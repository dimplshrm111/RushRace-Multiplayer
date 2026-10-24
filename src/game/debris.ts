/**
 * 3D break debris — chunky wooden pieces (cubes, planks, slats) that fly off
 * smashed crates and barricades, tumble through the air, bounce on the ground
 * and fade away. Everything is pooled: no allocations at play time, shared
 * geometries & materials, so smashing is cheap even on mobile.
 */
import * as THREE from "three";
import { clamp } from "./types";

const GRAVITY = -26;
const MAX_CHUNKS = 110;

interface Chunk {
  mesh: THREE.Mesh;
  active: boolean;
  /** seconds before the piece appears (staggered chain-breaks) */
  delay: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  /** remaining seconds of life once moving */
  life: number;
  groundY: number;
  halfH: number;
  baseScale: number;
  bounces: number;
}

export class DebrisSystem {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private cursor = 0;
  private highDensity = true;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  constructor(isMobile = false) {
    // geometry palette: 0 plank, 1 cube, 2 slat, 3 long board
    const plank = new THREE.BoxGeometry(0.72, 0.09, 0.26);
    const cube = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const slat = new THREE.BoxGeometry(0.5, 0.07, 0.12);
    const board = new THREE.BoxGeometry(1.15, 0.1, 0.3);
    this.geos.push(plank, cube, slat, board);

    // material palette: weathered crate wood, darker cross-plank, pale splinter
    const wood = new THREE.MeshLambertMaterial({ color: 0xa9713d, flatShading: true });
    const darkWood = new THREE.MeshLambertMaterial({ color: 0x7c4e26, flatShading: true });
    const paleWood = new THREE.MeshLambertMaterial({ color: 0xd8b078, flatShading: true });
    const painted = new THREE.MeshLambertMaterial({ color: 0xe8b04a, flatShading: true });
    this.mats.push(wood, darkWood, paleWood, painted);
    this.disposables.push(plank, cube, slat, board, wood, darkWood, paleWood, painted);

    this.group.frustumCulled = false;
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const mesh = new THREE.Mesh(cube, wood);
      mesh.visible = false;
      mesh.castShadow = !isMobile;
      this.group.add(mesh);
      this.chunks.push({
        mesh,
        active: false,
        delay: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
        life: 0,
        groundY: 0,
        halfH: 0.15,
        baseScale: 1,
        bounces: 0,
      });
    }
  }

  setHighDensity(v: boolean) {
    this.highDensity = v;
  }

  /** Take the next chunk from the pool (round-robin; oldest pieces recycle). */
  private next(): Chunk {
    const c = this.chunks[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_CHUNKS;
    return c;
  }

  /**
   * Wooden crate burst — a mix of cubes, slats and small planks arcing away
   * from the impact, biased along the car's direction of travel.
   */
  spawnCrateBurst(
    x: number,
    y: number,
    z: number,
    groundY: number,
    dirX: number,
    dirZ: number,
    power: number,
    delay = 0
  ) {
    const n = this.highDensity ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const c = this.next();
      c.mesh.geometry = this.geos[i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : 2];
      c.mesh.material = this.mats[i % 4];
      this.launch(c, x, y, z, groundY, dirX, dirZ, power, delay, 0.7 + Math.random() * 0.6);
    }
  }

  /**
   * Barricade plank burst — long boards and planks exploding outward, much
   * chunkier than a crate break so the wall smash reads BIG.
   */
  spawnWallBurst(
    x: number,
    y: number,
    z: number,
    groundY: number,
    dirX: number,
    dirZ: number,
    power: number,
    delay = 0
  ) {
    const n = this.highDensity ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const c = this.next();
      c.mesh.geometry = this.geos[i % 2 === 0 ? 3 : 0];
      c.mesh.material = this.mats[i % 3 === 0 ? 3 : i % 3 === 1 ? 0 : 1];
      this.launch(c, x, y, z, groundY, dirX, dirZ, power, delay, 0.85 + Math.random() * 0.7);
    }
  }

  private launch(
    c: Chunk,
    x: number,
    y: number,
    z: number,
    groundY: number,
    dirX: number,
    dirZ: number,
    power: number,
    delay: number,
    scale: number
  ) {
    c.active = true;
    c.delay = Math.max(0, delay);
    c.mesh.visible = false; // stays hidden until the delay elapses
    c.mesh.position.set(x, y, z);
    c.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    c.mesh.scale.setScalar(scale);
    c.baseScale = scale;
    const sp = power * (0.55 + Math.random() * 0.75);
    const side = (Math.random() - 0.5) * 1.6;
    c.vx = dirX * sp + -dirZ * side;
    c.vz = dirZ * sp + dirX * side;
    c.vy = 3.2 + Math.random() * 5.2 + power * 0.18;
    c.spinX = (Math.random() - 0.5) * 17;
    c.spinY = (Math.random() - 0.5) * 17;
    c.spinZ = (Math.random() - 0.5) * 17;
    c.life = 2.1 + Math.random() * 0.8;
    c.groundY = groundY;
    c.halfH = 0.14 * scale;
    c.bounces = 0;
  }

  update(dt: number) {
    for (const c of this.chunks) {
      if (!c.active) continue;
      if (c.delay > 0) {
        c.delay -= dt;
        if (c.delay > 0) continue;
        c.mesh.visible = true;
      }
      c.vy += GRAVITY * dt;
      const m = c.mesh;
      m.position.x += c.vx * dt;
      m.position.y += c.vy * dt;
      m.position.z += c.vz * dt;
      m.rotation.x += c.spinX * dt;
      m.rotation.y += c.spinY * dt;
      m.rotation.z += c.spinZ * dt;
      c.life -= dt;

      // ground bounce / settle
      const floor = c.groundY + c.halfH;
      if (m.position.y < floor && c.vy < 0) {
        m.position.y = floor;
        if (c.bounces < 2) {
          c.vy = -c.vy * (0.3 + Math.random() * 0.12);
          c.vx *= 0.55;
          c.vz *= 0.55;
          c.spinX *= 0.5;
          c.spinY *= 0.5;
          c.spinZ *= 0.5;
          c.bounces++;
        } else {
          c.vy = 0;
          c.vx *= 0.8;
          c.vz *= 0.8;
          c.spinX *= 0.7;
          c.spinY *= 0.7;
          c.spinZ *= 0.7;
        }
      }

      // fade out by shrinking over the last 0.5 s
      const s = c.baseScale * clamp(c.life / 0.5, 0, 1);
      m.scale.setScalar(Math.max(0.001, s));

      if (c.life <= 0) {
        c.active = false;
        m.visible = false;
      }
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
