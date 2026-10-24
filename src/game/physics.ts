"use client";

import * as THREE from "three";
import { Track, type GroundInfo, type TrackBox } from "./track";
import { clamp, damp, type DriveInput } from "./types";

export interface PhysicsEvents {
  onJump(): void;
  onLanding(intensity: number, clean: boolean): void;
  onCleanLand(airTime: number): void;
  onBigAir(airTime: number): void;
  onDriftBank(mult: number): void;
  onNearMiss(): void;
  onWallRideStart(): void;
  onCrash(intensity: number): void;
  onBoostStart(): void;
  onBoxHit(box: TrackBox): void;
  requestRecovery(): void;
}

const GRAV = 27;
const MAX_SPEED = 52;
const BOOST_SPEED = 66;
const ACCEL = 25;
const BOOST_ACCEL = 21;
const BRAKE_DECEL = 36;
const REVERSE_MAX = 13;

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function wrapIdxLocal(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Simple autopilot for self-testing: follows the racing line with P-steering. */
export function autopilotInput(p: CarPhysics, t: Track): DriveInput {
  const look = 12 + clamp(p.speed * 0.6, 8, 30);
  const li = wrapIdxLocal(p.idx + Math.round(look / t.step), t.N);
  const s = t.sample(li);
  const dx = s.x - p.pos.x;
  const dz = s.z - p.pos.z;
  const err = angDiff(Math.atan2(dx, dz), p.yaw);
  // NOTE: positive yaw turns the car toward its LEFT (forward = (sin,0,cos),
  // right = (-cos,0,sin)), so a positive heading error needs NEGATIVE steer.
  const steer = clamp(-err * 2.4, -1, 1);
  // corner speed heuristic from heading change ahead
  const s2 = t.sample(wrapIdxLocal(li + 12, t.N));
  const s3 = t.sample(wrapIdxLocal(li + 26, t.N));
  const dTheta = Math.abs(angDiff(Math.atan2(s3.dx, s3.dz), Math.atan2(s2.dx, s2.dz)));
  // never brake into a ramp/gap — jumps need commitment
  const fullSend = s.rampP >= 0 || s.gap || s2.rampP >= 0 || s2.gap || s3.rampP >= 0 || s3.gap;
  const target = fullSend ? 56 : clamp(52 / (1 + dTheta * 9), 15, 52);
  const fast = p.speed < target;
  return {
    steer,
    throttle: fast ? 1 : 0,
    brake: p.speed > target * 1.3 ? 0.5 : 0,
    handbrake: Math.abs(err) > 0.55 && p.speed > 20,
    boost: p.boostMeter > 72 && dTheta < 0.06,
  };
}

export class CarPhysics {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  yawRate = 0;
  grounded = true;
  airTime = 0;
  lastAirTime = 0;
  climbRate = 0;
  prevGroundY = 0;

  idx = 0;
  /** Continuous sample coordinate (idx + fractional step) — keeps the driven
   *  surface smooth instead of popping at every 2 m sample boundary. */
  groundP = 0;
  lateral = 0;
  progressS = 0; // unwrapped meters along the lap
  lapProgress = 0; // 0..1 through current lap

  drifting = false;
  driftChain = 0;
  driftCooldown = 0;
  driftScore = 0;
  slip = 0;

  boostMeter = 40;
  boosting = false;

  wallRiding = false;
  offRoad = false;
  onRoad = true;
  wrongWayTimer = 0;
  stuckTimer = 0;

  topSpeed = 0;
  nearMisses = 0;

  assist = true;
  /** Only the player's car counts near-misses / shared-obstacle cooldowns. */
  isPlayer = true;
  /** Difficulty boost-economy multiplier (easy > 1, hard < 1). */
  boostScale = 1;

  private gi: GroundInfo = { h: 0, onRoad: false, inPitZone: false };
  private ev: PhysicsEvents;
  private track: Track;
  private tmpF = new THREE.Vector3();
  private tmpR = new THREE.Vector3();

  constructor(track: Track, ev: PhysicsEvents) {
    this.track = track;
    this.ev = ev;
  }

  get forward(): THREE.Vector3 {
    return this.tmpF.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  get right(): THREE.Vector3 {
    return this.tmpR.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  /** Place the car on the track at (sample idx, lateral) facing forward. */
  place(idx: number, lat: number, speed: number, syncProgress = true) {
    const t = this.track;
    const s = t.sample(idx);
    const h = t.heightAt(idx, lat);
    this.pos.set(s.x + s.rx * lat, h + 0.05, s.z + s.rz * lat);
    this.yaw = Math.atan2(s.dx, s.dz);
    this.vel.set(s.dx * speed, 0, s.dz * speed);
    this.yawRate = 0;
    this.grounded = true;
    this.airTime = 0;
    this.climbRate = 0;
    this.idx = idx;
    this.lastIdx = idx; // keep the unwrapped-progress delta consistent after teleports
    this.groundP = idx;
    this.lateral = lat;
    this.prevGroundY = h;
    if (syncProgress) this.progressS = idx * t.step;
  }

  /** Re-sync unwrapped progress after a teleport. */
  syncProgress(baseS: number) {
    this.progressS = baseS;
  }

  update(input: DriveInput, dt: number): void {
    const t = this.track;
    // ---- track frame ----
    this.idx = t.nearestIdx(this.pos.x, this.pos.z, this.idx);
    const s = t.sample(this.idx);
    this.lateral = (this.pos.x - s.x) * s.rx + (this.pos.z - s.z) * s.rz;
    // continuous position along the spline (samples) — smooth ground queries
    const alongTrack = (this.pos.x - s.x) * s.dx + (this.pos.z - s.z) * s.dz;
    this.groundP = this.idx + clamp(alongTrack / t.step, -1.5, 1.5);

    // unwrapped progress
    let dIdx = this.idx - this.lastIdx;
    if (dIdx > t.N / 2) dIdx -= t.N;
    if (dIdx < -t.N / 2) dIdx += t.N;
    dIdx = clamp(dIdx, -30, 60);
    this.progressS += dIdx * t.step;
    this.lapProgress = clamp((this.progressS % t.length) / t.length, 0, 1);
    this.lastIdx = this.idx;

    const gi = t.groundAtP(this.groundP, this.lateral, this.gi);
    this.onRoad = gi.onRoad;
    this.offRoad = !gi.onRoad && !gi.inPitZone;

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);

    let vf = this.vel.x * fx + this.vel.z * fz;
    let vlat = this.vel.x * rx + this.vel.z * rz;
    let vy = this.vel.y;

    const speed = Math.hypot(vf, vlat);
    this.slip = Math.atan2(vlat, Math.max(4, Math.abs(vf)));

    // ---- ground / air transitions ----
    if (this.grounded) {
      const dh = gi.h - this.pos.y;
      if (dh < -0.5) {
        // ground fell away (cliff edge / gap lip / crest) — launch.
        // NOTE: no pit-zone special case here — a car resting on the pit
        // floor must STAY grounded so it can drive out of the valley.
        this.grounded = false;
        vy = clamp(this.climbRate, 0, 21) * 1.02;
        this.airTime = 0;
        if (vy > 3.2) this.ev.onJump();
      } else {
        this.pos.y = gi.h;
        const climb = (gi.h - this.prevGroundY) / Math.max(dt, 1e-4);
        this.climbRate = damp(this.climbRate, clamp(climb, -10, 26), 9, dt);
        this.prevGroundY = gi.h;
        vy = 0;
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      vy -= GRAV * dt;
    }

    // ---- steering ----
    // Convention: forward = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw).
    // Increasing yaw rotates the nose toward +X, which is the car's LEFT side,
    // so steering RIGHT (input.steer = +1) must produce a NEGATIVE yaw rate.
    const steerAuth = 1 / (1 + Math.pow(Math.abs(vf) * 0.026, 1.5));
    let targetYawRate = -input.steer * 2.5 * steerAuth * (this.drifting ? 1.55 : 1);
    if (!this.grounded) targetYawRate *= 0.34;

    if (this.assist && this.grounded) {
      const trackYaw = Math.atan2(s.dx, s.dz);
      const off = angDiff(trackYaw, this.yaw);
      if (Math.abs(off) > 0.5 && speed > 8) {
        targetYawRate += clamp(off, -1, 1) * 0.75 * clamp((Math.abs(off) - 0.5) / 1.2, 0, 1);
      }
      if (Math.abs(this.slip) > 1.05) targetYawRate *= 0.55; // anti-spin
    }
    this.yawRate = damp(this.yawRate, targetYawRate, this.grounded ? 8.5 : 3.5, dt);
    this.yaw += this.yawRate * dt;

    // ---- drift state machine ----
    const canDrift = this.grounded && Math.abs(vf) > 11;
    if (!this.drifting && input.handbrake && canDrift && Math.abs(input.steer) > 0.12) {
      this.drifting = true;
      this.driftChain = 0;
      // small kick to break traction: shove the chassis sideways, OPPOSITE to
      // the turn direction, so the velocity lags behind the rotating nose.
      vlat -= input.steer * 2.2;
    }
    if (this.drifting) {
      if (this.grounded && (input.handbrake || Math.abs(this.slip) > 0.16)) {
        this.driftChain += dt;
      } else {
        // end of drift — bank it
        if (this.driftChain > 0.85 && this.driftCooldown <= 0) {
          const mult = 1 + Math.min(2, this.driftChain / 6);
          this.boostMeter = clamp(this.boostMeter + Math.min(20, this.driftChain * 4) * this.boostScale, 0, 100);
          this.ev.onDriftBank(mult);
          this.driftCooldown = 0.7;
        }
        this.drifting = false;
        this.driftChain = 0;
      }
    }
    this.driftCooldown = Math.max(0, this.driftCooldown - dt);

    // ---- boost ----
    const wantBoost = input.boost && this.boostMeter > 1.5;
    if (wantBoost && !this.boosting) this.ev.onBoostStart();
    this.boosting = wantBoost;
    if (this.boosting) {
      this.boostMeter = Math.max(0, this.boostMeter - 26 * dt);
    }

    // ---- longitudinal forces ----
    const cap = this.boosting ? BOOST_SPEED : MAX_SPEED;
    if (input.throttle > 0.02) {
      let a = ACCEL * (1 - clamp(vf / cap, -1, 1)) * input.throttle;
      if (!this.onRoad && this.grounded) a *= 0.5;
      if (!this.grounded) a *= 0.45;
      if (this.boosting) a += BOOST_ACCEL * (1 - clamp(vf / BOOST_SPEED, 0, 1));
      vf += a * dt;
    } else {
      // coast drag
      const drag = this.grounded ? 2.2 + 0.011 * vf * vf : 0.15;
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
    }
    if (input.brake > 0.02) {
      if (vf > 0.5) {
        vf -= BRAKE_DECEL * input.brake * dt;
        if (vf < 0) vf = 0;
      } else {
        vf -= 10 * input.brake * dt; // reverse
        if (vf < -REVERSE_MAX) vf = -REVERSE_MAX;
      }
    }
    // handbrake slow
    if (input.handbrake && this.grounded && !this.drifting) {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
    }
    // off-road sand drag
    if (this.offRoad && this.grounded && !this.wallRiding) {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), (3.4 + 0.045 * Math.abs(vf)) * dt * 10) * 0.1;
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), (3.4 + 0.045 * Math.abs(vf)) * dt);
    }
    // slopes
    if (this.grounded) {
      const slopeF = t.slopeFwdAt(this.idx, this.lateral);
      vf -= GRAV * clamp(slopeF, -1.2, 1.2) * dt;
    }

    // ---- lateral grip ----
    if (this.grounded) {
      let grip = this.drifting ? 2.1 : 8.5;
      if (this.offRoad) grip = this.drifting ? 1.7 : 4.6;
      vlat *= Math.exp(-grip * dt);
      // gravity pull down slopes
      const slopeL = t.slopeLatAt(this.idx, this.lateral);
      vlat -= GRAV * (slopeL / Math.sqrt(1 + slopeL * slopeL)) * dt;
      // drift charge
      if (this.drifting) {
        const quality =
          clamp(Math.abs(this.slip) / 0.55, 0, 1) * clamp(Math.abs(vf) / 38, 0, 1);
        this.boostMeter = clamp(this.boostMeter + (9 + 13 * quality) * dt * this.boostScale, 0, 100);
        this.driftScore += (10 + 18 * quality) * (1 + Math.min(2, this.driftChain / 6)) * dt;
      }
    }

    // ---- wall-ride ----
    const rideZone =
      (s.wallRideR && this.lateral > s.hw * 0.75) || (s.wallRideL && this.lateral < -s.hw * 0.75);
    const wasRiding = this.wallRiding;
    this.wallRiding = this.grounded && rideZone && Math.abs(vf) > 18;
    if (this.wallRiding && !wasRiding) this.ev.onWallRideStart();
    if (this.wallRiding) {
      this.boostMeter = clamp(this.boostMeter + 15 * dt * this.boostScale, 0, 100);
      this.driftScore += 14 * dt;
    }

    // ---- airtime charge ----
    if (!this.grounded) {
      this.boostMeter = clamp(this.boostMeter + 6 * dt * this.boostScale, 0, 100);
      this.driftScore += 8 * dt;
    }

    // ---- rebuild velocity ----
    this.vel.set(fx * vf + rx * vlat, vy, fz * vf + rz * vlat);

    // ---- walls ----
    for (const side of [1, -1] as const) {
      const wd = t.wallDist(this.idx, side);
      const lat = this.lateral;
      if (side === 1 ? lat > wd : lat < -wd) {
        const pen = Math.abs(lat) - wd;
        const nx = s.rx * side;
        const nz = s.rz * side;
        this.pos.x -= nx * pen;
        this.pos.z -= nz * pen;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn > 0) {
          this.vel.x -= nx * vn * 1.55;
          this.vel.z -= nz * vn * 1.55;
          const impact = vn;
          if (impact > 3.5) {
            this.ev.onCrash(clamp(impact / 26, 0.15, 1));
            if (this.drifting) {
              this.drifting = false;
              this.driftChain = 0;
            }
          }
          // slow down a bit on hard hits
          const sf = impact > 9 ? 0.9 : 0.985;
          this.vel.x *= sf;
          this.vel.z *= sf;
        }
        this.lateral = wd * side;
      }
    }

    // ---- obstacles ----
    for (const ob of this.track.obstacles) {
      const dx = this.pos.x - ob.x;
      const dz = this.pos.z - ob.z;
      const d2 = dx * dx + dz * dz;
      const near = ob.r + 2.8;
      if (d2 < near * near) {
        const d = Math.sqrt(d2);
        const now = performance.now();
        if (d < ob.r + 1.0 && this.pos.y < ob.top && this.pos.y > ob.top - 6) {
          // collision
          const nx = d > 0.001 ? dx / d : 1;
          const nz = d > 0.001 ? dz / d : 0;
          const push = ob.r + 1.0 - d;
          this.pos.x += nx * push;
          this.pos.z += nz * push;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) {
            this.vel.x -= nx * vn * 1.6;
            this.vel.z -= nz * vn * 1.6;
            const impact = -vn;
            if (impact > 5) {
              this.ev.onCrash(clamp(impact / 24, 0.15, 1));
              if (this.drifting) {
                this.drifting = false;
                this.driftChain = 0;
              }
              this.vel.x *= 0.88;
              this.vel.z *= 0.88;
            }
          }
        } else if (
          d < near &&
          this.speed > 22 &&
          now - ob.lastNear > 5000 &&
          Math.abs(this.pos.y - (ob.top - 2)) < 6 &&
          this.isPlayer
        ) {
          ob.lastNear = now;
          this.nearMisses++;
          this.boostMeter = clamp(this.boostMeter + 9 * this.boostScale, 0, 100);
          this.ev.onNearMiss();
        }
      }
    }

    // ---- breakable crates & barricade ----
    // Smash through: the crate/segment explodes and the car sheds a little
    // speed (less for the barricade — it is meant to be smashed flat out),
    // then accelerates back up naturally. You can also jump clean over them.
    for (const b of t.boxes) {
      if (!b.active) continue;
      const dx = this.pos.x - b.x;
      const dz = this.pos.z - b.z;
      if (dx * dx + dz * dz > 3.6) continue; // (1.9 m)² — forgiving arcade radius
      if (Math.abs(this.pos.y - b.y) > b.halfH + 0.9) continue; // sailed over it
      b.active = false;
      b.mesh.visible = false;
      b.respawnAt = Infinity; // owner schedules the respawn via onBoxHit
      // little slow-down + a sideways stagger (barricades barely slow you)
      const shed = b.wall ? 0.92 : 0.78;
      this.vel.x *= shed;
      this.vel.z *= shed;
      this.vel.x += rx * (Math.random() - 0.5) * 1.6;
      this.vel.z += rz * (Math.random() - 0.5) * 1.6;
      if (this.drifting) {
        this.drifting = false;
        this.driftChain = 0;
      }
      this.ev.onBoxHit(b);
    }

    // ---- integrate ----
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // ---- landing ----
    if (!this.grounded) {
      // refresh the continuous coordinate after integration for an accurate surface test
      const s2 = t.sample(this.idx);
      const along2 = (this.pos.x - s2.x) * s2.dx + (this.pos.z - s2.z) * s2.dz;
      const gi2 = t.groundAtP(this.idx + clamp(along2 / t.step, -1.5, 1.5), this.lateral, this.gi);
      if (this.pos.y <= gi2.h && this.vel.y <= 0.01) {
        const impact = -this.vel.y;
        const clean = this.slipAbsAtLanding(vf, vlat) && impact < 21;
        this.grounded = true;
        this.pos.y = gi2.h;
        this.prevGroundY = gi2.h;
        this.climbRate = 0;
        this.lastAirTime = this.airTime;
        this.airTime = 0;
        this.vel.y = 0;
        if (impact > 7) this.ev.onLanding(clamp(impact / 24, 0.1, 1), clean);
        if (clean && this.lastAirTime > 0.45) {
          this.boostMeter = clamp(this.boostMeter + Math.min(30, this.lastAirTime * 16) * this.boostScale, 0, 100);
          this.ev.onCleanLand(this.lastAirTime);
          if (this.lastAirTime > 1.15) this.ev.onBigAir(this.lastAirTime);
        } else if (!clean && impact > 14) {
          vf *= 0.7;
          this.vel.x *= 0.7;
          this.vel.z *= 0.7;
          this.ev.onCrash(0.5);
        }
      }
    }

    // ---- pit fall ----
    // Only a genuine fall-through (below the valley floor itself) recovers;
    // a car that landed in the pit stays put and drives out via the ramp.
    if (gi.inPitZone && this.pos.y < gi.h - 3) {
      this.ev.requestRecovery();
    }

    // ---- stuck detection ----
    if (this.grounded && this.speed < 1.2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 3.5) {
        this.stuckTimer = 0;
        this.ev.requestRecovery();
      }
    } else {
      this.stuckTimer = 0;
    }

    // ---- wrong way ----
    const along = this.vel.x * s.dx + this.vel.z * s.dz;
    if (along < -3 && this.speed > 4) {
      this.wrongWayTimer += dt;
    } else {
      this.wrongWayTimer = 0;
    }

    this.topSpeed = Math.max(this.topSpeed, this.speedKmh);
  }

  private slipAbsAtLanding(vf: number, vlat: number): boolean {
    const align = vf / Math.max(1, Math.hypot(vf, vlat));
    return align > 0.85;
  }

  get wrongWay(): boolean {
    return this.wrongWayTimer > 1.1;
  }

  /** RPM & gear for HUD/engine audio. */
  gearAndRpm(): { gear: number; rpm: number } {
    const v = Math.abs(this.speed);
    const bands = [0, 9, 17, 26, 36, 47, 62, 80];
    let gear = 1;
    for (let i = 1; i < bands.length - 1; i++) {
      if (v >= bands[i]) gear = i + 1;
    }
    const lo = bands[gear - 1];
    const hi = bands[gear];
    const rpm = clamp(0.22 + ((v - lo) / (hi - lo)) * 0.68, 0.18, 1);
    return { gear, rpm };
  }

  private lastIdx = 0;
}
