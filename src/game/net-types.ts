/** Multiplayer protocol types shared by the net client + UI (server mirror). */

export const MP_MAX_PLAYERS = 10;

export type MPRoomPhase = "lobby" | "countdown" | "racing" | "results";

export interface MPRoomPlayer {
  id: string;
  name: string;
  color: string;
  /** garage selection (visual only) */
  car: string;
  carColor: number;
  ready: boolean;
  connected: boolean;
  grid: number;
  racing: boolean;
  lap: number;
  finishPos: number | null;
  finishMs: number | null;
}

export interface MPRoomState {
  code: string;
  hostId: string;
  phase: MPRoomPhase;
  laps: number;
  maxPlayers: number;
  startAt: number | null;
  players: MPRoomPlayer[];
}

export interface MPChatMessage {
  id: string;
  pid: string | null;
  name: string;
  text: string;
  at: number;
  sys: boolean;
}

/** One car's network state inside the aggregated 10 Hz relay. */
export interface MPRemoteState {
  pid: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  steer: number;
  spd: number;
  boost: boolean;
  drift: boolean;
  ground: boolean;
  lap: number;
  prog: number;
  /** nitro meter 0..100 (synced so every client shows the same boost level) */
  nitro?: number;
  /** nitro currently engaged (for flame-trail + audio on remote cars) */
  nitroActive?: boolean;
  /** current driving surface (so remote cars render the right dust colour) */
  surface?: string;
  /** set true for one tick after a recovery teleport — other clients snap
   *  instead of interpolating, so the recovered car doesn't rubber-band */
  recovering?: boolean;
}

export interface MPResultEntry {
  pid: string;
  name: string;
  color: string;
  pos: number | null; // null = DNF
  totalMs: number | null;
  bestLapMs: number | null;
  topSpeedKmh: number | null;
  driftScore: number | null;
  finished: boolean;
}

export interface Ack<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  code?: string;
  token?: string;
  pid?: string;
  data?: T;
}

/** Convert "#rrggbb" → 0xrrggbb for THREE.Color usage. */
export function cssToHex(color: string): number {
  const h = color.replace("#", "");
  return parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
}
