"use client";

import * as THREE from "three";
import { PALETTE, clamp } from "./types";

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

/** Procedural low-poly rally buggy with animated suspension & steering. */
export class CarVisual {
  group = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Mesh[] = [];
  steerPivots: THREE.Group[] = [];
  flame: THREE.Mesh;
  brakeLights: THREE.Mesh[] = [];
  private wheelSpin = 0;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(
    ghost = false,
    colors?: { body?: number; accent?: number; dark?: number }
  ) {
    const bodyColor = colors?.body ?? PALETTE.carBody;
    const accentColor = colors?.accent ?? PALETTE.carAccent;
    const darkColor = colors?.dark ?? PALETTE.carDark;
    const bodyMat = new THREE.MeshLambertMaterial({
      color: ghost ? PALETTE.ghost : bodyColor,
      flatShading: true,
      transparent: ghost,
      opacity: ghost ? 0.32 : 1,
    });
    const accentMat = new THREE.MeshLambertMaterial({
      color: ghost ? PALETTE.ghost : accentColor,
      flatShading: true,
      transparent: ghost,
      opacity: ghost ? 0.32 : 1,
    });
    const darkMat = new THREE.MeshLambertMaterial({
      color: ghost ? PALETTE.ghost : darkColor,
      flatShading: true,
      transparent: ghost,
      opacity: ghost ? 0.28 : 1,
    });
    const glassMat = new THREE.MeshLambertMaterial({
      color: ghost ? PALETTE.ghost : PALETTE.glass,
      flatShading: true,
      transparent: true,
      opacity: ghost ? 0.25 : 0.85,
    });
    const tireMat = new THREE.MeshLambertMaterial({
      color: ghost ? PALETTE.ghost : PALETTE.tire,
      flatShading: true,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    });

    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = this.body
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      if (!ghost) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
      }
      parent.add(mesh);
      this.disposables.push(geo);
      return mesh;
    };

    // chassis
    add(new THREE.BoxGeometry(1.78, 0.5, 3.3), bodyMat, 0, 0.62, 0);
    // sloped nose
    const nose = add(new THREE.BoxGeometry(1.66, 0.34, 1.0), bodyMat, 0, 0.52, 1.85);
    nose.rotation.x = -0.09;
    // cabin
    add(new THREE.BoxGeometry(1.42, 0.52, 1.5), glassMat, 0, 1.08, -0.28);
    add(new THREE.BoxGeometry(1.5, 0.1, 1.62), accentMat, 0, 1.36, -0.28); // roof
    // racing stripes
    add(new THREE.BoxGeometry(0.42, 0.05, 3.32), accentMat, 0, 0.885, 0.02);
    add(new THREE.BoxGeometry(0.44, 0.05, 0.9), accentMat, 0, 0.7, 1.88);
    // side skirts + bumpers
    add(new THREE.BoxGeometry(1.94, 0.18, 2.6), darkMat, 0, 0.36, -0.1);
    add(new THREE.BoxGeometry(1.8, 0.26, 0.3), darkMat, 0, 0.5, 2.32);
    add(new THREE.BoxGeometry(1.8, 0.3, 0.3), darkMat, 0, 0.52, -1.72);
    // roll cage bars
    for (const sx of [-0.62, 0.62]) {
      const bar = add(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6), darkMat, sx, 1.05, 0.62);
      bar.rotation.x = 0.42;
    }
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.28, 6), darkMat, 0, 1.52, 0.4).rotation.z = Math.PI / 2;
    // spoiler
    add(new THREE.BoxGeometry(1.7, 0.07, 0.44), accentMat, 0, 1.28, -1.68);
    for (const sx of [-0.66, 0.66]) {
      add(new THREE.BoxGeometry(0.08, 0.34, 0.1), darkMat, sx, 1.08, -1.66);
    }
    // headlights
    const lightMat = new THREE.MeshBasicMaterial({
      color: ghost ? PALETTE.ghost : 0xfff1c4,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    });
    add(new THREE.BoxGeometry(0.34, 0.14, 0.06), lightMat, -0.55, 0.6, 2.33);
    add(new THREE.BoxGeometry(0.34, 0.14, 0.06), lightMat, 0.55, 0.6, 2.33);
    this.disposables.push(lightMat);
    // brake lights
    const brakeMat = new THREE.MeshBasicMaterial({
      color: ghost ? PALETTE.ghost : 0xd64530,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    });
    this.brakeLights.push(add(new THREE.BoxGeometry(0.4, 0.12, 0.06), brakeMat, -0.55, 0.66, -1.88));
    this.brakeLights.push(add(new THREE.BoxGeometry(0.4, 0.12, 0.06), brakeMat, 0.55, 0.66, -1.88));
    this.disposables.push(brakeMat);
    // exhausts
    add(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 6), darkMat, -0.4, 0.42, -1.86).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 6), darkMat, 0.4, 0.42, -1.86).rotation.x = Math.PI / 2;

    // boost flame (additive cone, hidden by default)
    const flameGeo = new THREE.ConeGeometry(0.24, 1.5, 8);
    flameGeo.rotateX(Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flame = new THREE.Mesh(flameGeo, flameMat);
    this.flame.position.set(0, 0.44, -2.5);
    this.flame.visible = false;
    this.body.add(this.flame);
    this.disposables.push(flameGeo, flameMat);

    this.group.add(this.body);

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.36, 8);
    hubGeo.rotateZ(Math.PI / 2);
    this.disposables.push(wheelGeo, hubGeo);
    const hubMat = accentMat;
    const positions: [number, number, number, boolean][] = [
      [-0.88, 0.42, 1.18, true],
      [0.88, 0.42, 1.18, true],
      [-0.88, 0.42, -1.22, false],
      [0.88, 0.42, -1.22, false],
    ];
    for (const [x, y, z, front] of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const wheel = new THREE.Mesh(wheelGeo, tireMat);
      if (!ghost) wheel.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      wheel.add(hub);
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheels.push(wheel);
      if (front) this.steerPivots.push(pivot);
    }
  }

  update(s: CarVisualState) {
    const { dt } = s;
    this.wheelSpin += (s.speed / 0.42) * dt;
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
    // suspension: faint engine shiver at standstill only. (The old wall-clock
    // sinusoid scaled with speed and read as a constant fast jiggle.)
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
  }
}
