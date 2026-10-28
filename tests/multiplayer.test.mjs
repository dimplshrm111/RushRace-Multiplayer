import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { io } from "socket.io-client";

const port = 33000 + Math.floor(Math.random() * 10000);
const url = `http://127.0.0.1:${port}`;

function connect() {
  return io(url, { transports: ["websocket"], reconnection: false, timeout: 1000 });
}

function request(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
  });
}

test("socket routing, hostile state, and reconnection during a race", { timeout: 15000 }, async (t) => {
  const server = spawn("bun", ["index.ts"], {
    cwd: "mini-services/racing-service",
    env: { ...process.env, RACING_PORT: String(port), RACING_GRACE_MS: "1000" },
    stdio: "ignore",
  });
  t.after(() => server.kill("SIGTERM"));
  let socket;
  t.after(() => socket?.disconnect());

  for (let i = 0; i < 30; i++) {
    socket = connect();
    try {
      await Promise.race([once(socket, "connect"), once(socket, "connect_error").then(() => { throw new Error("not ready"); })]);
      break;
    } catch {
      socket.disconnect();
      await delay(100);
    }
  }
  assert.ok(socket.connected, "racing service should accept the standard Socket.IO path");
  const created = await request(socket, "mp:create", { name: "Racer" });
  assert.equal(created.ok, true);
  const cityRoom = once(socket, "mp:room");
  assert.equal((await request(socket, "mp:settings", { map: "city" })).ok, true);
  assert.equal((await cityRoom)[0].room.map, "city");
  assert.equal((await request(socket, "mp:settings", { map: "unknown" })).ok, false);
  assert.equal((await request(socket, "mp:ready", { ready: true })).ok, true);
  const go = once(socket, "mp:go");
  assert.equal((await request(socket, "mp:start", { laps: 1, trackLength: 500 })).ok, true);
  await go;

  // The old repeated-subtraction normalizer never terminated for this value.
  socket.emit("mp:state", { yaw: 1e308, prog: 0 });
  const pong = once(socket, "mp:pong");
  socket.emit("mp:ping", { t0: Date.now() });
  await Promise.race([pong, delay(2000).then(() => { throw new Error("server blocked on state"); })]);

  socket.disconnect();
  await delay(100);
  socket = connect();
  await once(socket, "connect");
  const joined = await request(socket, "mp:join", { code: created.code, token: created.token });
  assert.equal(joined.ok, true);
  let ended = false;
  socket.on("mp:results", () => { ended = true; });
  await delay(1400);
  assert.equal(ended, false, "a reconnecting racer must cancel pending all-disconnected results");
});
