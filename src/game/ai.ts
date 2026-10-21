"use client";

import * as THREE from "three";
import { Track } from "./track";
import { CarPhysics } from "./physics";
import { CarVisual } from "./car";
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
  /** 0..1 — corner-speed confidence & steering sharpness */
  skill: number;
}

/** The three rival buggies (identical performance, different skill). */
export const OPPONENTS: OpponentDefinition[] = [
  { name: "VIPER", cssColor: "#2f9e63", body: 0x2f9e63, accent: 0xfff3dd, skill: 0.975 },
  { name: "MESA", cssColor: "#d64530", body: 0xd64530, accent: 0xffe9c9, skill: 0.94 },
  { name: "HAWK", cssColor: "#1f8a70", body: 0x1f8a70, accent: 0xfff3dd, skill: 0.9 },
];

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

  private mistakeT = 9;
  private mistakeLeft = 0;
  private readonly baseLat: number;
  private readonly phase = Math.random() * Math.PI * 2;
  private readonly track: Track;
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
      requestRecovery: () => this.respawn(),
    });
    this.physics.isPlayer = false;

    this.visual = new CarVisual(false, { body: def.body, accent: def.accent });

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

  /** Drop onto the grid / scatter point facing forward. */
  place(idx: number, lat: number, speed: number) {
    this.physics.place(idx, lat, speed);
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
      const slopeL = this.track.slopeLatAt(p.idx, p.lateral);
      const slopeF = this.track.slopeFwdAt(p.idx, p.lateral);
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
      boosting: p.boosting,
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
  playerDist: number,
  dt: number,
  mode: "race" | "cruise"
): DriveInput {
  const p = op.physics;
  const t = performance.now() * 0.001 + op.phase;

  // occasional human-ish mistakes
  if (mode === "race") {
    if (op.mistakeLeft > 0) op.mistakeLeft -= dt;
    else {
      op.mistakeT -= dt;
      if (op.mistakeT <= 0) {
        op.mistakeLeft = 0.7 + Math.random() * 0.6;
        op.mistakeT = 12 + Math.random() * 18;
      }
    }
  }

  // aim at a look-ahead point on this car's preferred line
  const look = 11 + clamp(p.speed * 0.62, 7, 30) * (0.9 + 0.25 * op.def.skill);
  const li = wrapIdxLocal(p.idx + Math.round(look / track.step), track.N);
  const s = track.sample(li);
  const lat = clamp(op.baseLat * 0.6 + Math.sin(t * 0.14) * 1.3, -4.5, 4.5);
  const aimX = s.x + s.rx * lat;
  const aimZ = s.z + s.rz * lat;
  const err = angDiff(Math.atan2(aimX - p.pos.x, aimZ - p.pos.z), p.yaw);
  let steer = clamp(-err * (2.0 + 1.0 * op.def.skill), -1, 1);
  if (op.mistakeLeft > 0) steer = clamp(steer + Math.sin(t * 13) * 0.22, -1, 1);

  // corner severity ahead
  const s2 = track.sample(wrapIdxLocal(li + 12, track.N));
  const s3 = track.sample(wrapIdxLocal(li + 26, track.N));
  const dTheta = Math.abs(angDiff(Math.atan2(s3.dx, s3.dz), Math.atan2(s2.dx, s2.dz)));
  const fullSend = s.rampP >= 0 || s.gap || s2.rampP >= 0 || s2.gap || s3.rampP >= 0 || s3.gap;

  // speed target: skill, gentle rubber-band toward the player, mistakes
  let speedFactor = op.def.skill;
  if (mode === "race") {
    const band = clamp((playerDist - op.raceDist) / 200, -1, 1);
    speedFactor *= 1 + 0.055 * band;
    if (op.mistakeLeft > 0) speedFactor *= 0.72;
  } else {
    speedFactor *= 0.6; // relaxed title-screen cruise
  }
  speedFactor = clamp(speedFactor, 0.5, 1.02);

  const target = fullSend ? 55 : clamp(52 / (1 + dTheta * 9), 15, 52) * speedFactor;

  return {
    steer,
    throttle: p.speed < target ? 1 : 0,
    brake: p.speed > target * 1.3 ? 0.55 : 0,
    handbrake: Math.abs(err) > 0.62 && p.speed > 21,
    boost: mode === "race" && p.boostMeter > 74 && dTheta < 0.05 && p.grounded,
  };
}
