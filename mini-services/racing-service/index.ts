/**
 * CANYON RUSH — real-time multiplayer racing service.
 *
 * Socket.IO server (port 3003) providing:
 *  - room-based lobbies with 4-char codes, multiple independent rooms
 *  - hard 10-player limit enforced server-side
 *  - host/admin authority + safe host transfer on disconnect
 *  - custom names, live renaming, ready system
 *  - room-isolated real-time chat (validation + anti-spam)
 *  - server-authorized synchronized race countdown (3-2-1-GO)
 *  - 10Hz aggregated car-state relay with pre-GO movement lock
 *  - plausibility-checked laps / finishes / final results + rematch
 *  - reconnection tokens, disconnect grace, abandoned-room cleanup
 *
 * All game physics run on each client; the server is authoritative for
 * everything social + race lifecycle + result ordering, and validates
 * lap/finish plausibility; client-simulated races are not cheat-proof.
 */
import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------
const PORT = Number.parseInt(process.env.RACING_PORT ?? "3003", 10);
const MAX_PLAYERS = 10;
const COUNTDOWN_MS = 4200; // server-authorized GO moment
const MIN_LAP_MS = 20000; // plausible minimum lap time
// Sunstone Canyon spline length (track.ts); update when the track changes.
const TRACK_LENGTH = 2298;
const TRACK_LENGTHS = { canyon: TRACK_LENGTH, city: 2524 } as const;
type MapId = keyof typeof TRACK_LENGTHS;
const RECONNECT_GRACE_MS =
  Number.parseInt(process.env.RACING_GRACE_MS ?? "", 10) || 90000;
const CHAT_MAX_LEN = 200;
const CHAT_WINDOW_MS = 10000;
const CHAT_MAX_IN_WINDOW = 8;
const STATE_MIN_INTERVAL_MS = 40; // accept max 25 state updates / second
const RELAY_INTERVAL_MS = 50; // 20 Hz snapshots to match client send cadence
const RELAY_STALE_MS = 650; // do not replay a disconnected/lagged car as a fresh sample
const RESULTS_COMPILE_DELAY_MS = 10000; // wait for reconnectors after last finish
const RESULTS_TO_LOBBY_MS = 15000; // auto return-to-lobby after results
/** hard race timeout per lap (env-tunable for testing) */
const RACE_TIMEOUT_PER_LAP_MS =
  Number.parseInt(process.env.RACING_TIMEOUT_PER_LAP_MS ?? "", 10) ||
  4 * 60 * 1000;
const ROOM_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const NAME_MAX = 14;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOMS = 100; // global room cap (memory safety)
const CREATE_COOLDOWN_MS = 5000; // per-socket room-creation cooldown
/** garage model whitelist — identical gameplay stats, visuals only */
const CAR_MODELS = ["himalaya", "bison", "falcon", "sultan", "cub"];
const CAR_MAX_COLOR = 4; // colour option index bound per model
const PLAYER_COLORS = [
  "#f0641e",
  "#2f9e63",
  "#d64530",
  "#1f8a70",
  "#ffb020",
  "#8a5a2b",
  "#c94277",
  "#6a994e",
  "#a3593a",
  "#4a7c6f",
];

/** Mild profanity mask list (chat is masked, names are rejected). */
const BAD_WORDS = ["fuck", "shit", "bitch", "asshole", "cunt", "nigger", "retard", "bastard"];

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------
interface RaceState {
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
  /** nitro meter 0..100 (synced across clients for fair boost display) */
  nitro: number;
  /** nitro currently engaged (drives remote flame-trail + audio) */
  nitroActive: boolean;
  /** current driving surface (asphalt/dirt/sand/… for remote dust colour) */
  surface: string;
  /** true for one tick after a recovery teleport — clients snap, not interp */
  recovering: boolean;
}

interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  /** garage selection (visual only — validated against the whitelist) */
  car: string;
  carColor: number;
  ready: boolean;
  connected: boolean;
  socketId: string | null;
  grid: number;
  racing: boolean;
  /** forfeited this race (quit mid-race) — counted as done/DNF */
  forfeit: boolean;
  lap: number;
  finishPos: number | null;
  finishMs: number | null;
  bestLapMs: number | null;
  topSpeedKmh: number | null;
  driftScore: number | null;
  lastProgress: number;
  lapProgBase: number | null;
  anchor: RaceState | null; // grid position captured during countdown
  lastState: RaceState | null;
  lastStateAt: number;
  chatTimes: number[];
  disconnectAt: number | null;
  removeTimer: ReturnType<typeof setTimeout> | null;
}

type Phase = "lobby" | "countdown" | "racing" | "results";

