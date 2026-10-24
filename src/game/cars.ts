"use client";

/**
 * CANYON RUSH — SUV model catalogue.
 *
 * Five original vehicles inspired by popular Indian SUVs (no logos or
 * trademarks): HIMALAYA (rugged 2-door off-roader), BISON (muscular
 * full-size SUV), FALCON (sporty compact coupe-SUV), SULTAN (premium tech
 * SUV) and CUB (mini trail 4x4).
 *
 * Every model is PURELY VISUAL: identical gameplay stats are guaranteed by
 * building all five on the same physics footprint (same track width, same
 * wheel radius band, same collision sphere elsewhere in the engine).
 *
 * Performance: static parts are merged per material bucket (body / roof /
 * trim / chrome / glass / silver / tow / head / tail), so a whole car is
 * ~10 draw calls + 8 wheel meshes. Assets are cached per (model, paint)
 * and shared by every instance — 10 multiplayer cars stay cheap.
 */

import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

export type CarModelId = "himalaya" | "bison" | "falcon" | "sultan" | "cub";

export interface CarPaintOption {
  name: string;
  body: number;
  roof: number;
}

export interface CarModelDef {
  id: CarModelId;
  name: string;
  tag: string;
  blurb: string;
  /** short wheel/stance description for the card */
  stance: string;
  paints: CarPaintOption[];
}

export const CAR_MODELS: CarModelDef[] = [
  {
    id: "himalaya",
    name: "HIMALAYA",
    tag: "RUGGED 2-DOOR OFF-ROADER",
    blurb:
      "Flat hood, round headlamps, chunky mud tires and a tailgate spare wheel. Built to scramble over broken ground — a canyon classic.",
    stance: "HIGH CLEARANCE · MUD TIRES",
    paints: [
      { name: "RALLY RED", body: 0xc9302a, roof: 0x17191d },
      { name: "DESERT OLIVE", body: 0x77804f, roof: 0x17191d },
      { name: "SAND STORM", body: 0xd6bd90, roof: 0x2a2d33 },
    ],
  },
  {
    id: "bison",
    name: "BISON",
    tag: "MUSCULAR FULL-SIZE SUV",
    blurb:
      "Tall stance, bold vertical chrome grille, angular lamps and big wheels. The highway brute that owns the fast lane.",
    stance: "TALL STANCE · BIG WHEELS",
    paints: [
      { name: "MIDNIGHT BLACK", body: 0x15171b, roof: 0x101216 },
      { name: "ARCTIC WHITE", body: 0xf0eee8, roof: 0x1b1e23 },
      { name: "STEEL GREY", body: 0x7c838c, roof: 0x1b1e23 },
    ],
  },
  {
    id: "falcon",
    name: "FALCON",
    tag: "SPORTY COMPACT SUV",
    blurb:
      "Sloping roof, split LED lamps, sculpted shoulders and a connected tail-light bar. Nips through gaps the big ones can't.",
    stance: "COMPACT · COUPE ROOF",
    paints: [
      { name: "CRIMSON RED", body: 0xb32c26, roof: 0x14161a },
      { name: "FROST WHITE", body: 0xf3f1ec, roof: 0x14161a },
      { name: "QUANTUM GREY", body: 0x6a7178, roof: 0x14161a },
    ],
  },
  {
    id: "sultan",
    name: "SULTAN",
    tag: "PREMIUM TECH SUV",
    blurb:
      "Chrome-stud grille, twin LED swooshes, silky fastback roof and large machined alloys. Arrives like royalty.",
    stance: "SLEEK · LARGE ALLOYS",
    paints: [
      { name: "ELECTRIC BLUE", body: 0x1e6fd9, roof: 0x121419 },
      { name: "PEARL WHITE", body: 0xf4f2ec, roof: 0x171a1f },
      { name: "OBSIDIAN", body: 0x0f1114, roof: 0x0c0e11 },
    ],
  },
  {
    id: "cub",
    name: "CUB",
    tag: "MINI TRAIL 4X4",
    blurb:
      "Tiny, boxy and unstoppable — round lamps, upright slots, black roof and rugged steel wheels. Small car, big heart.",
    stance: "TINY FOOTPRINT · STEELS",
    paints: [
      { name: "SUNSHINE YELLOW", body: 0xe3b41f, roof: 0x17191d },
      { name: "KINETIC GREEN", body: 0x3f7d4e, roof: 0x17191d },
      { name: "CHALK WHITE", body: 0xece9df, roof: 0x17191d },
    ],
  },
];

export const CAR_MODEL_IDS: CarModelId[] = CAR_MODELS.map((m) => m.id);

export function getCarModel(id: string): CarModelDef | undefined {
  return CAR_MODELS.find((m) => m.id === id);
}

export function carModelName(id: string): string {
  return getCarModel(id)?.name ?? "HIMALAYA";
}

export const DEFAULT_CAR: CarModelId = "himalaya";

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

type Bucket =
  | "body"
  | "roof"
  | "trim"
  | "chrome"
  | "glass"
  | "silver"
  | "tow"
  | "head"
  | "amber"
  | "tail";

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 14);

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _scl = new THREE.Vector3();
const _mat = new THREE.Matrix4();

function boxPart(
  bucket: Bucket,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = UNIT_BOX.clone();
  _mat.compose(
    _pos.set(x, y, z),
    _quat.setFromEuler(_eul.set(rx, ry, rz)),
    _scl.set(w, h, d)
  );
  g.applyMatrix4(_mat);
  (g as THREE.BufferGeometry & { bucket?: Bucket }).bucket = bucket;
  return g;
}

