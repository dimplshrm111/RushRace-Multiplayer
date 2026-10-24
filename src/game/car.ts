"use client";

import * as THREE from "three";
import { clamp } from "./types";
import {
  getCarAssets,
  getCarMaterials,
  paintFor,
  paintWithBody,
  type CarModelId,
} from "./cars";

export interface CarVisualState {
  speed: number; // m/s (signed)
  steer: number; // -1..1
  slip: number; // drift slip angle (rad)
  grounded: boolean;
  boosting: boolean;
  braking: boolean;
  pitchRate: number; // vertical accel estimate for suspension
  rollRate: number;
  dt: number;
}

/**
 * A rendered car. PURELY VISUAL — the driving physics live in CarPhysics and
 * are identical for every model, so selecting any SUV never changes handling.
 */
export class CarVisual {
  group = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Mesh[] = [];
  steerPivots: THREE.Group[] = [];
  flame: THREE.Mesh;
  brakeLights: THREE.Mesh[] = [];
  readonly model: CarModelId;
  private wheelRadius: number;
  private wheelSpin = 0;
  private brakeMat: THREE.MeshBasicMaterial;
  /** per-instance only; geometries + other materials are shared caches */
  private disposables: THREE.Material[] = [];

  constructor(
    ghost = false,
    colors?: { body?: number; accent?: number; dark?: number },
    model: CarModelId = "himalaya",
    colorIdx = 0
  ) {
    this.model = model;
    // paint: explicit body override (rivals / multiplayer colours) or the
    // model's own colour option
    const paint =
      colors?.body != null
        ? { ...paintWithBody(model, colors.body), rim: colors.accent ?? paintWithBody(model, colors.body).rim }
        : paintFor(model, colorIdx);
    const assets = getCarAssets(model, paint);
    const mats = getCarMaterials(model, paint, ghost);

    const addBucket = (bucket: keyof typeof mats.mats) => {
      const geo = assets.buckets[bucket];
      const mat = mats.mats[bucket];
      if (!geo || !mat) return;
      const mesh = new THREE.Mesh(geo, mat);
      if (!ghost) mesh.castShadow = true;
      this.body.add(mesh);
    };
    for (const b of assets.bucketList) addBucket(b);

    // brake lights — per-instance material (toggles per car)
    this.brakeMat = mats.brakeTemplate.clone();
    this.disposables.push(this.brakeMat);
    const brakeMesh = new THREE.Mesh(assets.brakeGeo, this.brakeMat);
    this.body.add(brakeMesh);
    this.brakeLights.push(brakeMesh);

    // boost flame (additive cone, hidden by default)
    const flameGeo = new THREE.ConeGeometry(0.3, 1.8, 8);
    flameGeo.rotateX(Math.PI / 2);
    this.flame = new THREE.Mesh(flameGeo, mats.flameMat);
    this.flame.position.set(assets.flame[0], assets.flame[1], assets.flame[2]);
    this.flame.visible = false;
    this.body.add(this.flame);
    this.flameGeos.push(flameGeo);

    this.group.add(this.body);

    // wheels — merged tire + rim meshes on steering pivots
    this.wheelRadius = assets.wheelRadius;
    for (const [x, z, front] of assets.wheelPos) {
      const pivot = new THREE.Group();
      pivot.position.set(x, this.wheelRadius, z);
      const wheel = new THREE.Mesh(assets.wheelTire, mats.mats.tire!);
      if (!ghost) wheel.castShadow = true;
      const rim = new THREE.Mesh(assets.wheelRim, mats.mats.rim!);
      wheel.add(rim);
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheels.push(wheel);
      if (front) this.steerPivots.push(pivot);
    }
  }

  private flameGeos: THREE.BufferGeometry[] = [];

  update(s: CarVisualState) {
    const { dt } = s;
    this.wheelSpin += (s.speed / this.wheelRadius) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.steerPivots) {
      // Car local frame: nose = +Z, right = -X. Turning the wheels toward the
      // car's right (steer > 0) needs a NEGATIVE local Y rotation.
      p.rotation.y = -s.steer * 0.42;
    }
    // body lean: acceleration pitch + drift roll + air tilt
    const targetPitch = clamp(-s.pitchRate * 0.02, -0.09, 0.09);
    const targetRoll = clamp(s.rollRate * 0.016 + s.slip * 0.22, -0.22, 0.22);
    this.body.rotation.x += (targetPitch - this.body.rotation.x) * Math.min(1, dt * 9);
    this.body.rotation.z += (targetRoll - this.body.rotation.z) * Math.min(1, dt * 9);
    // suspension: faint engine shiver at standstill only
    const idle = 1 - clamp(Math.abs(s.speed) / 6, 0, 1);
    const bounce = s.grounded ? Math.sin(performance.now() * 0.03) * 0.006 * idle : 0.05;
    this.body.position.y = bounce;
    // flame
    this.flame.visible = s.boosting;
    if (s.boosting) {
      const p = 0.8 + Math.random() * 0.5;
      this.flame.scale.set(1, 1, p);
    }
    for (const b of this.brakeLights) {
      (b.material as THREE.MeshBasicMaterial).color.setHex(s.braking ? 0xff2a1a : 0xd64530);
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    for (const g of this.flameGeos) g.dispose();
  }
}
