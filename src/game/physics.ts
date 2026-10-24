"use client";

import * as THREE from "three";
import { Track, type GroundInfo, type Surface, type TrackBox } from "./track";
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

// ============================================================
// Surface physics profile
// ------------------------------------------------------------
// Each surface defines a physics "personality" so the car behaves
// believably on every part of the world. All values are tuned for
// arcade-realism: noticeable, but never frustrating.
//   gripMul       — lateral traction multiplier (1 = asphalt)
//   rollResist    — constant deceleration force (m/s²) at speed
//   accelMul      — engine power multiplier on this surface
//   brakeMul      — brake effectiveness multiplier
//   steerMul      — steering authority multiplier (grip-limited)
//   bumpAmp       — vertical suspension excitation amplitude (m)
//   bumpFreq      — spatial frequency of bump excitation (per m)
//   dragQuad      — aerodynamic-style v² drag coefficient
//   driftFriction — lateral grip while drifting (lower = slidier)
//   colour        — UI label colour (HUD surface chip)
// ============================================================

export interface SurfaceProps {
  gripMul: number;
  rollResist: number;
  accelMul: number;
  brakeMul: number;
  steerMul: number;
  bumpAmp: number;
  bumpFreq: number;
  dragQuad: number;
  driftFriction: number;
  label: string;
  colour: string;
}

export const SURFACE_PROPS: Record<Surface, SurfaceProps> = {
  asphalt: {
    gripMul: 1.0,
    rollResist: 2.2,
    accelMul: 1.0,
    brakeMul: 1.0,
    steerMul: 1.0,
    bumpAmp: 0.02,
    bumpFreq: 0.05,
    dragQuad: 0.011,
    driftFriction: 2.1,
    label: "TARMAC",
    colour: "#4a4640",
  },
  concrete: {
    gripMul: 0.96,
    rollResist: 2.3,
    accelMul: 1.0,
    brakeMul: 1.02,
    steerMul: 0.98,
    bumpAmp: 0.015,
    bumpFreq: 0.04,
    dragQuad: 0.012,
    driftFriction: 2.05,
    label: "CONCRETE",
    colour: "#8a8276",
  },
  dirt: {
    gripMul: 0.78,
    rollResist: 4.0,
    accelMul: 0.86,
    brakeMul: 0.82,
    steerMul: 0.88,
    bumpAmp: 0.09,
    bumpFreq: 0.18,
    dragQuad: 0.018,
    driftFriction: 1.85,
    label: "DIRT",
    colour: "#9b6b3f",
  },
  gravel: {
    gripMul: 0.7,
    rollResist: 5.2,
    accelMul: 0.78,
    brakeMul: 0.7,
    steerMul: 0.82,
    bumpAmp: 0.07,
    bumpFreq: 0.22,
    dragQuad: 0.022,
    driftFriction: 1.7,
    label: "GRAVEL",
    colour: "#b09a7a",
  },
  grass: {
    gripMul: 0.62,
    rollResist: 6.8,
    accelMul: 0.66,
    brakeMul: 0.58,
    steerMul: 0.74,
    bumpAmp: 0.05,
    bumpFreq: 0.16,
    dragQuad: 0.026,
    driftFriction: 1.6,
    label: "GRASS",
    colour: "#6f7a3e",
  },
  sand: {
    gripMul: 0.5,
    rollResist: 9.5,
    accelMul: 0.5,
    brakeMul: 0.45,
    steerMul: 0.6,
    bumpAmp: 0.04,
    bumpFreq: 0.14,
    dragQuad: 0.034,
    driftFriction: 1.4,
    label: "SAND",
    colour: "#e0b878",
  },
  mud: {
    gripMul: 0.42,
    rollResist: 11.5,
    accelMul: 0.42,
    brakeMul: 0.4,
    steerMul: 0.55,
    bumpAmp: 0.05,
    bumpFreq: 0.12,
    dragQuad: 0.04,
    driftFriction: 1.25,
    label: "MUD",
    colour: "#6a4a2a",
  },
  wet: {
    gripMul: 0.72,
    rollResist: 2.6,
    accelMul: 0.95,
    brakeMul: 0.74,
    steerMul: 0.86,
    bumpAmp: 0.02,
    bumpFreq: 0.05,
    dragQuad: 0.013,
    driftFriction: 1.75,
    label: "WET",
    colour: "#3a3a3a",
  },
  rock: {
    gripMul: 0.82,
    rollResist: 3.4,
    accelMul: 0.9,
    brakeMul: 0.86,
    steerMul: 0.9,
    bumpAmp: 0.14,
    bumpFreq: 0.32,
    dragQuad: 0.016,
    driftFriction: 1.95,
    label: "ROCK",
    colour: "#9c6a44",
  },
};

