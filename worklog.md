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
---
Task ID: 11
Agent: main agent (Z.ai Code)
Task: Fix user-reported issues — inverted arrow-key steering, wavy graphics, missing competitor cars (plus critical gaps found during verification)

Work Log:
- Diagnosed steering inversion mathematically: physics convention forward=(sin yaw,0,cos yaw), right=(−cos yaw,0,sin yaw) means POSITIVE yaw rate turns the nose toward the car's LEFT; steer=+1 (RIGHT key) produced positive yawRate → car turned LEFT. Fixed by negating steer→yawRate, drift-traction kick (vlat −= steer·2.2), autopilot steer sign, front-wheel visual steer sign, and camera banking roll sign.
- Removed the heat-haze post-process entirely (engine buildHaze/RT/quad, settings toggle, DEFAULT_SETTINGS.heatHaze): its full-screen 110-cycle sine UV warp was the "wavy" graphics, and the intermediate HalfFloat render target killed MSAA + broke the tone-mapped sRGB output chain. Renderer now draws directly to canvas.
- Added 3 AI rival cars (src/game/ai.ts): Opponent class wrapping CarPhysics + CarVisual + canvas-sprite name labels (VIPER green, MESA red, HAWK teal), opponentInput() brain with correct steer sign, per-skill corner speeds, preferred racing-line offsets, occasional mistakes, mild rubber-banding (±5.5% at 200 m), boost on straights, respawn recovery.
- CarVisual extended with body/accent/dark color overrides; CarPhysics gained isPlayer flag (near-miss accounting only for the player).
- Engine integration: 2×2 start grid (2 rivals front row, 1 alongside player at back — P4 start), opponents updated during racing/finished/title-cruise phases, soft sphere car-to-car collisions with crash sfx/trauma/rumble on player impacts, live standings (finished-by-time then track-position) pushed to store every 0.35 s, race clock keeps running after player finish so AI get exact finish times.
- HUD: POS chip beside LAP (gold when P1), rival blips + (previously never-rendered) player dot on the minimap using percent-based positioning (works at any CSS size); Results screen: VICTORY!/FINISH! title, P{n}/{total} badge, live RACE STANDINGS table; selftest JSON now reports rival standings.
- CRITICAL fix found during verification: checkGates' while-loop re-called completeLap() forever on the final lap because the finish branch never advanced nextGateAbs → infinite loop at every race finish (thousands of onFinish/fetch POSTs + tab freeze — 2,292 duplicate RaceRecord rows in the DB). Fixed by setting nextGateK = gates.length, nextGateAbs = Infinity after finish.
- Fixed particle Pool.spawn full-pool scan (O(n) per emit once saturated during deterministic stepping) — bounded to 16 tries then recycle cursor slot.
- Fixed CarPhysics.place() not syncing lastIdx (inconsistent −30/−60 m progressS offsets per car after teleports → wrong standings order); fixed PCFSoftShadowMap deprecation warning.
- Cleaned 2,292 junk RaceRecord rows (all from the finish-loop bug / test runs) → leaderboard fresh at 0.
- Verification (agent-browser + VLM screenshot analysis + deterministic eval pumping): arrow keys turn correct directions through the real DOM input path (right key → yaw −1.77 rad, left key → +1.32 rad); VLM confirms title/racing/results/countdown scenes render clean with no wavy artifacts; 4 cars on grid with name labels; full 1-lap race completes in 81.85 s with standings YOU 81.85 / VIPER 81.93 / MESA 85.10 / HAWK 87.11; pause menu, settings (heat-haze row removed), mobile landscape 844×390 layout all verified; `bun run lint` clean; dev.log clean.

Stage Summary:
- Steering: arrow keys + A/D now turn the correct way (verified end-to-end); wheel visuals and camera banking match.
- Graphics: wavy distortion gone; direct-to-canvas rendering keeps MSAA + ACES tone mapping; shadows use PCFShadowMap.
- Rivals: 3 AI opponents with identical performance, distinct paint/skill, name labels, minimap blips, live standings, results table; races are close (P2 gap 0.08 s in test race).
- Race flow: finish-line tab-freeze eliminated (root cause of duplicate leaderboard rows); race clock continues post-finish for exact AI times.
- Files touched: src/game/physics.ts, car.ts, engine.ts, ai.ts (new), particles.ts, types.ts, store.ts, HUD.tsx, Results.tsx, SettingsPanel.tsx, GameShell.tsx.
- Note for future agents: headless browser occlusion throttles rAF to ~5 fps and freezes long-running tabs — drive the engine deterministically via engine.debugStep() in eval chunks for race simulation tests.
