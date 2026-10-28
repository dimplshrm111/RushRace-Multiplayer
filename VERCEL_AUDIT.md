# RushRace — Vercel audit

## Changes in this commit

- Deploy Next.js and the racing Socket.IO service together using the existing Vercel Services configuration.
- Replace the incompatible SQLite Prisma datasource with PostgreSQL and add a non-destructive baseline migration. The production Vercel build runs Prisma generate + migrate deploy.
- Remove the redundant root Socket.IO server dependency and obsolete root api/racing.ts Function.
- Wait for an active Socket.IO connection before issuing create/join commands, and use Socket.IO acknowledgement timeouts rather than letting commands queue beyond a client-side deadline.
- Include authoritative room snapshots in create/join ACKs so the client enters the lobby without needing to refresh.
- Expose GET /api/racing/health with per-instance diagnostic metadata; log room lookup misses with instance IDs.

## Unresolved deployment architecture requirement

The racing engine still keeps rooms, countdowns, live state and timers in a process-local Map. **Vercel WebSocket Functions can recycle at their max duration and have no sticky routing for new connections.** A shared transactionally coordinated room-state store, cross-instance Socket.IO broadcasts, ownership/leader election and recovery tests are required for reliable multiplayer across Function instances. A Redis/Postgres Socket.IO adapter alone does not make room state durable. The health response deliberately reports durableRooms:false.

## Verification

Test the production /api/records endpoint, /api/racing/health, two-player room joining, race start and network updates, and reconnect across deployments. Use distinct preview and production PostgreSQL databases before preview builds run migrations. No secrets belong in Git.