function cylPart(
  bucket: Bucket,
  rTop: number,
  rBot: number,
  len: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  seg = 14
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  _mat.compose(
    _pos.set(x, y, z),
    _quat.setFromEuler(_eul.set(rx, ry, rz)),
    _scl.set(1, 1, 1)
  );
  g.applyMatrix4(_mat);
  (g as THREE.BufferGeometry & { bucket?: Bucket }).bucket = bucket;
  return g;
}

// ---------------------------------------------------------------------------
// shared wheel styles (merged tire + rim geometries, cached per style)
// ---------------------------------------------------------------------------

type WheelStyle = "steel6" | "alloy10" | "twin5" | "thin12";

interface WheelSpec {
  radius: number;
  width: number;
  style: WheelStyle;
}

const wheelGeoCache = new Map<string, { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry }>();

function buildWheelGeos(spec: WheelSpec) {
  const { radius: R, width: W, style } = spec;
  const tireParts: THREE.BufferGeometry[] = [];
  const rimParts: THREE.BufferGeometry[] = [];

  // tire — axis along X (car's lateral)
  tireParts.push(cylPart("trim", R, R, W, 0, 0, 0, 0, 0, Math.PI / 2, 18));
  // sidewall shoulders (chunky look for off-road styles)
  const chunky = style === "steel6";
  if (chunky) {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      tireParts.push(
        boxPart(
          "trim",
          W * 0.62,
          0.09,
          0.16,
          0,
          Math.cos(a) * R * 0.97,
          Math.sin(a) * R * 0.97,
          -a,
          0,
          0
        )
      );
    }
  }
  // rim base disc + hub well
  const rimR = R * (chunky ? 0.6 : 0.66);
  rimParts.push(cylPart("rim", rimR, rimR, W * 1.02, 0, 0, 0, 0, 0, Math.PI / 2, 16));
  rimParts.push(cylPart("rim", rimR * 0.32, rimR * 0.32, W * 1.06, 0, 0, 0, 0, 0, Math.PI / 2, 10));

  const spokeCount =
    style === "steel6" ? 6 : style === "alloy10" ? 10 : style === "twin5" ? 5 : 12;
  for (let i = 0; i < spokeCount; i++) {
    const a = (i / spokeCount) * Math.PI * 2;
    const cy = Math.cos(a);
    const cz = Math.sin(a);
    if (style === "steel6") {
      // chunky rectangular spokes
      rimParts.push(
        boxPart(
          "rim",
          W * 0.7,
          R * 0.5,
          0.09,
          0,
          cy * rimR * 0.52,
          cz * rimR * 0.52,
          -a,
          0,
          0
        )
      );
    } else if (style === "twin5") {
      // twin-spoke: two thin bars per arm
      for (const off of [-0.055, 0.055]) {
        rimParts.push(
          boxPart(
            "rim",
            W * 0.66,
            R * 0.52,
            0.045,
            0,
            cy * rimR * 0.52 - off * cz,
            cz * rimR * 0.52 + off * cy,
            -a,
            0,
            0
          )
        );
      }
    } else {
      // thin machined spokes
      rimParts.push(
        boxPart(
          "rim",
          W * 0.72,
          R * 0.54,
          style === "thin12" ? 0.03 : 0.05,
          0,
          cy * rimR * 0.52,
          cz * rimR * 0.52,
          -a,
          0,
          0
        )
      );
    }
  }
  // polished lip ring on premium styles
  if (style === "thin12" || style === "alloy10") {
    rimParts.push(
      cylPart("rim", R * 0.8, R * 0.8, W * 0.86, 0, 0, 0, 0, 0, Math.PI / 2, 18)
    );
  }

  const tire = BufferGeometryUtils.mergeGeometries(tireParts, false)!;
  const rim = BufferGeometryUtils.mergeGeometries(rimParts, false)!;
  for (const g of [...tireParts, ...rimParts]) g.dispose();
  return { tire, rim };
}

