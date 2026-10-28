"use client";

import * as THREE from "three";
import { PALETTE, clamp, type MapId } from "./types";

/** Smooth 0..1 step. */
function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapIdx(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/**
 * Driving surface types — each one has its own physics profile (grip,
 * rolling resistance, acceleration penalty, braking response) defined in
 * physics.ts via SURFACE_PROPS. The track samples carry one of these per
 * location; off-road shoulders fall back through a graded transition.
 */
export type Surface =
  | "asphalt" // primary race surface — max grip, max speed
  | "concrete" // tunnel floor / gantries — slightly less grip, very stable
  | "dirt" // graded terrace / dual-line low side — loose, reduced grip
  | "gravel" // shoulder edges — slippy, slows you
  | "grass" // outside the shoulders — soft, drags the car
  | "sand" // riverbed / dry pit — heavy drag, very low grip
  | "mud" // wet patches in the riverbed — slow + slidy
  | "wet" // wet asphalt (after the riverbed climb) — reduced grip
  | "rock"; // bare rock (arch pillars zone) — bumpy, medium grip

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number; // forward unit (XZ)
  rx: number;
  rz: number; // right unit (XZ)
  hw: number; // half road width
  shoulderL: number;
  shoulderR: number;
  bank: number; // meters raised at right edge
  gap: boolean;
  gapT: number; // -1 = none, else 0..1 progress through the gap (for the smooth pit profile)
  rampP: number; // -1 = none, else 0..1 through the launch ramp
  dualT: number; // 0..1 terrace blend
  wallRideR: boolean;
  wallRideL: boolean;
  riverbed: boolean;
  tunnel: boolean;
  wallHL: number;
  wallHR: number;
  /** driving surface at this sample (within hw); shoulders fall back through
   *  gravel → grass → sand as you leave the road, see Track.surfaceAt(). */
  surface: Surface;
}

export interface Gate {
  idx: number;
  pos: THREE.Vector3;
  isFinish: boolean;
  glow?: THREE.MeshStandardMaterial;
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  top: number; // top y
  lastNear: number;
  /** City motorcycles can be knocked down; other obstacles remain solid. */
  bikeIndex?: number;
  active?: boolean;
  enabled?: boolean;
}

interface CityBike {
  obstacle: Obstacle;
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  offset: THREE.Vector3;
  elapsed: number;
  hardOnly: boolean;
}

interface CityHazard {
  idx: number;
  lat: number;
  kind: "barricade" | "bike";
  hardOnly?: boolean;
}

/** A breakable wooden crate sitting on the racing line. */
export interface TrackBox {
  x: number;
  z: number;
  y: number; // center height
  idx: number;
  lat: number;
  /** stack/cluster id — smash one crate and the whole stack goes (walls share one id) */
  cluster: number;
  /** vertical half-extent — cars can jump clean over low crates */
  halfH: number;
  /** true = barricade wall segment (plank FX + bigger smash) */
  wall: boolean;
  /** crates beyond the difficulty limit are parked entirely */
  enabled: boolean;
  active: boolean;
  /** game-time ms when the smashed crate reappears */
  respawnAt: number;
  mesh: THREE.Mesh;
}

/** One live BREAK barricade on the loop (there are two). */
export interface BreakWall {
  idx: number;
  cluster: number;
  /** first plank segment — its active flag drives the glow group visibility */
  firstBox: TrackBox;
  /** amber glow strip + beacon lamps — visible only while the wall stands */
  glow: THREE.Group;
}

export interface GroundInfo {
  h: number;
  onRoad: boolean;
  inPitZone: boolean;
  /** driving surface at this point (asphalt / sand / dirt / grass / …).
   *  Drives per-wheel grip + rolling resistance in CarPhysics. */
  surface: Surface;
}

const CONTROL: [number, number, number][] = [
  [0, 0, 0],
  [100, 0, -6],
  [190, 1, -30],
  [255, 8, -95],
  [305, 0, -155],
  [350, 1, -205],
  [400, 3, -255],
  [455, 8, -300],
  [450, 14, -355],
  [420, 19, -410],
  [350, 23, -435],
  [280, 24, -430],
  [180, 23, -420],
  [90, 23, -415],
  [10, 22, -415],
  [-70, 22, -420],
  [-150, 22, -415],
  [-240, 17, -400],
  [-320, 12, -370],
  [-390, 6, -310],
  [-430, 2, -230],
  [-445, 0, -140],
  [-430, 0, -60],
  [-390, 0, 10],
  [-320, 1, 50],
  [-230, 1, 60],
  [-140, 0, 40],
  [-50, 0, 15],
];

// A closed, continuous elevated boulevard: broad bends and modest grades keep
// every section compatible with the same tyre, gravity and collision model.
const CITY_CONTROL: [number, number, number][] = [
  [0, 3, 0], [130, 3, 0], [250, 5, -30], [350, 10, -105],
  [390, 14, -220], [370, 14, -340], [300, 10, -420],
  [190, 5, -450], [60, 3, -430], [-70, 3, -460],
  [-200, 7, -450], [-310, 12, -390], [-365, 14, -280],
  [-350, 10, -160], [-275, 5, -80], [-150, 3, -35],
];

/** Fixed lateral columns for road mesh (meters from center). */
const ROAD_COLS = [-34, -28, -22, -17, -12, -8, -4, -2, 0, 2, 4, 8, 12, 17, 22, 28, 34];

export const SUN_DIR = new THREE.Vector3(-0.62, 0.5, 0.38).normalize();

interface Kicker {
  s: number;
  lat: number;
  r: number;
  h: number;
}

/** How deep the dry-riverbed pit floor sits below road level at gap progress t (0..1). */
const PIT_DEPTH = -9;
export function pitDepthAt(gapT: number): number {
  if (gapT < 0) return 0;
  // flat landing floor under the cliff, then a smooth drivable climb back to road level
  if (gapT < 0.12) return PIT_DEPTH;
  if (gapT > 0.99) return 0;
  const u = (gapT - 0.12) / 0.87; // 0..1 across the exit ramp
  // smoothstep-blended ramp: gentle at both ends, steady grade in the middle
  const s = u * u * (3 - 2 * u);
  return PIT_DEPTH * (1 - s);
}

/** The Sunstone Circuit: one spectacular closed loop through a red-rock canyon. */
export class Track {
  readonly map: MapId;
  samples: TrackSample[] = [];
  gates: Gate[] = [];
  obstacles: Obstacle[] = [];
  boxes: TrackBox[] = [];
  /** sample indices of the BREAK barricades */
  breakWallIdxs: number[] = [];
  /** per-wall live info (glow visibility + approach warnings) */
  breakWalls: BreakWall[] = [];
  /** pulsing amber glow materials (strips + beacons) — engine animates opacity */
  wallGlowMats: THREE.MeshBasicMaterial[] = [];
  kickers: Kicker[] = [];
  N = 0;
  step = 2;
  length = 0;
  group = new THREE.Group();
  minimapPts: { x: number; z: number }[] = [];
  gatePts: { x: number; z: number; finish: boolean }[] = [];
  /** BREAK barricade positions for the minimap */
  wallPts: { x: number; z: number }[] = [];
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private cityHazards: CityHazard[] = [];
  private cityHazardMeshes: THREE.InstancedMesh[] = [];
  private cityBikes: CityBike[] = [];
  private cityBikeParts: { mesh: THREE.InstancedMesh; original: THREE.Matrix4[] }[] = [];
  private cityWarningParts: { mesh: THREE.InstancedMesh; original: THREE.Matrix4[] }[] = [];
  private cityHardMode = true;

  constructor(map: MapId = "canyon") {
    this.map = map;
    this.buildSpline();
    if (map === "city") {
      this.buildCityZones();
      this.buildCityMeshes();
      this.setCityHardMode(false);
      this.updateScenery(0);
    } else {
      this.buildZones();
      this.buildMeshes();
    }
  }

  // ============================================================
  // Spline & samples
  // ============================================================

