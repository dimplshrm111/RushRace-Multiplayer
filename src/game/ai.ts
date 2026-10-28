"use client";

import * as THREE from "three";
import { Track, type TrackBox } from "./track";
import { CarPhysics, BOOST_SPEED } from "./physics";
import { CarVisual } from "./car";
import type { CarModelId } from "./cars";
import { clamp, damp, type DriveInput } from "./types";

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function wrapIdxLocal(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export interface OpponentDefinition {
  name: string;
  cssColor: string;
  body: number;
  accent: number;
  /** garage model the rival drives (visual only) */
  car: CarModelId;
  /** 0..1 — corner-speed confidence & steering sharpness */
  skill: number;
}

/** The three rivals (identical performance, different rides & skill). */
export const OPPONENTS: OpponentDefinition[] = [
  { name: "VIPER", cssColor: "#2f9e63", body: 0x2f9e63, accent: 0x44484f, car: "bison", skill: 0.975 },
  { name: "MESA", cssColor: "#d64530", body: 0xd64530, accent: 0x2b2d31, car: "himalaya", skill: 0.94 },
  { name: "HAWK", cssColor: "#1f8a70", body: 0x1f8a70, accent: 0xb9bec4, car: "falcon", skill: 0.9 },
];

/** Per-difficulty driving brain, set by the engine from DIFFICULTIES. */
export interface AiBrain {
  /** pace multiplier (corner + straight targets) */
  skillScale: number;
  /** seconds between unforced errors (0 = flawless — HARD) */
  mistakeEvery: number;
  /** catch-up bonus when the PLAYER leads (per 200 m of gap) */
  rubberAhead: number;
  /** mercy slowdown when the player trails (per 200 m of gap) */
  rubberBehind: number;
  /** 0..1 — how eagerly rivals spend NITRO on straights (fire point,
   *  tank drain depth, wheel-to-wheel defense) */
  boostAggro: number;
  /** actively sit on the player's line when just ahead */
  blocking: boolean;
}

const DEFAULT_BRAIN: AiBrain = {
  skillScale: 1,
  mistakeEvery: 26,
  rubberAhead: 0.05,
  rubberBehind: 0.055,
  boostAggro: 0.55,
  blocking: false,
};

/** Player context the rivals react to. */
export interface AiContext {
  /** player race distance (progressS - startS) */
  playerDist: number;
  /** player lateral offset on the track (for line blocking) */
  playerLat: number;
}

/** Per-car grid slot: lateral offset on the start line. */
export const OPPONENT_GRID_LAT = [-2.6, 2.6, -2.6];

/**
 * An AI rival. Same CarPhysics as the player (identical performance);
 * only the driving brain and the paint job differ.
 */
export class Opponent {
  physics: CarPhysics;
  visual: CarVisual;
  label: THREE.Sprite;
  readonly def: OpponentDefinition;
  /** progressS at race start — raceDist = progressS - startS */
  startS = 0;
  finishMs: number | null = null;
  avgSpeed = 26;
  /** difficulty driving brain (pace, mistakes, rubber-band, blocking) */
  brain: AiBrain = { ...DEFAULT_BRAIN };
  /** engine hook so rival crate smashes also spawn debris */
  boxHitHook?: (box: TrackBox) => void;

  /** nitro-brain latching: once lit, keep burning until the tank hits the
   *  difficulty floor (hysteresis — no per-frame boost flicker). */
  boostHold = false;
  /** exhaust-trail emit timer (engine drives the shared particle pool). */
  trailT = 0;

  mistakeT = 9;
  mistakeLeft = 0;
  readonly baseLat: number;
  readonly phase = Math.random() * Math.PI * 2;
  private track: Track;
  private readonly labelTex: THREE.CanvasTexture;
  private readonly labelMat: THREE.SpriteMaterial;

  constructor(def: OpponentDefinition, track: Track, baseLat: number) {
    this.def = def;
    this.track = track;
    this.baseLat = baseLat;

    this.physics = new CarPhysics(track, {
      onJump: () => {},
      onLanding: () => {},
      onCleanLand: () => {},
      onBigAir: () => {},
      onDriftBank: () => {},
      onNearMiss: () => {},
      onWallRideStart: () => {},
      onCrash: () => {},
      onBoostStart: () => {},
      onBoxHit: (box) => this.boxHitHook?.(box),
      requestRecovery: () => this.respawn(),
    });
    this.physics.isPlayer = false;

    this.visual = new CarVisual(false, { body: def.body, accent: def.accent }, def.car);

    // floating name tag
    const cvs = document.createElement("canvas");
    cvs.width = 256;
    cvs.height = 64;
    const ctx = cvs.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "rgba(43,28,18,0.88)";
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(4, 10, 248, 44, 10);
        ctx.fill();
      } else {
        ctx.fillRect(4, 10, 248, 44);
      }
      ctx.fillStyle = def.cssColor;
      ctx.fillRect(14, 18, 12, 28);
      ctx.fillStyle = "#fff6e6";
      ctx.font = "800 28px 'Arial Black', Arial, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(def.name, 36, 33);
    }
    this.labelTex = new THREE.CanvasTexture(cvs);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelMat = new THREE.SpriteMaterial({ map: this.labelTex, depthWrite: false, fog: true });
    this.label = new THREE.Sprite(this.labelMat);
    this.label.scale.set(3.3, 0.82, 1);
    this.label.position.set(0, 2.75, 0);
    this.label.renderOrder = 4;
    this.visual.group.add(this.label);
  }

  get raceDist(): number {
    return this.physics.progressS - this.startS;
  }

  setTrack(track: Track) {
    this.track = track;
    this.physics.setTrack(track);
  }

  /** Drop onto the grid / scatter point facing forward. */
  place(idx: number, lat: number, speed: number) {
    this.physics.place(idx, lat, speed);
    // fresh energy every race — on HARD mode rivals start with fully charged drift-boost bank
    this.physics.nitro = 100;
    this.physics.boostMeter =
      this.brain.skillScale > 1.3 ? 100 : this.brain.skillScale > 1.1 ? 75 : 40;
    this.boostHold = false;
    this.startS = this.physics.progressS;
    this.finishMs = null;
    this.syncVisual(0.016);
  }

  update(input: DriveInput, dt: number) {
    this.physics.update(input, dt);
    this.avgSpeed += (this.physics.speed - this.avgSpeed) * Math.min(1, dt * 0.25);
    this.syncVisual(dt, input);
  }

  /** Sync visual transform with physics (mirrors the player's syncCarVisual). */
  syncVisual(dt: number, input?: DriveInput) {
    const p = this.physics;
    const g = this.visual.group;
    g.position.copy(p.pos);
    g.rotation.set(0, p.yaw, 0);
    g.rotation.order = "YXZ";
    if (p.grounded) {
      // continuous slope queries — smooth roll/pitch at speed (no sample stepping)
      const slopeL = this.track.slopeLatAtP(p.groundP, p.lateral);
      const slopeF = this.track.slopeFwdAtP(p.groundP, p.lateral);
      g.rotation.x = damp(g.rotation.x, clamp(-Math.atan(slopeF), -0.5, 0.5), 8, dt);
      g.rotation.z = damp(g.rotation.z, clamp(Math.atan(slopeL), -0.9, 0.9), 8, dt);
      if (p.wallRiding) {
        const side = this.track.sample(p.idx).wallRideR && p.lateral > 0 ? 1 : -1;
        g.rotation.z = damp(g.rotation.z, side * clamp(Math.atan(slopeL), -1.15, 1.15), 8, dt);
      }
    } else {
      g.rotation.x = damp(g.rotation.x, clamp(-p.vel.y * 0.02, -0.35, 0.35), 3, dt);
      g.rotation.z = damp(g.rotation.z, 0, 4, dt);
    }
    this.visual.update({
      speed: p.vel.x * Math.sin(p.yaw) + p.vel.z * Math.cos(p.yaw),
      steer: input ? input.steer : 0,
      slip: p.drifting ? p.slip : 0,
      grounded: p.grounded,
      boosting: p.boosting || p.nitroActive,
      braking: input ? input.brake > 0.05 : false,
      pitchRate: 0,
      rollRate: p.drifting ? -p.slip * 12 : 0,
      dt,
    });
  }

  private respawn() {
    const p = this.physics;
    const keepS = p.progressS;
    const idx = wrapIdxLocal(p.idx + 3, this.track.N);
    p.place(idx, 0, 12, false);
    p.syncProgress(keepS + 3 * this.track.step);
    this.syncVisual(0.016);
  }

  dispose() {
    this.visual.dispose();
    this.labelTex.dispose();
    this.labelMat.dispose();
  }
}

