"use client";

import * as THREE from "three";

interface P {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  grav: number;
  drag: number;
}

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (280.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
uniform sampler2D uTex;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}
`;

function makeSoftTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Pool {
  points: THREE.Points;
  private ps: P[] = [];
  private posArr: Float32Array;
  private sizeArr: Float32Array;
  private alphaArr: Float32Array;
  private colorArr: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  density = 1;

  constructor(cap: number, tex: THREE.Texture, additive: boolean) {
    this.posArr = new Float32Array(cap * 3);
    this.sizeArr = new Float32Array(cap);
    this.alphaArr = new Float32Array(cap);
    this.colorArr = new Float32Array(cap * 3);
    for (let i = 0; i < cap; i++) {
      this.ps.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size0: 1, size1: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0,
      });
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.posArr, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizeArr, 1));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphaArr, 1));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.colorArr, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number,
    r: number, g: number, b: number, grav = 0, drag = 0
  ) {
    const n = this.ps.length;
    // find a free slot (round-robin); if the pool is saturated, recycle the
    // cursor slot immediately so spawn stays O(1) instead of scanning forever
    let p: P | null = null;
    for (let tries = 0; tries < 16; tries++) {
      Pool.cursor = (Pool.cursor + 1) % n;
      const cand = this.ps[Pool.cursor];
      if (!cand.active) {
        p = cand;
        break;
      }
    }
    if (!p) {
      Pool.cursor = (Pool.cursor + 1) % n;
      p = this.ps[Pool.cursor];
    }
    p.active = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = 0; p.maxLife = life;
    p.size0 = size0; p.size1 = size1;
    p.r = r; p.g = g; p.b = b;
    p.grav = grav; p.drag = drag;
  }

  private static cursor = 0;

  update(dt: number) {
    const n = this.ps.length;
    for (let i = 0; i < n; i++) {
      const p = this.ps[i];
      const i3 = i * 3;
      if (!p.active) {
        this.alphaArr[i] = 0;
        continue;
      }
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.alphaArr[i] = 0;
        continue;
      }
      p.vy -= p.grav * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.life / p.maxLife;
      this.posArr[i3] = p.x; this.posArr[i3 + 1] = p.y; this.posArr[i3 + 2] = p.z;
      this.sizeArr[i] = p.size0 + (p.size1 - p.size0) * t;
      this.alphaArr[i] = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      this.colorArr[i3] = p.r; this.colorArr[i3 + 1] = p.g; this.colorArr[i3 + 2] = p.b;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const SKID_VERT = `