interface Room {
  code: string;
  hostId: string;
  phase: Phase;
  players: Map<string, Player>;
  order: string[]; // join order (stable pids)
  nextPid: number;
  laps: number;
  map: MapId;
  trackLength: number;
  startAt: number;
  raceStartedAt: number;
  finishCounter: number;
  goTimer: ReturnType<typeof setTimeout> | null;
  raceTimer: ReturnType<typeof setTimeout> | null;
  compileTimer: ReturnType<typeof setTimeout> | null;
  lobbyTimer: ReturnType<typeof setTimeout> | null;
  relayOn: boolean;
  createdAt: number;
  /** last compiled results — re-emitted to late reconnectors during the results phase */
  lastResults: MPResult[] | null;
  /** results of players who FINISHED but left before compilation — they
   *  earned their position, so the final table must keep them */
  finishedLeft: MPResult[];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const rooms = new Map<string, Room>();

function sanitizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // strip control chars, collapse whitespace
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function maskProfanity(text: string): string {
  let out = text;
  for (const w of BAD_WORDS) {
    out = out.replace(new RegExp(w, "gi"), (m) => m[0] + "*".repeat(Math.max(1, m.length - 1)));
  }
  return out;
}

function hasProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  return BAD_WORDS.some((w) => lower.includes(w));
}

/** Valid display name or null. */
function validName(raw: unknown): string | null {
  const name = sanitizeText(raw);
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (hasProfanity(name)) return null;
  return name;
}

function genCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

interface MPResult {
  pid: string;
  name: string;
  color: string;
  pos: number | null;
  totalMs: number | null;
  bestLapMs: number | null;
  topSpeedKmh: number | null;
  driftScore: number | null;
  finished: boolean;
}

function genRoomCode(): string {
  // 32^4 ≈ 1M possible codes vs ≤ MAX_ROOMS live rooms — collisions are
  // near-impossible; still, never fall back to an invalid-length code.
  for (let tries = 0; tries < 500; tries++) {
    const code = genCode();
    if (!rooms.has(code)) return code;
  }
  throw new Error("room code space exhausted");
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeState(raw: unknown): RaceState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const rawYaw = num(r.yaw);
  const yaw = ((rawYaw % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  // surface whitelist — must be one of the known physics surfaces
  const SURFACES = new Set([
    "asphalt", "concrete", "dirt", "gravel", "grass", "sand", "mud", "wet", "rock",
  ]);
  const surfRaw = typeof r.surface === "string" ? r.surface : "asphalt";
  const surface = SURFACES.has(surfRaw) ? surfRaw : "asphalt";
  return {
    x: clampAbs(num(r.x), 6000),
    y: clampRange(num(r.y), -60, 400),
    z: clampAbs(num(r.z), 6000),
    yaw,
    steer: clampRange(num(r.steer), -1, 1),
    spd: clampRange(num(r.spd), 0, 250),
    boost: !!r.boost,
    drift: !!r.drift,
    ground: !!r.ground,
    lap: Math.min(50, Math.max(0, Math.round(num(r.lap)))),
    prog: clampAbs(num(r.prog), 1e7),
    nitro: clampRange(num(r.nitro, 100), 0, 100),
    nitroActive: !!r.nitroActive,
    surface,
    recovering: !!r.recovering,
  };
}

function clampAbs(v: number, lim: number): number {
  return Math.max(-lim, Math.min(lim, v));
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function roomState(r: Room) {
  return {
    code: r.code,
    hostId: r.hostId,
    phase: r.phase,
    laps: r.laps,
    map: r.map,
    maxPlayers: MAX_PLAYERS,
    startAt: r.phase === "countdown" ? r.startAt : null,
    players: r.order
      .map((pid) => r.players.get(pid))
      .filter((p): p is Player => !!p)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        car: p.car,
        carColor: p.carColor,
        ready: p.ready,
        connected: p.connected,
        grid: p.grid,
        racing: p.racing,
        lap: p.lap,
        finishPos: p.finishPos,
        finishMs: p.finishMs,
      })),
  };
}

function sysMsg(text: string) {
  return { id: randomUUID(), pid: null, name: "SYSTEM", text, at: Date.now(), sys: true };
}

function chatMsg(p: Player, text: string) {
  return { id: randomUUID(), pid: p.id, name: p.name, text, at: Date.now(), sys: false };
}

function broadcastRoom(r: Room) {
  io.to(r.code).emit("mp:room", { room: roomState(r) });
}

function systemChat(r: Room, text: string) {
  io.to(r.code).emit("mp:chat", { msg: sysMsg(text) });
}

function pickColor(r: Room): string {
  const used = new Set([...r.players.values()].map((p) => p.color));
  for (const c of PLAYER_COLORS) if (!used.has(c)) return c;
  return PLAYER_COLORS[r.players.size % PLAYER_COLORS.length];
}

function clearTimer(t: ReturnType<typeof setTimeout> | null): ReturnType<typeof setTimeout> | null {
  if (t) clearTimeout(t);
  return null;
}

function playerResult(p: Player): MPResult {
  return {
    pid: p.id,
    name: p.name,
    color: p.color,
    pos: p.finishPos,
    totalMs: p.finishMs,
    bestLapMs: p.bestLapMs,
    topSpeedKmh: p.topSpeedKmh,
    driftScore: p.driftScore,
    finished: p.finishPos != null,
  };
}