  private buildSpline() {
    const scale = this.map === "city" ? 1.25 : 1;
    const pts = (this.map === "city" ? CITY_CONTROL : CONTROL).map((p) => new THREE.Vector3(p[0] * scale, p[1], p[2] * scale));
    const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    const approxLen = curve.getLength();
    const n = Math.max(600, Math.round(approxLen / this.step));
    const spaced = curve.getSpacedPoints(n);
    this.N = n;
    this.length = n * this.step;
    const raw = spaced.slice(0, n);

    const dirs: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const a = raw[wrapIdx(i - 1, n)];
      const b = raw[wrapIdx(i + 1, n)];
      const d = new THREE.Vector2(b.x - a.x, b.z - a.z);
      if (d.lengthSq() < 1e-8) d.set(0, -1);
      dirs.push(d.normalize());
    }
    // curvature → banking (outer edge raised)
    const banks = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const d0 = dirs[wrapIdx(i - 2, n)];
      const d1 = dirs[wrapIdx(i + 2, n)];
      const crossY = d0.x * d1.y - d0.y * d1.x; // >0 = left turn
      const dot = clamp(d0.dot(d1), -1, 1);
      const dTheta = Math.atan2(crossY, dot);
      banks[i] = clamp((dTheta / (4 * this.step)) * 46, -1, 1) * 3.0;
    }
    const sm = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -9; k <= 9; k++) acc += banks[wrapIdx(i + k, n)];
      sm[i] = acc / 19;
    }

    for (let i = 0; i < n; i++) {
      const p = raw[i];
      const d = dirs[i];
      const r = new THREE.Vector2(-d.y, d.x); // right = (-dz, dx)
      this.samples.push({
        x: p.x,
        y: p.y,
        z: p.z,
        dx: d.x,
        dz: d.y,
        rx: r.x,
        rz: r.y,
        hw: 9,
        shoulderL: 8,
        shoulderR: 8,
        bank: sm[i],
        gap: false,
        gapT: -1,
        rampP: -1,
        dualT: 0,
        wallRideR: false,
        wallRideL: false,
        riverbed: false,
        tunnel: false,
        wallHL: 24,
        wallHR: 24,
        surface: "asphalt",
      });
    }
  }

  private idxNear(x: number, z: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.N; i++) {
      const s = this.samples[i];
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private range(a: number, b: number): [number, number] {
    return [
      this.idxNear(CONTROL[a][0], CONTROL[a][2]),
      this.idxNear(CONTROL[b][0], CONTROL[b][2]),
    ];
  }

  private forEachInRange(r: [number, number], fn: (i: number, t: number) => void) {
    const [a, b] = r;
    const span = (b - a + this.N) % this.N;
    for (let k = 0; k <= span; k++) fn(wrapIdx(a + k, this.N), span > 0 ? k / span : 1);
  }

  // ============================================================
  // Feature zones
  // ============================================================

  private buildZones() {
    const S = this.samples;

    // --- launch ramp before the gap (last 58% of approach → crest) ---
    const ramp = this.range(2, 3);
    this.forEachInRange(ramp, (i, t) => {
      S[i].rampP = clamp((t - 0.42) / 0.58, 0, 1);
    });

    // --- the GAP over the dry riverbed canyon ---
    // The pit is a smooth valley, not a box canyon: a short flat landing
    // floor under the cliff, then a long drivable ramp that climbs back up
    // to the landing road — undershoot the jump and you can still drive out.
    const crestI = this.idxNear(CONTROL[3][0], CONTROL[3][2]);
    const landI = this.idxNear(CONTROL[4][0], CONTROL[4][2]);
    const gapSpan = (landI - crestI + this.N) % this.N;
    const gapStart = crestI + 2;
    const gapEnd = crestI + Math.round(gapSpan * 0.62);
    for (let k = gapStart; k <= gapEnd; k++) {
      const s = S[wrapIdx(k, this.N)];
      s.gap = true;
      s.gapT = (k - gapStart) / Math.max(1, gapEnd - gapStart);
      s.shoulderL = 3.2;
      s.shoulderR = 3.2;
      s.wallHL = 30;
      s.wallHR = 30;
      // dry-riverbed floor is sand; deeper sections near the middle are mud
      s.surface = s.gapT > 0.18 && s.gapT < 0.55 ? "mud" : "sand";
    }

    // --- natural arch zone: taller walls, bare rock floor ---
    const archI = this.idxNear(CONTROL[6][0], CONTROL[6][2]);
    for (let k = archI - 14; k <= archI + 14; k++) {
      const s = S[wrapIdx(k, this.N)];
      s.wallHL = 42;
      s.wallHR = 42;
      s.surface = "rock";
    }

    // --- wall-ride carousel: banked outer wall on the right ---
    const carousel = this.range(8, 11);
    this.forEachInRange(carousel, (i, t) => {
      const edge = sstep(0, 0.14, t) * (1 - sstep(0.86, 1, t));
      const s = S[i];
      s.wallRideR = edge > 0.01;
      s.shoulderR = 26 * edge + 8 * (1 - edge);
      s.wallHR = 30;
      s.bank = s.bank * (1 - edge) + (s.bank * 0.4 + 2.4) * edge;
      // banked wall-ride surface stays asphalt (the wall itself is the feature)
    });

    // --- tunnel through the mesa: concrete floor ---
    const tunnel = this.range(13, 16);
    this.forEachInRange(tunnel, (i, t) => {
      const edge = sstep(0, 0.05, t) * (1 - sstep(0.95, 1, t));
      const s = S[i];
      s.tunnel = edge > 0.01;
      s.hw = 8.5 + 0.5 * (1 - edge);
      s.shoulderL = 1.5 + 6.5 * (1 - edge);
      s.shoulderR = 1.5 + 6.5 * (1 - edge);
      if (edge > 0.5) s.surface = "concrete";
    });

    // --- dual-line downhill: high terrace on the left, dirt low side ---
    const dual = this.range(16, 18);
    this.forEachInRange(dual, (i, t) => {
      const s = S[i];
      s.dualT = sstep(0, 0.12, t) * (1 - sstep(0.88, 1, t));
      s.shoulderL = 9.5;
      // the low (right) side of the dual-line is a graded dirt terrace
      if (s.dualT > 0.4) s.surface = "dirt";
    });

    // --- riverbed: wide sandy floor with mud patches near the banks ---
    const river = this.range(19, 24);
    this.forEachInRange(river, (i, t) => {
      const edge = sstep(0, 0.06, t) * (1 - sstep(0.94, 1, t));
      const s = S[i];
      s.riverbed = true;
      s.hw = 9 + 11 * edge;
      s.shoulderL = 8 + 6 * edge;
      s.shoulderR = 8 + 6 * edge;
      s.wallHL = 20;
      s.wallHR = 20;
      if (edge > 0.5) {
        // muddy section near the riverbed middle (around CONTROL 21-22)
        const mid = this.idxNear(CONTROL[21][0], CONTROL[21][2]);
        const dToMid = Math.min(Math.abs(i - mid), this.N - Math.abs(i - mid));
        s.surface = dToMid < 14 ? "mud" : "sand";
      }
    });

    // --- wet road briefly after the riverbed climb (the road is "damp"
    //     where it meets the sand ramp) ---
    const wetStart = this.idxNear(CONTROL[24][0], CONTROL[24][2]);
    for (let k = 0; k < 8; k++) {
      const s = S[wrapIdx(wetStart + k, this.N)];
      s.surface = "wet";
    }

    // --- low walls near the start/finish for the vista ---
    for (let k = -30; k <= 40; k++) {
      const s = S[wrapIdx(k, this.N)];
      s.wallHL = Math.min(s.wallHL, 14);
      s.wallHR = Math.min(s.wallHR, 14);
    }

    // wall height noise
    for (let i = 0; i < this.N; i++) {
      const s = S[i];
      const n =
        Math.sin(i * 0.093) * 0.5 + Math.sin(i * 0.031 + 2.1) * 0.3 + Math.sin(i * 0.017 + 4) * 0.2;
      s.wallHL = Math.max(10, s.wallHL + n * 7);
      s.wallHR = Math.max(10, s.wallHR + n * 7 + Math.sin(i * 0.05) * 2);
    }

    // --- kicker bumps in the riverbed ---
    const rB = this.idxNear(CONTROL[21][0], CONTROL[21][2]);
    const rC = this.idxNear(CONTROL[22][0], CONTROL[22][2]);
    const rD = this.idxNear(CONTROL[23][0], CONTROL[23][2]);
    this.kickers = [
      { s: (rB + 9) * this.step, lat: -8, r: 7, h: 2.1 },
      { s: (rC + 10) * this.step, lat: 7, r: 7, h: 2.2 },
      { s: (rD + 12) * this.step, lat: -5, r: 6.5, h: 1.9 },
    ];

    // --- checkpoint gates in racing order ---
    const gateAnchors: { c: number; finish: boolean }[] = [
      { c: 4, finish: false }, // gap landing
      { c: 6, finish: false }, // arch
      { c: 7, finish: false }, // climb
      { c: 10, finish: false }, // carousel apex
      { c: 13, finish: false }, // tunnel entry
      { c: 16, finish: false }, // tunnel exit
      { c: 18, finish: false }, // dual-line merge
      { c: 22, finish: false }, // riverbed mid
      { c: 27, finish: false }, // final arc
      { c: 0, finish: true }, // start/finish
    ];
    for (const g of gateAnchors) {
      const idx = this.idxNear(CONTROL[g.c][0], CONTROL[g.c][2]);
      const s = S[idx];
      this.gates.push({ idx, pos: new THREE.Vector3(s.x, s.y, s.z), isFinish: g.finish });
      this.gatePts.push({ x: s.x, z: s.z, finish: g.finish });
    }

    for (let i = 0; i < this.N; i += 6) this.minimapPts.push({ x: S[i].x, z: S[i].z });

    this.addObstacles();
  }

  private buildCityZones() {
    for (const s of this.samples) {
      s.hw = 11;
      s.shoulderL = s.shoulderR = 4;
      s.wallHL = s.wallHR = 3;
      s.surface = "asphalt";
      s.bank = clamp(s.bank, -1.2, 1.2);
    }
    for (let k = 1; k <= 8; k++) {
      const idx = k === 8 ? 0 : Math.round(this.N * k / 8);
      const s = this.samples[idx];
      this.gates.push({ idx, pos: new THREE.Vector3(s.x, s.y, s.z), isFinish: k === 8 });
      this.gatePts.push({ x: s.x, z: s.z, finish: k === 8 });
    }
    for (let i = 0; i < this.N; i += 6) this.minimapPts.push({ x: this.samples[i].x, z: this.samples[i].z });
    // Alternating obstructions leave a clear lane and are kept away from the
    // grid and checkpoint gantries. They are identical for every client.
    const locations = [0.08, 0.18, 0.29, 0.39, 0.52, 0.64, 0.77, 0.88];
    this.cityHazards = locations.map((fraction, i) => ({
      idx: Math.floor(this.N * fraction),
      lat: i % 2 === 0 ? 5.5 : -5.5,
      kind: i % 4 < 2 ? "barricade" : "bike",
    }));
    for (const [i, fraction] of [0.14, 0.34, 0.60, 0.81].entries()) {
      this.cityHazards.push({ idx: Math.floor(this.N * fraction), lat: i % 2 ? 5.5 : -5.5, kind: "bike", hardOnly: true });
    }
    for (const hazard of this.cityHazards) {
      const s = this.sample(hazard.idx);
      const obstacle: Obstacle = {
        x: s.x + s.rx * hazard.lat,
        z: s.z + s.rz * hazard.lat,
        r: hazard.kind === "barricade" ? 1.8 : 1.1,
        top: this.heightAt(hazard.idx, hazard.lat) + 2.4,
        lastNear: -1e9,
      };
      if (hazard.kind === "bike") {
        obstacle.bikeIndex = this.cityBikes.length;
        obstacle.active = true;
        this.cityBikes.push({
          obstacle,
          origin: new THREE.Vector3(obstacle.x, this.heightAt(hazard.idx, hazard.lat), obstacle.z),
          velocity: new THREE.Vector3(), offset: new THREE.Vector3(), elapsed: 0, hardOnly: !!hazard.hardOnly,
        });
      }
      this.obstacles.push(obstacle);
    }
  }

  private addObstacles() {
    const rnd = mulberry32(20240607);
    // riverbed boulders
    const rA = this.idxNear(CONTROL[20][0], CONTROL[20][2]);
    const rB = this.idxNear(CONTROL[23][0], CONTROL[23][2]);
    const span = (rB - rA + this.N) % this.N;
    for (let k = 0; k < 8; k++) {
      const idx = wrapIdx(rA + Math.round(span * (0.12 + 0.78 * rnd())), this.N);
      const s = this.samples[idx];
      const lat = (rnd() * 9 + 4.5) * (rnd() > 0.5 ? 1 : -1);
      const r = 1.7 + rnd() * 0.9;
      this.obstacles.push({
        x: s.x + s.rx * lat,
        z: s.z + s.rz * lat,
        r,
        top: this.heightAt(idx, lat) + r * 1.5,
        lastNear: -1e9,
      });
    }
    // rock fins on the dual-line low (right) side
    const dA = this.idxNear(CONTROL[17][0], CONTROL[17][2]);
    for (let k = 0; k < 3; k++) {
      const idx = wrapIdx(dA + 8 + k * 14, this.N);
      const s = this.samples[idx];
      const lat = 5.5 + rnd() * 3;
      this.obstacles.push({
        x: s.x + s.rx * lat,
        z: s.z + s.rz * lat,
        r: 1.6,
        top: this.heightAt(idx, lat) + 3.4,
        lastNear: -1e9,
      });
    }
    // arch pillars
    const archI = this.idxNear(CONTROL[6][0], CONTROL[6][2]);
    const as = this.samples[archI];
    for (const side of [-1, 1]) {
      const lat = side * (as.hw + 2.2);
      this.obstacles.push({
        x: as.x + as.rx * lat,
        z: as.z + as.rz * lat,
        r: 2.3,
        top: this.heightAt(archI, lat) + 9,
        lastNear: -1e9,
      });
    }
    // two rocks flanking the landing zone (near-miss bait)
    const landI = this.idxNear(CONTROL[4][0], CONTROL[4][2]);
    const ls = this.samples[landI];
    for (const side of [-1, 1]) {
      const lat = side * (ls.hw + 1.4);
      this.obstacles.push({
        x: ls.x + ls.rx * lat,
        z: ls.z + ls.rz * lat,
        r: 2.0,
        top: this.heightAt(landI, lat) + 3,
        lastNear: -1e9,
      });
    }
  }

  // ============================================================
  // Sampling API
  // ============================================================

  sample(i: number): TrackSample {
    return this.samples[wrapIdx(i, this.N)];
  }

  groundAt(i: number, lat: number, out: GroundInfo): GroundInfo {
    const s = this.sample(i);
    const al = Math.abs(lat);
    if (s.gap && al < s.hw + 3) {
      out.h = s.y + pitDepthAt(s.gapT);
      out.onRoad = false;
      out.inPitZone = true;
      out.surface = s.surface; // sand / mud from the gap zone assignment
      return out;
    }
    out.inPitZone = false;
    let h = s.y;
    const u = clamp(lat / s.hw, -1, 1);
    h += s.bank * u;
    if (s.riverbed) h += 0.45 * u * u;
    if (s.dualT > 0 && lat > 3) {
      const t = sstep(3, 5, lat) * (1 - sstep(13, 15.5, lat));
      h += 2.6 * s.dualT * t;
    }
    if (s.wallRideR && lat > 4) h += 13 * Math.pow(Math.min(1, (lat - 4) / 24), 2.4);
    if (s.wallRideL && lat < -4) h += 13 * Math.pow(Math.min(1, (-lat - 4) / 24), 2.4);
    if (s.rampP >= 0 && al < s.hw + 1) {
      const latFade = 1 - sstep(4.5, s.hw, al);
      h += 3.4 * sstep(0.1, 0.92, s.rampP) * latFade;
    }
    let onRoad = al <= s.hw;
    if (al > s.hw) {
      if (s.wallRideR && lat > 0) onRoad = true;
      else if (s.dualT > 0 && lat < 0 && lat > 3) onRoad = true;
      else {
        const sh = lat > 0 ? s.shoulderR : s.shoulderL;
        if (sh > 0) h -= 0.55 * Math.min(1, (al - s.hw) / Math.max(0.5, sh));
      }
    }
    const sHere = wrapIdx(i, this.N) * this.step;
    for (const k of this.kickers) {
      let ds = Math.abs(sHere - k.s);
      ds = Math.min(ds, this.length - ds);
      const dl = lat - k.lat;
      const d2 = ds * ds + dl * dl;
      if (d2 < k.r * k.r) {
        const q = Math.sqrt(d2) / k.r;
        h += k.h * (0.5 + 0.5 * Math.cos(Math.PI * q));
      }
    }
    out.h = h;
    out.onRoad = onRoad;
    // surface assignment:
    //  - on the road (within hw) → the sample's own surface
    //  - off the road (shoulder) → graded chain gravel → grass → sand
    //    the further off you go, the looser it gets (so grass just past
    //    the edge gives way to sand further out)
    if (this.map === "city") {
      out.surface = onRoad ? "asphalt" : "concrete";
    } else if (onRoad) {
      out.surface = s.surface;
    } else {
      const sh = lat > 0 ? s.shoulderR : s.shoulderL;
      const over = al - s.hw; // meters past the road edge
      if (s.riverbed || s.gap) {
        // already sand/mud in the riverbed — keep it
        out.surface = s.surface;
      } else if (over < Math.max(1.5, sh * 0.4)) {
        out.surface = "gravel";
      } else if (over < Math.max(3.5, sh * 0.85)) {
        out.surface = "grass";
      } else {
        out.surface = "sand";
      }
    }
    return out;
  }

  heightAt(i: number, lat: number): number {
    return this.groundAt(i, lat, TMP_GROUND).h;
  }

  // ---- continuous (interpolated) sampling ----
  // The physics used to snap to the discrete 2 m sample grid, which made the
  // car's height (and everything derived from it) pop at every sample boundary
  // — a visible buzz/jiggle at speed. These queries blend adjacent samples so
  // the driven surface matches the rendered road exactly and stays smooth.

  /** Ground query at a continuous sample coordinate p (= idx + fraction ahead). */
  groundAtP(p: number, lat: number, out: GroundInfo): GroundInfo {
    const i0 = Math.floor(p);
    const fr = clamp(p - i0, 0, 1);
    const a = this.groundAt(i0, lat, TMP_GA);
    const b = this.groundAt(i0 + 1, lat, TMP_GB);
    if (a.inPitZone !== b.inPitZone) {
      // cliff lip at the gap — keep the step crisp so launches still fire
      const use = fr < 0.5 ? a : b;
      out.h = use.h;
      out.onRoad = use.onRoad;
      out.inPitZone = use.inPitZone;
      out.surface = use.surface;
      return out;
    }
    out.h = a.h + (b.h - a.h) * fr;
    out.onRoad = fr < 0.5 ? a.onRoad : b.onRoad;
    out.inPitZone = a.inPitZone;
    out.surface = fr < 0.5 ? a.surface : b.surface;
    return out;
  }

  heightAtP(p: number, lat: number): number {
    return this.groundAtP(p, lat, TMP_GROUND).h;
  }

  /** Lateral slope at a continuous sample coordinate. */
  slopeLatAtP(p: number, lat: number): number {
    return (this.heightAtP(p, lat + 0.9) - this.heightAtP(p, lat - 0.9)) / 1.8;
  }

  /** Forward slope at a continuous sample coordinate. */
  slopeFwdAtP(p: number, lat: number): number {
    const d = 0.9 / this.step;
    return (this.heightAtP(p + d, lat) - this.heightAtP(p - d, lat)) / 1.8;
  }

  slopeLatAt(i: number, lat: number): number {
    const a = this.heightAt(wrapIdx(i, this.N), lat + 0.9);
    const b = this.heightAt(wrapIdx(i, this.N), lat - 0.9);
    return (a - b) / 1.8;
  }

  slopeFwdAt(i: number, lat: number): number {
    const a = this.heightAt(wrapIdx(i + 1, this.N), lat);
    const b = this.heightAt(wrapIdx(i - 1, this.N), lat);
    return (a - b) / (2 * this.step);
  }

  wallDist(i: number, side: 1 | -1): number {
    const s = this.sample(i);
    return side > 0 ? s.hw + s.shoulderR + 0.3 : s.hw + s.shoulderL + 0.3;
  }

  /** Surface type at a continuous sample coordinate p (= idx + fraction). */
  surfaceAtP(p: number, lat: number): Surface {
    return this.groundAtP(p, lat, TMP_GROUND).surface;
  }

  /** Find the checkpoint gate nearest to (idx) — used for recovery placement.
   *  Returns the gate index (into this.gates) and a forward offset sample. */
  nearestCheckpoint(idx: number): { gateK: number; gateIdx: number; ahead: number } {
    let bestK = 0;
    let bestD = Infinity;
    for (let k = 0; k < this.gates.length; k++) {
      let d = this.gates[k].idx - idx;
      if (d < -this.N / 2) d += this.N;
      else if (d > this.N / 2) d -= this.N;
      if (d >= 0 && d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    return { gateK: bestK, gateIdx: this.gates[bestK].idx, ahead: bestD };
  }

  nearestIdx(x: number, z: number, hint: number): number {
    let best = hint;
    let bd = Infinity;
    for (let k = -35; k <= 95; k++) {
      const i = wrapIdx(hint + k, this.N);
      const s = this.samples[i];
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (bd > 90 * 90) best = this.idxNear(x, z);
    return best;
  }

  lateralOf(i: number, x: number, z: number): number {
    const s = this.sample(i);
    return (x - s.x) * s.rx + (z - s.z) * s.rz;
  }

  posAt(i: number, lat: number, y?: number): THREE.Vector3 {
    const s = this.sample(i);
    return new THREE.Vector3(s.x + s.rx * lat, y ?? s.y, s.z + s.rz * lat);
  }

  // ============================================================
  // Meshes
  // ============================================================

  private buildMeshes() {
    this.buildWalls();
    this.buildRoad();
    this.buildRouteMarks();
    this.buildPit();
    this.buildTunnel();
    this.buildArch();
    this.buildScenery();
    this.buildGates();
    // two BREAK barricades: one right after the first jump (you spot its
    // banner mid-air), one on the final arc — both with the full clarity kit
    this.buildBreakWall(5, 1_000_000);
    this.buildBreakWall(25, 1_000_001);
    this.buildStacks();
  }

  private cityClusters = new Map<number, THREE.Group>();
  private cityGeometry: THREE.BoxGeometry | null = null;
  private cityMaterial: THREE.MeshLambertMaterial | null = null;
  private cityNeon: THREE.MeshBasicMaterial | null = null;
  private cityPillars: THREE.InstancedMesh | null = null;
  private readonly cityClusterCount = 16;
  private cityCenter = -1;

  private buildCityMeshes() {
    this.buildRoad();
    this.buildRouteMarks();
    this.buildGates();
    this.buildCityHazards();

    // Continuous concrete barriers are placed at the same lateral distance as
    // the physics walls, so the visible road and collision surface agree.
    const vertices: number[] = [];
    const indices: number[] = [];
    for (const side of [-1, 1] as const) {
      const base = vertices.length / 3;
      for (let i = 0; i < this.N; i++) {
        const s = this.samples[i];
        const lat = side * this.wallDist(i, side);
        const y = this.heightAt(i, lat);
        vertices.push(s.x + s.rx * lat, y, s.z + s.rz * lat,
          s.x + s.rx * lat, y + 2.2, s.z + s.rz * lat);
      }
      for (let i = 0; i < this.N; i++) {
        const a = base + i * 2, b = base + ((i + 1) % this.N) * 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const barrier = new THREE.BufferGeometry();
    barrier.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    barrier.setIndex(indices);
    barrier.computeVertexNormals();
    const barrierMat = new THREE.MeshLambertMaterial({ color: 0x465668, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(barrier, barrierMat));
    this.disposables.push(barrier, barrierMat);
    const railMat = new THREE.LineBasicMaterial({ color: 0x68e9f0 });
    for (const side of [-1, 1] as const) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < this.N; i += 2) {
        const s = this.sample(i);
        const lat = side * this.wallDist(i, side);
        points.push(new THREE.Vector3(s.x + s.rx * lat, this.heightAt(i, lat) + 2.23, s.z + s.rz * lat));
      }
      const rail = new THREE.BufferGeometry().setFromPoints(points);
      this.group.add(new THREE.LineLoop(rail, railMat));
      this.disposables.push(rail);
    }
    this.disposables.push(railMat);

    // The elevated roadway and towers sit on visible foundations, rather than
    // floating scenery. These are decorative; driving remains on the road.
    const groundGeo = new THREE.PlaneGeometry(2200, 2200);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x283644 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    this.group.add(ground);
    const pillarGeo = new THREE.BoxGeometry(1, 1, 1);
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x65717b });
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, Math.ceil(this.N / 35));
    const pillarTransform = new THREE.Object3D();
    for (let i = 0; i < pillars.count; i++) {
      const s = this.sample(i * 35);
      const h = s.y + 10;
      pillarTransform.position.set(s.x, -10 + h / 2, s.z);
      pillarTransform.scale.set(3.5, h, 3.5);
      pillarTransform.updateMatrix();
      pillars.setMatrixAt(i, pillarTransform.matrix);
    }
    pillars.computeBoundingSphere();
    this.group.add(pillars);
    this.cityPillars = pillars;
    this.disposables.push(groundGeo, groundMat, pillarGeo, pillarMat);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#263447";
    ctx.fillRect(0, 0, 128, 128);
    const rnd = mulberry32(4127);
    for (let y = 3; y < 128; y += 10) for (let x = 3; x < 128; x += 10) {
      ctx.fillStyle = rnd() > 0.42 ? (rnd() > 0.7 ? "#edbd87" : "#77c9d3") : "#172534";
      ctx.fillRect(x, y, 5, 5);
    }
    const windows = new THREE.CanvasTexture(canvas);
    windows.colorSpace = THREE.SRGBColorSpace;
    this.cityGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.cityMaterial = new THREE.MeshLambertMaterial({ map: windows, color: 0xb7c9dc });
    this.cityNeon = new THREE.MeshBasicMaterial({ color: 0x5ae7f1 });
    this.disposables.push(windows, this.cityGeometry, this.cityMaterial, this.cityNeon);
  }

  /** Roadside police equipment is stationary, with collisions matching its
   *  visible footprint. Every obstruction has an advance warning light. */
  private buildCityHazards() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const wheel = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    wheel.rotateZ(Math.PI / 2);
    const white = new THREE.MeshLambertMaterial({ color: 0xdce4e6 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x162433 });
    const red = new THREE.MeshBasicMaterial({ color: 0xff584c });
    const blue = new THREE.MeshBasicMaterial({ color: 0x39bfff });
    const amber = new THREE.MeshBasicMaterial({ color: 0xffc04a });
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e7edf0";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#113359";
    ctx.font = "bold 46px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("POLICE", 128, 32);
    const signTexture = new THREE.CanvasTexture(canvas);
    signTexture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.MeshLambertMaterial({ map: signTexture });
    this.disposables.push(box, wheel, white, dark, red, blue, amber, signTexture, sign);
    const barriers = this.cityHazards.filter((h) => h.kind === "barricade");
    const bikes = this.cityHazards.filter((h) => h.kind === "bike");
    const transform = new THREE.Object3D();
    const addPart = (
      hazards: CityHazard[], geometry: THREE.BufferGeometry, material: THREE.Material,
      scale: [number, number, number], lateral: number, forward: number, height: number,
      advance = 0,
    ) => {
      const mesh = new THREE.InstancedMesh(geometry, material, hazards.length);
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        const idx = wrapIdx(h.idx - advance, this.N);
        const s = this.sample(idx);
        const lat = advance ? Math.sign(h.lat) * 12 : h.lat + lateral;
        transform.position.set(
          s.x + s.rx * lat + s.dx * forward,
          this.heightAt(idx, lat) + height,
          s.z + s.rz * lat + s.dz * forward,
        );
        transform.rotation.set(0, Math.atan2(s.dx, s.dz), 0);
        transform.scale.set(...scale);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
      }
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.cityHazardMeshes.push(mesh);
      if (hazards === bikes && advance === 0) {
        const original = bikes.map((_, i) => {
          const matrix = new THREE.Matrix4();
          mesh.getMatrixAt(i, matrix);
          return matrix;
        });
        this.cityBikeParts.push({ mesh, original });
      }
      if (hazards === this.cityHazards && advance > 0) {
        const original = hazards.map((_, i) => {
          const matrix = new THREE.Matrix4();
          mesh.getMatrixAt(i, matrix);
          return matrix;
        });
        this.cityWarningParts.push({ mesh, original });
      }
    };
    // Police barricades: two legs, reflective crossbar, and red/blue lamps.
    addPart(barriers, box, dark, [0.18, 1.45, 0.38], -1.35, 0, 0.72);
    addPart(barriers, box, dark, [0.18, 1.45, 0.38], 1.35, 0, 0.72);
    addPart(barriers, box, sign, [3.4, 0.58, 0.25], 0, 0, 1.25);
    addPart(barriers, box, red, [0.55, 0.25, 0.35], -1.1, 0, 1.72);
    addPart(barriers, box, blue, [0.55, 0.25, 0.35], 1.1, 0, 1.72);
    // Parked police bikes: two wheels, a low chassis, seat and beacon.
    addPart(bikes, wheel, dark, [0.32, 0.85, 0.85], 0, -0.78, 0.45);
    addPart(bikes, wheel, dark, [0.32, 0.85, 0.85], 0, 0.78, 0.45);
    addPart(bikes, box, white, [0.65, 0.48, 1.65], 0, 0, 0.85);
    addPart(bikes, box, dark, [0.55, 0.22, 0.65], 0, -0.2, 1.18);
    addPart(bikes, box, blue, [0.3, 0.2, 0.3], 0, 0.65, 1.38);
    // Small warning beacons 56 m before the obstruction, on the shoulder.
    addPart(this.cityHazards, box, dark, [0.22, 1.8, 0.22], 0, 0, 0.9, 28);
    addPart(this.cityHazards, box, amber, [0.9, 0.5, 0.25], 0, 0, 1.8, 28);
  }

  /** Extra motorcycles and their warning beacons are only enabled on Hard. */
  setCityHardMode(enabled: boolean) {
    if (this.map !== "city" || this.cityHardMode === enabled) return;
    this.cityHardMode = enabled;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.cityBikes.length; i++) {
      const bike = this.cityBikes[i];
      if (!bike.hardOnly) continue;
      bike.obstacle.enabled = enabled;
      bike.obstacle.active = enabled;
      bike.elapsed = 0;
      bike.offset.set(0, 0, 0);
      bike.velocity.set(0, 0, 0);
      for (const part of this.cityBikeParts) part.mesh.setMatrixAt(i, enabled ? part.original[i] : hidden);
    }
    for (const part of this.cityBikeParts) part.mesh.instanceMatrix.needsUpdate = true;
    for (const part of this.cityWarningParts) {
      for (let i = 0; i < this.cityHazards.length; i++) {
        if (this.cityHazards[i].hardOnly) part.mesh.setMatrixAt(i, enabled ? part.original[i] : hidden);
      }
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Transfer momentum to a parked bike without treating it as an immovable wall. */
  hitCityBike(obstacle: Obstacle, vx: number, vz: number, impact: number): boolean {
    if (obstacle.bikeIndex == null || obstacle.active === false || obstacle.enabled === false) return false;
    const bike = this.cityBikes[obstacle.bikeIndex];
    if (!bike) return false;
    obstacle.active = false;
    bike.elapsed = 0;
    bike.offset.set(0, 0, 0);
    const speed = Math.hypot(vx, vz);
    const impulseSpeed = Math.min(16, Math.max(0.5, impact * 0.4));
    bike.velocity.set(speed > 0.01 ? vx / speed * impulseSpeed : 0, 0, speed > 0.01 ? vz / speed * impulseSpeed : 0);
    return true;
  }

  /** Slide and tip struck bikes; after the cooldown restore their original pose. */
  updateCityBikes(dt: number) {
    if (dt <= 0 || !this.cityBikeParts.length || !this.cityBikes.some((bike) => bike.obstacle.enabled !== false && bike.obstacle.active === false)) return;
    let changed = false;
    for (let i = 0; i < this.cityBikes.length; i++) {
      const bike = this.cityBikes[i];
      if (bike.obstacle.enabled === false || bike.obstacle.active !== false) continue;
      const settled = bike.elapsed >= 0.4 && bike.velocity.lengthSq() === 0;
      bike.elapsed += dt;
      if (bike.elapsed >= 15) {
        bike.obstacle.active = true;
        bike.velocity.set(0, 0, 0);
        bike.offset.set(0, 0, 0);
        for (const part of this.cityBikeParts) part.mesh.setMatrixAt(i, part.original[i]);
      } else if (!settled) {
        bike.offset.addScaledVector(bike.velocity, dt);
        const speed = bike.velocity.length();
        if (speed > 0) bike.velocity.multiplyScalar(Math.max(0, speed - 8 * dt) / speed);
        const tilt = Math.min(1, bike.elapsed * 2.5) * Math.PI * 0.47;
        const pivot = new THREE.Matrix4().makeTranslation(bike.origin.x + bike.offset.x, bike.origin.y, bike.origin.z + bike.offset.z);
        const rotation = new THREE.Matrix4().makeRotationZ(tilt);
        const inverse = new THREE.Matrix4().makeTranslation(-bike.origin.x, -bike.origin.y, -bike.origin.z);
        const matrix = new THREE.Matrix4();
        const posed = new THREE.Matrix4();
        matrix.multiplyMatrices(pivot, rotation).multiply(inverse);
        for (const part of this.cityBikeParts) {
          posed.multiplyMatrices(matrix, part.original[i]);
          part.mesh.setMatrixAt(i, posed);
        }
      } else continue;
      changed = true;
    }
    if (changed) for (const part of this.cityBikeParts) part.mesh.instanceMatrix.needsUpdate = true;
  }

  resetCityBikes() {
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.cityBikes.length; i++) {
      const bike = this.cityBikes[i];
      bike.obstacle.active = bike.obstacle.enabled !== false;
      bike.elapsed = 0;
      bike.offset.set(0, 0, 0);
      bike.velocity.set(0, 0, 0);
      for (const part of this.cityBikeParts) part.mesh.setMatrixAt(i, bike.obstacle.enabled === false ? hidden : part.original[i]);
    }
    for (const part of this.cityBikeParts) part.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Recycle five districts as the car moves, keeping GPU buffers resident. */
  updateScenery(sampleIndex: number) {
    if (this.map !== "city" || !this.cityGeometry || !this.cityMaterial || !this.cityNeon) return;
    const center = Math.floor(wrapIdx(sampleIndex, this.N) / this.N * this.cityClusterCount);
    if (center === this.cityCenter) return;
    this.cityCenter = center;
    const desired = new Set<number>();
    for (let offset = -2; offset <= 2; offset++) desired.add(wrapIdx(center + offset, this.cityClusterCount));
    const pool: THREE.Group[] = [];
    for (const [id, group] of this.cityClusters) {
      if (desired.has(id)) continue;
      this.cityClusters.delete(id);
      pool.push(group);
    }
    for (const id of desired) {
      if (this.cityClusters.has(id)) continue;
      const count = 16;
      let group = pool.pop();
      if (!group) {
        group = new THREE.Group();
        group.add(
          new THREE.InstancedMesh(this.cityGeometry, this.cityMaterial, count),
          new THREE.InstancedMesh(this.cityGeometry, this.cityNeon, count),
          new THREE.InstancedMesh(this.cityGeometry, this.cityMaterial, count),
          new THREE.InstancedMesh(this.cityGeometry, this.cityMaterial, 8),
          new THREE.InstancedMesh(this.cityGeometry, this.cityNeon, 8),
        );
        this.group.add(group);
      }
      const [towers, lights, foundations, lampPosts, lampHeads] = group.children as THREE.InstancedMesh[];
      const transform = new THREE.Object3D();
      const random = mulberry32(8001 + id);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor((id + (Math.floor(i / 2) + 0.5) / (count / 2)) * this.N / this.cityClusterCount);
        const s = this.sample(idx);
        const side = i % 2 ? 1 : -1;
        const width = 20 + random() * 16;
        const depth = 17 + random() * 18;
        const height = 28 + random() * 90;
        const lat = side * (35 + depth * 0.5 + random() * 15);
        transform.position.set(s.x + s.rx * lat, s.y - 4 + height / 2, s.z + s.rz * lat);
        transform.rotation.set(0, Math.atan2(s.rx, s.rz), 0);
        transform.scale.set(width, height, depth);
        transform.updateMatrix();
        towers.setMatrixAt(i, transform.matrix);
        const foundationHeight = s.y + 6;
        transform.position.y = -10 + foundationHeight / 2;
        transform.scale.set(width, foundationHeight, depth);
        transform.updateMatrix();
        foundations.setMatrixAt(i, transform.matrix);
        transform.position.y = s.y - 4 + height + 0.15;
        transform.scale.set(width * 0.96, 0.3, depth * 0.96);
        transform.updateMatrix();
        lights.setMatrixAt(i, transform.matrix);
      }
      for (let i = 0; i < 8; i++) {
        const idx = Math.floor((id + (Math.floor(i / 2) + 0.5) / 4) * this.N / this.cityClusterCount);
        const s = this.sample(idx);
        const lat = (i % 2 ? 1 : -1) * 14;
        transform.rotation.set(0, 0, 0);
        transform.position.set(s.x + s.rx * lat, s.y + 3.7, s.z + s.rz * lat);
        transform.scale.set(0.3, 7.4, 0.3);
        transform.updateMatrix();
        lampPosts.setMatrixAt(i, transform.matrix);
        transform.position.y = s.y + 7.4;
        transform.scale.set(1.3, 0.25, 1.3);
        transform.updateMatrix();
        lampHeads.setMatrixAt(i, transform.matrix);
      }
      for (const mesh of [towers, lights, foundations, lampPosts, lampHeads]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      this.cityClusters.set(id, group);
    }
  }

  private buildWalls() {
    const S = this.samples;
    const n = this.N;
    for (const side of [-1, 1] as const) {
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const strata = PALETTE.rockStrata.map((c) => new THREE.Color(c));
      const cBase = new THREE.Color(PALETTE.rockBase);
      for (let i = 0; i < n; i++) {
        const s = S[i];
        const wd = this.wallDist(i, side) - 0.3;
        const bx = s.x + s.rx * wd * side;
        const bz = s.z + s.rz * wd * side;
        const wallH = side > 0 ? s.wallHR : s.wallHL;
        const lean = 7 + ((i * 37) % 5);
        const tx = s.x + (s.rx * wd + lean) * side;
        const tz = s.z + (s.rz * wd + lean) * side;
        const by = s.gap ? s.y + pitDepthAt(s.gapT) - 0.4 : this.heightAt(i, wd * side) - 0.2;
        const ty = s.y + wallH;
        pos.push(bx, by, bz, tx, ty, tz);
        for (const yv of [by, ty]) {
          const band = Math.floor((yv + Math.sin(i * 0.7 + side) * 1.4) / 4.2);
          const c = strata[((band % strata.length) + strata.length) % strata.length].clone();
          c.lerp(cBase, 0.25 + 0.2 * Math.abs(Math.sin(i * 0.13 + band)));
          col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        const b = ((i + 1) % n) * 2;
        if (side > 0) {
          // normal faces the track (-right)
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        } else {
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(g, m);
    }
  }

  private ringLats(i: number): number[] {
    const s = this.sample(i);
    const wdL = -this.wallDist(i, -1);
    const wdR = this.wallDist(i, 1);
    const lats: number[] = [wdL];
    for (const l of ROAD_COLS) {
      if (l > wdL + 0.05 && l < wdR - 0.05) lats.push(l);
    }
    lats.push(wdR);
    return lats;
  }

  private buildRoad() {
    const n = this.N;
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const cRoad = new THREE.Color(PALETTE.road);
    const cRoadDust = new THREE.Color(PALETTE.roadDust);
    const cSand = new THREE.Color(PALETTE.sand);
    const cPit = new THREE.Color(PALETTE.pitSand);
    const cTerr = new THREE.Color(0xcf8a52);
    // surface tints — match the physics so the player can SEE the surface change
    const cAsphalt = new THREE.Color(0x4a4640); // dark grey-tan (main canyon road)
    const cConcrete = new THREE.Color(0x8a8276); // pale concrete (tunnel)
    const cDirt = new THREE.Color(0x9b6b3f); // brown dirt (dual-line low)
    const cGravel = new THREE.Color(0xb09a7a); // pale gravel (shoulders)
    const cGrass = new THREE.Color(0x6f7a3e); // dry grass (off-shoulder)
    const cSandSurf = new THREE.Color(0xe0b878); // sand (riverbed)
    const cMud = new THREE.Color(0x6a4a2a); // wet mud (riverbed mid)
    const cWet = new THREE.Color(0x3a3a3a); // dark wet asphalt
    const cRock = new THREE.Color(0x9c6a44); // bare rock (arch zone)
    const gi: GroundInfo = { h: 0, onRoad: false, inPitZone: false, surface: "asphalt" };

    const ringLats: number[][] = [];
    const ringStart: number[] = [];
    for (let i = 0; i < n; i++) {
      ringStart[i] = pos.length / 3;
      const s = this.samples[i];
      const lats = this.ringLats(i);
      ringLats.push(lats);
      for (const l of lats) {
        this.groundAt(i, l, gi);
        let c: THREE.Color;
        if (gi.inPitZone) {
          // pit sand (gap) — keep the warm pit-sand look
          c = cPit;
        } else if (Math.abs(l) <= s.hw + 0.01) {
          // on the road — color by surface type so the driver can read it
          const wobble = 0.3 + 0.2 * Math.sin(i * 0.37);
          switch (gi.surface) {
            case "concrete":
              c = cConcrete.clone().lerp(cRoadDust, 0.1 * wobble);
              break;
            case "dirt":
              c = cDirt.clone().lerp(cTerr, 0.15 + 0.1 * Math.sin(i * 0.21 + l));
              break;
            case "sand":
              c = cSandSurf.clone().offsetHSL(0, 0, Math.sin(i * 0.53 + l) * 0.02);
              break;
            case "mud":
              c = cMud.clone().lerp(cSandSurf, 0.25 + 0.1 * Math.sin(i * 0.41));
              break;
            case "wet":
              c = cWet.clone().lerp(cAsphalt, 0.25 + 0.08 * Math.sin(i * 0.33));
              break;
            case "rock":
              c = cRock.clone().lerp(cTerr, 0.2 + 0.12 * Math.sin(i * 0.19 + l));
              break;
            case "asphalt":
            default:
              c = cAsphalt.clone().lerp(cRoadDust, wobble);
              break;
          }
        } else if (s.dualT > 0 && l < -3) {
          c = cTerr.clone();
        } else if (s.wallRideR && l > s.hw) {
          const t = clamp((l - 4) / 24, 0, 1);
          c = cRoad.clone().lerp(cTerr, t * 0.8);
        } else {
          // shoulders / off-road — graded chain: gravel → grass → sand
          switch (gi.surface) {
            case "gravel":
              c = cGravel.clone().offsetHSL(0, 0, Math.sin(i * 0.29 + l) * 0.02);
              break;
            case "grass":
              c = cGrass.clone().offsetHSL(0, 0, Math.sin(i * 0.23 + l * 0.5) * 0.03);
              break;
            case "sand":
              c = cSand.clone().offsetHSL(0, 0, Math.sin(i * 0.53 + l) * 0.015);
              break;
            default:
              c = cSand.clone().offsetHSL(0, 0, Math.sin(i * 0.53 + l) * 0.015);
              break;
          }
        }
        if (this.map === "city") c = Math.abs(l) <= s.hw ? new THREE.Color(0x526374) : new THREE.Color(0x8a9ba4);
        pos.push(s.x + s.rx * l, gi.h, s.z + s.rz * l);
        col.push(c.r, c.g, c.b);
        uv.push(l / 12, (i * this.step) / 7);
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (this.samples[i].gap || this.samples[j].gap) continue;
      const a = ringStart[i];
      const b = ringStart[j];
      const m = ringLats[i].length; // stitch with ring i's column count on both rings
      for (let k = 0; k < m - 1; k++) {
        idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tex = this.map === "city" ? null : makeSandNoiseTexture();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, flatShading: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(g, m);
    if (tex) this.disposables.push(tex);
  }

  /** Painted route markings — edge lines + forward chevrons so the line is always readable. */
  private buildRouteMarks() {
    const n = this.N;
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xf7e7c3,
      fog: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const chevMat = new THREE.MeshBasicMaterial({
      color: 0xfffbe8,
      fog: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    // ---- continuous edge lines hugging the road edge ----
    const pos: number[] = [];
    const idx: number[] = [];
    const lineHalf = 0.19;
    for (const side of [-1, 1] as const) {
      const start = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const s = this.samples[i];
        const latE = (s.hw - 0.85) * side;
        const y = this.heightAt(i, latE) + 0.05;
        pos.push(
          s.x + s.rx * (latE - lineHalf), y, s.z + s.rz * (latE - lineHalf),
          s.x + s.rx * (latE + lineHalf), y, s.z + s.rz * (latE + lineHalf)
        );
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (this.samples[i].gap || this.samples[j].gap) continue;
        const a = start + i * 2;
        const b = start + j * 2;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    lineGeo.setIndex(idx);
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.frustumCulled = false; // spans the whole loop
    this.group.add(lineMesh);
    this.disposables.push(lineGeo, lineMat);

    // ---- forward-pointing chevrons along the centerline ----
    const gateBlocked = new Set<number>();
    for (const g of this.gates) {
      for (let k = -4; k <= 4; k++) gateBlocked.add(wrapIdx(g.idx + k, n));
    }
    const cpos: number[] = [];
    const cidx: number[] = [];
    const arm = (f0: number, l0: number, f1: number, l1: number, w: number, i: number) => {
      const df = f1 - f0;
      const dl = l1 - l0;
      const len = Math.hypot(df, dl);
      if (len < 1e-4) return;
      const px = (-dl / len) * (w * 0.5);
      const pl = (df / len) * (w * 0.5);
      const corners: [number, number][] = [
        [f0 + px, l0 + pl],
        [f1 + px, l1 + pl],
        [f1 - px, l1 - pl],
        [f0 - px, l0 - pl],
      ];
      const base = cpos.length / 3;
      const s = this.samples[i];
      for (const [f, l] of corners) {
        const x = s.x + s.dx * f + s.rx * l;
        const z = s.z + s.dz * f + s.rz * l;
        const y = this.heightAtP(i + f / this.step, l) + 0.07;
        cpos.push(x, y, z);
      }
      cidx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let i = 6; i < n; i += 14) {
      const s = this.samples[i];
      if (s.gap || gateBlocked.has(i)) continue;
      arm(1.15, 0, -0.45, 1.35, 0.46, i);
      arm(1.15, 0, -0.45, -1.35, 0.46, i);
    }
    const chevGeo = new THREE.BufferGeometry();
    chevGeo.setAttribute("position", new THREE.Float32BufferAttribute(cpos, 3));
    chevGeo.setIndex(cidx);
    const chevMesh = new THREE.Mesh(chevGeo, chevMat);
    chevMesh.frustumCulled = false;
    this.group.add(chevMesh);
    this.disposables.push(chevGeo, chevMat);
  }

  private buildPit() {
    const n = this.N;
    const pos: number[] = [];
    const idx: number[] = [];
    const col: number[] = [];
    const cPit = new THREE.Color(PALETTE.pitSand);
    const cDark = new THREE.Color(0xb08a58);
    let v = 0;
    const pushTri = (a: number[], b: number[], c: number[], shade: number) => {
      for (const p of [a, b, c]) pos.push(p[0], p[1], p[2]);
      const cc = cPit.clone().lerp(cDark, shade);
      col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
      idx.push(v, v + 1, v + 2);
      v += 3;
    };
    const pushQuad = (a: number[], b: number[], c: number[], d: number[]) => {
      pushTri(a, b, c, 0);
      pushTri(a, c, d, 0.25);
    };
    const PL = 12.4;
    let i = 0;
    while (i < n) {
      if (!this.samples[i].gap) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && this.samples[j].gap) j++;
      const jEnd = Math.min(j, n - 1); // gap never crosses the wrap in this track
      // smooth valley floor — follows the same profile the physics drives on,
      // so the rendered sand matches the collision surface exactly
      const floorY = (k: number) => {
        const sk = this.samples[wrapIdx(k, n)];
        return sk.y + pitDepthAt(sk.gapT);
      };
      for (let k = i; k < jEnd; k++) {
        const s0 = this.samples[k];
        const s1 = this.samples[k + 1];
        for (const [l0, l1] of [
          [-PL, -PL / 2],
          [-PL / 2, PL / 2],
          [PL / 2, PL],
        ] as [number, number][]) {
          pushQuad(
            [s0.x + s0.rx * l0, floorY(k), s0.z + s0.rz * l0],
            [s0.x + s0.rx * l1, floorY(k), s0.z + s0.rz * l1],
            [s1.x + s1.rx * l1, floorY(k + 1), s1.z + s1.rz * l1],
            [s1.x + s1.rx * l0, floorY(k + 1), s1.z + s1.rz * l0]
          );
        }
      }
      // near face: crisp cliff under the launch edge (keeps launches snappy)
      const sp = this.samples[wrapIdx(i - 1, n)];
      const sa = this.samples[i];
      for (const [l0, l1] of [
        [-PL, 0],
        [0, PL],
      ] as [number, number][]) {
        pushQuad(
          [sp.x + sp.rx * l0, this.heightAt(wrapIdx(i - 1, n), l0), sp.z + sp.rz * l0],
          [sp.x + sp.rx * l1, this.heightAt(wrapIdx(i - 1, n), l1), sp.z + sp.rz * l1],
          [sa.x + sa.rx * l1, floorY(i), sa.z + sa.rz * l1],
          [sa.x + sa.rx * l0, floorY(i), sa.z + sa.rz * l0]
        );
      }
      // far face: the valley floor has already climbed to road level here —
      // just a short skirt so there is no visible seam at the join
      const sf = this.samples[wrapIdx(jEnd, n)];
      const sl = this.samples[wrapIdx(jEnd - 1, n)];
      for (const [l0, l1] of [
        [-PL, 0],
        [0, PL],
      ] as [number, number][]) {
        pushQuad(
          [sl.x + sl.rx * l0, floorY(jEnd - 1), sl.z + sl.rz * l0],
          [sl.x + sl.rx * l1, floorY(jEnd - 1), sl.z + sl.rz * l1],
          [sf.x + sf.rx * l1, this.heightAt(wrapIdx(jEnd, n), l1), sf.z + sf.rz * l1],
          [sf.x + sf.rx * l0, this.heightAt(wrapIdx(jEnd, n), l0), sf.z + sf.rz * l0]
        );
      }
      i = j;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(g, m);
  }

  private buildTunnel() {
    const n = this.N;
    const tunnelIdx: number[] = [];
    for (let i = 0; i < n; i++) if (this.samples[i].tunnel) tunnelIdx.push(i);
    if (tunnelIdx.length < 8) return;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const strata = PALETTE.rockStrata.map((c) => new THREE.Color(c));
    const cDark = new THREE.Color(0x6e3524);
    const SEG = 7;
    const R = 12.2;
    for (let r = 0; r < tunnelIdx.length; r++) {
      const i = tunnelIdx[r];
      const s = this.samples[i];
      for (let k = 0; k <= SEG; k++) {
        const a = Math.PI * (k / SEG);
        const lx = -Math.cos(a) * R;
        const ly = Math.sin(a) * R * 0.92;
        pos.push(s.x + s.rx * lx, s.y + ly - 1.8, s.z + s.rz * lx);
        const band = Math.floor((k + i * 0.2) / 2);
        const c = strata[((band % strata.length) + strata.length) % strata.length].clone().lerp(cDark, 0.5);
        col.push(c.r, c.g, c.b);
      }
      if (r > 0) {
        for (let k = 0; k < SEG; k++) {
          const a = (r - 1) * (SEG + 1) + k;
          const b = r * (SEG + 1) + k;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(g, m);

    // amber light strips along the ceiling
    const stripGeo = new THREE.BoxGeometry(0.5, 0.15, 2.4);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffc766 });
    for (let r = 5; r < tunnelIdx.length - 5; r += 10) {
      const i = tunnelIdx[r];
      const s = this.samples[i];
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(s.x, s.y + R * 0.92 - 1.2, s.z);
      strip.lookAt(s.x + s.dx, s.y + R * 0.92 - 1.2, s.z + s.dz);
      this.group.add(strip);
    }
    this.disposables.push(stripGeo, stripMat);

    // the mesa blob covering the tunnel
    const mid = tunnelIdx[Math.floor(tunnelIdx.length / 2)];
    const ms = this.samples[mid];
    const mesaGeo = new THREE.SphereGeometry(1, 12, 8);
    const mesaMat = new THREE.MeshLambertMaterial({ color: 0xb0532f, flatShading: true });
    const mesa = new THREE.Mesh(mesaGeo, mesaMat);
    mesa.scale.set(150, 40, 58);
    mesa.position.set(ms.x, ms.y + 4, ms.z);
    mesa.rotation.y = Math.atan2(ms.dx, ms.dz) + Math.PI / 2;
    mesa.castShadow = true;
    this.group.add(mesa);
    this.disposables.push(mesaGeo, mesaMat);
  }

  private buildArch() {
    const i = this.idxNear(CONTROL[6][0], CONTROL[6][2]);
    const s = this.samples[i];
    const geo = new THREE.TorusGeometry(30, 7.5, 8, 14, Math.PI);
    const mat = new THREE.MeshLambertMaterial({ color: 0xb45a33, flatShading: true });
    const arch = new THREE.Mesh(geo, mat);
    arch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(s.dx, 0, s.dz));
    arch.scale.set(1, 0.78, 1);
    arch.position.set(s.x, s.y + 1.2, s.z);
    arch.castShadow = true;
    this.group.add(arch);
    this.disposables.push(geo, mat);

    const rockGeo = new THREE.IcosahedronGeometry(2.4, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0xa84c2c, flatShading: true });
    for (const side of [-1, 1]) {
      const lat = side * (s.hw + 2.2);
      const pillar = new THREE.Mesh(rockGeo, rockMat);
      pillar.position.set(s.x + s.rx * lat, this.heightAt(i, lat) + 1.6, s.z + s.rz * lat);
      pillar.scale.set(1.1, 2.6, 1.1);
      pillar.rotation.set(0.2 * side, side, 0.1);
      pillar.castShadow = true;
      this.group.add(pillar);
    }
    this.disposables.push(rockGeo, rockMat);
  }

  private buildScenery() {
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const posAttr = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < posAttr.count; v++) {
      const j = 1 + (Math.sin(v * 12.9) * 0.5 + Math.cos(v * 7.7) * 0.5) * 0.22;
      posAttr.setXYZ(v, posAttr.getX(v) * j, posAttr.getY(v) * j * 0.8, posAttr.getZ(v) * j);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshLambertMaterial({ flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 150);
    const rnd = mulberry32(777);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let placed = 0;
    let guard = 0;
    while (placed < 150 && guard++ < 3000) {
      const i = Math.floor(rnd() * this.N);
      const s = this.samples[i];
      const side = rnd() > 0.5 ? 1 : -1;
      const wd = this.wallDist(i, side as 1 | -1);
      const lat = wd + 2 + rnd() * 16;
      const wallH = side > 0 ? s.wallHR : s.wallHL;
      const y = s.y + wallH * (0.15 + rnd() * 0.6);
      const sc = 1.4 + rnd() * 4.6;
      m.makeRotationY(rnd() * Math.PI * 2);
      m.scale(new THREE.Vector3(sc, sc * (0.7 + rnd() * 0.6), sc));
      m.setPosition(s.x + s.rx * lat * side, y, s.z + s.rz * lat * side);
      rocks.setMatrixAt(placed, m);
      col.setHex(PALETTE.rockStrata[Math.floor(rnd() * PALETTE.rockStrata.length)]);
      rocks.setColorAt(placed, col);
      placed++;
    }
    rocks.castShadow = true;
    this.group.add(rocks);
    this.disposables.push(rockGeo, rockMat);

    // boulders for registered obstacles
    const obGeo = new THREE.IcosahedronGeometry(1, 0);
    const obMat = new THREE.MeshLambertMaterial({ color: 0x9c4a2a, flatShading: true });
    for (const ob of this.obstacles) {
      const b = new THREE.Mesh(obGeo, obMat);
      b.position.set(ob.x, ob.top - ob.r * 0.8, ob.z);
      b.scale.set(ob.r, ob.r * 1.2, ob.r);
      b.rotation.y = ob.x * 0.7;
      b.castShadow = true;
      this.group.add(b);
    }
    this.disposables.push(obGeo, obMat);

    // cacti
    const cactus = buildCactusGeometry();
    const cacMat = new THREE.MeshLambertMaterial({ color: 0x4e7d4a, flatShading: true });
    const cacti = new THREE.InstancedMesh(cactus, cacMat, 70);
    let cp = 0;
    let cg = 0;
    while (cp < 70 && cg++ < 1500) {
      const i = Math.floor(rnd() * this.N);
      const s = this.samples[i];
      const side = rnd() > 0.5 ? 1 : -1;
      const wd = this.wallDist(i, side as 1 | -1);
      const lat = wd + 3 + rnd() * 14;
      const y = s.y + (side > 0 ? s.wallHR : s.wallHL) * (0.05 + rnd() * 0.4);
      const sc = 0.8 + rnd() * 1.5;
      m.makeRotationY(rnd() * Math.PI * 2);
      m.scale(new THREE.Vector3(sc, sc, sc));
      m.setPosition(s.x + s.rx * lat * side, y, s.z + s.rz * lat * side);
      cacti.setMatrixAt(cp, m);
      cp++;
    }
    cacti.castShadow = true;
    this.group.add(cacti);
    this.disposables.push(cactus, cacMat);

    // distant mesa skyline
    const skyGeo = new THREE.CylinderGeometry(0.55, 1, 1, 7, 1);
    const skyMat = new THREE.MeshLambertMaterial({ color: 0xc98a63, flatShading: true });
    const sky = new THREE.InstancedMesh(skyGeo, skyMat, 46);
    const fogC = new THREE.Color(PALETTE.fog);
    for (let k = 0; k < 46; k++) {
      const ang = (k / 46) * Math.PI * 2 + rnd() * 0.1;
      const rad = 850 + rnd() * 550;
      const h = 70 + rnd() * 150;
      const w = 70 + rnd() * 140;
      m.makeRotationY(rnd() * Math.PI);
      m.scale(new THREE.Vector3(w, h, w));
      m.setPosition(Math.cos(ang) * rad, h * 0.5 - 18, Math.sin(ang) * rad);
      sky.setMatrixAt(k, m);
      col.copy(skyMat.color).lerp(fogC, 0.55 + rnd() * 0.2);
      sky.setColorAt(k, col);
    }
    this.group.add(sky);
    this.disposables.push(skyGeo, skyMat);

    // giant ground disc
    const gg = new THREE.CircleGeometry(3200, 40);
    const gm = new THREE.MeshLambertMaterial({ color: 0xd8ad74 });
    const ground = new THREE.Mesh(gg, gm);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -14.4;
    this.group.add(ground);
    this.disposables.push(gg, gm);
  }

  private buildGates() {
    const stripeTex = makeStripeTexture();
    const pylonGeo = new THREE.CylinderGeometry(0.42, 0.55, 5.4, 8);
    const pylonMat = new THREE.MeshLambertMaterial({ map: stripeTex });
    const capGeo = new THREE.SphereGeometry(0.62, 8, 6);
    const chevGeo = new THREE.ConeGeometry(0.85, 1.5, 4);
    const beamGeo = new THREE.BoxGeometry(1, 0.5, 0.5);
    const UP = new THREE.Vector3(0, 1, 0);
    for (const gate of this.gates) {
      const s = this.sample(gate.idx);
      const grp = new THREE.Group();
      const glowMat = new THREE.MeshStandardMaterial({
        color: PALETTE.checkpoint,
        emissive: new THREE.Color(gate.isFinish ? 0xffcf3f : 0xff9a1f),
        emissiveIntensity: 1.4,
        roughness: 0.4,
      });
      for (const side of [-1, 1]) {
        const lat = side * (s.hw + 1.2);
        const pylon = new THREE.Mesh(pylonGeo, pylonMat);
        pylon.position.set(s.x + s.rx * lat, this.heightAt(gate.idx, lat) + 2.6, s.z + s.rz * lat);
        pylon.castShadow = true;
        grp.add(pylon);
        const cap = new THREE.Mesh(capGeo, glowMat);
        cap.position.set(s.x + s.rx * lat, this.heightAt(gate.idx, lat) + 5.6, s.z + s.rz * lat);
        grp.add(cap);
      }
      const beam = new THREE.Mesh(beamGeo, glowMat);
      beam.scale.x = s.hw * 2 + 3.2;
      beam.position.set(s.x, s.y + 7.6, s.z);
      beam.rotation.y = Math.atan2(-s.rz, s.rx);
      grp.add(beam);

      const chev = new THREE.Mesh(chevGeo, glowMat);
      chev.quaternion.setFromUnitVectors(UP, new THREE.Vector3(s.dx, 0, s.dz));
      chev.position.set(s.x + s.dx * 2.2, s.y + 6.3, s.z + s.dz * 2.2);
      grp.add(chev);

      if (gate.isFinish) {
        const bannerTex = makeBannerTexture();
        const bannerGeo = new THREE.PlaneGeometry(s.hw * 2 + 2, 2.6);
        const banner = new THREE.Mesh(
          bannerGeo,
          new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
        );
        banner.position.set(s.x, s.y + 9.4, s.z);
        banner.rotation.y = Math.atan2(-s.dx, -s.dz);
        grp.add(banner);
        this.disposables.push(bannerTex, bannerGeo, banner.material as THREE.Material);

        const lineTex = makeCheckerTexture();
        const lineGeo = new THREE.PlaneGeometry(s.hw * 2, 3);
        lineGeo.rotateX(-Math.PI / 2);
        const line = new THREE.Mesh(
          lineGeo,
          new THREE.MeshBasicMaterial({ map: lineTex, transparent: true, depthWrite: false })
        );
        line.rotation.y = Math.atan2(-s.rz, s.rx);
        line.position.set(s.x, this.heightAt(gate.idx, 0) + 0.08, s.z);
        grp.add(line);
        this.disposables.push(lineTex, lineGeo, line.material as THREE.Material);
      }
      gate.glow = glowMat;
      this.group.add(grp);
      this.disposables.push(glowMat);
    }
    this.disposables.push(pylonGeo, pylonMat, stripeTex, capGeo, chevGeo, beamGeo);
  }

  /** Activate the first `stacks` crate stacks (difficulty setting) — the break wall is always live. */
  setActiveStacks(stacks: number) {
    for (const b of this.boxes) {
      b.enabled = b.wall || b.cluster < stacks;
      b.active = b.enabled;
      b.respawnAt = 0;
      b.mesh.visible = b.enabled;
    }
  }

  /** Bring every enabled crate back for a new race. */
  resetBoxes() {
    for (const b of this.boxes) {
      if (!b.enabled) continue;
      b.active = true;
      b.respawnAt = 0;
      b.mesh.visible = true;
    }
  }

  /** Respawn smashed crates whose timeout has elapsed (game-time ms). */
  updateBoxes(nowMs: number) {
    for (const b of this.boxes) {
      if (b.enabled && !b.active && b.respawnAt <= nowMs) {
        b.active = true;
        b.mesh.visible = true;
      }
    }
  }

  /**
   * The BREAK barricade: a full-width plank wall that is MEANT to be smashed.
   * Full clarity kit so no rider can miss it at 180 km/h:
   *  - giant unlit gantry banner overhead: "BREAK" with hazard borders + down arrows
   *  - pulsing amber glow strip along the wall top + beacon lamps on the gantry
   *  - two roadside "BREAK AHEAD" diamond signs (56 m + 28 m) with beacons
   *  - triple chevron decals painted onto the approach road
   * One cluster id = the whole wall chain-breaks when you hit it.
   */
  private buildBreakWall(controlIdx: number, cluster: number) {
    const idx = this.idxNear(CONTROL[controlIdx][0], CONTROL[controlIdx][2]);
    this.breakWallIdxs.push(idx);
    const s = this.samples[idx];
    const yaw = Math.atan2(-s.rz, s.rx); // local +X along the road's right vector
    const faceBack = Math.atan2(-s.dx, -s.dz); // plane normal toward oncoming riders

    const span = s.hw + 1.6; // road + shoulders — nowhere to sneak around
    const segW = 2.0;
    const segH = 2.6;

    const tex = makeWallTexture();
    const geo = new THREE.BoxGeometry(segW, segH, 0.18);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const postMat = new THREE.MeshLambertMaterial({ color: 0x6e4523 });
    this.disposables.push(geo, mat, tex, postMat);

    // ---- glow group: amber top strip + beacon lamps (engine pulses them) ----
    const glow = new THREE.Group();
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffb020,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.wallGlowMats.push(glowMat);
    const stripGeo = new THREE.BoxGeometry(span * 2 + 0.4, 0.12, 0.12);
    const strip = new THREE.Mesh(stripGeo, glowMat);
    strip.position.set(s.x, this.heightAt(idx, 0) + segH + 0.16, s.z);
    strip.rotation.y = yaw;
    glow.add(strip);
    const beaconGeo = new THREE.SphereGeometry(0.26, 10, 8);
    this.disposables.push(stripGeo, beaconGeo, glowMat);

    // ---- gantry: posts + crossbeam + the big BREAK banner ----
    const postH = 7.3;
    const gLat = span + 1.0;
    const postGeo = new THREE.BoxGeometry(0.32, postH, 0.32);
    this.disposables.push(postGeo);
    for (const e of [-gLat, gLat]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(s.x + s.rx * e, this.heightAt(idx, e) + postH / 2, s.z + s.rz * e);
      post.rotation.y = yaw;
      post.castShadow = true;
      this.group.add(post);
      const beacon = new THREE.Mesh(beaconGeo, glowMat);
      beacon.position.set(s.x + s.rx * e, this.heightAt(idx, e) + postH + 0.28, s.z + s.rz * e);
      glow.add(beacon);
    }
    const beamGeo = new THREE.BoxGeometry(gLat * 2 + 0.32, 0.36, 0.36);
    const beam = new THREE.Mesh(beamGeo, postMat);
    beam.position.set(s.x, this.heightAt(idx, 0) + postH, s.z);
    beam.rotation.y = yaw;
    this.group.add(beam);
    this.disposables.push(beamGeo);

    const banW = Math.min(gLat * 2 - 0.5, 14);
    const banH = 2.5;
    const banTex = makeBreakBannerTexture();
    const banGeo = new THREE.PlaneGeometry(banW, banH);
    const banMat = new THREE.MeshBasicMaterial({
      map: banTex,
      side: THREE.DoubleSide,
      transparent: true,
      fog: true,
    });
    const banner = new THREE.Mesh(banGeo, banMat);
    banner.position.set(s.x, this.heightAt(idx, 0) + postH - banH / 2 - 0.4, s.z);
    banner.rotation.y = faceBack;
    this.group.add(banner);
    this.disposables.push(banTex, banGeo, banMat);

    // ---- the wall itself ----
    let firstBox: TrackBox | null = null;
    for (let lat = -span; lat <= span + 0.01; lat += segW) {
      const l = Math.min(lat, span);
      const x = s.x + s.rx * l;
      const z = s.z + s.rz * l;
      const y = this.heightAt(idx, l) + segH / 2 + 0.06;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      this.group.add(mesh);
      const box: TrackBox = {
        x,
        z,
        y,
        idx,
        lat: l,
        cluster,
        halfH: segH / 2,
        wall: true,
        enabled: true,
        active: true,
        respawnAt: 0,
        mesh,
      };
      this.boxes.push(box);
      if (!firstBox) firstBox = box;
    }

    this.group.add(glow);
    this.breakWalls.push({ idx, cluster, firstBox: firstBox!, glow });
    this.wallPts.push({ x: s.x, z: s.z });

    // ---- roadside warning signs (56 m + 28 m out, alternating sides) ----
    const signTex = makeSignTexture();
    const signGeo = new THREE.PlaneGeometry(2.9, 2.9);
    const signMat = new THREE.MeshBasicMaterial({
      map: signTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const signPostGeo = new THREE.BoxGeometry(0.16, 3.0, 0.16);
    this.disposables.push(signTex, signGeo, signMat, signPostGeo);
    for (const [back, side] of [
      [56, 1],
      [28, -1],
    ] as const) {
      const si = wrapIdx(idx - back, this.N);
      const ss = this.samples[si];
      const slat = (ss.hw + 2.6) * side;
      const sy = this.heightAt(si, slat) + 3.1;
      const sign = new THREE.Mesh(signGeo, signMat);
      sign.position.set(ss.x + ss.rx * slat, sy, ss.z + ss.rz * slat);
      sign.rotation.y = Math.atan2(-ss.dx, -ss.dz); // face oncoming riders
      const signPost = new THREE.Mesh(signPostGeo, postMat);
      signPost.position.set(ss.x + ss.rx * slat, sy - 1.55, ss.z + ss.rz * slat);
      signPost.castShadow = true;
      this.group.add(sign);
      this.group.add(signPost);
      const beacon = new THREE.Mesh(beaconGeo, glowMat);
      beacon.position.set(ss.x + ss.rx * slat, sy + 1.8, ss.z + ss.rz * slat);
      glow.add(beacon);
    }

    // ---- chevron decals painted onto the approach road ----
    const chevTex = makeChevronTexture();
    const chevGeo = new THREE.PlaneGeometry(4.8, 3.4);
    chevGeo.rotateX(-Math.PI / 2);
    const chevMat = new THREE.MeshBasicMaterial({ map: chevTex, transparent: true, depthWrite: false });
    this.disposables.push(chevTex, chevGeo, chevMat);
    for (const back of [26, 17, 8]) {
      const ci = wrapIdx(idx - back, this.N);
      const cs = this.samples[ci];
      const m = new THREE.Mesh(chevGeo, chevMat);
      m.position.set(cs.x, this.heightAt(ci, 0) + 0.09, cs.z);
      m.rotation.y = Math.atan2(-cs.dx, -cs.dz); // chevrons point toward the wall
      m.renderOrder = 1;
      this.group.add(m);
    }
  }

  /**
   * Breakable wooden crates arranged in STACKS — pyramids, pairs, blocks and
   * firing lines on the racing line. Smash one crate and the whole stack
   * chain-breaks into flying pieces. The full candidate set is generated once
   * (max count); difficulty decides how many stacks go live.
   */
  private buildStacks() {
    const n = this.N;
    const MAX_STACKS = 14;
    const rnd = mulberry32(9155);

    // zones to keep clear: gates, ramps, the gap, the tunnel, the start grid, the break wall
    const blocked = new Uint8Array(n);
    for (const g of this.gates) {
      for (let k = -8; k <= 8; k++) blocked[wrapIdx(g.idx + k, n)] = 1;
    }
    for (let i = 0; i < n; i++) {
      if (this.samples[i].gap || this.samples[i].tunnel || this.samples[i].rampP >= 0) {
        for (let k = -7; k <= 7; k++) blocked[wrapIdx(i + k, n)] = 1;
      }
    }
    for (let k = -60; k <= 60; k++) blocked[wrapIdx(k, n)] = 1; // start/finish + grid
    for (const wi of this.breakWallIdxs) {
      for (let k = -16; k <= 16; k++) blocked[wrapIdx(wi + k, n)] = 1;
    }

    const crateTex = makeCrateTexture();
    const crateGeo = new THREE.BoxGeometry(1.24, 1.24, 1.24);
    const crateMat = new THREE.MeshLambertMaterial({ map: crateTex });
    this.disposables.push(crateGeo, crateMat, crateTex);

    // stack layout patterns: [lateral cell offset, stack level]
    const PATTERNS: [number, number][][] = [
      [
        [-1.32, 0],
        [0, 0],
        [1.32, 0],
        [-0.66, 1],
        [0.66, 1],
        [0, 2],
      ], // pyramid
      [
        [-0.65, 0],
        [0.65, 0],
        [0, 1],
      ], // pair + top
      [
        [-1.35, 0],
        [0, 0],
        [1.35, 0],
      ], // firing line across the road
      [
        [-0.66, 0],
        [0.66, 0],
        [-0.66, 1],
        [0.66, 1],
      ], // 2×2 block
    ];

    const used: number[] = [];
    let cluster = 0;
    let placed = 0;
    let guard = 0;
    while (placed < MAX_STACKS && guard++ < 9000) {
      const idx = 60 + Math.floor(rnd() * (n - 120));
      if (blocked[idx]) continue;
      // stack spacing — each stack reads as its own little event on approach
      let tooClose = false;
      for (const u of used) {
        let d = Math.abs(idx - u);
        d = Math.min(d, n - d);
        if (d < 26) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      const s = this.samples[idx];
      // bias stacks toward the middle of the road
      const u = rnd() * 2 - 1;
      const lat = Math.sign(u) * Math.pow(Math.abs(u), 1.35) * Math.max(1.2, s.hw - 4.5);
      // keep clear of registered boulders / pillars
      let clash = false;
      for (const ob of this.obstacles) {
        const dx = ob.x - (s.x + s.rx * lat);
        const dz = ob.z - (s.z + s.rz * lat);
        if (dx * dx + dz * dz < 34) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      const pattern = PATTERNS[Math.floor(rnd() * PATTERNS.length)];
      const count = Math.min(pattern.length, 3 + Math.floor(rnd() * (pattern.length - 2)));
      for (let c = 0; c < count; c++) {
        const [cl, lvl] = pattern[c];
        const blat = lat + cl;
        const x = s.x + s.rx * blat;
        const z = s.z + s.rz * blat;
        const y = this.heightAt(idx, blat) + 0.62 + lvl * 1.24;
        const mesh = new THREE.Mesh(crateGeo, crateMat);
        mesh.position.set(x, y, z);
        mesh.rotation.y = (rnd() - 0.5) * 0.55;
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({
          x,
          z,
          y,
          idx,
          lat: blat,
          cluster,
          halfH: 0.62,
          wall: false,
          enabled: false,
          active: false,
          respawnAt: 0,
          mesh,
        });
      }
      used.push(idx);
      cluster++;
      placed++;
    }
  }

  dispose() {
    this.cityPillars?.dispose();
    for (const mesh of this.cityHazardMeshes) mesh.dispose();
    this.cityHazardMeshes.length = 0;
    for (const group of this.cityClusters.values()) {
      group.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    }
    this.cityClusters.clear();
    for (const d of this.disposables) d.dispose();
  }
}

const TMP_GROUND: GroundInfo = { h: 0, onRoad: false, inPitZone: false, surface: "asphalt" };
const TMP_GA: GroundInfo = { h: 0, onRoad: false, inPitZone: false, surface: "asphalt" };
const TMP_GB: GroundInfo = { h: 0, onRoad: false, inPitZone: false, surface: "asphalt" };

// ---------------- helpers & textures ----------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSandNoiseTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(42);
  for (let i = 0; i < 2600; i++) {
    const v = 200 + Math.floor(rnd() * 55);
    ctx.fillStyle = `rgba(${v},${v - 14},${v - 30},${0.16 + rnd() * 0.2})`;
    const s = 1 + rnd() * 3;
    ctx.fillRect(rnd() * 128, rnd() * 128, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeStripeTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f3e6cc";
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = "#d64530";
  for (let y = 0; y < 8; y++) {
    if (y % 2 === 0) continue;
    ctx.save();
    ctx.translate(0, y * 16);
    ctx.transform(1, 0, -0.35, 1, 0, 0);
    ctx.fillRect(0, 0, 64, 16);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeBannerTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f0641e";
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "#2b1c12";
  for (let x = 0; x < 512; x += 32) {
    ctx.globalAlpha = 0.22;
    ctx.fillRect(x, 0, 16, 96);
  }
  ctx.globalAlpha = 1;
  ctx.font = "bold 52px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff6e6";
  ctx.fillText("CANYON RUSH", 256, 50);
  return new THREE.CanvasTexture(c);
}

function makeCheckerTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 48);
  const sq = 12;
  for (let y = 0; y < 48 / sq; y++) {
    for (let x = 0; x < 256 / sq; x++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = "rgba(43,28,18,0.85)";
        ctx.fillRect(x * sq, y * sq, sq, sq);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function makeCrateTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  // base weathered wood
  ctx.fillStyle = "#a9713d";
  ctx.fillRect(0, 0, 128, 128);
  // plank seams (horizontal boards)
  ctx.fillStyle = "#7c4e26";
  for (const y of [31, 63, 95]) ctx.fillRect(0, y, 128, 3);
  // grain streaks
  const rnd = mulberry32(313);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(${90 + rnd() * 60},${50 + rnd() * 35},${20 + rnd() * 20},${0.12 + rnd() * 0.18})`;
    ctx.fillRect(rnd() * 128, rnd() * 128, 8 + rnd() * 34, 1 + rnd() * 2);
  }
  // frame border
  ctx.strokeStyle = "#8a5a2e";
  ctx.lineWidth = 7;
  ctx.strokeRect(3.5, 3.5, 121, 121);
  // diagonal cross plank
  ctx.save();
  ctx.strokeStyle = "#93602f";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(120, 120);
  ctx.moveTo(120, 8);
  ctx.lineTo(8, 120);
  ctx.stroke();
  ctx.restore();
  // corner nails
  ctx.fillStyle = "#4c2f16";
  for (const [x, y] of [
    [14, 14],
    [114, 14],
    [14, 114],
    [114, 114],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Plank barricade segment — pale weathered timber (reads man-made against the
 *  red rock), cross braces, hazard stripes and a big amber-on-dark BREAK! stencil. */
function makeWallTexture(): THREE.Texture {
  const W = 256;
  const H = 340;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const rnd = mulberry32(777);

  // vertical planks — pale timber so the wall pops from the canyon
  const plankW = W / 4;
  for (let p = 0; p < 4; p++) {
    const shade = 0.9 + rnd() * 0.2;
    const r = Math.floor(0xc9 * shade);
    const g = Math.floor(0xa6 * shade);
    const b = Math.floor(0x70 * shade);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(p * plankW, 0, plankW, H);
    // seam
    ctx.fillStyle = "rgba(84,52,22,0.85)";
    ctx.fillRect(p * plankW, 0, 3, H);
    // grain
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${96 + rnd() * 46},${64 + rnd() * 24},${28 + rnd() * 12},${0.14 + rnd() * 0.16})`;
      ctx.fillRect(p * plankW + 4 + rnd() * (plankW - 10), rnd() * H, 2, 18 + rnd() * 60);
    }
    // nails top & bottom
    ctx.fillStyle = "#4c2f16";
    for (const y of [14, H - 14]) {
      ctx.beginPath();
      ctx.arc(p * plankW + plankW / 2, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // horizontal cross braces
  for (const by of [64, H - 88]) {
    ctx.fillStyle = "#a87c48";
    ctx.fillRect(0, by, W, 26);
    ctx.fillStyle = "rgba(255,232,196,0.16)";
    ctx.fillRect(0, by, W, 5);
    ctx.fillStyle = "rgba(50,28,10,0.4)";
    ctx.fillRect(0, by + 22, W, 4);
  }

  // hazard stripes along the bottom
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, H - 46, W, 46);
  ctx.clip();
  ctx.fillStyle = "#ffb020";
  ctx.fillRect(0, H - 46, W, 46);
  ctx.fillStyle = "#2b1c12";
  for (let x = -46; x < W + 46; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + 23, H);
    ctx.lineTo(x + 23 + 46, H - 46);
    ctx.lineTo(x + 46, H - 46);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // big painted stencil: BREAK! — dark plate + amber letters (matches the
  // gantry banner & beacons so the whole hazard kit reads as one system)
  ctx.save();
  ctx.translate(W / 2, H / 2 - 16);
  ctx.rotate(-0.06);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = 96;
  do {
    ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
    fontSize -= 3;
  } while (ctx.measureText("BREAK!").width > W - 26 && fontSize > 40);
  const tw = ctx.measureText("BREAK!").width;
  ctx.fillStyle = "rgba(30,16,7,0.85)";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(-tw / 2 - 12, -fontSize * 0.62, tw + 24, fontSize * 1.2, 8);
    ctx.fill();
  } else {
    ctx.fillRect(-tw / 2 - 12, -fontSize * 0.62, tw + 24, fontSize * 1.2);
  }
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#2b1c12";
  ctx.lineWidth = Math.max(7, fontSize * 0.13);
  ctx.strokeText("BREAK!", 0, 0);
  ctx.fillStyle = "#ffb020";
  ctx.fillText("BREAK!", 0, 0);
  ctx.restore();

  // impact crack lines
  ctx.strokeStyle = "rgba(40,22,8,0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const x0 = 30 + rnd() * (W - 60);
    const y0 = 30 + rnd() * (H - 120);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (rnd() - 0.5) * 44, y0 + 16 + rnd() * 40);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Giant overhead gantry banner for the BREAK wall — unlit black/amber plate
 *  with "BREAK", hazard borders, down-arrows pointing at the wall and a SMASH tagline. */
function makeBreakBannerTexture(): THREE.Texture {
  const W = 1024;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // dark plate
  ctx.fillStyle = "#1d1108";
  ctx.fillRect(0, 0, W, H);
  // amber frame
  ctx.strokeStyle = "#ffb020";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  // hazard stripe bands top & bottom
  const stripe = 30;
  for (const y0 of [10, H - stripe - 10]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, y0, W - 20, stripe);
    ctx.clip();
    ctx.fillStyle = "#ffb020";
    ctx.fillRect(10, y0, W - 20, stripe);
    ctx.fillStyle = "#1d1108";
    for (let x = 8 - stripe * 2; x < W; x += stripe * 2) {
      ctx.beginPath();
      ctx.moveTo(x, y0 + stripe);
      ctx.lineTo(x + stripe, y0 + stripe);
      ctx.lineTo(x + stripe * 2, y0);
      ctx.lineTo(x + stripe, y0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // stacked down-arrows flanking the word, pointing at the wall below
  ctx.fillStyle = "#ffb020";
  for (const cx of [W * 0.145, W * 0.855]) {
    for (const dy of [0, 54]) {
      ctx.beginPath();
      ctx.moveTo(cx - 42, 86 + dy);
      ctx.lineTo(cx + 42, 86 + dy);
      ctx.lineTo(cx, 86 + dy + 44);
      ctx.closePath();
      ctx.fill();
    }
  }

  // THE word
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let f = 148;
  do {
    ctx.font = `900 ${f}px system-ui, sans-serif`;
    f -= 4;
  } while (ctx.measureText("BREAK").width > W * 0.55 && f > 60);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1d1108";
  ctx.lineWidth = 18;
  ctx.strokeText("BREAK", W / 2, H / 2 - 10);
  ctx.fillStyle = "#fff6e6";
  ctx.fillText("BREAK", W / 2, H / 2 - 10);

  // tagline
  let f2 = 32;
  ctx.font = `900 ${f2}px system-ui, sans-serif`;
  while (ctx.measureText("SMASH THROUGH — FULL SEND").width > W * 0.46 && f2 > 16) {
    f2 -= 2;
    ctx.font = `900 ${f2}px system-ui, sans-serif`;
  }
  ctx.fillStyle = "#ffb020";
  ctx.fillText("SMASH THROUGH — FULL SEND", W / 2, H - 58);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Road-paint chevron decal — twin amber arrows pointing toward the wall. */
function makeChevronTexture(): THREE.Texture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;

  ctx.lineJoin = "round";
  for (const y0 of [158, 84]) {
    ctx.beginPath();
    ctx.moveTo(40, y0);
    ctx.lineTo(S / 2, y0 - 52);
    ctx.lineTo(S - 40, y0);
    ctx.lineTo(S - 40, y0 + 26);
    ctx.lineTo(S / 2, y0 - 26);
    ctx.lineTo(40, y0 + 26);
    ctx.closePath();
    ctx.fillStyle = "#ffb020";
    ctx.strokeStyle = "rgba(43,28,18,0.9)";
    ctx.lineWidth = 10;
    ctx.fill();
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Diamond warning sign — "BREAK" with a smash burst, so riders know the wall is smashable. */
function makeSignTexture(): THREE.Texture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;

  // diamond plate
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#ffb020";
  ctx.strokeStyle = "#2b1c12";
  ctx.lineWidth = 10;
  const d = S * 0.36;
  ctx.fillRect(-d, -d, d * 2, d * 2);
  ctx.strokeRect(-d, -d, d * 2, d * 2);
  ctx.restore();

  // text (auto-fit inside the diamond)
  ctx.fillStyle = "#2b1c12";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let f1 = 66;
  do {
    ctx.font = `900 ${f1}px system-ui, sans-serif`;
    f1 -= 2;
  } while (ctx.measureText("BREAK").width > S * 0.64 && f1 > 24);
  ctx.fillText("BREAK", S / 2, S / 2 - 32);
  let f2 = 42;
  do {
    ctx.font = `900 ${f2}px system-ui, sans-serif`;
    f2 -= 2;
  } while (ctx.measureText("AHEAD").width > S * 0.54 && f2 > 16);
  ctx.fillText("AHEAD", S / 2, S / 2 + 16);

  // little impact burst
  ctx.strokeStyle = "#2b1c12";
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r0 = 46;
    const r1 = 64;
    ctx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + 62 + Math.sin(a) * r0 * 0.5);
    ctx.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + 62 + Math.sin(a) * r1 * 0.5);
  }
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCactusGeometry(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CapsuleGeometry(0.5, 2.6, 4, 8);
  trunk.translate(0, 1.9, 0);
  geos.push(trunk);
  const armL = new THREE.CapsuleGeometry(0.34, 1.2, 4, 6);
  armL.rotateZ(0.5);
  armL.translate(-0.85, 2.4, 0);
  geos.push(armL);
  const armR = new THREE.CapsuleGeometry(0.34, 1.0, 4, 6);
  armR.rotateZ(-0.6);
  armR.translate(0.85, 2.9, 0);
  geos.push(armR);
  const pos: number[] = [];
  const norm: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position as THREE.BufferAttribute;
    const nn = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      norm.push(nn.getX(i), nn.getY(i), nn.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  return out;
}
