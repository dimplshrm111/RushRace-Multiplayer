"use client";

/**
 * Multiplayer client: socket lifecycle, room/chat/race API and the glue
 * between the server and the local game engine.
 *
 * Dev on :3000 and production talk to the racing service on port 3003.
 * The Caddy gateway (:81) forwards with /?XTransformPort=3003.
 */
import { io, type Socket } from "socket.io-client";
import { gameStore } from "./store";
import { mpStore } from "./net-store";
import { DEFAULT_CAR } from "./cars";
import type {
  Ack,
  MPChatMessage,
  MPResultEntry,
  MPRemoteState,
  MPRoomState,
} from "./net-types";
import type { GameEngine } from "./engine";
import type { MapId, ResultsData } from "./types";

const NAME_KEY = "canyonrush.mp.name";
const TOKEN_KEY_PREFIX = "canyonrush.mp.token.";
const LAST_ROOM_KEY = "canyonrush.mp.lastRoom";

function ackTimeout<T>(ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(fallback), ms));
}

export class NetClient {
  private socket: Socket | null = null;
  private engine: GameEngine | null = null;
  private code: string | null = null;
  private token: string | null = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private clockSamples: { rtt: number; offset: number }[] = [];
  clockOffset = 0;
  /** true once this client has entered the current race round */
  racedThisRound = false;
  private disposed = false;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectGeneration = 0;
  private rejoinAttempts = 0;
  private lastUpdateAt = 0;
  private lastStateSentAt = 0;
  private lastServerReceiptAt = 0;
  private serverStaleSources = 0;
  private sentStates = 0;
  private receivedUpdates = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealthKey = "";
  private reports: { event: string; payload: unknown }[] = [];
  private reporting = false;
  private reportTimer: ReturnType...[truncated]