/** Remove a player entirely (grace expired or explicit leave). */
function removePlayer(r: Room, p: Player, reason: "left" | "timeout") {
  if (!r.players.has(p.id)) return;
  // a finisher leaving before results compile keeps their earned position
  if (p.finishPos != null && (r.phase === "racing" || r.phase === "results")) {
    r.finishedLeft.push(playerResult(p));
  }
  if (p.removeTimer) clearTimeout(p.removeTimer);
  r.players.delete(p.id);
  r.order = r.order.filter((pid) => pid !== p.id);
  io.to(r.code).emit("mp:chat", {
    msg: sysMsg(reason === "left" ? `${p.name} left the room` : `${p.name} timed out`),
  });

  if (r.players.size === 0) {
    deleteRoom(r);
    return;
  }
  // host transfer — prefer a connected player; if everyone left is within
  // their reconnect grace, still hand the crown to the earliest remaining
  // player so the room can never end up hostless
  if (r.hostId === p.id) {
    const remaining = r.order
      .map((pid) => r.players.get(pid)!)
      .filter(Boolean);
    const next = remaining.find((pl) => pl.connected) ?? remaining[0];
    if (next) {
      r.hostId = next.id;
      systemChat(r, `${next.name} is now the host`);
    }
  }
  broadcastRoom(r);
  // a racer leaving mid-race is "done" — re-check whether the field is
  // complete now (no-ops outside the racing phase)
  maybeScheduleCompile(r);
}

function deleteRoom(r: Room) {
  r.goTimer = clearTimer(r.goTimer);
  r.raceTimer = clearTimer(r.raceTimer);
  r.compileTimer = clearTimer(r.compileTimer);
  r.lobbyTimer = clearTimer(r.lobbyTimer);
  for (const p of r.players.values()) {
    if (p.removeTimer) clearTimeout(p.removeTimer);
  }
  r.relayOn = false;
  rooms.delete(r.code);
  console.log(`[room ${r.code}] deleted`);
}

/** Assign fresh grid slots: connected racers in `order` sequence. */
function assignGrid(r: Room) {
  let g = 0;
  for (const pid of r.order) {
    const p = r.players.get(pid);
    if (!p) continue;
    p.grid = g++;
  }
}

/** Begin the server-authorized countdown. */
function beginCountdown(r: Room) {
  r.phase = "countdown";
  r.startAt = Date.now() + COUNTDOWN_MS;
  r.finishCounter = 0;
  r.lastResults = null;
  r.finishedLeft = [];
  for (const p of r.players.values()) {
    // everyone present at start time races (even currently-disconnected
    // players keep their slot so they can rejoin in progress)
    p.racing = true;
    p.forfeit = false;
    p.lap = 0;
    p.finishPos = null;
    p.finishMs = null;
    p.bestLapMs = null;
    p.topSpeedKmh = null;
    p.driftScore = null;
    p.lastProgress = 0;
    p.lapProgBase = null;
    p.anchor = null;
    p.lastState = null;
    p.ready = false;
  }
  assignGrid(r);
  r.relayOn = true;
  broadcastRoom(r);
  io.to(r.code).emit("mp:countdown", { startAt: r.startAt, laps: r.laps });
  console.log(`[room ${r.code}] countdown → GO at ${r.startAt}`);

  r.goTimer = clearTimer(r.goTimer);
  r.goTimer = setTimeout(() => {
    r.phase = "racing";
    r.raceStartedAt = r.startAt;
    io.to(r.code).emit("mp:go", { startAt: r.startAt });
    broadcastRoom(r);
    // re-check completion: players may already have forfeited during the
    // countdown (maybeScheduleCompile no-ops while phase !== "racing")
    maybeScheduleCompile(r);
    // hard race timeout — force results so a room can never hang
    r.raceTimer = clearTimer(r.raceTimer);
    r.raceTimer = setTimeout(
      () => {
        if (r.phase === "racing") {
          console.log(`[room ${r.code}] race timeout → results`);
          compileResults(r, true);
        }
      },
      r.laps * RACE_TIMEOUT_PER_LAP_MS + 60000
    );
  }, COUNTDOWN_MS);
}

/** Build + broadcast final results and move to the results phase. */
function compileResults(r: Room, fromTimeout = false) {
  if (r.phase !== "racing") return;
  r.compileTimer = clearTimer(r.compileTimer);
  r.raceTimer = clearTimer(r.raceTimer);
  const racers = r.order
    .map((pid) => r.players.get(pid)!)
    .filter((p) => p && (p.racing || p.forfeit));
  const finished = racers
    .filter((p) => p.finishPos != null)
    .sort((a, b) => (a.finishPos ?? 0) - (b.finishPos ?? 0));
  const dnf = racers
    .filter((p) => p.finishPos == null)
    .sort((a, b) => b.lastProgress - a.lastProgress);
  const results: MPResult[] = [
    ...[...finished.map(playerResult), ...r.finishedLeft].sort(
      (a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity)
    ),
    ...dnf.map(playerResult),
  ];
  r.lastResults = results;
  r.phase = "results";
  io.to(r.code).emit("mp:results", { results });
  broadcastRoom(r);
  console.log(
    `[room ${r.code}] results compiled (${finished.length} finished, ${dnf.length} DNF${fromTimeout ? ", timeout" : ""})`
  );
  // auto return to lobby so the room never gets stuck in results
  r.lobbyTimer = clearTimer(r.lobbyTimer);
  r.lobbyTimer = setTimeout(() => returnToLobby(r), RESULTS_TO_LOBBY_MS);
}