attribute float aAlpha;
attribute float aBirth;
uniform float uTime;
varying float vA;
void main() {
  vA = aAlpha * clamp(1.0 - (uTime - aBirth) / 22.0, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SKID_FRAG = `
varying float vA;
void main() {
  gl_FragColor = vec4(0.14, 0.10, 0.07, vA * 0.5);
}
`;

export class ParticleSystem {
  group = new THREE.Group();
  private smoke: Pool;
  private dust: Pool;
  private sparks: Pool;
  private boost: Pool;
  private tex: THREE.Texture;
  highDensity = true;

  // skid marks ring buffer
  private skidGeo: THREE.BufferGeometry;
  private skidMat: THREE.ShaderMaterial;
  private skidPos: Float32Array;
  private skidAlpha: Float32Array;
  private skidBirth: Float32Array;
  private skidCursor = 0;
  private readonly MAX_QUADS = 640;

  constructor() {
    this.tex = makeSoftTexture();
    this.smoke = new Pool(240, this.tex, false);
    this.dust = new Pool(180, this.tex, false);
    this.sparks = new Pool(220, this.tex, true);
    this.boost = new Pool(120, this.tex, true);
    this.group.add(this.smoke.points, this.dust.points, this.sparks.points, this.boost.points);

    const cap = this.MAX_QUADS * 4;
    this.skidPos = new Float32Array(cap * 3);
    this.skidAlpha = new Float32Array(cap);
    this.skidBirth = new Float32Array(cap);
    this.skidBirth.fill(-100);
    this.skidGeo = new THREE.BufferGeometry();
    this.skidGeo.setAttribute("position", new THREE.BufferAttribute(this.skidPos, 3));
    this.skidGeo.setAttribute("aAlpha", new THREE.BufferAttribute(this.skidAlpha, 1));
    this.skidGeo.setAttribute("aBirth", new THREE.BufferAttribute(this.skidBirth, 1));
    const idx: number[] = [];
    for (let q = 0; q < this.MAX_QUADS; q++) {
      const b = q * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.skidGeo.setIndex(idx);
    this.skidGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000);
    this.skidMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SKID_VERT,
      fragmentShader: SKID_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const skidMesh = new THREE.Mesh(this.skidGeo, this.skidMat);
    skidMesh.frustumCulled = false;
    this.group.add(skidMesh);
  }

  setHighDensity(v: boolean) {
    this.highDensity = v;
  }

  emitSmoke(x: number, y: number, z: number, intensity: number) {
    const n = this.highDensity ? 2 : 1;
    for (let i = 0; i < n; i++) {
      this.smoke.spawn(
        x + (Math.random() - 0.5) * 0.5, y + 0.15, z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 2.2, 1.1 + Math.random() * 1.4, (Math.random() - 0.5) * 2.2,
        0.7 + Math.random() * 0.5, 0.7, 3.2 + intensity * 2,
        0.82, 0.78, 0.72, -0.4, 1.6
      );
    }
  }

  emitDust(x: number, y: number, z: number, intensity: number, vx: number, vz: number) {
    const n = this.highDensity ? 2 : 1;
    for (let i = 0; i < n; i++) {
      this.dust.spawn(
        x + (Math.random() - 0.5) * 0.8, y + 0.1, z + (Math.random() - 0.5) * 0.8,
        vx * 0.25 + (Math.random() - 0.5) * 2.4, 0.8 + Math.random() * 1.6 * intensity, vz * 0.25 + (Math.random() - 0.5) * 2.4,
        0.9 + Math.random() * 0.7, 1.1, 4.5 + intensity * 3,
        0.85, 0.68, 0.46, -0.25, 1.2
      );
    }
  }

  emitSparks(x: number, y: number, z: number, nx: number, nz: number, count: number) {
    const n = this.highDensity ? count : Math.ceil(count * 0.5);
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 4;
      this.sparks.spawn(
        x, y + 0.15, z,
        nx * (2 + Math.random() * 7) + spread, 1.5 + Math.random() * 4.5, nz * (2 + Math.random() * 7) - spread,
        0.25 + Math.random() * 0.3, 0.28, 0.06,
        1, 0.62, 0.18, 22, 0.6
      );
    }
  }

  emitBoost(x: number, y: number, z: number, bx: number, bz: number) {
    this.boost.spawn(
      x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.25, z + (Math.random() - 0.5) * 0.3,
      bx * (9 + Math.random() * 5), 0.6 + Math.random(), bz * (9 + Math.random() * 5),
      0.28 + Math.random() * 0.15, 0.5, 0.05,
      1, 0.55, 0.2, 2, 2.5
    );
  }

  /** Wooden crate shatter — chunky debris that arcs down with gravity. */
  emitShards(x: number, y: number, z: number, count: number) {
    const n = this.highDensity ? count : Math.ceil(count * 0.6);
    for (let i = 0; i < n; i++) {
      const t = Math.random(); // wood tone variation
      this.dust.spawn(
        x + (Math.random() - 0.5) * 0.7, y + (Math.random() - 0.5) * 0.5, z + (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 9, 2 + Math.random() * 5.5, (Math.random() - 0.5) * 9,
        0.55 + Math.random() * 0.45, 0.46, 0.1,
        0.64 + t * 0.16, 0.42 + t * 0.1, 0.22 + t * 0.07,
        17, 0.7
      );
    }
    // a puff of sawdust so the break reads at distance
    for (let i = 0; i < 3; i++) {
      this.dust.spawn(
        x, y + 0.3, z,
        (Math.random() - 0.5) * 3, 1.4 + Math.random() * 1.6, (Math.random() - 0.5) * 3,
        0.7 + Math.random() * 0.4, 0.9, 3.6,
        0.85, 0.72, 0.5, -0.2, 1.4
      );
    }
  }

  emitSkid(x: number, y: number, z: number, dx: number, dz: number, strength: number, time: number) {
    // quad oriented across the movement direction
    const px = -dz;
    const pz = dx;
    const w = 0.19;
    const len = 0.55;
    const q = this.skidCursor;
    const b = q * 4;
    const y0 = y + 0.04;
    this.skidPos[b * 3] = x + px * w - dx * len;
    this.skidPos[b * 3 + 1] = y0;
    this.skidPos[b * 3 + 2] = z + pz * w - dz * len;
    this.skidPos[(b + 1) * 3] = x - px * w - dx * len;
    this.skidPos[(b + 1) * 3 + 1] = y0;
    this.skidPos[(b + 1) * 3 + 2] = z - pz * w - dz * len;
    this.skidPos[(b + 2) * 3] = x - px * w + dx * len;
    this.skidPos[(b + 2) * 3 + 1] = y0;
    this.skidPos[(b + 2) * 3 + 2] = z - pz * w + dz * len;
    this.skidPos[(b + 3) * 3] = x + px * w + dx * len;
    this.skidPos[(b + 3) * 3 + 1] = y0;
    this.skidPos[(b + 3) * 3 + 2] = z + pz * w + dz * len;
    const a = Math.min(1, strength);
    for (let k = 0; k < 4; k++) {
      this.skidAlpha[b + k] = a;
      this.skidBirth[b + k] = time;
    }
    this.skidCursor = (q + 1) % this.MAX_QUADS;
    (this.skidGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.skidGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.skidGeo.attributes.aBirth as THREE.BufferAttribute).needsUpdate = true;
  }

  clearSkids(time: number) {
    this.skidBirth.fill(time - 100);
    (this.skidGeo.attributes.aBirth as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number, time: number) {
    this.smoke.update(dt);
    this.dust.update(dt);
    this.sparks.update(dt);
    this.boost.update(dt);
    this.skidMat.uniforms.uTime.value = time;
  }

  dispose() {
    this.smoke.dispose();
    this.dust.dispose();
    this.sparks.dispose();
    this.boost.dispose();
    this.skidGeo.dispose();
    this.skidMat.dispose();
    this.tex.dispose();
  }
}
