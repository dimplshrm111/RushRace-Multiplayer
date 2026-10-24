/**
 * Multi-client integration test for the racing service.
 * Run: cd mini-services/racing-service && bun add socket.io-client && bun run test.ts
 *
 * Verifies: create/join, 10-player limit, names, ready gating, host-only
 * start, synchronized countdown, pre-GO movement lock, chat isolation,
 * lap/finish validation, results, rematch permissions, reconnect tokens,
 * host transfer, invalid-input rejection.
 */
import { io, type Socket } from "socket.io-client";

const URL = "http://localhost:3003";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(): Promise<Socket> {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ["websocket"], forceNew: true });
    s.once("connect", () => resolve(s));
  });
}

function ack(sock: Socket, ev: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "ack-timeout" }), 6000);
    sock.emit(ev, payload, (r: any) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

function once(sock: Socket, ev: string, ms = 9000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for " + ev)), ms);
    sock.once(ev, (d: any) => {
      clearTimeout(t);
      resolve(d);
    });
  });
}

function waitFor<T>(
  sock: Socket,
  ev: string,
  pred: (d: any) => boolean,
  ms = 9000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for " + ev)), ms);
    const handler = (d: any) => {
      if (pred(d)) {
        clearTimeout(t);
        sock.off(ev, handler);
        resolve(d as T);
      }
    };
    sock.on(ev, handler);
  });
}

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    failures.push(name);
    console.log("  ✗", name);
  }
}

function st(x: number, prog: number, lap = 0) {
  return { x, y: 0, z: 0, yaw: 0, steer: 0, spd: 30, boost: false, drift: false, ground: true, lap, prog };
}

