/** Shared types & constants for CANYON RUSH. */

export const GAME_TITLE = "CANYON RUSH";
export const TRACK_NAME = "Sunstone Circuit";

/** Warm desert palette (no blue/indigo primaries). */
export const PALETTE = {
  skyZenith: 0x7ec8b4,
  skyMid: 0xffd9a0,
  skyHorizon: 0xff9a52,
  fog: 0xf3c98f,
  sun: 0xfff2d0,
  rockBase: 0xc1633f,
  rockStrata: [0xd98a5a, 0xa34e33, 0xe8b27a, 0x8a3f2c, 0xcf7a4a],
  road: 0xd9a86e,
  roadDust: 0xc49560,
  sand: 0xe3bd85,
  pitSand: 0xc9a06a,
  carBody: 0xff6a2a,
  carAccent: 0xfff3dd,
  carDark: 0x2e1f18,
  tire: 0x241a14,
  glass: 0x20302c,
  checkpoint: 0xffb020,
  ghost: 0xfff2d8,
  uiCream: "#fff6e6",
  uiInk: "#2b1c12",
  uiOrange: "#f0641e",
  uiGreen: "#2f9e63",
  uiTeal: "#1f8a70",
  uiRed: "#d64530",
} as const;

export type GamePhase = "title" | "countdown" | "racing" | "finished";
export type CameraMode = 0 | 1 | 2; // 0 chase near, 1 chase far, 2 hood
export type Difficulty = "easy" | "medium" | "hard";

/**
 * Difficulty presets.
 * - stacks: how many crate-stack clusters are live
 * - aiSkill: rival corner-speed / pace multiplier
 * - aiSpeedCap: rival straight-line speed cap multiplier (>1 = they out-run
 *   the player's non-boost top speed — on HARD you must drift + boost to win)
 * - boostGain: player boost-economy scale (hard punishes wasteful boosting)
 * - startBoost: player's boost meter when the lights go out
 * - aiMistakeEvery: seconds between rival unforced errors (0 = flawless)
 * - rubberAhead / rubberBehind: asymmetric catch-up — how much the rivals
 *   speed up when the PLAYER leads, vs. how much mercy they show when behind
 * - aiBoostAggro: 0..1 — how eagerly rivals spend boost on straights
 * - blocking: rivals actively defend their line when just ahead of the player
 */
export interface DifficultyPreset {
  label: string;
  short: string;
  stacks: number;
  aiSkill: number;
  aiSpeedCap: number;
  boostGain: number;
  startBoost: number;
  aiMistakeEvery: number;
  rubberAhead: number;
  rubberBehind: number;
  aiBoostAggro: number;
  blocking: boolean;
  hint: string;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  easy: {
    label: "EASY",
    short: "EASY",
    stacks: 5,
    aiSkill: 0.86,
    aiSpeedCap: 0.94,
    boostGain: 1.3,
    startBoost: 45,
    aiMistakeEvery: 13,
    rubberAhead: 0.03,
    rubberBehind: 0.1,
    aiBoostAggro: 0.25,
    blocking: false,
    hint: "Few crate stacks · relaxed rivals · juicy boost",
  },
  medium: {
    label: "MEDIUM",
    short: "MED",
    stacks: 9,
    aiSkill: 1.0,
    aiSpeedCap: 1.0,
    boostGain: 1.0,
    startBoost: 35,
    aiMistakeEvery: 26,
    rubberAhead: 0.05,
    rubberBehind: 0.055,
    aiBoostAggro: 0.55,
    blocking: false,
    hint: "The standard canyon challenge",
  },
  hard: {
    label: "HARD",
    short: "HARD",
    stacks: 14,
    aiSkill: 1.22,
    aiSpeedCap: 1.17,
    boostGain: 0.6,
    startBoost: 22,
    aiMistakeEvery: 0,
    rubberAhead: 0.14,
    rubberBehind: 0.02,
    aiBoostAggro: 1.0,
    blocking: true,
    hint: "Flawless rivals block & out-run you · 40% weaker boost · assists off",
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

/** How long a smashed crate stays gone before respawning (ms). */
export const BOX_RESPAWN_MS = 15000;

/** The breakable barricade rebuilds more slowly — its absence should read clearly. */
export const WALL_RESPAWN_MS = 30000;

export interface GameSettings {
  assist: boolean;
  mouseSteer: boolean;
  cameraMode: CameraMode;
  musicVol: number; // 0..1
  sfxVol: number; // 0..1
  highParticles: boolean;
  shadows: boolean;
  laps: number; // 1..5
  difficulty: Difficulty;
}

export const DEFAULT_SETTINGS: GameSettings = {
  assist: true,
  mouseSteer: false,
  cameraMode: 0,
  musicVol: 0.75,
  sfxVol: 0.9,
  highParticles: true,
  shadows: true,
  laps: 3,
  difficulty: "medium",
};

/** AI car marker on the minimap. */
export interface Blip {
  x: number;
  z: number;
  color: string;
}

/** Per-frame telemetry snapshot for HUD (updated via direct DOM, not React state). */
export interface Telemetry {
  speedKmh: number;
  boostMeter: number; // 0..100
  boosting: boolean;
  drifting: boolean;
  driftMult: number; // 1.0 .. 3.0
  lap: number; // 1-based
  totalLaps: number;
  position: number; // 1-based race position
  totalCars: number;
  blips: Blip[]; // AI cars for the minimap
  raceTimeMs: number;
  lapTimeMs: number;
  bestLapMs: number | null;
  bestTotalMs: number | null;
  wrongWay: boolean;
  airborne: boolean;
  wallRide: boolean;
  offRoad: boolean;
  nextCpDist: number; // meters
  gear: number; // 1..6
  rpm: number; // 0..1
  progressPct: number; // 0..1 through current lap
}

export type UIEventType =
  | "nearmiss"
  | "cleanland"
  | "airtime"
  | "wallride"
  | "driftbank"
  | "checkpoint"
  | "lap"
  | "wrongway"
  | "newrecord"
  | "recovery"
  | "boost"
  | "smash";

export interface UIEvent {
  id: number;
  type: UIEventType;
  text: string;
  amount?: number;
  deltaMs?: number; // split delta at checkpoints
  at: number;
}

/** One row of the live race standings. */
export interface StandingEntry {
  pos: number;
  name: string;
  isPlayer: boolean;
  color: string;
  timeMs: number | null; // null = still racing
}

export interface ResultsData {
  totalMs: number;
  bestLapMs: number;
  topSpeedKmh: number;
  driftScore: number;
  nearMisses: number;
  bigAirCount: number;
  laps: number;
  isNewRecord: boolean;
  splits: number[];
  position: number; // 1-based final position
  totalCars: number;
}

export interface RaceRecord {
  id: number;
  racerName: string;
  laps: number;
  timeMs: number;
  bestLapMs: number;
  topSpeedKmh: number;
  driftScore: number;
  createdAt: string;
}

export interface DriveInput {
  steer: number; // -1..1
  throttle: number; // 0..1
  brake: number; // 0..1
  handbrake: boolean;
  boost: boolean;
}

export const EMPTY_INPUT: DriveInput = {
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  boost: false,
};

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

export function formatTime(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return "--:--.--";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function formatDelta(ms: number): string {
  const sign = ms >= 0 ? "+" : "-";
  const a = Math.abs(ms) / 1000;
  return `${sign}${a.toFixed(2)}`;
}
