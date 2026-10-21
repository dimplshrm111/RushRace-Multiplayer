# Worklog — Canyon Rush (3D Arcade Stunt Racer)

Project: A 3D arcade stunt-racing game in a sunlit canyon, built with Next.js 16 + Three.js (client-side game), procedural Web Audio soundtrack/SFX, Prisma local records leaderboard.

Main route: `/` (src/app/page.tsx) — game shell. API: `/api/records` for leaderboard.

Art direction: warm desert palette (terracotta/amber/cream/teal accents), flat-shaded low-poly, golden-hour sun, long shadows, heat haze. NO blue/indigo primary colors.

Game name: **CANYON RUSH** — track "Sunstone Circuit".

Task breakdown:
- Task 1-a (subagent): concept art via image-generation skill → public/concept/
- Task 2-6 (main agent): engine foundation, track, car/physics/camera/particles, race logic, UI
- Task 7 (subagent candidate): records API + leaderboard
- Task 8-10: lint, browser self-playtest, polish
---
Task ID: 1-a
Agent: general-purpose (concept art)
Task: Generate concept art reference images via image-generation skill

Work Log:
- Read worklog.md for project context (CANYON RUSH, warm terracotta/amber/cream desert palette, low-poly flat-shaded style).
- Invoked image-generation skill; reviewed CLI usage (z-ai image -p ... -o ... -s ...).
- Created directory /home/z/my-project/public/concept/ (mkdir -p).
- Generated Image 1 (title key art: burnt-orange buggy drifting through sunlit red-rock canyon with stone arch) — first attempt at 1440x720 failed: API rejects sizes whose dimensions are not multiples of 32 (720 is not); CLI also restricts sizes to a fixed list. Retried at 1344x768 (largest landscape size that satisfies both CLI list and API constraints) — success.
- Generated Image 2 (buggy concept design sheet: burnt-orange body, cream stripes, knobby tires, roll cage, three-quarter view on sand with mesas) at 1344x768 — success on first attempt.
- Verified both files: CLI emitted JPEG-encoded data despite .png extension; converted both to true PNG format (RGB, 1344x768) via Pillow to match the .png extension. Confirmed with `file` (PNG image data, 1344x768, 8-bit/color RGB, non-interlaced) and non-trivial sizes (>50KB each).

Stage Summary:
- /home/z/my-project/public/concept/title-canyon.png — 1344x768 PNG, 1,378,995 bytes (~1.38 MB) — hero/key art for title screen art direction.
- /home/z/my-project/public/concept/car-buggy.png — 1344x768 PNG, 849,453 bytes (~849 KB) — buggy design reference for the player vehicle.
- Decision: 1440x720 is not usable (API requires both dimensions to be multiples of 32; CLI whitelist excludes other custom sizes), so both images use 1344x768 — the largest working landscape size.
- Decision: transcoded CLI output (JPEG) to genuine PNG so file content matches the .png extension; original prompts were fully original, no copyrighted/branded content.
- Next: Tasks 2-6 can reference these images for palette (terracotta/amber/cream/teal) and vehicle/environment shape language.
---
Task ID: 7
Agent: full-stack-developer
Task: Records API + Prisma leaderboard

Work Log:
- Read worklog.md, prisma/schema.prisma, src/lib/db.ts; confirmed datasource config (SQLite, env DATABASE_URL=file:/home/z/my-project/db/custom.db) and that src/lib/db.ts exports `db` (PrismaClient singleton).
- Appended `RaceRecord` model to prisma/schema.prisma — kept existing User/Post models untouched. Model: id (Int, autoincrement), racerName (String, default "RACER"), laps/timeMs/bestLapMs/topSpeedKmh/driftScore (Int), createdAt (DateTime, default now()).
- Ran `bun run db:push` — schema synced to db/custom.db; Prisma Client v6.19.2 regenerated.
- Created src/app/api/records/route.ts as Next.js App Router route handlers (no server actions), `export const dynamic = "force-dynamic"`, `Cache-Control: no-store` on GET.
- GET: query param `laps` (integer 1..5, default 3, invalid → 400) → `{ records }`, top 8 for that lap count ordered by timeMs ASC.
- POST: JSON body validation — laps integer 1..5; timeMs/bestLapMs integers 10000..3600000; topSpeedKmh finite number 0..500; driftScore finite number >= 0; racerName optional string ≤ 24 chars (trimmed, empty/null/undefined → "RACER"). topSpeedKmh/driftScore floats rounded to Int columns. Valid → insert + 201 `{ ok: true, record }`; invalid → 400 `{ ok: false, error }`.
- Curl-tested against running dev server (port 3000): the two required payloads from the task spec (POST 201, GET 200), 10 bulk inserts to verify top-8 cutoff + ASC ordering (slowest 3 of 13 excluded), boundary values (laps 1 & 5, timeMs 3600000, bestLapMs 10000, driftScore 0 → 201), float rounding (199.6 → 200), name trimming ("  Edge Case  " → "Edge Case"), custom name ("DUST DEVIL"), and 6 invalid cases (laps 6, timeMs 5000, topSpeedKmh 501, missing driftScore, 25-char name, malformed JSON → all 400 with descriptive errors). GET ?laps=9 → 400; GET without param → 200 (defaults to 3).
- `bun run lint`: 0 errors (2 pre-existing warnings in src/components/game/GameShell.tsx — not my file, untouched). dev.log clean — all requests returned expected 200/201/400, Prisma SQL confirms `WHERE laps = ? ORDER BY timeMs ASC LIMIT 8`.
- Left the existing /api route (src/app/api/route.ts) and everything else in src/app untouched. /agent-ctx is not writable in this sandbox (permission denied at root) — work record appended here per task instruction.

Stage Summary:
- Live endpoints (dev server, port 3000, relative path only):
  - GET /api/records?laps={1..5} → 200 `{ records: RaceRecord[] }` (max 8, fastest first, no-store); missing laps defaults to 3, malformed laps → 400 `{ ok: false, error }`.
  - POST /api/records (Content-Type: application/json) → 201 `{ ok: true, record: RaceRecord }` | 400 `{ ok: false, error: string }`.
  - RaceRecord JSON: { id: number, racerName: string, laps: number, timeMs: number, bestLapMs: number, topSpeedKmh: number, driftScore: number, createdAt: ISO-8601 string }.
- All validation rules verified via curl (see Work Log); top-8 + timeMs ASC ordering verified with 11 rows in laps=3.
- DB currently holds 13 test rows (11 @ laps=3, 1 @ laps=1, 1 @ laps=5). Optional cleanup before ship: `sqlite3 /home/z/my-project/db/custom.db "DELETE FROM RaceRecord;"`.
- Frontend integration hint: POST the race result after finish, then GET (or invalidate a TanStack Query keyed on ['records', laps]) to refresh the leaderboard.