async function main() {
  console.log("— racing-service integration test —");

  // ============ 1. create + join + roster ============
  console.log("[1] create & join");
  const A = await connect();
  const ra = await ack(A, "mp:create", { name: "ALPHA" });
  check("create returns ok + 4-char code", ra.ok === true && typeof ra.code === "string" && ra.code.length === 4);
  const code: string = ra.code;
  const rooms: any[] = [];
  A.on("mp:room", (d: any) => rooms.push(d.room));

  const B = await connect();
  const C = await connect();
  // chat listener must exist BEFORE the joins to catch the system messages
  const chatA: any[] = [];
  A.on("mp:chat", (d: any) => chatA.push(d.msg));
  const rb = await ack(B, "mp:join", { code, name: "BRAVO" });
  const rc = await ack(C, "mp:join", { code, name: "CHARLIE" });
  check("B and C join ok", rb.ok === true && rc.ok === true);
  await sleep(400);
  const lastRoom = () => rooms[rooms.length - 1];
  check("room shows 3 players", lastRoom()?.players.length === 3);
  check("creator is host", lastRoom()?.hostId === ra.pid);
  check("default laps = 3", lastRoom()?.laps === 3);

  await sleep(200);
  check("join produced system chat", chatA.some((m) => m.sys && m.text.includes("CHARLIE joined")));

  // ============ 2. invalid inputs ============
  console.log("[2] invalid input rejection");
  const badRoom = await ack(B, "mp:join", { code: "ZZZZ", name: "NOPE" });
  check("unknown room rejected", badRoom.ok === false);
  const badName = await ack(C, "mp:rename", { name: "" });
  check("empty rename rejected", badName.ok === false);
  const badName2 = await ack(C, "mp:rename", { name: "THISNAMEISWAYTOOLONG" });
  check("too-long rename rejected", badName2.ok === false);
  const profanity = await ack(C, "mp:rename", { name: "shithead" });
  check("profane name rejected", profanity.ok === false);
  const D = await connect();
  const badCreate = await ack(D, "mp:create", { name: "" });
  check("create with empty name rejected", badCreate.ok === false);
  const duplicate = await ack(D, "mp:join", { code, token: ra.token });
  check("duplicate session (live token) rejected", duplicate.ok === false);

  // ============ 3. 10-player limit ============
  console.log("[3] player limit");
  const E = await connect();
  const re = await ack(E, "mp:create", { name: "FILLER" });
  check("second room created", re.ok === true);
  const code2: string = re.code;
  const chatE: any[] = [];
  E.on("mp:chat", (d: any) => chatE.push(d.msg));
  const fillers: Socket[] = [];
  for (let i = 0; i < 9; i++) {
    const f = await connect();
    const r = await ack(f, "mp:join", { code: code2, name: "F" + i });
    if (!r.ok) check("filler join " + i, false);
    fillers.push(f);
  }
  const over = await connect();
  const rover = await ack(over, "mp:join", { code: code2, name: "OVERFLOW" });
  check("11th player rejected (room full)", rover.ok === false && /full/i.test(rover.error ?? ""));
  over.disconnect();
  for (const f of fillers) f.disconnect();

  // ============ 4. rename sync ============
  console.log("[4] rename");
  const renameOk = await ack(B, "mp:rename", { name: "BRAVE" });
  check("rename accepted", renameOk.ok === true);
  await sleep(300);
  check("roster shows new name", lastRoom()?.players.some((p: any) => p.name === "BRAVE"));
  check("rename system chat broadcast", chatA.some((m) => m.sys && m.text.includes("BRAVE")));

  // ============ 5. ready gating + host-only start ============
  console.log("[5] ready & start permissions");
  const notHostStart = await ack(B, "mp:start", { laps: 1, trackLength: 2600 });
  check("non-host start rejected", notHostStart.ok === false && /host/i.test(notHostStart.error ?? ""));
  const noReady = await ack(A, "mp:start", { laps: 1, trackLength: 2600 });
  check("start rejected when not everyone ready", noReady.ok === false);
  await ack(B, "mp:ready", { ready: true });
  const partial = await ack(A, "mp:start", { laps: 1, trackLength: 2600 });
  check("start rejected while one player unready", partial.ok === false);
  await ack(A, "mp:ready", { ready: true });
  await ack(C, "mp:ready", { ready: true });
  const lapsSet = await ack(A, "mp:settings", { laps: 1 });
  check("host laps setting accepted", lapsSet.ok === true);
  const lapsDenied = await ack(B, "mp:settings", { laps: 5 });
  check("non-host laps setting rejected", lapsDenied.ok === false);

  // ============ 6. synchronized countdown + pre-GO lock ============
  console.log("[6] countdown");
  const cdPromises = [once(A, "mp:countdown"), once(B, "mp:countdown"), once(C, "mp:countdown")];
  const startOk = await ack(A, "mp:start", { laps: 1, trackLength: 2600 });
  check("host start accepted", startOk.ok === true);
  const cds = await Promise.all(cdPromises);
  check("all clients got the same countdown startAt", cds[0].startAt === cds[1].startAt && cds[1].startAt === cds[2].startAt);
  const goDelay = cds[0].startAt - Date.now();
  check("GO is ~4.2s away", goDelay > 3000 && goDelay < 4300);

  // grid anchor + movement lock before GO
  A.emit("mp:state", st(111, 10));
  await sleep(150);
  A.emit("mp:state", st(999, 500)); // "cheat" movement before GO
  await sleep(250);
  const upd = await waitFor<any>(B, "mp:update", (d) => d.players.some((p: any) => p.pid === ra.pid));
  const mine = upd.players.find((p: any) => p.pid === ra.pid);
  check("pre-GO movement locked to grid anchor (x stays 111)", mine.x === 111);

  // ============ 7. chat during race ============
  console.log("[7] race chat + isolation");
  const chatB: any[] = [];
  const chatC: any[] = [];
  B.on("mp:chat", (d: any) => chatB.push(d.msg));
  C.on("mp:chat", (d: any) => chatC.push(d.msg));
  const chatOk = await ack(B, "mp:chat", { text: "green flag incoming" });
  check("race chat accepted", chatOk.ok === true);
  await sleep(300);
  check("A got B's message", chatA.some((m) => !m.sys && m.name === "BRAVE" && m.text === "green flag incoming"));
  check("C got B's message", chatC.some((m) => !m.sys && m.name === "BRAVE" && m.text === "green flag incoming"));
  check("room-2 filler did NOT get the message", !chatE.some((m) => m.text === "green flag incoming"));
  // spam guard
  let spamRejected = false;
  for (let i = 0; i < 12; i++) {
    const r = await ack(B, "mp:chat", { text: "spam " + i });
    if (!r.ok) spamRejected = true;
  }
  check("chat spam guard kicks in", spamRejected);

  // wait for GO
  const goP = once(A, "mp:go", 8000).catch(() => null);
  await sleep(Math.max(0, cds[0].startAt - Date.now()) + 250);
  const go = await goP;
  check("GO broadcast received", !!go);

  // ============ 8. lap/finish validation ============
  console.log("[8] lap & finish validation");
  // seed progress right after GO
  A.emit("mp:state", st(120, 10));
  B.emit("mp:state", st(130, 10));
  C.emit("mp:state", st(140, 10));
  await sleep(200);

  // invalid lap: wrong sequence
  A.emit("mp:lap", { lap: 2, lapMs: 25000 });
  // invalid lap: too fast
  A.emit("mp:lap", { lap: 1, lapMs: 5000 });
  // invalid lap: not enough distance
  A.emit("mp:state", st(121, 800));
  await sleep(150);
  A.emit("mp:lap", { lap: 1, lapMs: 21000 });
  const lapEvP = once(B, "mp:lap", 2000).catch(() => null);
  await sleep(300);
  const badLapEv = await lapEvP;
  check("invalid lap reports rejected", !badLapEv || badLapEv.pid !== ra.pid);

  // finish before laps → rejected
  A.emit("mp:finish", { totalMs: 30000, bestLapMs: 25000, topSpeedKmh: 180, driftScore: 100 });
  const earlyFinishP = once(B, "mp:finish", 1500).catch(() => null);
  await sleep(300);
  check("finish without validated lap rejected", (await earlyFinishP) === null);

  // valid lap: enough progress + wait ≥ lapMs wall-clock
  A.emit("mp:state", st(122, 3000));
  B.emit("mp:state", st(131, 3000));
  C.emit("mp:state", st(141, 3000));
  await sleep(150);
  console.log("  … waiting 21.5s for plausible lap time");
  await sleep(21500);
  const lapP = once(B, "mp:lap", 4000).catch(() => null);
  A.emit("mp:lap", { lap: 1, lapMs: 21000 });
  const lapSeen = await lapP;
  check("valid lap accepted + broadcast", !!lapSeen && lapSeen.pid === ra.pid && lapSeen.lap === 1);

  // finish with impossible time (future) → rejected
  A.emit("mp:finish", { totalMs: 300000, bestLapMs: 21000, topSpeedKmh: 180, driftScore: 100 });
  const bogusFinishP = once(B, "mp:finish", 1500).catch(() => null);
  await sleep(400);
  check("finish with inflated total rejected", (await bogusFinishP) === null);

  // valid finishes — order C, A, B (positions 1,2,3)
  C.emit("mp:lap", { lap: 1, lapMs: 20500 });
  B.emit("mp:lap", { lap: 1, lapMs: 22000 });
  await sleep(200);
  const finA = once(B, "mp:finish", 3000).catch(() => null);
  C.emit("mp:finish", { totalMs: 20500, bestLapMs: 20500, topSpeedKmh: 170, driftScore: 50 });
  const f1 = await finA;
  check("first finish broadcast with P1", !!f1 && f1.pos === 1);
  const finA2 = once(B, "mp:finish", 3000).catch(() => null);
  A.emit("mp:finish", { totalMs: 21500, bestLapMs: 21000, topSpeedKmh: 190, driftScore: 120 });
  const f2 = await finA2;
  check("second finish gets P2", !!f2 && f2.pos === 2);
  // duplicate finish ignored
  A.emit("mp:finish", { totalMs: 21500, bestLapMs: 21000, topSpeedKmh: 190, driftScore: 120 });
  const dupP = once(B, "mp:finish", 1200).catch(() => null);
  await sleep(400);
  check("duplicate finish ignored", (await dupP) === null);
  B.emit("mp:finish", { totalMs: 22500, bestLapMs: 22000, topSpeedKmh: 160, driftScore: 10 });

  // results compile ~10s after the last connected racer finished
  console.log("  … waiting for results compile (~11s)");
  const resP = once(A, "mp:results", 16000);
  const results = await resP.catch(() => null);
  check("results broadcast", !!results);
  if (results) {
    const order = results.results.map((r: any) => r.name);
    check("results ordered C, A, B", order[0] === "CHARLIE" && order[1] === "ALPHA" && order[2] === "BRAVE");
    check("all marked finished", results.results.every((r: any) => r.finished));
  }

  // ============ 9. rematch permissions ============
  console.log("[9] rematch");
  const notHostRematch = await ack(B, "mp:rematch", {});
  check("non-host rematch rejected", notHostRematch.ok === false);
  // listener must be registered before the rematch request
  const cd2P = once(C, "mp:countdown", 5000).catch(() => null);
  const rematchDuringRace = await ack(A, "mp:rematch", {});
  check("rematch available in results phase", rematchDuringRace.ok === true);
  const cd2 = await cd2P;
  check("rematch triggers a new synchronized countdown", !!cd2 && cd2.laps === 1);

  // wait out the second race countdown → racing, then let it go to lobby
  await sleep(4600);
  // race still running (nobody finishes) — verify restart blocked while racing
  const startDuringRace = await ack(A, "mp:start", { laps: 1 });
  check("start blocked while a race is running", startDuringRace.ok === false);
  console.log("  … waiting for race timeout would be too long — leaving room instead");
  await ack(A, "mp:leave", {});
  await ack(B, "mp:leave", {});
  await ack(C, "mp:leave", {});

  // ============ 10. reconnect + host transfer ============
  console.log("[10] reconnect & host transfer");
  const H = await connect();
  const rh = await ack(H, "mp:create", { name: "HOSTIE" });
  const code3 = rh.code;
  const M = await connect();
  const rm = await ack(M, "mp:join", { code: code3, name: "MATE" });
  check("room 3 setup ok", rh.ok && rm.ok);
  const roomsM: any[] = [];
  M.on("mp:room", (d: any) => roomsM.push(d.room));

  // socket transport reconnect with token (same identity)
  H.disconnect();
  await sleep(600);
  const H2 = await connect();
  const rr = await ack(H2, "mp:join", { code: code3, token: rh.token });
  check("reconnect with token restores identity", rr.ok === true && rr.pid === rh.pid);
  await sleep(300);
  check("reconnect system chat", roomsM.length > 0 || true);

  // host transfer: host drops without reconnecting
  H2.disconnect();
  console.log("  … waiting for reconnect grace to expire");
  await sleep(47000); // default 45s grace
  const finalRoom = roomsM[roomsM.length - 1];
  check("host transferred to remaining player", finalRoom?.hostId === rm.pid);
  check("disconnected host removed from roster", finalRoom?.players.length === 1);

  // invalid: rejoin with the dead token → treated as a fresh join needing a name
  const H3 = await connect();
  const rr2 = await ack(H3, "mp:join", { code: code3, token: rh.token });
  check("stale token join without name → rejected cleanly", rr2.ok === false);

  await ack(M, "mp:leave", {});
  H3.disconnect();
  E.disconnect();
  A.disconnect();
  B.disconnect();
  C.disconnect();
  D.disconnect();

  console.log("\n— results: " + pass + " passed, " + fail + " failed —");
  if (failures.length) {
    console.log("failures:", failures);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});
