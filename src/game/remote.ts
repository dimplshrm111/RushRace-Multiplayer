"use client";

import * as THREE from "three";
import { CarVisual } from "./car";
import { DEFAULT_CAR, paintFor, type CarModelId } from "./cars";
import { clamp, damp } from "./types";

/** A received car-state sample, stamped with client receipt time. */
export interface RemoteSnapshot {
  t: number; // client performance.now() at receipt
  x: number;
  y: number;
  z: number;
  yaw: number;
  steer: number;
  spd: number;
  boost: boolean;
  drift: boolean;
  ground: boolean;
  prog: number;
  /** nitro meter 0..100 (synced display) */
  nitro?: number;
  /** nitro currently engaged (flame-trail + audio on the remote car) */
  nitroActive?: boolean;
  /** driving surface the car is on (for dust colour) */
  surface?: string;
  /** true for one tick after a recovery teleport — snap instead of interp */
  recovering?: boolean;
}

const INTERP_DELAY_MS = 90; // render this far behind the newest sample (lower = less latency, more jitter risk)
const EXTRAPOLATE_MS = 220; // dead-reckon at most this far ahead (lower = less rubber-banding on packet loss)
const STALE_MS = 2500; // hold position after this long without data

function angLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Another human's car in a multiplayer race. Renders from network snapshots
 * (with interpolation + short dead-reckoning) instead of local physics —
 * the owner's client is authoritative for their car's motion.
 */
export class RemotePlayer {
  readonly id: string;
  name: string;
  readonly colorCss: string;
  model: CarModelId;
  colorIdx = 0;
  /** total race progress (progressS) — for standings */
  progressS = 0;
  /** server-assigned finish (null while racing) */
  finishMs: number | null = null;
  finishPos: number | null = null;
  /** latched true once a snapshot arrives — car only then becomes visible */
  active = false;

  visual: CarVisual;
  label: THREE.Sprite;
  private labelTex: THREE.CanvasTexture;
  private labelMat: THREE.SpriteMaterial;
  private buf: RemoteSnapshot[] = [];
  /** current interpolated render state (for collisions) */
  rx = 0;
  ry = 0;
  rz = 0;
  ryaw = 0;
  private vx = 0;
  private vz = 0;
  private lastSnapAt = 0;

  constructor(id: string, name: string, colorCss: string, car?: string, carColorIdx = 0) {
    this.id = id;
    this.name = name;
    this.colorCss = colorCss;
    this.model = (car as CarModelId) || DEFAULT_CAR;
    this.colorIdx = carColorIdx;
    this.visual = this.buildVisual();
    this.visual.group.visible = false;
    this.labelTex = RemotePlayer.makeLabel(name, colorCss);
    this.labelMat = new THREE.SpriteMaterial({
      map: this.labelTex,
      depthWrite: false,
      fog: true,
    });
    this.label = new THREE.Sprite(this.labelMat);
    this.label.scale.set(3.3, 0.82, 1);
    this.label.position.set(0, 2.75, 0);
    this.label.renderOrder = 4;
    this.visual.group.add(this.label);
  }

  private buildVisual(): CarVisual {
    // the car wears the driver's SELECTED paint (model + colour option);
    // their room identity colour stays on the label chip + minimap blip
    const paint = paintFor(this.model, this.colorIdx);
    return new CarVisual(false, { body: paint.body }, this.model);
  }

  /** Swap the car model/paint when the driver changes it in the garage. */
  setCar(car: string | undefined, colorIdx: number | undefined): boolean {
    const model = (car as CarModelId) || DEFAULT_CAR;
    const color = colorIdx ?? 0;
    if (model === this.model && color === this.colorIdx) return false;
    const parent = this.visual.group.parent;
    const wasVisible = this.visual.group.visible;
    const pos = this.visual.group.position.clone();
    const rot = this.visual.group.rotation.clone();
    this.visual.dispose();
    if (parent) parent.remove(this.visual.group);
    this.model = model;
    this.colorIdx = color;
    this.visual = this.buildVisual();
    this.visual.group.add(this.label);
    this.visual.group.position.copy(pos);
    this.visual.group.rotation.copy(rot);
    this.visual.group.visible = wasVisible;
    if (parent) parent.add(this.visual.group);
    return true;
  }

