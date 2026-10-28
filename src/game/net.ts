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
  private lastSentAt = 0;
  private staleSourceCount = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealth = "";
  private reports: { event: string; payload: unknown }[] = [];
  private reporting = false;
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private reportGeneration = 0;

  // ------------------------------------------------------------------ socket
  /** Open the connection early (multiplayer screen mount) so the status
   *  chip + buttons are ready before the first user action. */
  warmup(): void {
    this.ensureSocket();
  }

  private ensureSocket(): Socket {
    if (this.socket) return this.socket;

    // The racing service always listens on port 3003.
    // Port 81 is the Caddy gateway, which forwards /?XTransformPort=3003.
    // Everywhere else (including Vercel) dial that port on the page host,
    // unless NEXT_PUBLIC_MP_URL names the public Socket.IO address.
    const configured = process.env.NEXT_PUBLIC_MP_URL;
    const port = typeof window !== "undefined" ? window.location.port : "";
    const usingVercel = process.env.NEXT_PUBLIC_MP_MODE === "vercel";
    const serverUrl = configured
      ? configured
      : usingVercel
        ? window.location.origin
      : port === "81"
        ? "/?XTransformPort=3003"
        : `${window.location.protocol}//${window.location.hostname}:3003`;

    const sock = io(serverUrl, {
      path: usingVercel ? "/api/racing" : "/socket.io/",
      transports: usingVercel ? ["websocket"] : ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 4000,
      timeout: 10000,
    });
    this.socket = sock;
    mpStore.getState().setConnection("connecting");

    sock.on("connect", () => {
      console.info("[mp:network] connected", {socketId: sock.id, room: this.code});
      const generation = ++this.reconnectGeneration;
      this.clearRejoinTimer();
      this.rejoinAttempts = 0;
      this.clockSamples = [];
      this.syncClock(true);
      if (this.code && this.token) {
        mpStore.getState().setConnection("connecting");
        void this.rejoinWithRetry(generation);
      } else {
        mpStore.getState().setConnection("online");
      }
    });
    sock.on("disconnect", (reason) => {
      console.warn("[mp:network] disconnected", {reason, room: this.code});
      ++this.reconnectGeneration;
      this.clearRejoinTimer();
      mpStore.getState().setConnection("offline");
    });
    sock.on("connect_error", (err) => {
      console.error("[mp:network] connect_error", err.message);
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
      this.lastUpdateAt = performance.now();
      const eng = this.engine;
      const myId = mpStore.getState().myId;
      if (!eng) return;
      for (const st of p.players) {
        if (st.pid === myId) continue;
        eng.applyRemoteSnapshot(st.pid, st);
      }
    });
    sock.on("mp:diag", (p: {sources: {pid: string; connected:boolean; lastInputAgeMs:number}[]}) => {
      this.staleSourceCount = p.sources.filter((source) => source.pid !== mpStore.getState().myId && source.connected && source.lastInputAgeMs > 1600).length;
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
    this.healthTimer = setInterval(() => this.updateHealth(), 1000);
    return sock;
  }

  /** Keep the live race while the network or a Function instance is rotating.
   * A failed acknowledgement is not proof that the room was deleted. */
  private async rejoinWithRetry(generation: number): Promise<void> {
    if (this.disposed || generation !== this.reconnectGeneration || !this.socket?.connected) return;
    const code = this.code;
    const token = this.token;
    if (!code || !token) return;
    const ok = await this.rawJoin(code, undefined, token);
    if (this.disposed || generation !== this.reconnectGeneration || !this.socket?.connected || this.code !== code) return;
    if (ok) {
      this.rejoinAttempts = 0;
      mpStore.getState().setConnection("online");
      void this.flushReports();
      return;
    }
    this.rejoinAttempts++;
    if (this.rejoinAttempts >= 14) {
      mpStore.getState().showToast("error", "Could not restore this room — it may have expired");
      this.cleanupLocal();
      mpStore.getState().setScreen("home");
      return;
    }
    const delay = Math.min(3500, 500 * Math.pow(1.4, this.rejoinAttempts));
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      void this.rejoinWithRetry(generation);
    }, delay);
  }

  private clearRejoinTimer() {
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
  }

  private updateHealth() {
    const st = mpStore.getState();
    const now = performance.now();
    const racing = st.room?.phase === "racing";
    const remote = st.room?.players.some(p => p.id !== st.myId && p.connected && p.racing);
    const age = this.lastUpdateAt ? Math.round(now - this.lastUpdateAt) : -1;
    const sendAge = this.lastSentAt ? Math.round(now - this.lastSentAt) : -1;
    const health = !this.socket?.connected ? "offline"
      : st.connection === "connecting" ? "connecting"
      : racing && remote && this.staleSourceCount > 0 ? "remote-uplink-stale"
      : racing && remote && (age < 0 || age > 1800) ? "downlink-stale"
      : racing && this.racedThisRound && sendAge > 1800 ? "uplink-stale"
      : st.ping > 250 ? "high-latency" : "healthy";
    st.setNetworkHealth(health, age);
    if (health !== this.lastHealth) {
      if (health !== "healthy") console.warn("[mp:network] health", {health, incomingAge:age, sendAge, ping:st.ping, room:this.code});
      else if (this.lastHealth) console.info("[mp:network] recovered", {room:this.code});
      this.lastHealth = health;
    }
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
  private waitForConnection(sock: Socket): Promise<boolean> {
    if (sock.connected) return Promise.resolve(true);
    if (!sock.active) sock.connect();
    return new Promise((resolve) => {
      let done = false;
      const onConnect = () => finish(true);
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sock.off("connect", onConnect);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 12000);
      sock.on("connect", onConnect);
      if (sock.connected) finish(true);
    });
  }

  private async call<T extends Ack>(event: string, payload: unknown): Promise<T> {
    const sock = this.ensureSocket();
    if (!(await this.waitForConnection(sock))) {
      console.warn("[mp:network] connection_timeout", {event});
      return {ok:false,error:"Connection could not be established — retry"} as T;
    }
    return new Promise((resolve) => {
      sock.timeout(10000).emit(event, payload, (err: Error | null, res: T) => {
        if (err) {
          console.warn("[mp:network] ack_timeout_or_disconnect", {event, room:this.code});
          resolve({ok:false,error:"Server did not acknowledge the request — retry"} as T);
        } else resolve(res);
      });
    });
  }

  async createRoom(name: string): Promise<boolean> {
    const res = await this.call<{ ok: boolean; error?: string; code?: string; token?: string; pid?: string; room?: MPRoomState }>(
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
    if (res.room) this.onRoom(res.room);
    mpStore.getState().setScreen("room");
    this.syncCarSelection();
    return true;
  }

  async joinRoom(code: string, name: string): Promise<boolean> {
    const res = await this.rawJoin(code, name);
    if (res) {
      const st = mpStore.getState();
      st.setScreen("room");
      this.syncCarSelection();
      return true;
    }
    return false;
  }

  private async rawJoin(code: string, name?: string, token?: string): Promise<boolean> {
    const res = await this.call<{ ok: boolean; error?: string; code?: string; token?: string; pid?: string; room?: MPRoomState }>(
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
    if (res.room) this.onRoom(res.room);
    return true;
  }

  async leaveRoom(): Promise<void> {
    if (this.socket?.connected) {
      await this.call("mp:leave", {});
    }
    this.cleanupLocal();
  }

  private cleanupLocal() {
    ++this.reconnectGeneration;
    this.clearRejoinTimer();
    this.clearReports();
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

  /** Push the local garage selection to the room (server default is
   *  HIMALAYA/0 — if you picked something else, sync it on entry). */
  private syncCarSelection() {
    const gs = gameStore.getState();
    if (gs.carModel !== DEFAULT_CAR || gs.carColor !== 0) {
      this.socket?.emit("mp:car", { model: gs.carModel, color: gs.carColor }, () => undefined);
    }
  }

  /** Change the car shown to everyone in the room (garage). */
  async setCar(model: string, color: number): Promise<void> {
    const res = await this.call<{ ok: boolean; error?: string }>("mp:car", { model, color });
    if (!res.ok) {
      mpStore.getState().showToast("error", res.error ?? "Could not change car");
    }
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

  async setMap(map: MapId): Promise<void> {
    const res = await this.call<Ack>("mp:settings", { map });
    if (!res.ok) mpStore.getState().showToast("error", res.error ?? "Could not change track");
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
    if (this.racedThisRound) {
      // include current progress so the server's distance validation never
      // races against the 15 Hz state stream
      const prog = this.engine ? +this.engine.physics.progressS.toFixed(1) : 0;
      this.reports.push({ event: "mp:lap", payload: { lap, lapMs: Math.round(lapMs), prog } });
      void this.flushReports();
    }
  }

  sendFinish(r: ResultsData) {
    if (this.racedThisRound) {
      this.reports.push({ event: "mp:finish", payload: {
        totalMs: Math.round(r.totalMs),
        bestLapMs: Math.round(r.bestLapMs),
        topSpeedKmh: Math.round(r.topSpeedKmh),
        driftScore: Math.round(r.driftScore),
      } });
      void this.flushReports();
    }
  }

  private clearReports() {
    this.reportGeneration++;
    this.reports = [];
    if (this.reportTimer) clearTimeout(this.reportTimer);
    this.reportTimer = null;
  }

  private async flushReports(): Promise<void> {
    if (this.reporting || !this.socket?.connected || !this.code) return;
    this.reporting = true;
    const generation = this.reportGeneration;
    try {
      while (this.reports.length && this.socket?.connected && generation === this.reportGeneration) {
        const report = this.reports[0];
        const result = await this.call<Ack>(report.event, report.payload);
        if (generation !== this.reportGeneration) break;
        if (!result.ok) {
          this.reportTimer = setTimeout(() => { this.reportTimer = null; void this.flushReports(); }, 2000);
          break;
        }
        this.reports.shift();
      }
    } finally {
      this.reporting = false;
      if (generation !== this.reportGeneration && this.reports.length) void this.flushReports();
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
    }, 50); // 20 Hz state pump (was 15 Hz) — smoother remote cars, still cheap
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
    // detect a recovery teleport: if the car just jumped a large distance
    // since the last state send, flag this tick as "recovering" so other
    // clients snap to the new position instead of interpolating across the gap
    const dx = p.pos.x - this.lastSentX;
    const dz = p.pos.z - this.lastSentZ;
    const jumpDist = Math.hypot(dx, dz);
    const recovering = jumpDist > 12;
    this.lastSentX = p.pos.x;
    this.lastSentZ = p.pos.z;
    // Position snapshots are disposable. Never buffer old positions while a
    // slow mobile/WebSocket transport is congested: only the latest matters.
    this.lastSentAt = performance.now();
    sock.volatile.emit("mp:state", {
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
      // new fields — sync the nitro bar, the active boost state, the surface
      // the car is on, and the recovery flag so remote cars don't rubber-band
      nitro: +p.nitro.toFixed(0),
      nitroActive: p.nitroActive,
      surface: p.surfaceBlend,
      recovering,
    });
  }
  private lastSentX = 0;
  private lastSentZ = 0;

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
    const map = room.map === "city" ? "city" : "canyon";
    if (gameStore.getState().settings.map !== map) {
      gameStore.getState().setSettings({ map });
      gameStore.getState().loadBest(gameStore.getState().settings.laps);
    }
    eng.setTrack(map);
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
      roster.map((p) => ({ id: p.id, name: p.name, color: p.color, car: p.car, carColor: p.carColor }))
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
    this.clearReports();
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
    ++this.reconnectGeneration;
    this.clearRejoinTimer();
    this.clearReports();
    this.detachEngine();
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
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
