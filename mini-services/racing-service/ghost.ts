/**
 * Ghost driver — a scripted 2nd client for browser E2E testing.
 * Joins a room, chats, readies up, then during the race follows the other
 * player's car (echoing mp:update positions ~18 m behind them), reports a
 * validated lap + finish, so the browser client sees a full multiplayer flow.
 *
 * Run: bun run ghost.ts <CODE> [NAME]
 */
import { io, type Socket } from "socket.io-client";

const URL = "http://localhost:3003";
const code = (process.argv[2] ?? "").toUpperCase();
const name = process.argv[3] ?? "GHOST";
if (code.length !== 4) {
  console.error("usage: bun run ghost.ts <CODE> [NAME]");
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ack(sock: Socket, ev: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 6000);
    sock.emit(ev, payload, (r: any) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

const sock = io(URL, { transports: ["websocket"], forceNew: true });
let myPid = "";
let other: { x: number; y: number; z: number; yaw: number; spd: number; ground: boolean } | null = null;
let goAt = 0;
let finished = false;
let lapped = false;
let progBase: number | null = null;

sock.on("connect", async () => {
  console.log("[ghost] connected");
  const r = await ack(sock, "mp:join", { code, name });
  if (!r.ok) {
    console.error("[ghost] join failed:", r.error);
    process.exit(1);
  }
  myPid = r.pid;
  console.log("[ghost] joined room", code, "as", name, r.pid);
  await sleep(300);
  await ack(sock, "mp:chat", { text: "hey pilot! ghost driver reporting in" });
  await sleep(400);
  await ack(sock, "mp:ready", { ready: true });
  console.log("[ghost] ready ✓");
});

sock.on("mp:room", (d: any) => {
  const me = d.room.players.find((p: any) => p.id === myPid);
  if (me && d.room.phase === "countdown") console.log("[ghost] room phase: countdown");
});

sock.on("mp:countdown", (d: any) => {
  goAt = d.startAt;
  console.log("[ghost] countdown! GO in", d.startAt - Date.now(), "ms · laps:", d.laps);
});

sock.on("mp:go", () => {
  console.log("[ghost] GO — starting to drive");
});

sock.on("mp:update", (d: any) => {
  for (const p of d.players) {
    if (p.pid === myPid) continue;
    other = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, spd: p.spd, ground: p.ground };
  }
});

sock.on("mp:finish", (d: any) => {
  if (d.pid !== myPid) console.log("[ghost] other player finished P" + d.pos);
});

sock.on("mp:results", (d: any) => {
  console.log("[ghost] results:", JSON.stringify(d.results.map((r: any) => ({ n: r.name, p: r.pos, f: r.finished }))));
});

sock.on("mp:chat", (d: any) => {
  if (d.msg.pid !== myPid) console.log("[ghost] chat:", d.msg.name + ":", d.msg.text);
});

// state pump: 15 Hz
setInterval(() => {
  if (!goAt || !other) return;
  const s = {
    x: +(other.x - Math.sin(other.yaw) * 18).toFixed(2),
    y: +other.y.toFixed(2),
    z: +(other.z - Math.cos(other.yaw) * 18).toFixed(2),
    yaw: +other.yaw.toFixed(3),
    steer: 0,
    spd: +other.spd.toFixed(1),
    boost: Math.floor(Date.now() / 3000) % 3 === 0,
    drift: false,
    ground: other.ground,
    lap: lapped ? 1 : 0,
    prog: 0,
  };
  if (progBase == null) progBase = 0;
  s.prog = +(((Date.now() - goAt) / 1000) * 100).toFixed(1); // ~100 m/s fake progress
  sock.emit("mp:state", s);
}, 66);

// race timeline
void (async () => {
  // wait for GO
  const t0 = Date.now();
  while (!goAt && Date.now() - t0 < 120000) await sleep(200);
  if (!goAt) {
    console.error("[ghost] no race started in 2 min — exiting");
    process.exit(1);
  }
  await sleep(Math.max(0, goAt - Date.now()) + 200); // GO moment
  await sleep(27000);
  console.log("[ghost] reporting lap 1");
  sock.emit("mp:lap", { lap: 1, lapMs: 26000 });
  lapped = true;
  await sleep(32000);
  if (!finished) {
    finished = true;
    console.log("[ghost] reporting finish");
    sock.emit("mp:finish", {
      totalMs: 58000,
      bestLapMs: 26000,
      topSpeedKmh: 172,
      driftScore: 340,
    });
  }
  await sleep(30000); // watch results / possible rematch
  console.log("[ghost] leaving");
  await ack(sock, "mp:leave", {});
  sock.disconnect();
  process.exit(0);
})();