function getWheelGeos(spec: WheelSpec) {
  const key = `${spec.style}|${spec.radius}|${spec.width}`;
  let hit = wheelGeoCache.get(key);
  if (!hit) {
    hit = buildWheelGeos(spec);
    wheelGeoCache.set(key, hit);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// per-model body specs
// ---------------------------------------------------------------------------

interface ModelSpec {
  wheel: WheelSpec;
  /** [x, z, front?] */
  wheels: [number, number, boolean][];
  /** tailgate spare wheel */
  spare?: { x: number; y: number; z: number };
  flame: [number, number, number]; // x, y, z
  brake: [number, number, number, number, number, number][]; // w,h,d,x,y,z
  build: (B: BucketParts) => void;
}

interface BucketParts {
  add(bucket: Bucket, geo: THREE.BufferGeometry): void;
  box(bucket: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number): void;
  cyl(bucket: Bucket, rTop: number, rBot: number, len: number, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number, seg?: number): void;
}

// --- HIMALAYA (Thar-inspired) ----------------------------------------------
function buildHimalaya(P: BucketParts) {
  const black = "roof"; // black bucket for roof/flares (two-tone)
  // main tub — boxy, flat sides, high clearance
  P.box("body", 1.7, 0.5, 3.45, 0, 0.97, 0.05);
  // flat hood lip + nose face
  P.box("body", 1.7, 0.16, 0.5, 0, 1.19, 1.62);
  P.box("body", 1.7, 0.44, 0.18, 0, 1.0, 1.86);
  // hood latches
  P.box("trim", 0.13, 0.05, 0.18, -0.32, 1.3, 1.7);
  P.box("trim", 0.13, 0.05, 0.18, 0.32, 1.3, 1.7);
  // grille recess + 6 vertical slats + chrome crown bar
  P.box("trim", 0.98, 0.36, 0.07, 0, 1.0, 1.93);
  for (let i = 0; i < 6; i++) {
    P.box("silver", 0.08, 0.3, 0.05, -0.4 + i * 0.16, 1.0, 1.955);
  }
  P.box("chrome", 1.0, 0.05, 0.05, 0, 1.2, 1.95);
  // round headlights + chrome bezels + small amber indicators
  for (const sx of [-1, 1]) {
    P.cyl("chrome", 0.2, 0.2, 0.09, sx * 0.66, 1.0, 1.9, Math.PI / 2);
    P.cyl("head", 0.165, 0.165, 0.11, sx * 0.66, 1.0, 1.9, Math.PI / 2);
    P.cyl("amber", 0.055, 0.055, 0.09, sx * 0.63, 0.72, 1.92, Math.PI / 2);
  }
  // front bumper + silver skid + tow hooks
  P.box("trim", 1.88, 0.26, 0.32, 0, 0.66, 2.0);
  P.box("silver", 1.24, 0.14, 0.26, 0, 0.53, 2.1);
  P.box("tow", 0.12, 0.08, 0.14, -0.34, 0.66, 2.14);
  P.box("tow", 0.12, 0.08, 0.14, 0.34, 0.66, 2.14);
  // fender flares (all four)
  for (const [wx, wz] of [[-0.86, 1.3], [0.86, 1.3], [-0.86, -1.25], [0.86, -1.25]] as [number, number][]) {
    P.box(black, 0.3, 0.24, 1.32, wx, 0.9, wz);
  }
  // side steps
  P.box(black, 0.24, 0.1, 1.6, -0.92, 0.6, -0.05);
  P.box(black, 0.24, 0.1, 1.6, 0.92, 0.6, -0.05);
  // rocker cladding
  P.box(black, 1.82, 0.16, 2.1, 0, 0.74, -0.05);
  // windshield (nearly upright) + frame + A pillars
  P.box("glass", 1.5, 0.72, 0.06, 0, 1.62, 0.72, -0.12);
  P.box(black, 1.62, 0.1, 0.12, 0, 1.99, 0.66, -0.12);
  for (const sx of [-1, 1]) {
    P.box(black, 0.12, 0.78, 0.11, sx * 0.76, 1.61, 0.71, -0.12);
  }
  // black hardtop roof
  P.box(black, 1.58, 0.12, 2.28, 0, 2.0, -0.52);
  P.box(black, 1.5, 0.34, 0.16, 0, 1.86, -1.62); // rear roof cap
  // side windows + B pillar
  P.box("glass", 0.05, 0.56, 1.9, -0.79, 1.62, -0.42);
  P.box("glass", 0.05, 0.56, 1.9, 0.79, 1.62, -0.42);
  P.box(black, 0.1, 0.62, 0.14, -0.77, 1.6, -0.5);
  P.box(black, 0.1, 0.62, 0.14, 0.77, 1.6, -0.5);
  // rear glass + tailgate + hinges
  P.box("glass", 1.4, 0.5, 0.05, 0, 1.66, -1.72);
  P.box("body", 1.62, 0.42, 0.14, 0, 1.0, -1.78);
  P.box("trim", 0.1, 0.2, 0.06, -0.55, 1.28, -1.84);
  P.box("trim", 0.1, 0.2, 0.06, 0.55, 1.28, -1.84);
  // tail lights (vertical)
  P.box("tail", 0.14, 0.32, 0.05, -0.72, 1.04, -1.87);
  P.box("tail", 0.14, 0.32, 0.05, 0.72, 1.04, -1.87);
  // rear bumper + exhaust
  P.box("trim", 1.86, 0.24, 0.28, 0, 0.66, -1.9);
  P.box("silver", 1.1, 0.12, 0.22, 0, 0.55, -1.98);
  P.cyl("chrome", 0.05, 0.06, 0.18, -0.52, 0.5, -1.94, Math.PI / 2);
  // mirrors
  for (const sx of [-1, 1]) {
    P.box(black, 0.06, 0.05, 0.16, sx * 0.86, 1.52, 0.62);
    P.box(black, 0.24, 0.15, 0.09, sx * 0.99, 1.56, 0.56);
  }
  // door handles
  P.box("trim", 0.2, 0.06, 0.05, -0.87, 1.16, 0.3);
  P.box("trim", 0.2, 0.06, 0.05, 0.87, 1.16, 0.3);
}

// --- BISON (Scorpio-N-inspired) ---------------------------------------------
function buildBison(P: BucketParts) {
  // tall muscular tub
  P.box("body", 1.84, 0.62, 4.42, 0, 1.04, -0.05);
  // long hood + power bulge
  P.box("body", 1.84, 0.18, 1.5, 0, 1.42, 1.45);
  P.box("body", 1.16, 0.07, 1.05, 0, 1.53, 1.42);
  // front fascia — recessed grille + 6 vertical chrome slats + crown bar
  P.box("trim", 1.04, 0.56, 0.09, 0, 1.2, 2.24);
  for (let i = 0; i < 6; i++) {
    P.box("chrome", 0.1, 0.48, 0.06, -0.42 + i * 0.168, 1.2, 2.27);
  }
  P.box("chrome", 1.06, 0.07, 0.06, 0, 1.5, 2.26);
  // angular headlights + fog lamps
  for (const sx of [-1, 1]) {
    P.box("head", 0.4, 0.17, 0.08, sx * 0.75, 1.32, 2.22, 0, 0, sx * 0.08);
    P.box("trim", 0.44, 0.05, 0.06, sx * 0.75, 1.44, 2.24);
    P.cyl("head", 0.07, 0.07, 0.06, sx * 0.66, 0.9, 2.16, Math.PI / 2);
  }
  // front bumper + skid
  P.box("trim", 1.94, 0.3, 0.34, 0, 0.84, 2.3);
  P.box("silver", 1.3, 0.17, 0.28, 0, 0.71, 2.4);
  // raked windshield + pillars
  P.box("glass", 1.6, 0.86, 0.06, 0, 1.78, 0.95, -0.3);
  for (const sx of [-1, 1]) {
    P.box("trim", 0.13, 0.9, 0.11, sx * 0.79, 1.77, 0.94, -0.3);
  }
  P.box("trim", 1.68, 0.09, 0.13, 0, 2.18, 0.86, -0.3);
  // roof (body colour) + rails
  P.box("body", 1.7, 0.1, 2.8, 0, 2.2, -0.82, 0.02);
  for (const sx of [-1, 1]) {
    P.box("silver", 0.07, 0.08, 2.2, sx * 0.58, 2.28, -0.82);
  }
  // side glass with pillars
  P.box("glass", 0.05, 0.62, 2.5, -0.91, 1.8, -0.72);
  P.box("glass", 0.05, 0.62, 2.5, 0.91, 1.8, -0.72);
  for (const pz of [0.35, -0.55, -1.25]) {
    P.box("trim", 0.08, 0.66, 0.1, -0.9, 1.79, pz);
    P.box("trim", 0.08, 0.66, 0.1, 0.9, 1.79, pz);
  }
  // chrome belt line + shoulder crease
  P.box("chrome", 0.05, 0.05, 3.6, -0.935, 1.62, -0.15);
  P.box("chrome", 0.05, 0.05, 3.6, 0.935, 1.62, -0.15);
  // wheel arch cladding (angular)
  for (const [wx, wz] of [[-0.9, 1.5], [0.9, 1.5], [-0.9, -1.55], [0.9, -1.55]] as [number, number][]) {
    P.box("trim", 0.3, 0.3, 1.52, wx, 0.88, wz);
    P.box("trim", 0.34, 0.1, 1.6, wx, 0.72, wz);
  }
  // side skirts
  P.box("trim", 1.94, 0.14, 2.6, 0, 0.72, -0.1);
  // mirrors + chrome handles
  for (const sx of [-1, 1]) {
    P.box("trim", 0.06, 0.05, 0.14, sx * 0.94, 1.68, 0.9);
    P.box("trim", 0.28, 0.16, 0.1, sx * 1.08, 1.72, 0.84);
    P.box("chrome", 0.05, 0.07, 0.22, sx * 0.93, 1.28, 0.55);
    P.box("chrome", 0.05, 0.07, 0.22, sx * 0.93, 1.28, -0.7);
  }
  // rear glass + tailgate + vertical tails + spoiler
  P.box("glass", 1.5, 0.6, 0.05, 0, 1.8, -2.22);
  P.box("body", 1.76, 0.5, 0.16, 0, 1.08, -2.28);
  P.box("tail", 0.15, 0.52, 0.06, -0.78, 1.3, -2.32);
  P.box("tail", 0.15, 0.52, 0.06, 0.78, 1.3, -2.32);
  P.box("trim", 1.66, 0.1, 0.42, 0, 2.1, -2.12);
  // rear bumper + skid + exhaust
  P.box("trim", 1.9, 0.28, 0.3, 0, 0.8, -2.36);
  P.box("silver", 1.2, 0.14, 0.24, 0, 0.68, -2.44);
  P.cyl("chrome", 0.05, 0.06, 0.18, -0.6, 0.52, -2.4, Math.PI / 2);
  // shark fin antenna
  P.box("trim", 0.13, 0.11, 0.3, 0, 2.29, -1.7, -0.3);
}

// --- FALCON (Nexon-inspired) -------------------------------------------------
function buildFalcon(P: BucketParts) {
  const dark = "roof"; // black roof pack
  // compact tub with sculpted shoulder
  P.box("body", 1.72, 0.5, 3.8, 0, 0.96, -0.02);
  P.box("body", 1.8, 0.16, 3.1, 0, 1.08, -0.15); // shoulder ledge
  // split DRL (high slim strip) + main lamp low + angular surround
  for (const sx of [-1, 1]) {
    P.box("head", 0.5, 0.05, 0.05, sx * 0.58, 1.14, 1.95);
    P.box("head", 0.36, 0.15, 0.07, sx * 0.62, 0.87, 1.93, 0, 0, -sx * 0.16);
    P.box("trim", 0.56, 0.04, 0.05, sx * 0.56, 1.06, 1.96);
    P.cyl("head", 0.06, 0.06, 0.05, sx * 0.5, 0.74, 2.0, Math.PI / 2);
  }
  // sporty front bumper: dark insert + silver lip + side curtains
  P.box("trim", 1.8, 0.28, 0.3, 0, 0.76, 2.02);
  P.box("trim", 0.86, 0.2, 0.1, 0, 0.7, 2.13);
  P.box("silver", 1.0, 0.09, 0.24, 0, 0.6, 2.12);
  P.box("trim", 0.16, 0.18, 0.08, -0.84, 0.8, 2.02);
  P.box("trim", 0.16, 0.18, 0.08, 0.84, 0.8, 2.02);
  // raked windshield
  P.box("glass", 1.52, 0.72, 0.06, 0, 1.56, 0.78, -0.3);
  for (const sx of [-1, 1]) {
    P.box(dark, 0.12, 0.76, 0.1, sx * 0.74, 1.55, 0.77, -0.3);
  }
  // sloping coupe roof + black
  P.box(dark, 1.56, 0.09, 1.9, 0, 1.84, -0.55, 0.045);
  // rising belt line (side accent) + black pillars
  for (const sx of [-1, 1]) {
    P.box("trim", 0.04, 0.05, 2.4, sx * 0.875, 1.12, -0.3, 0, 0, 0.045);
    P.box("glass", 0.05, 0.5, 1.15, sx * 0.87, 1.5, 0.05);
    P.box("glass", 0.05, 0.44, 0.9, sx * 0.87, 1.44, -0.95);
    P.box(dark, 0.08, 0.55, 0.1, sx * 0.86, 1.48, -0.45);
    P.box(dark, 0.08, 0.5, 0.1, sx * 0.86, 1.42, -1.3);
    P.box(dark, 0.22, 0.06, 0.06, sx * 0.88, 1.18, 0.4);
    P.box(dark, 0.22, 0.06, 0.06, sx * 0.88, 1.18, -0.75);
  }
  // steep rear glass + roof spoiler
  P.box("glass", 1.44, 0.6, 0.06, 0, 1.5, -1.4, 0.52);
  P.box(dark, 1.6, 0.09, 0.42, 0, 1.76, -1.86);
  // connected tail-light bar + corner tails
  P.box("tail", 1.44, 0.08, 0.05, 0, 1.2, -1.94);
  P.box("tail", 0.13, 0.3, 0.05, -0.8, 1.06, -1.92);
  P.box("tail", 0.13, 0.3, 0.05, 0.8, 1.06, -1.92);
  // rear bumper + diffuser + dual exhaust
  P.box("trim", 1.78, 0.3, 0.28, 0, 0.74, -1.98);
  P.box("silver", 1.06, 0.1, 0.22, 0, 0.6, -2.04);
  P.cyl("chrome", 0.05, 0.06, 0.16, -0.42, 0.56, -2.0, Math.PI / 2);
  P.cyl("chrome", 0.05, 0.06, 0.16, 0.42, 0.56, -2.0, Math.PI / 2);
  // black side skirts + mirrors
  P.box(dark, 1.84, 0.12, 2.3, 0, 0.66, -0.05);
  for (const sx of [-1, 1]) {
    P.box(dark, 0.05, 0.05, 0.13, sx * 0.88, 1.44, 0.68);
    P.box(dark, 0.24, 0.14, 0.09, sx * 1.0, 1.48, 0.6);
  }
  // wheel arches dark
  for (const [wx, wz] of [[-0.85, 1.32], [0.85, 1.32], [-0.85, -1.28], [0.85, -1.28]] as [number, number][]) {
    P.box(dark, 0.26, 0.22, 1.3, wx, 0.88, wz);
  }
}

// --- SULTAN (XUV700-inspired) ------------------------------------------------
function buildSultan(P: BucketParts) {
  // sleek smooth tub
  P.box("body", 1.82, 0.56, 4.5, 0, 1.0, -0.05);
  P.box("body", 1.82, 0.2, 1.6, 0, 1.32, 1.4, -0.035); // gently sloped hood
  // signature chrome-stud grille (4 x 6 grid) + surround
  P.box("trim", 1.0, 0.52, 0.09, 0, 1.12, 2.3);
  for (let c = 0; c < 4; c++) {
    for (let r2 = 0; r2 < 6; r2++) {
      P.cyl(
        "chrome",
        0.035,
        0.035,
        0.05,
        -0.36 + c * 0.24,
        0.92 + r2 * 0.105,
        2.34,
        Math.PI / 2,
        0,
        0,
        8
      );
    }
  }
  P.box("chrome", 1.04, 0.06, 0.05, 0, 1.41, 2.32);
  // twin swoosh LED DRLs + sleek main lamps (per side)
  for (const sx of [-1, 1]) {
    P.box("head", 0.34, 0.045, 0.05, sx * 0.64, 1.3, 2.3, 0, 0, 0.32);
    P.box("head", 0.3, 0.045, 0.05, sx * 0.58, 1.17, 2.33, 0, 0, 0.32);
    P.box("head", 0.32, 0.12, 0.07, sx * 0.71, 0.99, 2.29);
    P.box("trim", 0.36, 0.04, 0.05, sx * 0.71, 1.12, 2.3);
  }
  // front bumper + skid + air curtains
  P.box("trim", 1.92, 0.3, 0.34, 0, 0.78, 2.34);
  P.box("silver", 1.26, 0.16, 0.28, 0, 0.66, 2.44);
  P.box("trim", 0.15, 0.16, 0.07, -0.86, 0.82, 2.28);
  P.box("trim", 0.15, 0.16, 0.07, 0.86, 0.82, 2.28);
  // fastback-ish windshield + roof
  P.box("glass", 1.58, 0.84, 0.06, 0, 1.74, 0.92, -0.38);
  for (const sx of [-1, 1]) {
    P.box("trim", 0.12, 0.88, 0.11, sx * 0.78, 1.73, 0.91, -0.38);
  }
  P.box("body", 1.72, 0.09, 2.86, 0, 2.12, -0.8, 0.035);
  // chrome window belt + pillars + side glass
  P.box("chrome", 0.05, 0.045, 2.9, -0.9, 1.6, -0.65);
  P.box("chrome", 0.05, 0.045, 2.9, 0.9, 1.6, -0.65);
  P.box("glass", 0.05, 0.56, 2.6, -0.9, 1.78, -0.68);
  P.box("glass", 0.05, 0.56, 2.6, 0.9, 1.78, -0.68);
  for (const pz of [0.3, -0.6, -1.35]) {
    P.box("trim", 0.08, 0.6, 0.1, -0.89, 1.77, pz);
    P.box("trim", 0.08, 0.6, 0.1, 0.89, 1.77, pz);
  }
  // roof rails
  for (const sx of [-1, 1]) {
    P.box("silver", 0.07, 0.07, 2.3, sx * 0.58, 2.2, -0.8);
  }
  // wheel arch cladding
  for (const [wx, wz] of [[-0.88, 1.5], [0.88, 1.5], [-0.88, -1.55], [0.88, -1.55]] as [number, number][]) {
    P.box("trim", 0.28, 0.26, 1.5, wx, 0.86, wz);
  }
  // side skirts + chrome handles + mirrors
  P.box("trim", 1.9, 0.13, 2.7, 0, 0.7, -0.1);
  for (const sx of [-1, 1]) {
    P.box("chrome", 0.05, 0.07, 0.22, sx * 0.92, 1.26, 0.5);
    P.box("chrome", 0.05, 0.07, 0.22, sx * 0.92, 1.26, -0.75);
    P.box("trim", 0.06, 0.05, 0.13, sx * 0.93, 1.66, 0.88);
    P.box("trim", 0.26, 0.15, 0.1, sx * 1.06, 1.7, 0.82);
  }
  // rear: glass, light bar, chrome strip, spoiler lip
  P.box("glass", 1.5, 0.56, 0.05, 0, 1.78, -2.24);
  P.box("tail", 1.56, 0.07, 0.05, 0, 1.32, -2.3);
  P.box("chrome", 1.46, 0.06, 0.04, 0, 1.22, -2.3);
  P.box("tail", 0.12, 0.26, 0.05, -0.8, 1.14, -2.28);
  P.box("tail", 0.12, 0.26, 0.05, 0.8, 1.14, -2.28);
  P.box("body", 1.74, 0.48, 0.16, 0, 1.0, -2.34);
  P.box("trim", 1.64, 0.08, 0.34, 0, 1.98, -2.2);
  // rear bumper + skid
  P.box("trim", 1.88, 0.28, 0.3, 0, 0.78, -2.38);
  P.box("silver", 1.16, 0.13, 0.24, 0, 0.67, -2.46);
  P.cyl("chrome", 0.05, 0.06, 0.18, -0.62, 0.54, -2.42, Math.PI / 2);
}

// --- CUB (Jimny-inspired) ----------------------------------------------------
function buildCub(P: BucketParts) {
  const black = "roof";
  // tiny box tub
  P.box("body", 1.56, 0.5, 3.42, 0, 0.94, 0);
  // flat hood + latch bumps
  P.box("body", 1.56, 0.14, 0.6, 0, 1.15, 1.5);
  P.box("trim", 0.12, 0.05, 0.16, -0.3, 1.26, 1.55);
  P.box("trim", 0.12, 0.05, 0.16, 0.3, 1.26, 1.55);
  // front face: black grille + 5 body slots + round lamps + chrome rings
  P.box(black, 0.74, 0.34, 0.06, 0, 1.0, 1.78);
  for (let i = 0; i < 5; i++) {
    P.box("silver", 0.07, 0.26, 0.04, -0.28 + i * 0.14, 1.0, 1.81);
  }
  for (const sx of [-1, 1]) {
    P.cyl("chrome", 0.17, 0.17, 0.08, sx * 0.56, 1.02, 1.76, Math.PI / 2);
    P.cyl("head", 0.14, 0.14, 0.1, sx * 0.56, 1.02, 1.76, Math.PI / 2);
    P.cyl("amber", 0.05, 0.05, 0.08, sx * 0.53, 0.78, 1.78, Math.PI / 2);
  }
  // rugged bumpers + skid + end caps
  P.box("trim", 1.62, 0.2, 0.26, 0, 0.7, 1.86);
  P.box("trim", 0.12, 0.26, 0.2, -0.82, 0.72, 1.86);
  P.box("trim", 0.12, 0.26, 0.2, 0.82, 0.72, 1.86);
  P.box("silver", 0.9, 0.1, 0.2, 0, 0.62, 1.94);
  // upright windshield + frame
  P.box("glass", 1.34, 0.66, 0.05, 0, 1.56, 0.78, -0.07);
  P.box(black, 1.44, 0.09, 0.1, 0, 1.9, 0.76, -0.07);
  for (const sx of [-1, 1]) {
    P.box(black, 0.1, 0.7, 0.1, sx * 0.72, 1.55, 0.77, -0.07);
  }
  // black roof (flat, boxy)
  P.box(black, 1.46, 0.1, 2.42, 0, 1.9, -0.42);
  // side windows + pillars
  P.box("glass", 0.05, 0.5, 2.0, -0.79, 1.56, -0.35);
  P.box("glass", 0.05, 0.5, 2.0, 0.79, 1.56, -0.35);
  for (const pz of [0.25, -0.5, -1.15]) {
    P.box(black, 0.08, 0.54, 0.09, -0.78, 1.55, pz);
    P.box(black, 0.08, 0.54, 0.09, 0.78, 1.55, pz);
  }
  // rear glass + tailgate + spare wheel mount plate
  P.box("glass", 1.3, 0.46, 0.05, 0, 1.58, -1.7);
  P.box("body", 1.5, 0.44, 0.12, 0, 1.0, -1.75);
  P.box("trim", 0.6, 0.6, 0.06, 0, 1.05, -1.79);
  // tail lights
  P.box("tail", 0.11, 0.26, 0.05, -0.6, 1.02, -1.82);
  P.box("tail", 0.11, 0.26, 0.05, 0.6, 1.02, -1.82);
  // rear bumper
  P.box("trim", 1.58, 0.2, 0.24, 0, 0.7, -1.84);
  P.box("silver", 0.8, 0.09, 0.18, 0, 0.62, -1.9);
  // black cladding: rockers + arches
  P.box(black, 1.66, 0.16, 2.2, 0, 0.72, -0.05);
  for (const [wx, wz] of [[-0.78, 1.18], [0.78, 1.18], [-0.78, -1.18], [0.78, -1.18]] as [number, number][]) {
    P.box(black, 0.26, 0.22, 1.28, wx, 0.86, wz);
  }
  // mirrors + handles (black)
  for (const sx of [-1, 1]) {
    P.box(black, 0.05, 0.05, 0.12, sx * 0.8, 1.46, 0.68);
    P.box(black, 0.2, 0.13, 0.08, sx * 0.91, 1.5, 0.6);
    P.box(black, 0.18, 0.05, 0.05, sx * 0.8, 1.12, 0.3);
    P.box(black, 0.18, 0.05, 0.05, sx * 0.8, 1.12, -0.65);
  }
}

const MODEL_SPECS: Record<CarModelId, ModelSpec> = {
  himalaya: {
    wheel: { radius: 0.45, width: 0.34, style: "steel6" },
    wheels: [
      [-0.86, 1.3, true],
      [0.86, 1.3, true],
      [-0.86, -1.25, false],
      [0.86, -1.25, false],
    ],
    spare: { x: 0.32, y: 1.05, z: -1.98 },
    flame: [0, 0.52, -2.15],
    brake: [
      [0.14, 0.32, 0.06, -0.72, 1.04, -1.89],
      [0.14, 0.32, 0.06, 0.72, 1.04, -1.89],
    ],
    build: buildHimalaya,
  },
  bison: {
    wheel: { radius: 0.43, width: 0.32, style: "alloy10" },
    wheels: [
      [-0.9, 1.5, true],
      [0.9, 1.5, true],
      [-0.9, -1.55, false],
      [0.9, -1.55, false],
    ],
    flame: [0, 0.55, -2.5],
    brake: [
      [0.15, 0.52, 0.06, -0.78, 1.3, -2.34],
      [0.15, 0.52, 0.06, 0.78, 1.3, -2.34],
    ],
    build: buildBison,
  },
  falcon: {
    wheel: { radius: 0.4, width: 0.28, style: "twin5" },
    wheels: [
      [-0.85, 1.32, true],
      [0.85, 1.32, true],
      [-0.85, -1.28, false],
      [0.85, -1.28, false],
    ],
    flame: [0, 0.56, -2.14],
    brake: [
      [0.13, 0.3, 0.05, -0.8, 1.06, -1.95],
      [0.13, 0.3, 0.05, 0.8, 1.06, -1.95],
    ],
    build: buildFalcon,
  },
  sultan: {
    wheel: { radius: 0.43, width: 0.3, style: "thin12" },
    wheels: [
      [-0.88, 1.5, true],
      [0.88, 1.5, true],
      [-0.88, -1.55, false],
      [0.88, -1.55, false],
    ],
    flame: [0, 0.54, -2.5],
    brake: [
      [0.12, 0.26, 0.05, -0.8, 1.14, -2.31],
      [0.12, 0.26, 0.05, 0.8, 1.14, -2.31],
    ],
    build: buildSultan,
  },
  cub: {
    wheel: { radius: 0.4, width: 0.3, style: "steel6" },
    wheels: [
      [-0.78, 1.18, true],
      [0.78, 1.18, true],
      [-0.78, -1.18, false],
      [0.78, -1.18, false],
    ],
    spare: { x: 0, y: 1.05, z: -1.95 },
    flame: [0, 0.5, -2.0],
    brake: [
      [0.11, 0.26, 0.05, -0.6, 1.02, -1.84],
      [0.11, 0.26, 0.05, 0.6, 1.02, -1.84],
    ],
    build: buildCub,
  },
};

// ---------------------------------------------------------------------------
// assets (cached per model + paint)
// ---------------------------------------------------------------------------

export interface CarPaint {
  body: number;
  roof: number;
  /** rim/alloy tint (defaults per model) */
  rim: number;
}

const RIM_DEFAULTS: Record<CarModelId, number> = {
  himalaya: 0x2b2d31,
  bison: 0x44484f,
  falcon: 0xb9bec4,
  sultan: 0xc4c8ce,
  cub: 0x232529,
};

export interface CarAssets {
  buckets: Partial<Record<Bucket, THREE.BufferGeometry>>;
  bucketList: Bucket[];
  wheelTire: THREE.BufferGeometry;
  wheelRim: THREE.BufferGeometry;
  wheelRadius: number;
  wheelPos: [number, number, boolean][];
  flame: [number, number, number];
  brakeGeo: THREE.BufferGeometry;
  sparePos: [number, number, number] | null;
  spareTire: THREE.BufferGeometry;
  spareRim: THREE.BufferGeometry;
}

const assetCache = new Map<string, CarAssets>();

/** Build (or fetch cached) merged geometry + layout for a model+paint. */
export function getCarAssets(model: CarModelId, paint: CarPaint): CarAssets {
  const key = `${model}`;
  let hit = assetCache.get(key);
  if (hit) return hit;

  const spec = MODEL_SPECS[model];
  const parts: THREE.BufferGeometry[] = [];
  const P: BucketParts = {
    add: (bucket, geo) => {
      (geo as THREE.BufferGeometry & { bucket?: Bucket }).bucket = bucket;
      parts.push(geo);
    },
    box: (bucket, w, h, d, x, y, z, rx, ry, rz) =>
      parts.push(boxPart(bucket, w, h, d, x, y, z, rx, ry, rz)),
    cyl: (bucket, rTop, rBot, len, x, y, z, rx, ry, rz, seg) =>
      parts.push(cylPart(bucket, rTop, rBot, len, x, y, z, rx, ry, rz, seg)),
  };

  spec.build(P);

  // tailgate spare wheel (off-roaders): tire + 5-spoke steel rim, mounted
  const sparePosArr: [number, number, number] | null = spec.spare
    ? [spec.spare.x, spec.spare.y, spec.spare.z]
    : null;
  let spareTire: THREE.BufferGeometry | null = null;
  let spareRim: THREE.BufferGeometry | null = null;
  if (spec.spare) {
    const { x, y, z } = spec.spare;
    const R = spec.wheel.radius * 0.92;
    spareTire = cylPart("trim", R, R, 0.24, x, y, z, Math.PI / 2);
    const rimP: THREE.BufferGeometry[] = [
      cylPart("silver", R * 0.6, R * 0.6, 0.26, x, y, z, Math.PI / 2),
    ];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      rimP.push(
        boxPart("silver", 0.16, R * 0.5, 0.08, x, y + Math.cos(a) * R * 0.32, z + Math.sin(a) * R * 0.32, 0, 0, 0)
      );
    }
    spareRim = BufferGeometryUtils.mergeGeometries(rimP, false)!;
    for (const g of rimP) g.dispose();
    parts.push(spareTire);
    parts.push(spareRim);
  }

  // split parts into buckets & merge
  const byBucket = new Map<Bucket, THREE.BufferGeometry[]>();
  for (const g of parts) {
    const b = (g as THREE.BufferGeometry & { bucket?: Bucket }).bucket ?? "body";
    const list = byBucket.get(b);
    if (list) list.push(g);
    else byBucket.set(b, [g]);
  }
  const buckets: Partial<Record<Bucket, THREE.BufferGeometry>> = {};
  for (const [b, list] of byBucket) {
    const merged = BufferGeometryUtils.mergeGeometries(list, false)!;
    buckets[b] = merged;
  }
  // raw part clones can be disposed once merged
  for (const g of parts) g.dispose();

  const wheelGeos = getWheelGeos(spec.wheel);

  const brakeGeo = BufferGeometryUtils.mergeGeometries(
    spec.brake.map(([w, h, d, x, y, z]) => boxPart("tail", w, h, d, x, y, z)),
    false
  )!;

  const assets: CarAssets = {
    buckets,
    bucketList: Object.keys(buckets) as Bucket[],
    wheelTire: wheelGeos.tire,
    wheelRim: wheelGeos.rim,
    wheelRadius: spec.wheel.radius,
    wheelPos: spec.wheels.map(([x, z, f]) => [x, z, f] as [number, number, boolean]),
    flame: spec.flame,
    brakeGeo,
    sparePos: sparePosArr,
    spareTire: spareTire!,
    spareRim: spareRim!,
  };
  assetCache.set(key, assets);
  return assets;
}

/** Shared materials for one (model, paint, ghost) combo. */
export interface CarMaterials {
  mats: Partial<Record<Bucket, THREE.Material>>;
  brakeTemplate: THREE.MeshBasicMaterial;
  flameMat: THREE.MeshBasicMaterial;
}

const matCache = new Map<string, CarMaterials>();

export function getCarMaterials(
  model: CarModelId,
  paint: CarPaint,
  ghost: boolean
): CarMaterials {
  const key = `${model}|${paint.body}|${paint.roof}|${paint.rim}|${ghost ? 1 : 0}`;
  let hit = matCache.get(key);
  if (hit) return hit;

  const lam = (color: number, opacity = 1): THREE.MeshLambertMaterial =>
    new THREE.MeshLambertMaterial({
      color: ghost ? 0xfff2d8 : color,
      flatShading: true,
      transparent: ghost || opacity < 1,
      opacity: ghost ? Math.min(0.3, opacity) : opacity,
    });
  const basic = (color: number, opacity = 1): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      color: ghost ? 0xfff2d8 : color,
      transparent: ghost || opacity < 1,
      opacity: ghost ? 0.3 : opacity,
    });

  const mats: Partial<Record<Bucket, THREE.Material>> = {
    body: lam(paint.body),
    roof: lam(paint.roof),
    trim: lam(0x24262b),
    chrome: lam(0xd8dbe0),
    glass: new THREE.MeshLambertMaterial({
      color: ghost ? 0xfff2d8 : 0x1d2b28,
      flatShading: true,
      transparent: true,
      opacity: ghost ? 0.22 : 0.82,
    }),
    silver: lam(0x9aa0a8),
    tow: basic(0xd64530),
    head: basic(0xfff1c4),
    amber: basic(0xffa62b),
    tail: basic(0xc23a28),
    rim: lam(paint.rim),
    tire: lam(0x1a1512),
  };

  const out: CarMaterials = {
    mats,
    brakeTemplate: basic(0xd64530),
    flameMat: new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
  matCache.set(key, out);
  return out;
}

/** Resolve a CarPaint from a model + colour option index. */
export function paintFor(model: CarModelId, colorIdx: number): CarPaint {
  const def = getCarModel(model) ?? CAR_MODELS[0];
  const p = def.paints[Math.max(0, Math.min(def.paints.length - 1, colorIdx))] ?? def.paints[0];
  return { body: p.body, roof: p.roof, rim: RIM_DEFAULTS[model] };
}

/** Override the body colour (e.g. multiplayer room colours) keeping the model's roof/rim. */
export function paintWithBody(model: CarModelId, body: number): CarPaint {
  const base = paintFor(model, 0);
  return { ...base, body };
}