  private static makeLabel(name: string, color: string): THREE.CanvasTexture {
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
      ctx.fillStyle = color;
      ctx.fillRect(14, 18, 12, 28);
      ctx.fillStyle = "#fff6e6";
      let font = 28;
      ctx.font = `800 ${font}px 'Arial Black', Arial, sans-serif`;
      while (ctx.measureText(name).width > 196 && font > 12) {
        font -= 2;
        ctx.font = `800 ${font}px 'Arial Black', Arial, sans-serif`;
      }
      ctx.textBaseline = "middle";
      ctx.fillText(name, 36, 33);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  setName(name: string) {
    if (name === this.name) return;
    this.name = name;
    const old = this.labelTex;
    this.labelTex = RemotePlayer.makeLabel(name, this.colorCss);
    this.labelMat.map = this.labelTex;
    this.labelMat.needsUpdate = true;
    old.dispose();
  }

  push(s: Omit<RemoteSnapshot, "t">) {
    const t = performance.now();
    // recovery teleport: if the owner flagged this tick as recovering, snap
    // to the new position instead of buffering it (which would interpolate
    // across the gap and look like a rubber-band sprint). Clear the buffer
    // so the next render uses the new position directly.
    if (s.recovering) {
      this.buf = [{ ...s, t }];
      this.lastSnapAt = t;
      this.progressS = s.prog;
      this.active = true;
      this.visual.group.visible = true;
      this.rx = s.x;
      this.ry = s.y;
      this.rz = s.z;
      this.ryaw = s.yaw;
      this.vx = 0;
      this.vz = 0;
      return;
    }
    const last = this.buf[this.buf.length - 1];
    if (last) {
      const dt = Math.max(0.016, (t - last.t) / 1000);
      this.vx = (s.x - last.x) / dt;
      this.vz = (s.z - last.z) / dt;
    }
    this.buf.push({ ...s, t });
    if (this.buf.length > 16) this.buf.shift();
    this.lastSnapAt = t;
    this.progressS = s.prog;
    if (!this.active) {
      this.active = true;
      this.visual.group.visible = true;
      this.rx = s.x;
      this.ry = s.y;
      this.rz = s.z;
      this.ryaw = s.yaw;
    }
  }

  /** Estimated world velocity (for local collision response). */
  get vel(): { x: number; z: number } {
    return { x: this.vx, z: this.vz };
  }

  update(nowMs: number, dt: number) {
    if (!this.active || this.buf.length === 0) return;
    const g = this.visual.group;

    // find snapshots surrounding the render time
    const renderT = nowMs - INTERP_DELAY_MS;
    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    let f = 1;
    for (let i = this.buf.length - 1; i > 0; i--) {
      if (this.buf[i - 1].t <= renderT) {
        a = this.buf[i - 1];
        b = this.buf[i];
        const span = Math.max(1, b.t - a.t);
        f = clamp((renderT - a.t) / span, 0, 1);
        break;
      }
      a = b = this.buf[i];
      f = 1;
    }

    const newest = this.buf[this.buf.length - 1];
    const age = nowMs - this.lastSnapAt;
    if (renderT > b.t) {
      // between samples / beyond the newest — short dead-reckoning
      const ahead = Math.min(renderT - b.t, EXTRAPOLATE_MS) / 1000;
      this.rx = newest.x + newest.spd * Math.sin(newest.yaw) * ahead;
      this.rz = newest.z + newest.spd * Math.cos(newest.yaw) * ahead;
      this.ry = newest.y;
      this.ryaw = newest.yaw;
      if (age > STALE_MS) {
        // connection trouble — freeze in place (car stays, dim the label a bit)
        this.labelMat.opacity = 0.55;
      }
    } else {
      this.rx = a.x + (b.x - a.x) * f;
      this.ry = a.y + (b.y - a.y) * f;
      this.rz = a.z + (b.z - a.z) * f;
      this.ryaw = angLerp(a.yaw, b.yaw, f);
      this.labelMat.opacity = 1;
    }

    g.position.set(this.rx, this.ry, this.rz);
    g.rotation.order = "YXZ";
    g.rotation.set(0, this.ryaw, 0);
    if (newest.ground) {
      g.rotation.x = damp(g.rotation.x, 0, 8, dt);
      g.rotation.z = damp(g.rotation.z, 0, 8, dt);
    } else {
      g.rotation.x = damp(g.rotation.x, 0, 3, dt);
      g.rotation.z = damp(g.rotation.z, 0, 4, dt);
    }

    this.visual.update({
      speed: newest.spd,
      steer: newest.steer,
      slip: newest.drift ? 0.4 : 0,
      grounded: newest.ground,
      boosting: newest.boost || !!newest.nitroActive, // nitro flame on remote cars
      braking: false,
      pitchRate: 0,
      rollRate: newest.drift ? -4.8 : 0,
      dt,
    });
  }

  /** Drop to a known grid position before snapshots arrive (pre-GO view). */
  placeAt(x: number, y: number, z: number, yaw: number) {
    this.rx = x;
    this.ry = y;
    this.rz = z;
    this.ryaw = yaw;
    this.buf = [];
    this.active = false;
    this.visual.group.visible = false;
  }

  dispose() {
    this.visual.dispose();
    this.labelTex.dispose();
    this.labelMat.dispose();
  }
}