function returnToLobby(r: Room) {
  if (r.phase !== "results") return;
  r.lobbyTimer = clearTimer(r.lobbyTimer);
  r.phase = "lobby";
  r.lastResults = null;
  r.finishedLeft = [];
  for (const p of r.players.values()) {
    p.ready = false;
    p.racing = false;
    p.forfeit = false;
    p.lap = 0;
    p.finishPos = null;
    p.finishMs = null;
  }
  r.relayOn = false;
  io.to(r.code).emit("mp:phase", { phase: "lobby" });
  broadcastRoom(r);
}

/** Schedule result compilation once every connected racer is done
 *  (finished, forfeited or gone). */
function maybeScheduleCompile(r: Room) {
  if (r.phase !== "racing") return;
  const racers = [...r.players.values()].filter((p) => p.racing || p.forfeit);
  const connectedRacers = racers.filter((p) => p.connected);
  if (connectedRacers.length === 0) {
    // everyone dropped — compile after the reconnect grace window
    if (!r.compileTimer) {
      r.compileTimer = setTimeout(() => compileResults(r), RECONNECT_GRACE_MS);
    }
    return;
  }
  const allDone = connectedRacers.every((p) => p.finishPos != null || p.forfeit);
  if (allDone) {
    r.compileTimer = clearTimer(r.compileTimer);
    r.compileTimer = setTimeout(() => compileResults(r), RESULTS_COMPILE_DELAY_MS);
  }
}

// ---------------------------------------------------------------------------
// socket server
// ---------------------------------------------------------------------------
const httpServer = createServer();
const io = new Server(httpServer, {
  path: process.env.VERCEL ? "/api/racing" : "/socket.io/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e5,
});

interface SocketData {
  roomCode?: string;
  pid?: string;
  lastCreateAt?: number;
}

function ctxOf(socket: Socket): { r: Room; p: Player } | null {
  const code = (socket.data as SocketData).roomCode;
  const pid = (socket.data as SocketData).pid;
  if (!code || !pid) return null;
  const r = rooms.get(code);
  if (!r) return null;
  const p = r.players.get(pid);
  // An old transport can disconnect after a valid token-based takeover.
  // Never let that stale socket mutate the new owner's room state.
  if (!p || p.socketId !== socket.id) return null;
  return { r, p };
}

