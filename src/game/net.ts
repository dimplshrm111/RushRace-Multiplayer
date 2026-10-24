"use client";

/**
 * Multiplayer client: socket lifecycle, room/chat/race API and the glue
 * between the server and the local game engine.
 *
 * Connection goes through the gateway: io("/?XTransformPort=3003").
 */
import { io, type Socket } from "socket.io-client";
import { gameStore } from "./store";
import { mpStore } from "./net-store";
import type {
  Ack,
  MPChatMessage,
  MPResultEntry,
  MPRemoteState,
  MPRoomState,
} from "./net-types";
import type { GameEngine } from "./engine";
import type { ResultsData } from "./types";

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

  // ------------------------------------------------------------------ socket
  /** Open the connection early (multiplayer screen mount) so the status
   *  chip + buttons are ready before the first user action. */
  warmup(): void {
    this.ensureSocket();
  }

  private ensureSocket(): Socket {
    if (this.socket) return this.socket;
    const sock = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 4000,
      timeout: 10000,
    });
    this.socket = sock;
    mpStore.getState().setConnection("connecting");

    sock.on("connect", () => {
      mpStore.getState().setConnection("online");
      this.syncClock(true);
      // silent rejoin after a transport reconnect
      if (this.code && this.token) {
        void this.rawJoin(this.code, undefined, this.token).then((ok) => {
          if (!ok && !this.disposed) {
            // room is gone (deleted while we were away) — back to the
            // multiplayer home screen, not the solo title
            mpStore.getState().showToast("error", "Room no longer exists");
            this.cleanupLocal();
            mpStore.getState().setScreen("home");
          }
        });
      }
    });
    sock.on("disconnect", () => {
      mpStore.getState().setConnection("offline");
    });
    sock.on("connect_error", () => {
      mpStore.getState().setConnection(
        this.socket?.connected ? "online" : "offline"
      );
    });

    // clock sync
    sock.on("mp:pong", (p: { t0: number; serverNow: number }) => {
      const t1 = Date.now();
      const rtt = t1 - p.t0;
      const offset = p.serverNow - (p.t0 + rtt / 2);
      this.clockSamples.push({ rtt, offset });
      if (this.clockSamples.length > 8) this.clockSamples.shift();
      const best = this.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.clockOffset = best.offset;
      mpStore.getState().setPing(Math.round(best.rtt));
    });

    // room state
    sock.on("mp:room", (p: { room: MPRoomState }) => this.onRoom(p.room));

    // chat
    sock.on("mp:chat", (p: { msg: MPChatMessage }) => {
      mpStore.getState().pushMessage(p.msg);
    });

    // race lifecycle
    sock.on("mp:countdown", (p: { startAt: number; laps: number }) => {
      this.onCountdown(p.startAt, p.laps);
    });
    sock.on("mp:go", (p: { startAt: number }) => {
      void p;
      // engine countdown was already aligned to the server GO moment; nothing to do
    });
    sock.on("mp:update", (p: { t: number; players: MPRemoteState[] }) => {
      void p;
      const eng = this.engine;
      const myId = mpStore.getState().myId;
      if (!eng) return;
      for (const st of p.players) {
        if (st.pid === myId) continue;
        eng.applyRemoteSnapshot(st.pid, st);
      }
    });
    sock.on("mp:lap", (p: { pid: string; lap: number; lapMs: number; name: string }) => {
      const myId = mpStore.getState().myId;
      if (p.pid !== myId) {
        gameStore.getState().pushPopup("lap", `${p.name} — LAP ${p.lap}`);
      }
    });
    sock.on("mp:finish", (p: { pid: string; totalMs: number; pos: number; name: string }) => {
      const myId = mpStore.getState().myId;
      this.engine?.setRemoteFinish(p.pid, p.totalMs, p.pos);
      if (p.pid !== myId) {
        gameStore.getState().pushPopup("checkpoint", `${p.name} FINISHED — P${p.pos}`);
      } else {
        // server-authoritative final position (may differ from the local estimate)
        const res = gameStore.getState().results;
        if (res && res.position !== p.pos) {
          gameStore.getState().setResults({ ...res, position: p.pos, totalMs: p.totalMs });
        }
      }
    });
    sock.on("mp:results", (p: { results: MPResultEntry[] }) => {
      mpStore.getState().setFinalResults(p.results);
      // the server ended the race while we were still driving (timeout or
      // the rest of the field finished) — stop the local car and show the
      // final table instead of driving on in a dead race
      const eng = this.engine;
      if (eng && (eng.phase === "racing" || eng.phase === "countdown")) {
        eng.mpAbortRace();
      }
    });
    sock.on("mp:phase", (p: { phase: string }) => {
      if (p.phase === "lobby") {
        this.racedThisRound = false;
        const st = mpStore.getState();
        st.setFinalResults(null);
        // if any local race view is still up (finished screen, or a car
        // still driving a race the server already closed), drop to the lobby
        const eng = this.engine;
        if (
          eng &&
          (eng.phase === "finished" ||
            eng.phase === "racing" ||
            eng.phase === "countdown")
        ) {
          eng.toTitle();
        }
      }
    });

    // periodic clock resync
    this.clockTimer = setInterval(() => this.syncClock(false), 30000);
    return sock;
  }

  private syncClock(burst: boolean) {
    const sock = this.socket;
    if (!sock || !sock.connected) return;
    const n = burst ? 5 : 2;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (sock.connected) sock.emit("mp:ping", { t0: Date.now() });
      }, i * 130);
    }
  }

  /** Server-time ↔ client-time alignment. */
  private timeUntilGo(startAtServer: number): number {
    return startAtServer - (Date.now() + this.clockOffset);
  }

  // ------------------------------------------------------------------- API
  private call<T extends Ack>(event: string, payload: unknown): Promise<T> {
    const sock = this.ensureSocket();
    return new Promise<T>((resolve) => {
      let settled = false;
      const t = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: "Server not responding" } as T);
        }
      }, 8000);
      sock.emit(event, payload, (res: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(res);
      });
    });
  }

  async createRoom(name: string): Promise<boolean> {
    const res = await this.call<{ ok: boolean; error?: string; code?: string; token?: string; pid?: string }>(
      "mp:create",
      { name }
    );
    if (!res.ok || !res.code || !res.token || !res.pid) {
      mpStore.getState().showToast("error", res.error ?? "Could not create room");
      return false;
    }
    this.persist(name, res.code, res.token);
    this.code = res.code;
    this.token = res.token;
    mpStore.getState().setMyId(res.pid);
    mpStore.getState().setScreen("room");
    return true;
  }

  async joinRoom(code: string, name: string): Promise<boolean> {
    const res = await this.rawJoin(code, name);
    if (res) {
      const st = mpStore.getState();
      st.setScreen("room");
      return true;
    }
    return false;
  }

  private async rawJoin(code: string, name?: string, token?: string): Promise<boolean> {
    const res = await this.call<{ ok: boolean; error?: string; code?: string; token?: string; pid?: string }>(
      "mp:join",
      { code: code.toUpperCase(), name, token }
    );
    if (!res.ok || !res.code || !res.token || !res.pid) {
      if (!token) mpStore.getState().showToast("error", res.error ?? "Could not join room");
      return false;
    }
    if (name) this.persist(name, res.code, res.token);
    this.code = res.code;
    this.token = res.token;
    mpStore.getState().setMyId(res.pid);
    return true;
  }

  async leaveRoom(): Promise<void> {
    if (this.socket?.connected) {
      await this.call("mp:leave", {});
    }
    this.cleanupLocal();
  }

  private cleanupLocal() {
    this.code = null;
    this.token = null;
    this.racedThisRound = false;
    this.engine?.setMultiplayerSession(false);
    mpStore.getState().reset();
    // NOTE: the state-pump interval is intentionally left running — killing
    // it here would silently break car sync in the NEXT room the player
    // joins (nothing re-arms it). sendState() already no-ops outside a room.
  }

  private persist(name: string, code: string, token: string) {
    try {
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(TOKEN_KEY_PREFIX + code, token);
      localStorage.setItem(LAST_ROOM_KEY, code);
    } catch {
      /* ignore */
    }
  }

  static loadName(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  }

  private loadToken(code: string): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY_PREFIX + code.toUpperCase());
    } catch {
      return null;
    }
  }

  static loadLastRoom(): string | null {
    try {
      return localStorage.getItem(LAST_ROOM_KEY);
    } catch {
      return null;
    }
  }

  /** Try to rejoin a room we were in during a previous page session. */
  async tryRejoin(code: string): Promise<boolean> {
    const token = this.loadToken(code);
    if (!token) return false;
    return this.rawJoin(code, undefined, token);
  }

  async rename(name: string): Promise<string | null> {
    const res = await this.call<{ ok: boolean; error?: string }>("mp:rename", { name });
    if (!res.ok) return res.error ?? "Rename failed";
    return null;
  }

  async setReady(ready: boolean): Promise<void> {
    await this.call("mp:ready", { ready });
  }

  async setLaps(laps: number): Promise<void> {
    await this.call("mp:settings", { laps });
  }

  async sendChat(text: string): Promise<string | null> {
    const res = await this.call<{ ok: boolean; error?: string }>("mp:chat", { text });
    if (!res.ok) return res.error ?? "Message failed";
    return null;
  }

  async startRace(): Promise<void> {
    const eng = this.engine;
    const room = mpStore.getState().room;
    if (!eng || !room) return;
    const res = await this.call<{ ok: boolean; error?: string }>("mp:start", {
      laps: room.laps,
      trackLength: Math.round(eng.track.length),
    });
    if (!res.ok) mpStore.getState().showToast("error", res.error ?? "Could not start");
  }

  async rematch(): Promise<void> {
    const res = await this.call<{ ok: boolean; error?: string }>("mp:rematch", {});
    if (!res.ok) mpStore.getState().showToast("error", res.error ?? "Could not rematch");
  }

  /** Quit the current multiplayer race without leaving the room — the
   *  server marks us DNF so the field isn't held up waiting for us. */
  forfeit(): void {
    if (this.socket?.connected) {
      this.socket.emit("mp:forfeit", {}, () => undefined);
    }
  }

  sendLap(lap: number, lapMs: number) {
    if (this.socket?.connected && this.racedThisRound) {
      // include current progress so the server's distance validation never
      // races against the 15 Hz state stream
      const prog = this.engine ? +this.engine.physics.progressS.toFixed(1) : 0;
      this.socket.emit("mp:lap", { lap, lapMs: Math.round(lapMs), prog });
    }
  }

  sendFinish(r: ResultsData) {
    if (this.socket?.connected && this.racedThisRound) {
      this.socket.emit("mp:finish", {
        totalMs: Math.round(r.totalMs),
        bestLapMs: Math.round(r.bestLapMs),
        topSpeedKmh: Math.round(r.topSpeedKmh),
        driftScore: Math.round(r.driftScore),
      });
    }
  }

  get roomCode(): string | null {
    return this.code;
  }

  get inRoom(): boolean {
    return this.code != null;
  }

  /** Diagnostics for E2E testing. */
  debugState() {
    const st = mpStore.getState();
    return {
      hasEngine: !!this.engine,
      socketConnected: !!this.socket?.connected,
      hasRoom: !!st.room,
      myId: st.myId,
      racedThisRound: this.racedThisRound,
      mpActive: this.engine?.mpActive ?? false,
      spectating: this.engine?.mpSpectating ?? false,
      enginePhase: this.engine?.phase ?? null,
      code: this.code,
    };
  }

  // ------------------------------------------------------------- engine glue
  attachEngine(engine: GameEngine) {
    this.engine = engine;
    engine.onMpLap = (lap, lapMs) => this.sendLap(lap, lapMs);
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = setInterval(() => {
      try {
        this.sendState();
      } catch (err) {
        console.error("[mp] sendState failed", err);
      }
    }, 66);
  }

  detachEngine() {
    this.engine = null;
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
  }

  private sendState() {
    const eng = this.engine;
    const sock = this.socket;
    const st = mpStore.getState();
    if (!eng || !sock?.connected || !st.room || !st.myId || !this.racedThisRound) return;
    if (!eng.mpActive || eng.mpSpectating) return;
    if (eng.phase !== "countdown" && eng.phase !== "racing" && eng.phase !== "finished") return;
    const p = eng.physics;
    sock.emit("mp:state", {
      x: +p.pos.x.toFixed(2),
      y: +p.pos.y.toFixed(2),
      z: +p.pos.z.toFixed(2),
      yaw: +p.yaw.toFixed(3),
      steer: +eng.steerInput.toFixed(2),
      spd: +p.speed.toFixed(1),
      boost: p.boosting,
      drift: p.drifting,
      ground: p.grounded,
      lap: eng.lapsDone,
      prog: +p.progressS.toFixed(1),
    });
  }

  private onRoom(room: MPRoomState) {
    const st = mpStore.getState();
    const prevPhase = st.room?.phase;
    st.setRoom(room);

    // we were removed from the room server-side
    if (st.myId && !room.players.some((p) => p.id === st.myId)) {
      mpStore.getState().showToast("info", "You were removed from the room");
      this.cleanupLocal();
      return;
    }

    const eng = this.engine;
    if (!eng) return;
    const my = room.players.find((p) => p.id === st.myId);
    if (my) {
      eng.mpMyName = my.name;
      eng.mpMyColor = my.color;
    }

    // session + spectate flags
    eng.setMultiplayerSession(true);
    eng.setSpectating(!!my && !my.racing && room.phase !== "lobby");

    // sync remote cars with the roster
    const roster = room.players.filter((p) => p.id !== st.myId);
    eng.syncRemotes(
      roster.map((p) => ({ id: p.id, name: p.name, color: p.color }))
    );
    for (const p of roster) {
      if (p.finishMs != null) eng.setRemoteFinish(p.id, p.finishMs, p.finishPos);
    }

    if (room.phase === "lobby" && prevPhase !== "lobby") {
      this.racedThisRound = false;
      st.setFinalResults(null);
    }

    // (re)enter an in-progress race (fresh page / reconnect)
    if (
      my &&
      my.racing &&
      (room.phase === "countdown" || room.phase === "racing") &&
      !this.racedThisRound &&
      eng.phase !== "countdown" &&
      eng.phase !== "racing" &&
      eng.phase !== "finished"
    ) {
      const goInMs =
        room.phase === "countdown" && room.startAt ? this.timeUntilGo(room.startAt) : 0;
      eng.startMultiplayerRace(room.laps, my.grid, Math.max(0, goInMs));
      this.racedThisRound = true;
    }
  }

  private onCountdown(startAt: number, laps: number) {
    const eng = this.engine;
    const st = mpStore.getState();
    if (!eng || !st.myId || !st.room) return;
    const my = st.room.players.find((p) => p.id === st.myId);
    st.setFinalResults(null);
    this.racedThisRound = false;
    eng.resetRemoteRace();
    if (my && my.racing) {
      const goInMs = Math.max(0, this.timeUntilGo(startAt));
      eng.startMultiplayerRace(laps, my.grid, goInMs);
      this.racedThisRound = true;
    } else {
      eng.setSpectating(true);
    }
  }

  dispose() {
    this.disposed = true;
    this.detachEngine();
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
    this.socket?.disconnect();
    this.socket = null;
  }
}

/** Singleton used by the React components. */
export const net = new NetClient();

// E2E debug handle (harmless in production — exposes the same public API)
if (typeof window !== "undefined") {
  (window as unknown as { __mpNet?: NetClient }).__mpNet = net;
}
