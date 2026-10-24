/**
 * Car-selection protocol tests (garage / mp:car).
 * Run: bun run test-cars.ts
 */
import { io, type Socket } from "socket.io-client";

const URL = "http://localhost:3003";
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

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

async function main() {
  const host = io(URL, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res) => host.on("connect", res));

  console.log("[cars] defaults + validation");
  const cr = await ack(host, "mp:create", { name: "CARHOST" });
  check("room created", cr.ok, cr);
  const code = cr.code as string;
  let room: any = null;
  host.on("mp:room", (d: any) => {
    room = d.room;
  });
  await sleep(300);
  check("default car is himalaya", room?.players?.[0]?.car === "himalaya", room?.players?.[0]);
  check("default colour is 0", room?.players?.[0]?.carColor === 0);

  // invalid models rejected
  const bad1 = await ack(host, "mp:car", { model: "porsche911", color: 0 });
  check("unknown model rejected", !bad1.ok, bad1);
  const bad2 = await ack(host, "mp:car", { model: "", color: 0 });
  check("empty model rejected", !bad2.ok, bad2);
  const bad3 = await ack(host, "mp:car", { model: "BISON", color: 99 });
  check("out-of-range colour rejected", !bad3.ok, bad3);
  const bad4 = await ack(host, "mp:car", { model: "bison", color: -1 });
  check("negative colour rejected", !bad4.ok, bad4);
  const bad5 = await ack(host, "mp:car", { model: 42, color: 0 });
  check("non-string model rejected", !bad5.ok, bad5);
  await sleep(200);
  check("car unchanged after rejects", room?.players?.[0]?.car === "himalaya");

  // valid change — all five models
  for (const m of ["himalaya", "bison", "falcon", "sultan", "cub"]) {
    const r = await ack(host, "mp:car", { model: m, color: 1 });
    check(`set ${m} ok`, r.ok, r);
    await sleep(150);
    check(`roster shows ${m}`, room?.players?.[0]?.car === m, room?.players?.[0]?.car);
  }
  // case-insensitivity (client may send title-case)
  const ci = await ack(host, "mp:car", { model: "  CuB  ", color: 2 });
  check("case-insensitive + trimmed model", ci.ok && (await sleep(150), room?.players?.[0]?.car === "cub"));

  console.log("[cars] multiplayer visibility");
  const guest = io(URL, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res) => guest.on("connect", res));
  await ack(host, "mp:car", { model: "falcon", color: 0 });
  const gj = await ack(guest, "mp:join", { code, name: "CARGUEST" });
  check("guest joined", gj.ok, gj);
  await ack(guest, "mp:car", { model: "jimny", color: 0 }); // invalid — stays default
  await ack(guest, "mp:car", { model: "cub", color: 0 });
  await sleep(300);
  const hostView = room?.players?.find((p: any) => p.id === gj.pid);
  check("host sees guest's cub", hostView?.car === "cub", hostView);
  check("host sees own falcon", room?.players?.[0]?.car === "falcon");

  console.log("[cars] not in a room");
  const lone = io(URL, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res) => lone.on("connect", res));
  const nr = await ack(lone, "mp:car", { model: "bison", color: 0 });
  check("car change outside a room rejected", !nr.ok, nr);

  console.log(`\n— results: ${passed} passed, ${failed} failed —`);
  host.disconnect();
  guest.disconnect();
  lone.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("test crash:", e);
  process.exit(1);
});
