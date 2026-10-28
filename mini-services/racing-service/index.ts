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
const RELAY_STALE_MS = 650; // do not replay a disconnected/lagg...[truncated]  ack?.({ ok: true });
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
      if (lapMs < MIN_LAP_MS) re...[truncated]