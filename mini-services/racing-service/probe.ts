import { io } from "socket.io-client";
const code = process.argv[2].toUpperCase();
const sock = io("http://localhost:3003", { transports: ["websocket"], forceNew: true });
let updates = 0;
sock.on("connect", async () => {
  sock.emit("mp:join", { code, name: "PROBE" }, (r: any) => {
    console.log("join:", JSON.stringify(r).slice(0, 120));
    if (!r.ok) process.exit(1);
  });
});
sock.on("mp:room", (d: any) => {
  console.log("room phase:", d.room.phase, "players:", d.room.players.map((p: any) => `${p.name}:${p.racing ? "R" : "S"}:${p.connected ? "C" : "D"}`).join(" "));
});
sock.on("mp:update", (d: any) => {
  if (updates < 3) {
    updates++;
    console.log("update:", JSON.stringify(d.players.map((p: any) => ({ pid: p.pid, x: p.x, z: p.z, spd: p.spd }))));
  }
});
setTimeout(() => { console.log("done, updates seen:", updates); process.exit(0); }, 5000);