// ============================================================
// Constants — identical for every car (visual-only differentiation)
// ============================================================
const GRAV = 27;
const MAX_SPEED = 52;
const BOOST_SPEED = 66;
const ACCEL = 25;
const BOOST_ACCEL = 21;
const BRAKE_DECEL = 36;
const REVERSE_MAX = 13;

// --- suspension model ---
// A real per-chassis spring–damper, integrated with semi-implicit Euler.
//   compression  = (ground + SUS_REST) − chassisY   (+ = compressed)
//   susAccel     = compression·K + (groundVy − vy)·C
// The damper acts on the velocity RELATIVE TO THE GROUND (feedforward):
// on a slope the ground contact point moves vertically at groundVy, and the
// damper transmits that motion to the chassis almost instantly — so the car
// tracks uphills/downhills with essentially no lag and never "falls behind"
// the terrain (which used to trigger spurious launches).
//   ω = √K ≈ 11.8 rad/s, ζ = C/(2√K) ≈ 0.93 → critically-ish damped: one
//   small rebound at most, settled within ~0.2 s. Hard landings hit the
//   bump-stop (bottom out) — the tire absorbs the rest with NO rebound kick.
const SUS_STIFFNESS = 140; // spring rate (per m of compression)
const SUS_DAMPING = 22; // damper rate (per m/s of ground-relative velocity)
const SUS_REST = 0.42; // rest ride height above ground (m)
const SUS_TRAVEL = 0.55; // max compression before bottoming out (m)
const SUS_DROOP = 0.42; // max wheel extension before the car un-grounds (m)
const SUS_MAX_ACCEL = 300; // clamp on suspension acceleration (anti-spike)
const SUS_MIN_CLEAR = 0.06; // chassis floor above terrain at full bottom-out (m)
const GROUND_VY_CLAMP = 30; // clamp on the terrain-rate estimate (sample noise)

// --- weight transfer ---
// Longitudinal: weight shifts forward under braking, rearward under accel.
// Lateral: weight shifts to the outside wheels in a corner. These shift
// grip front/rear and left/right, enabling realistic controlled drift.
const WT_LONG = 0.32; // fraction of weight shifted fwd/bwd at 1g accel/brake
const WT_LAT = 0.30; // fraction shifted sideways at 1g lateral

