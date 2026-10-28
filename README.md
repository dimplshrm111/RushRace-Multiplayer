# CANYON RUSH — Sunlit Canyon Stunt Racing

An original 3D arcade stunt racer built with Next.js 16, Three.js, WebGL, Tailwind CSS, and a real-time Socket.IO multiplayer backend.

## Quick Start (Development)

Install Bun (required by the multiplayer service) and install dependencies for both services:

```bash
bun install
(cd mini-services/racing-service && bun install)
cp .env.example .env # if .env does not already exist
bun run db:push
bun run dev # or npm run dev after installing dependencies
```

- **Game Client**: [http://localhost:3000](http://localhost:3000)
- **Multiplayer Socket**: `http://localhost:3003`

---

## Production Deployment

Detailed instructions for building, running in production, PM2 process management, and Nginx/Caddy SSL reverse proxy configuration are documented in:

📄 **[DEPLOYMENT.md](./DEPLOYMENT.md)**

```bash
# Production quick run:
bun run build
bun run start
```

---

## Features

- **Two circuits**: Sunstone Canyon and the longer Neon Harbor city circuit. Neon Harbor includes marked police barricades and parked police motorcycles to avoid. Select a track on the title screen; the multiplayer host selects the track in the lobby.
- **Hard-mode traffic**: Neon Harbor adds four more police bikes in solo Hard races. Multiplayer uses the shared normal obstacle layout for all drivers.
- **Motorcycle impacts**: Parked bikes tip and slide when struck. The car loses speed according to the closing speed and keeps moving; bikes reset after a short interval.
- **Streamed city districts**: Nearby buildings and street furniture use shared, instanced geometry. A fixed pool of districts is recycled as the player moves, keeping allocation and GPU buffer churn low. The road and its collision data stay loaded for consistent driving and recovery.
- **PWA Installation**: Install as an edge-to-edge standalone app without browser navigation bars.
- **Dedicated Mobile Controls**: Ergonomic landscape touch controls with Nitro positioned above steering and top-right rear-view camera.
- **Real-Time Multiplayer**: Up to 10 players per room, authoritative countdown, live position synchronization, and in-game chat.
- **Zero-Latency Telemetry**: 60 FPS direct DOM updates for speedometer, boost, nitro, minimap blips, and split times.

Race physics run on players' devices. Multiplayer results receive plausibility checks, but are not cheat-proof. Shared records are casual, client-submitted scores, not a verified competitive leaderboard.
Neon Harbor personal bests and ghosts are stored separately on the device; the extended circuit uses a new record set so its times are not compared with the shorter original city route. The existing shared leaderboard contains Sunstone Canyon records only.

Run `npm test`, `npm run lint`, and `npm run typecheck` to check the multiplayer service and source. The integration test requires Bun.