/**
 * AI driving brain. Same conventions as autopilotInput, i.e. steering is
 * NEGATED against the heading error (positive steer = turn right).
 */
export function opponentInput(
  op: Opponent,
  track: Track,
  ctx: AiContext,
  dt: number,
  mode: "race" | "cruise"
): DriveInput {
  const p = op.physics;
  const brain = op.brain;
  const t = performance.now() * 0.001 + op.phase;

  // occasional human-ish mistakes (HARD rivals never fluff a line)
  if (mode === "race" && brain.mistakeEvery > 0) {
    if (op.mistakeLeft > 0) op.mistakeLeft -= dt;
    else {
      op.mistakeT -= dt;
      if (op.mistakeT <= 0) {
        op.mistakeLeft = 0.7 + Math.random() * 0.6;
        op.mistakeT = brain.mistakeEvery * (0.7 + Math.random() * 0.6);
      }
    }
  } else {
    op.mistakeLeft = 0;
  }

  // aim at a look-ahead point on this car's preferred line
  const look = 11 + clamp(p.speed * 0.62, 7, 30) * (0.9 + 0.25 * op.def.skill);
  const li = wrapIdxLocal(p.idx + Math.round(look / track.step), track.N);
  const s = track.sample(li);
  const wanderAmp = brain.skillScale > 1.1 ? 0.35 : 1.3;
  let lat = clamp(op.baseLat * (brain.skillScale > 1.1 ? 0.4 : 0.6) + Math.sin(t * 0.14) * wanderAmp, -4.5, 4.5);

  // HARD: defend the racing line — when this rival is just ahead of the
  // player, drift over onto the player's line so they have to out-brake it
  if (brain.blocking && mode === "race") {
    const gap = op.raceDist - ctx.playerDist; // >0 = rival ahead of player
    if (gap > 0 && gap < 28) {
      lat = clamp(lat * 0.15 + ctx.playerLat * 0.85, -(s.hw - 2.0), s.hw - 2.0);
    }
  }

  // dodge active crates near the intended line — sharper minds dodge better
  // (full-width BREAK walls are ignored: they get smashed, not dodged)
  if (op.mistakeLeft <= 0) {
    let dodge = 0;
    for (const b of track.boxes) {
      if (!b.active || b.wall) continue;
      let d = b.idx - p.idx;
      if (d < -track.N / 2) d += track.N;
      else if (d > track.N / 2) d -= track.N;
      if (d < 0 || d > 14) continue;
      const dl = b.lat - lat;
      const adl = Math.abs(dl);
      if (adl < 2.7) dodge += (dl >= 0 ? -1 : 1) * (2.7 - adl + 1.1) * (1 - d / 14);
    }
    lat = clamp(lat + dodge * (0.35 + 0.65 * op.def.skill), -(s.hw - 2.2), s.hw - 2.2);
  }
  const aimX = s.x + s.rx * lat;
  const aimZ = s.z + s.rz * lat;
  const err = angDiff(Math.atan2(aimX - p.pos.x, aimZ - p.pos.z), p.yaw);
  const steerSharpness = 2.0 + 1.0 * op.def.skill * Math.min(1.35, Math.max(1.0, brain.skillScale));
  let steer = clamp(-err * steerSharpness, -1, 1);
  if (op.mistakeLeft > 0) steer = clamp(steer + Math.sin(t * 13) * 0.22, -1, 1);

  // corner severity ahead
  const s2 = track.sample(wrapIdxLocal(li + 12, track.N));
  const s3 = track.sample(wrapIdxLocal(li + 26, track.N));
  const dTheta = Math.abs(angDiff(Math.atan2(s3.dx, s3.dz), Math.atan2(s2.dx, s2.dz)));
  const fullSend = s.rampP >= 0 || s.gap || s2.rampP >= 0 || s2.gap || s3.rampP >= 0 || s3.gap;

  // speed target: skill, asymmetric difficulty rubber-band, mistakes
  let speedFactor = op.def.skill * brain.skillScale;
  if (mode === "race") {
    const gapM = ctx.playerDist - op.raceDist;
    const band = clamp(gapM / 180, -1, 1.5);
    speedFactor *= 1 + (band >= 0 ? brain.rubberAhead : brain.rubberBehind) * band;
    if (op.mistakeLeft > 0) speedFactor *= 0.72;
  } else {
    speedFactor *= 0.6; // relaxed title-screen cruise
  }
  speedFactor = clamp(speedFactor, 0.5, 1.85);

  const curveWeight = Math.max(3.8, 9.0 - 5.5 * Math.max(0, brain.skillScale - 1.0));
  const cornerPace = (52 / (1 + dTheta * curveWeight)) * speedFactor;
  const maxTarget = 52 * p.speedCapScale * Math.min(1.25, speedFactor);
  const target = fullSend
    ? Math.max(55 * speedFactor, maxTarget)
    : clamp(cornerPace, 18, Math.max(58, maxTarget));

  // --- nitro brain ---
  // Rivals run the SAME nitro system as the player (CarPhysics drains the
  // tank at 33/s while boost is held, refills 10/s when released). The brain
  // fires it on straights, holds while the tank lasts, then lifts to
  // recharge. boostAggro sets the engagement point and the drain floor.
  const energy = p.nitro + p.boostMeter * 0.55;
  // Dynamic engagement: high aggro fires readily and drains deep
  const fireFrom = clamp(88 - 56 * brain.boostAggro, 30, 88);
  const fireFloor = clamp(18 - 14 * brain.boostAggro, 4, 18);

  if (op.boostHold && energy < fireFloor) op.boostHold = false;
  else if (!op.boostHold && energy >= fireFrom) op.boostHold = true;

  // HARD only: wheel-to-wheel defense and hunter overtake
  if (brain.blocking && mode === "race" && !op.boostHold) {
    const battle = ctx.playerDist - op.raceDist; // >0 means player ahead
    // Player leading within 65m — deploy nitro to hunt down and overtake!
    if (battle > 0 && battle < 65 && energy > fireFloor + 12) {
      op.boostHold = true;
    }
    // Player alongside or tailgating — burn nitro to defend position!
    else if (battle >= -16 && battle <= 0 && energy > fireFloor + 12) {
      op.boostHold = true;
    }
  }

  // Straight enough or corner exit: high aggro allows boosting through sweeping curves
  const angleOk = Math.abs(err) < 0.32;
  const straightThreshold = 0.045 + 0.11 * brain.boostAggro;
  const straightEnough = dTheta < straightThreshold && angleOk;
  const wantsBoost =
    mode === "race" &&
    op.boostHold &&
    straightEnough &&
    p.grounded &&
    p.speed > 16;

  const boostTopSpeed = BOOST_SPEED * p.speedCapScale;
  const brakeThreshold = target * (1.28 + 0.15 * Math.max(0, brain.skillScale - 1.0));
  const overspeed = p.speed - brakeThreshold;
  const brakeAmount = overspeed > 0
    ? clamp(overspeed * 0.04, 0.15, brain.skillScale > 1.1 ? 0.45 : 0.55)
    : 0;

  return {
    steer,
    throttle: p.speed < (wantsBoost ? boostTopSpeed : target) ? 1 : 0,
    brake: brakeAmount,
    handbrake: Math.abs(err) > (brain.skillScale > 1.1 ? 0.52 : 0.62) && p.speed > 21,
    boost: wantsBoost,
  };
}