// --- nitro recharge ---
const NITRO_RECHARGE_PER_SEC = 10; // 10s for a full 0→100 refill
const NITRO_DRAIN_PER_SEC = 33; // ~3s of full-bore boost from full

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
  /** Difficulty straight-line speed-cap multiplier — HARD rivals (1.17) cruise
   *  at ~61 u/s vs the player's 52, so the player must drift + boost to keep up. */
  speedCapScale = 1;

  // --- new realistic-physics state ---
  /** Current surface under the car (drives grip, drag, bumps). */
  surface: Surface = "asphalt";
  /** Smoothed surface (so the HUD chip doesn't flicker at sample boundaries). */
  surfaceBlend: Surface = "asphalt";
  /** Per-axle suspension compression 0..1 (front, rear). 1 = bottomed out. */
  susCompression = [0, 0];
  /** Per-axle suspension velocity (m/s) — drives the damper force. */
  private susVel = [0, 0];
  /** Body pitch (rad) from weight transfer + suspension. */
  bodyPitch = 0;
  /** Body roll (rad) from lateral weight transfer. */
  bodyRoll = 0;
  /** Longitudinal load transfer fraction (-WT_LONG..+WT_LONG). + = nose-up under accel. */
  loadLong = 0;
  /** Lateral load transfer fraction (-WT_LAT..+WT_LAT). + = leaning right in a left turn. */
  loadLat = 0;
  /** Nitro meter — separate from boost (the existing drift/near-miss bank).
   *  Drains while boosting at NITRO_DRAIN_PER_SEC, refills at
   *  NITRO_RECHARGE_PER_SEC when not. Identical for every car. */
  nitro = 100;
  /** Boost button currently held (X / Numpad0 / touch). */
  nitroActive = false;

  /** Vertical velocity of the terrain under the car (m/s, smoothed estimate).
   *  Used by the suspension damper as a feedforward target. */
  groundVyEst = 0;

  private gi: GroundInfo = { h: 0, onRoad: false, inPitZone: false, surface: "asphalt" };
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
    // spawn AT ride height so the suspension starts settled (no launch pop)
    this.pos.set(s.x + s.rx * lat, h + SUS_REST, s.z + s.rz * lat);
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
    // reset suspension so the rebuilt car doesn't pitch on placement
    this.susCompression = [0, 0];
    this.susVel = [0, 0];
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.loadLong = 0;
    this.loadLat = 0;
    this.groundVyEst = 0;
    this.vel.y = 0;
  }

  /** Re-sync unwrapped progress after a teleport. */
  syncProgress(baseS: number) {
    this.progressS = baseS;
  }

  update(input: DriveInput, dt: number): void {
    // ---- frame-rate independence ----
    // The spring–damper suspension is conditionally stable in explicit
    // integration; anything above ~22 ms is split into two half-steps so
    // 30 fps and 60 fps produce identical vehicle behaviour (the deterministic
    // selftest drives exactly 1/60 s steps → single step, bit-identical).
    if (dt > 1 / 45 && dt <= 0.25) {
      this.update(input, dt / 2);
      this.update(input, dt / 2);
      return;
    }
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
    // surface: blend instantly at low speeds (so HUD chip is responsive) but
    // never flicker at sample boundaries — surfaceAtP already interpolates
    this.surface = gi.surface;
    this.surfaceBlend = gi.surface;
    const surf = SURFACE_PROPS[gi.surface];

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);

    let vf = this.vel.x * fx + this.vel.z * fz;
    let vlat = this.vel.x * rx + this.vel.z * rz;
    let vy = this.vel.y;

    const speed = Math.hypot(vf, vlat);
    this.slip = Math.atan2(vlat, Math.max(4, Math.abs(vf)));

    // ---- ground / air transitions (real spring–damper suspension) ----
    // The chassis is a mass on a spring resting on the moving terrain
    // contact point. Slopes push it up / let it down through the damper
    // feedforward (groundVy), bumps compress the spring, and the car only
    // leaves the ground when the wheel would have to extend past its droop
    // limit (a genuine cliff / gap lip / hard crest) — carrying its real
    // vertical velocity with it (no fabricated launch impulse).
    if (this.grounded) {
      const target = gi.h + SUS_REST;
      const gap = this.pos.y - target; // + = chassis above ride height (wheel extended)
      if (gap > SUS_DROOP) {
        // wheel has hung past full droop — the ground has genuinely fallen
        // away (cliff edge / gap lip / sharp crest). Go airborne with
        // VELOCITY CONTINUITY: vy already carries whatever the spring gave
        // us on the preceding ramp/climb.
        this.grounded = false;
        this.airTime = 0;
        if (vy > 3.2) this.ev.onJump();
      } else {
        // terrain vertical rate at the contact patch (feedforward for the
        // damper). Rate-limited against single-sample noise.
        const groundVy = clamp((gi.h - this.prevGroundY) / Math.max(dt, 1e-4), -GROUND_VY_CLAMP, GROUND_VY_CLAMP);
        this.groundVyEst = groundVy;
        // spring–damper (semi-implicit: accelerate vy first, then integrate)
        const compression = -gap; // + = compressed (chassis low), − = extended
        let susA = compression * SUS_STIFFNESS + (groundVy - vy) * SUS_DAMPING;
        susA = clamp(susA, -SUS_MAX_ACCEL, SUS_MAX_ACCEL);
        vy += susA * dt;
        // suspension compression for visual body pitch/roll (front & rear
        // axles sample the ground slightly ahead/behind the centre)
        const slopeF = t.slopeFwdAtP(this.groundP, this.lateral);
        const fH = gi.h + slopeF * 1.2; // ground height at front axle
        const rH = gi.h - slopeF * 1.2; // ground height at rear axle
        // per-axle compression 0..1 (1 = bottomed out)
        const fComp = clamp(1 - (fH + SUS_REST - this.pos.y) / SUS_TRAVEL, 0, 1);
        const rComp = clamp(1 - (rH + SUS_REST - this.pos.y) / SUS_TRAVEL, 0, 1);
        this.susCompression[0] = damp(this.susCompression[0], fComp, 12, dt);
        this.susCompression[1] = damp(this.susCompression[1], rComp, 12, dt);
        // surface bumps excite the suspension (rocks / gravel / dirt are bumpy)
        if (surf.bumpAmp > 0.01) {
          const bumpPhase = this.progressS * surf.bumpFreq;
          const bump = Math.sin(bumpPhase) * Math.sin(bumpPhase * 1.7 + 1.3);
          this.susCompression[0] = clamp(
            this.susCompression[0] + bump * surf.bumpAmp * 0.4 * Math.min(1, speed / 18),
            0,
            1
          );
          this.susCompression[1] = clamp(
            this.susCompression[1] - bump * surf.bumpAmp * 0.4 * Math.min(1, speed / 18),
            0,
            1
          );
        }
        this.climbRate = damp(this.climbRate, clamp(groundVy, -10, 26), 9, dt);
        this.prevGroundY = gi.h;
        // vy flows into vel.y below — the integration moves the chassis
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      vy -= GRAV * dt;
      // anti-flip: clamp vertical velocity so big air can't send the car
      // tumbling off into the sky (and landings stay controllable)
      vy = clamp(vy, -42, 22);
    }

    // ---- weight transfer ----
    // Longitudinal: braking shifts load forward (more front grip, less rear),
    // accelerating shifts it rearward (more rear grip for traction). This is
    // the key to controlled drift — brake into a corner and the rear goes
    // light, so it breaks traction first when you steer.
    const longAccel =
      (input.throttle > 0.02 ? ACCEL * input.throttle : 0) -
      (input.brake > 0.02 ? BRAKE_DECEL * input.brake : 0);
    this.loadLong = damp(this.loadLong, clamp(-longAccel / GRAV, -1, 1) * WT_LONG, 8, dt);
    // Lateral: cornering force shifts load to the outside wheels.
    const latAccel = vlat * 0; // placeholder — actual lateral accel = yawRate × speed
    const lateralG = clamp(this.yawRate * Math.abs(vf) / GRAV, -1.4, 1.4);
    this.loadLat = damp(this.loadLat, lateralG * WT_LAT, 8, dt);
    void latAccel;

    // ---- steering ----
    // Convention: forward = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw).
    // Increasing yaw rotates the nose toward +X, which is the car's LEFT side,
    // so steering RIGHT (input.steer = +1) must produce a NEGATIVE yaw rate.
    const steerAuth = 1 / (1 + Math.pow(Math.abs(vf) * 0.026, 1.5));
    // surface reduces steering authority (sand/dirt = vague, loose steering)
    let targetYawRate = -input.steer * 2.5 * steerAuth * surf.steerMul * (this.drifting ? 1.55 : 1);
    if (!this.grounded) targetYawRate *= 0.34;

    if (this.assist && this.grounded) {
      const trackYaw = Math.atan2(s.dx, s.dz);
      const off = angDiff(trackYaw, this.yaw);
      if (Math.abs(off) > 0.5 && speed > 8) {
        targetYawRate += clamp(off, -1, 1) * 0.75 * clamp((Math.abs(off) - 0.5) / 1.2, 0, 1);
      }
      if (Math.abs(this.slip) > 1.05) targetYawRate *= 0.55; // anti-spin
    }
    // weight transfer affects steering response: more front load = more turn-in
    const frontLoad = 0.5 + this.loadLong * 0.5; // 0..1 front axle load
    targetYawRate *= 0.85 + 0.3 * frontLoad;
    this.yawRate = damp(this.yawRate, targetYawRate, this.grounded ? 8.5 : 3.5, dt);
    this.yaw += this.yawRate * dt;

    // ---- drift state machine ----
    // Drift is initiated by handbrake OR by lifting off the throttle while
    // braking into a corner (weight-transfer breakaway). Once sliding, rear
    // grip stays low until you straighten or release the slide.
    const canDrift = this.grounded && Math.abs(vf) > 11;
    const wtBreakaway =
      input.brake > 0.3 && Math.abs(input.steer) > 0.3 && Math.abs(vf) > 18 && this.loadLong > 0.12;
    if (
      !this.drifting &&
      canDrift &&
      (input.handbrake || wtBreakaway) &&
      Math.abs(input.steer) > 0.12
    ) {
      this.drifting = true;
      this.driftChain = 0;
      // kick the chassis sideways opposite to the turn direction so the
      // velocity lags behind the rotating nose (controlled slide initiation)
      vlat -= input.steer * 2.2 * surf.gripMul;
    }
    if (this.drifting) {
      if (this.grounded && (input.handbrake || Math.abs(this.slip) > 0.16)) {
        this.driftChain += dt;
      } else {
        // end of drift — bank it
        if (this.driftChain > 0.85 && this.driftCooldown <= 0) {
          const mult = 1 + Math.min(2, this.driftChain / 6);
          this.boostMeter = clamp(
            this.boostMeter + Math.min(20, this.driftChain * 4) * this.boostScale,
            0,
            100
          );
          this.ev.onDriftBank(mult);
          this.driftCooldown = 0.7;
        }
        this.drifting = false;
        this.driftChain = 0;
      }
    }
    this.driftCooldown = Math.max(0, this.driftCooldown - dt);

    // ---- nitro system ----
    // Nitro is a separate energy bar from the drift/near-miss boost bank.
    // Drains while held, refills passively over 10s when not. Identical for
    // every car. Boost is applied through the existing physics (BOOST_ACCEL)
    // — never a teleport or an abrupt velocity change.
    const wantNitro = input.boost && this.nitro > 1.5;
    const wasBoosting = this.boosting || this.nitroActive;
    this.nitroActive = wantNitro;
    if (wantNitro) {
      this.nitro = Math.max(0, this.nitro - NITRO_DRAIN_PER_SEC * dt);
    } else {
      // passive recharge — 10s for a full 0→100 refill (identical for every car)
      this.nitro = Math.min(100, this.nitro + NITRO_RECHARGE_PER_SEC * dt);
    }

    // ---- boost (drift/near-miss bank — unchanged for compatibility) ----
    const wantBoost = input.boost && this.boostMeter > 1.5;
    this.boosting = wantBoost;
    if (this.boosting) {
      this.boostMeter = Math.max(0, this.boostMeter - 26 * dt);
    }
    // fire the boost-start audio when EITHER nitro or the drift-bank engages
    const nowBoosting = this.boosting || this.nitroActive;
    if (nowBoosting && !wasBoosting) this.ev.onBoostStart();

    // ---- longitudinal forces ----
    // Nitro and boost both contribute (nitro is the user-facing system; the
    // boost meter is the drift/near-miss bank that still drains separately).
    const boosting = this.boosting || wantNitro;
    const cap = boosting ? BOOST_SPEED : MAX_SPEED * this.speedCapScale;
    if (input.throttle > 0.02) {
      let a = ACCEL * (1 - clamp(vf / cap, -1, 1)) * input.throttle;
      // surface reduces acceleration (sand/mud sap engine power)
      a *= surf.accelMul;
      if (!this.grounded) a *= 0.45;
      if (boosting) a += BOOST_ACCEL * (1 - clamp(vf / BOOST_SPEED, 0, 1));
      vf += a * dt;
    } else {
      // coast drag — surface-dependent
      const drag = this.grounded
        ? surf.rollResist + surf.dragQuad * vf * vf
        : 0.15;
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
    }
    if (input.brake > 0.02) {
      if (vf > 0.5) {
        // surface reduces braking effectiveness (sand/mud/grass = longer stops)
        const decel = BRAKE_DECEL * surf.brakeMul * input.brake;
        vf -= decel * dt;
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
    // off-road sand/mud drag (extra heavy resistance — sand should slow cars)
    if (this.offRoad && this.grounded && !this.wallRiding) {
      const extraDrag = (surf.rollResist - 2.2) * 0.6;
      if (extraDrag > 0) {
        vf -= Math.sign(vf) * Math.min(Math.abs(vf), extraDrag * dt);
      }
    }
    // slopes — uphill saps speed, downhill adds it (graded by surface grip)
    if (this.grounded) {
      const slopeF = t.slopeFwdAtP(this.groundP, this.lateral);
      vf -= GRAV * clamp(slopeF, -1.2, 1.2) * dt;
    }

    // ---- lateral grip ----
    // Per-axle grip with weight transfer: front axle grip rises under braking
    // (more turn-in), rear axle grip drops (easier drift). Under accel the
    // reverse — rear grips harder (traction), front goes light (understeer).
    if (this.grounded) {
      const frontGrip = (this.drifting ? surf.driftFriction : 8.5) * surf.gripMul;
      const rearGrip = (this.drifting ? surf.driftFriction * 0.85 : 8.5 * 0.95) * surf.gripMul;
      // weight-transfer modulation: rear grip drops under braking (drift!),
      // rises under acceleration (traction)
      const rearLoad = 0.5 - this.loadLong * 0.5; // 0..1 rear axle load
      const gripEff = (frontGrip + rearGrip) * 0.5 * (0.7 + 0.6 * rearLoad);
      vlat *= Math.exp(-gripEff * dt);
      // gravity pull down slopes
      const slopeL = t.slopeLatAtP(this.groundP, this.lateral);
      vlat -= GRAV * (slopeL / Math.sqrt(1 + slopeL * slopeL)) * dt;
      // drift charge
      if (this.drifting) {
        const quality =
          clamp(Math.abs(this.slip) / 0.55, 0, 1) * clamp(Math.abs(vf) / 38, 0, 1);
        this.boostMeter = clamp(
          this.boostMeter + (9 + 13 * quality) * dt * this.boostScale,
          0,
          100
        );
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

    // ---- body pitch & roll (visual — driven by weight transfer) ----
    this.bodyPitch = damp(this.bodyPitch, this.loadLong * 0.09, 7, dt);
    this.bodyRoll = damp(this.bodyRoll, -this.loadLat * 0.11, 7, dt);

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
    for (const b of t.boxes) {
      if (!b.active) continue;
      const dx = this.pos.x - b.x;
      const dz = this.pos.z - b.z;
      if (dx * dx + dz * dz > 3.6) continue; // (1.9 m)² — forgiving arcade radius
      if (Math.abs(this.pos.y - b.y) > b.halfH + 0.9) continue; // sailed over it
      b.active = false;
      b.mesh.visible = false;
      b.respawnAt = Infinity;
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
    // ---- suspension bump-stop (bottoming out) ----
    // The chassis can never penetrate the terrain: at full compression it
    // hits the bump-stop, which kills any remaining downward velocity
    // (the tire absorbs it — metal-to-metal contact does NOT rebound).
    if (this.grounded) {
      const floor = gi.h + SUS_MIN_CLEAR;
      if (this.pos.y < floor) {
        this.pos.y = floor;
        if (this.vel.y < this.groundVyEst) this.vel.y = this.groundVyEst;
      }
      // safety net: a mis-sample / collision pop can never leave the
      // grounded chassis floating far above the ride height either
      const ceil = gi.h + SUS_REST + SUS_DROOP + 0.25;
      if (this.pos.y > ceil) {
        this.pos.y = ceil;
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }

    // ---- landing ----
    // Touch down when the chassis descends to RIDE HEIGHT — the spring
    // then compresses over the following frames to absorb the impact (hard
    // landings bottom out against the bump-stop above). No teleport snap,
    // no vy zeroing: energy is absorbed by the suspension, not deleted.
    if (!this.grounded) {
      const s2 = t.sample(this.idx);
      const along2 = (this.pos.x - s2.x) * s2.dx + (this.pos.z - s2.z) * s2.dz;
      const gi2 = t.groundAtP(this.idx + clamp(along2 / t.step, -1.5, 1.5), this.lateral, this.gi);
      if (this.pos.y <= gi2.h + SUS_REST && this.vel.y <= 0) {
        const impact = -this.vel.y;
        const clean = this.slipAbsAtLanding(vf, vlat) && impact < 21;
        this.grounded = true;
        this.prevGroundY = gi2.h;
        this.climbRate = 0;
        this.lastAirTime = this.airTime;
        this.airTime = 0;
        // NOTE: pos.y and vel.y are kept — the spring absorbs the impact.
        // A touchdown below the bump-stop floor (very fast fall) is clamped
        // so the car can't clip into the terrain on the landing frame.
        const floor2 = gi2.h + SUS_MIN_CLEAR;
        if (this.pos.y < floor2) {
          this.pos.y = floor2;
          this.vel.y = Math.max(this.vel.y, 0);
        }
        if (impact > 7) this.ev.onLanding(clamp(impact / 24, 0.1, 1), clean);
        if (clean && this.lastAirTime > 0.45) {
          this.boostMeter = clamp(
            this.boostMeter + Math.min(30, this.lastAirTime * 16) * this.boostScale,
            0,
            100
          );
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
    if (gi.inPitZone && this.pos.y < gi.h - 3) {
      this.ev.requestRecovery();
    }

    // ---- world-bounds recovery (invisible barrier backstop) ----
    // If a mis-sample, a collision pop or a botched wall-ride sends the car
    // below the world floor or out beyond the playable radius, recover it
    // instead of letting it fall forever. This is the safety net that lets
    // us keep the walls hard but forgiving — drivers never get stuck in the
    // void if they somehow clip through.
    if (this.pos.y < -30 || this.pos.y > 120) {
      this.ev.requestRecovery();
    }
    const distFromOrigin = Math.hypot(this.pos.x, this.pos.z);
    if (distFromOrigin > 2400) {
      this.ev.requestRecovery();
    }
    // upside-down recovery: if the car is grounded but the chassis is
    // severely tilted (flipped on its side), recover. The track slope never
    // exceeds ~0.7 rad, so anything beyond 1.1 means the car is on its roof.
    if (this.grounded && Math.abs(this.bodyRoll) > 1.1) {
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