/** Detach a socket from its current room (explicit leave / room switch). */
function detachSocket(socket: Socket, reason: "left" | "timeout") {
  const ctx = ctxOf(socket);
  if (!ctx) return;
  const { r, p } = ctx;
  const lastCreateAt = (socket.data as SocketData).lastCreateAt;
  (socket.data as SocketData) = lastCreateAt ? { lastCreateAt } : {};
  socket.leave(r.code);
  removePlayer(r, p, reason);
}

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);

  socket.on("mp:ping", (payload: unknown) => {
    const t0 = (payload as { t0?: number })?.t0;
    socket.emit("mp:pong", { t0: typeof t0 === "number" ? t0 : 0, serverNow: Date.now() });
  });

  // ----- create ------------------------------------------------------------
  socket.on("mp:create", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const body = (payload ?? {}) as { name?: unknown };
      const name = validName(body.name);
      if (!name) {
        ack?.({ ok: false, error: "Enter a name (1-14 characters)" });
        return;
      }
      // abuse guards: global room cap + per-socket creation cooldown
      if (rooms.size >= MAX_ROOMS) {
        ack?.({ ok: false, error: "Server is full of rooms — try again in a moment" });
        return;
      }
      const now = Date.now();
      const data = socket.data as SocketData;
      if (data.lastCreateAt && now - data.lastCreateAt < CREATE_COOLDOWN_MS) {
        ack?.({ ok: false, error: "Slow down — wait a moment before creating another room" });
        return;
      }
      detachSocket(socket, "left");
      const code = genRoomCode();
      const room: Room = {
        code,
        hostId: "p1",
        phase: "lobby",
        players: new Map(),
        order: [],
        nextPid: 1,
        laps: 3,
        map: "canyon",
        trackLength: TRACK_LENGTH,
        startAt: 0,
        raceStartedAt: 0,
        finishCounter: 0,
        goTimer: null,
        raceTimer: null,
        compileTimer: null,
        lobbyTimer: null,
        relayOn: false,
        createdAt: Date.now(),
        lastResults: null,
        finishedLeft: [],
      };
      const pid = "p" + room.nextPid++;
      const player: Player = {
        id: pid,
        token: randomUUID(),
        name,
        color: pickColor(room),
        car: "himalaya",
        carColor: 0,
        ready: false,
        connected: true,
        socketId: socket.id,
        grid: 0,
        racing: false,
        forfeit: false,
        lap: 0,
        finishPos: null,
        finishMs: null,
        bestLapMs: null,
        topSpeedKmh: null,
        driftScore: null,
        lastProgress: 0,
        lapProgBase: null,
        anchor: null,
        lastState: null,
        lastStateAt: 0,
        chatTimes: [],
        disconnectAt: null,
        removeTimer: null,
      };
      room.players.set(pid, player);
      room.order.push(pid);
      room.hostId = pid;
      rooms.set(code, room);
      (socket.data as SocketData) = { roomCode: code, pid, lastCreateAt: now };
      socket.join(code);
      console.log(`[room ${code}] created by ${name}`);
      ack?.({ ok: true, code, token: player.token, pid });
      socket.emit("mp:room", { room: roomState(room) });
      systemChat(room, `${name} created the room`);
    } catch (err) {
      console.error("mp:create error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- join --------------------------------------------------------------
  socket.on("mp:join", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const body = (payload ?? {}) as { code?: unknown; name?: unknown; token?: unknown };
      const code = sanitizeText(body.code).toUpperCase();
      if (code.length !== 4) {
        ack?.({ ok: false, error: "Room code must be 4 characters" });
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        ack?.({ ok: false, error: "Room not found — check the code" });
        return;
      }
      const token = typeof body.token === "string" ? body.token : "";

      // --- reconnection path (token match, currently disconnected) ---
      if (token) {
        for (const p of room.players.values()) {
          if (p.token === token) {
            // Take over a stale/half-open transport after a mobile handoff or
            // Function reconnect. Matching the secret UUID token is required.
            const previousSocketId = p.socketId;
            detachSocket(socket, "left");
            p.connected = true;
            // A pending "everyone disconnected" result must not end a race
            // after an unfinished racer successfully rejoins.
            if (room.phase === "racing" && p.racing && p.finishPos == null) {
              room.compileTimer = clearTimer(room.compileTimer);
            }
            p.socketId = socket.id;
            p.disconnectAt = null;
            if (previousSocketId && previousSocketId !== socket.id) {
              io.sockets.sockets.get(previousSocketId)?.disconnect(true);
            }
            if (p.removeTimer) {
              clearTimeout(p.removeTimer);
              p.removeTimer = null;
            }
            (socket.data as SocketData) = { roomCode: code, pid: p.id };
            socket.join(code);
            // self-heal: if the host is gone (mass disconnect edge case),
            // the returning player takes the crown
            if (!room.players.has(room.hostId)) {
              room.hostId = p.id;
              console.log(`[room ${code}] host missing — ${p.name} promoted on rejoin`);
            }
            console.log(`[room ${code}] ${p.name} reconnected`);
            ack?.({ ok: true, code, token: p.token, pid: p.id });
            socket.emit("mp:room", { room: roomState(room) });
            // a reconnector during the results phase missed the broadcast —
            // replay the stored table so they see how the race ended
            if (room.phase === "results" && room.lastResults) {
              socket.emit("mp:results", { results: room.lastResults });
            }
            systemChat(room, `${p.name} reconnected`);
            broadcastRoom(room);
            return;
          }
        }
      }

      // --- fresh join ---
      if (room.players.size >= MAX_PLAYERS) {
        ack?.({ ok: false, error: `Room is full (${room.players.size}/${MAX_PLAYERS})` });
        return;
      }
      const name = validName(body.name);
      if (!name) {
        ack?.({ ok: false, error: "Enter a name (1-14 characters)" });
        return;
      }
      detachSocket(socket, "left");
      const pid = "p" + room.nextPid++;
      const color = pickColor(room);
      const player: Player = {
        id: pid,
        token: randomUUID(),
        name,
        color,
        car: "himalaya",
        carColor: 0,
        ready: false,
        connected: true,
        socketId: socket.id,
        grid: room.players.size,
        racing: false,
        forfeit: false,
        lap: 0,
        finishPos: null,
        finishMs: null,
        bestLapMs: null,
        topSpeedKmh: null,
        driftScore: null,
        lastProgress: 0,
        lapProgBase: null,
        anchor: null,
        lastState: null,
        lastStateAt: 0,
        chatTimes: [],
        disconnectAt: null,
        removeTimer: null,
      };
      room.players.set(pid, player);
      room.order.push(pid);
      (socket.data as SocketData) = { roomCode: code, pid };
      socket.join(code);
      console.log(`[room ${code}] ${name} joined (${room.players.size}/${MAX_PLAYERS})`);
      ack?.({ ok: true, code, token: player.token, pid });
      socket.emit("mp:room", { room: roomState(room) });
      systemChat(room, `${name} joined the room`);
      broadcastRoom(room);
    } catch (err) {
      console.error("mp:join error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- leave -------------------------------------------------------------
  socket.on("mp:leave", (_payload: unknown, ack?: (res: unknown) => void) => {
    try {
      detachSocket(socket, "left");
      ack?.({ ok: true });
    } catch (err) {
      console.error("mp:leave error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- rename ------------------------------------------------------------
  socket.on("mp:rename", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      const body = (payload ?? {}) as { name?: unknown };
      const name = validName(body.name);
      if (!name) {
        ack?.({ ok: false, error: "Name must be 1-14 characters (no bad words)" });
        return;
      }
      if (name === p.name) {
        ack?.({ ok: true });
        return;
      }
      const old = p.name;
      p.name = name;
      ack?.({ ok: true });
      systemChat(r, `${old} is now known as ${name}`);
      broadcastRoom(r);
    } catch (err) {
      console.error("mp:rename error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- ready -------------------------------------------------------------
  socket.on("mp:ready", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      if (r.phase !== "lobby") {
        ack?.({ ok: false, error: "Can't change ready during a race" });
        return;
      }
      p.ready = !!((payload as { ready?: unknown })?.ready);
      ack?.({ ok: true });
      broadcastRoom(r);
    } catch (err) {
      console.error("mp:ready error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- host lobby settings (laps) ----------------------------------------
  socket.on("mp:settings", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      if (r.hostId !== p.id) {
        ack?.({ ok: false, error: "Only the host can change settings" });
        return;
      }
      if (r.phase !== "lobby") {
        ack?.({ ok: false, error: "Settings are locked outside the lobby" });
        return;
      }
      const body = (payload ?? {}) as { laps?: unknown; map?: unknown };
      const laps = Math.round(num(body.laps, r.laps));
      if (laps < 1 || laps > 5) {
        ack?.({ ok: false, error: "Laps must be 1-5" });
        return;
      }
      if (body.map !== undefined) {
        if (body.map !== "canyon" && body.map !== "city") {
          ack?.({ ok: false, error: "Unknown track" });
          return;
        }
        r.map = body.map;
        r.trackLength = TRACK_LENGTHS[r.map];
      }
      r.laps = laps;
      ack?.({ ok: true });
      broadcastRoom(r);
    } catch (err) {
      console.error("mp:settings error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- chat --------------------------------------------------------------
  socket.on("mp:chat", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      const raw = (payload as { text?: unknown })?.text;
      if (typeof raw !== "string") {
        ack?.({ ok: false, error: "Invalid message" });
        return;
      }
      const text = sanitizeText(raw).slice(0, CHAT_MAX_LEN);
      if (!text) {
        ack?.({ ok: false, error: "Message is empty" });
        return;
      }
      // anti-spam: max CHAT_MAX_IN_WINDOW messages per window
      const now = Date.now();
      p.chatTimes = p.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
      if (p.chatTimes.length >= CHAT_MAX_IN_WINDOW) {
        ack?.({ ok: false, error: "Slow down — too many messages" });
        return;
      }
      p.chatTimes.push(now);
      ack?.({ ok: true });
      io.to(r.code).emit("mp:chat", { msg: chatMsg(p, maskProfanity(text)) });
    } catch (err) {
      console.error("mp:chat error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- host: start race ----------------------------------------------------
  socket.on("mp:start", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      if (r.hostId !== p.id) {
        ack?.({ ok: false, error: "Only the host can start the race" });
        return;
      }
      if (r.phase !== "lobby") {
        ack?.({ ok: false, error: "Race already running" });
        return;
      }
      const connected = [...r.players.values()].filter((pl) => pl.connected);
      if (connected.length < 1) {
        ack?.({ ok: false, error: "Not enough players" });
        return;
      }
      const notReady = connected.filter((pl) => !pl.ready);
      if (notReady.length > 0) {
        ack?.({ ok: false, error: `Waiting for ${notReady.length} player(s) to ready up` });
        return;
      }
      const body = (payload ?? {}) as { laps?: unknown };
      const laps = Math.round(num(body.laps, r.laps));
      if (laps < 1 || laps > 5) {
        ack?.({ ok: false, error: "Laps must be 1-5" });
        return;
      }
      r.laps = laps;
      r.trackLength = TRACK_LENGTHS[r.map];
      ack?.({ ok: true });
      beginCountdown(r);
    } catch (err) {
      console.error("mp:start error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- host: rematch -------------------------------------------------------
  socket.on("mp:rematch", (_payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      if (r.hostId !== p.id) {
        ack?.({ ok: false, error: "Only the host can start a rematch" });
        return;
      }
      if (r.phase !== "results") {
        ack?.({ ok: false, error: "Rematch is available on the results screen" });
        return;
      }
      // new grid: finish order first (winner on pole), DNFs by progress
      r.order = r.order
        .map((pid) => r.players.get(pid)!)
        .filter(Boolean)
        .sort((a, b) => {
          const fa = a.finishPos ?? Infinity;
          const fb = b.finishPos ?? Infinity;
          if (fa !== fb) return fa - fb;
          if (fa === Infinity) return b.lastProgress - a.lastProgress;
          return 0;
        })
        .map((pl) => pl.id);
      ack?.({ ok: true });
      beginCountdown(r);
    } catch (err) {
      console.error("mp:rematch error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- race state (throttled, sanitized, relayed) --------------------------
  socket.on("mp:state", (payload: unknown) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) return;
      const { r, p } = ctx;
      if (r.phase !== "countdown" && r.phase !== "racing" && r.phase !== "results") return;
      if (!p.racing || !p.connected) return;
      const now = Date.now();
      if (now - p.lastStateAt < STATE_MIN_INTERVAL_MS) return; // drop, don't queue
      const st = sanitizeState(payload);
      if (!st) return;
      p.lastStateAt = now;
      p.lastState = st;
      p.lastProgress = st.prog;
      if (r.phase === "racing" && p.lapProgBase == null) p.lapProgBase = st.prog;
      // pre-GO lock: the first state during countdown becomes the grid anchor
      // and every relayed state until GO uses the anchor (no early movement)
      if (r.phase === "countdown") {
        if (!p.anchor) p.anchor = st;
        p.lastState = { ...p.anchor, lap: 0, prog: p.anchor.prog };
      }
    } catch (err) {
      console.error("mp:state error", err);
    }
  });

  // ----- lap report (validated) ----------------------------------------------
  socket.on("mp:lap", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) return;
      const { r, p } = ctx;
      if (r.phase !== "racing" || !p.racing) return;
      const body = (payload ?? {}) as { lap?: unknown; lapMs?: unknown; prog?: unknown };
      const lap = Math.round(num(body.lap, -1));
      const lapMs = num(body.lapMs, 0);
      // Acknowledgements may be lost during reconnect; duplicate reports are safe.
      if (lap > 0 && lap <= p.lap) { ack?.({ ok: true }); return; }
      if (lap !== p.lap + 1) return; // out of order / duplicate
      if (lapMs < MIN_LAP_MS) return; // impossible lap time
      if (Date.now() - r.raceStartedAt < lap * MIN_LAP_MS) return;
      if (lapMs > Date.now() - r.raceStartedAt + 3000) return; // faster than wall clock
      if (p.lapProgBase == null) return;
      // distance travelled this lap — the lap payload's own progress is merged
      // with the state stream so a just-missed state tick can't reject a lap
      const progNow = Math.max(p.lastProgress, clampAbs(num(body.prog, p.lastProgress), 1e7));
      if (progNow - p.lapProgBase < r.trackLength * 0.75) return; // not enough distance
      p.lastProgress = progNow;
      p.lap++;
      p.lapProgBase = p.lastProgress;
      if (p.bestLapMs == null || lapMs < p.bestLapMs) p.bestLapMs = lapMs;
      ack?.({ ok: true });
      io.to(r.code).emit("mp:lap", { pid: p.id, lap: p.lap, lapMs, name: p.name });
    } catch (err) {
      console.error("mp:lap error", err);
    }
  });

  // ----- finish report (validated, position assigned server-side) -------------
  socket.on("mp:finish", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) return;
      const { r, p } = ctx;
      if (r.phase !== "racing" || !p.racing) return;
      if (p.finishPos != null) { ack?.({ ok: true }); return; }
      const body = (payload ?? {}) as Record<string, unknown>;
      const totalMs = num(body.totalMs, -1);
      if (totalMs < r.laps * MIN_LAP_MS) return; // impossible total
      const serverElapsed = Date.now() - r.raceStartedAt;
      if (totalMs > serverElapsed + 3000) return; // future time = reject
      if (p.lap < r.laps) return; // laps not validated yet
      p.finishMs = totalMs;
      // Keep the best lap accepted by the server rather than replacing it.
      p.topSpeedKmh = clampRange(num(body.topSpeedKmh, 0), 0, 500);
      p.driftScore = clampRange(num(body.driftScore, 0), 0, 1e7);
      p.finishPos = ++r.finishCounter;
      ack?.({ ok: true });
      io.to(r.code).emit("mp:finish", {
        pid: p.id,
        totalMs: p.finishMs,
        pos: p.finishPos,
        name: p.name,
      });
      broadcastRoom(r);
      maybeScheduleCompile(r);
    } catch (err) {
      console.error("mp:finish error", err);
    }
  });

  // ----- car selection (garage — visual only, whitelist-validated) ---------
  socket.on("mp:car", (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      const body = (payload ?? {}) as { model?: unknown; color?: unknown };
      const model = sanitizeText(body.model).toLowerCase();
      if (!CAR_MODELS.includes(model)) {
        ack?.({ ok: false, error: "Unknown car model" });
        return;
      }
      const color = Math.round(num(body.color, 0));
      if (!Number.isInteger(color) || color < 0 || color > CAR_MAX_COLOR) {
        ack?.({ ok: false, error: "Invalid colour selection" });
        return;
      }
      p.car = model;
      p.carColor = color;
      ack?.({ ok: true });
      broadcastRoom(r); // everyone re-renders the roster + remote cars
    } catch (err) {
      console.error("mp:car error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- forfeit (player quits a live race — counted as DNF, room keeps flowing) ----
  socket.on("mp:forfeit", (_payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) {
        ack?.({ ok: false, error: "Not in a room" });
        return;
      }
      const { r, p } = ctx;
      if (r.phase !== "racing" && r.phase !== "countdown") {
        ack?.({ ok: false, error: "No race to forfeit" });
        return;
      }
      if (!p.racing || p.forfeit) {
        ack?.({ ok: true });
        return;
      }
      p.racing = false;
      p.forfeit = true; // counted as DNF in results; done for compile purposes
      console.log(`[room ${r.code}] ${p.name} forfeited`);
      ack?.({ ok: true });
      systemChat(r, `${p.name} forfeited this race`);
      broadcastRoom(r);
      maybeScheduleCompile(r);
    } catch (err) {
      console.error("mp:forfeit error", err);
      ack?.({ ok: false, error: "Server error" });
    }
  });

  // ----- disconnect / graceful removal ----------------------------------------
  socket.on("disconnect", () => {
    try {
      const ctx = ctxOf(socket);
      if (!ctx) return;
      const { r, p } = ctx;
      console.log(`[room ${r.code}] ${p.name} disconnected`);
      p.connected = false;
      p.socketId = null;
      p.disconnectAt = Date.now();
      systemChat(r, `${p.name} disconnected — reconnecting…`);
      broadcastRoom(r);
      maybeScheduleCompile(r);
      p.removeTimer = clearTimer(p.removeTimer);
      p.removeTimer = setTimeout(() => {
        // room may have been deleted meanwhile
        const room = rooms.get(r.code);
        if (!room) return;
        const pl = room.players.get(p.id);
        if (!pl || pl.connected) return;
        removePlayer(room, pl, "timeout");
      }, RECONNECT_GRACE_MS);
    } catch (err) {
      console.error("disconnect handler error", err);
    }
  });

  socket.on("error", (err) => {
    console.error(`socket error (${socket.id}):`, err);
  });
});

// ---------------------------------------------------------------------------
// aggregated 10 Hz relay: one broadcast per room with every racer's state
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (!r.relayOn) continue;
    const players: unknown[] = [];
    for (const pid of r.order) {
      const p = r.players.get(pid);
      if (!p || !p.racing || !p.connected || !p.lastState) continue;
      // A lost upstream connection must not produce a stream of fake fresh
      // timestamps, which caused remote clients to hold a frozen car forever.
      if (now - p.lastStateAt > RELAY_STALE_MS) continue;
      const st = r.phase === "countdown" && p.anchor ? p.anchor : p.lastState;
      players.push({ pid, ...st });
    }
    if (players.length) {
      // Superseded race snapshots are disposable: never queue stale positions
      // behind slow clients while preserving reliable room/lap/results events.
      io.to(r.code).volatile.emit("mp:update", { t: now, players });
    }
  }
}, RELAY_INTERVAL_MS);

// Diagnostic heartbeat: distinguish a sender that stopped uploading from a
// receiver whose downstream snapshots are missing. No names or tokens logged.
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (!r.relayOn) continue;
    const sources = r.order.flatMap((pid) => {
      const p = r.players.get(pid);
      return p && p.racing ? [{pid, connected:p.connected, lastInputAgeMs:p.lastStateAt ? now - p.lastStateAt : -1}] : [];
    });
    io.to(r.code).emit("mp:diag", {t:now,sources});
    const stale = sources.filter(p => p.connected && p.lastInputAgeMs > 2000);
    if (stale.length) console.warn("[mp:network] stale_source", {room:r.code,sources:stale.map(p => ({pid:p.pid,ageMs:p.lastInputAgeMs}))});
  }
}, 3000);

// ---------------------------------------------------------------------------
// housekeeping: abandoned rooms / stale rooms
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    if (now - r.createdAt > ROOM_MAX_AGE_MS) {
      console.log(`[room ${r.code}] expired (max age)`);
      deleteRoom(r);
      continue;
    }
    const anyConnected = [...r.players.values()].some((p) => p.connected);
    if (!anyConnected) {
      // all sockets gone (crash / mass drop) — remove once every grace expired
      const earliest = [...r.players.values()].reduce(
        (min, p) => Math.min(min, p.disconnectAt ?? now),
        Infinity
      );
      if (r.players.size === 0 || now - earliest > RECONNECT_GRACE_MS + 10000) {
        console.log(`[room ${r.code}] abandoned — cleaning up`);
        deleteRoom(r);
      }
    }
  }
}, 30000);

// ---------------------------------------------------------------------------
if (!process.env.VERCEL) httpServer.listen(PORT, () => {
  console.log(`Canyon Rush multiplayer service listening on port ${PORT}`);
  console.log(`  max players/room: ${MAX_PLAYERS} · reconnect grace: ${RECONNECT_GRACE_MS}ms`);
});

function shutdown() {
  console.log("shutting down");
  // close all sockets immediately so httpServer.close() can't hang on
  // live connections, then exit hard as a safety net
  io.close();
  const force = setTimeout(() => process.exit(0), 1500);
  force.unref();
  httpServer.close(() => process.exit(0));
}

if (!process.env.VERCEL) {
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Vercel Functions export the HTTP server instead of listening on a fixed port.
export default httpServer;
