import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Validation bounds for race record submissions.
const MIN_LAPS = 1;
const MAX_LAPS = 5;
const MIN_TIME_MS = 10_000;
const MAX_TIME_MS = 3_600_000; // 1 hour
const MAX_TOP_SPEED_KMH = 500;
const MAX_NAME_LENGTH = 24;
const DEFAULT_RACER_NAME = "RACER";
const LEADERBOARD_SIZE = 8;

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/**
 * GET /api/records?laps=3
 * Returns the top 8 records for the given lap count, fastest first.
 */
export async function GET(request: NextRequest) {
  const lapsParam = request.nextUrl.searchParams.get("laps");

  let laps = 3;
  if (lapsParam !== null && lapsParam !== "") {
    const parsed = Number(lapsParam);
    if (!isIntInRange(parsed, MIN_LAPS, MAX_LAPS)) {
      return badRequest(
        `Query param 'laps' must be an integer between ${MIN_LAPS} and ${MAX_LAPS}.`
      );
    }
    laps = parsed;
  }

  const records = await db.raceRecord.findMany({
    where: { laps },
    orderBy: { timeMs: "asc" },
    take: LEADERBOARD_SIZE,
  });

  return NextResponse.json(
    { records },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * POST /api/records
 * Body: { racerName?: string, laps: number, timeMs: number, bestLapMs: number,
 *         topSpeedKmh: number, driftScore: number }
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;

  if (!isIntInRange(input.laps, MIN_LAPS, MAX_LAPS)) {
    return badRequest(
      `'laps' must be an integer between ${MIN_LAPS} and ${MAX_LAPS}.`
    );
  }
  const laps = input.laps as number;

  if (!isIntInRange(input.timeMs, MIN_TIME_MS * laps, MAX_TIME_MS)) {
    return badRequest(
      `'timeMs' must be an integer between ${MIN_TIME_MS} and ${MAX_TIME_MS}.`
    );
  }
  const timeMs = input.timeMs as number;

  if (!isIntInRange(input.bestLapMs, MIN_TIME_MS, MAX_TIME_MS)) {
    return badRequest(
      `'bestLapMs' must be an integer between ${MIN_TIME_MS} and ${MAX_TIME_MS}.`
    );
  }
  const bestLapMs = input.bestLapMs as number;
  if (bestLapMs * laps > timeMs + laps) {
    return badRequest("'bestLapMs' is inconsistent with the total time.");
  }

  if (
    typeof input.topSpeedKmh !== "number" ||
    !Number.isFinite(input.topSpeedKmh) ||
    input.topSpeedKmh < 0 ||
    input.topSpeedKmh > MAX_TOP_SPEED_KMH
  ) {
    return badRequest(
      `'topSpeedKmh' must be a number between 0 and ${MAX_TOP_SPEED_KMH}.`
    );
  }
  const topSpeedKmh = input.topSpeedKmh as number;

  if (
    typeof input.driftScore !== "number" ||
    !Number.isFinite(input.driftScore) ||
    input.driftScore < 0 || input.driftScore > 10_000_000
  ) {
    return badRequest("'driftScore' must be between 0 and 10000000.");
  }
  const driftScore = input.driftScore as number;

  let racerName = DEFAULT_RACER_NAME;
  if (input.racerName !== undefined && input.racerName !== null) {
    if (typeof input.racerName !== "string") {
      return badRequest("'racerName' must be a string.");
    }
    const trimmed = input.racerName.trim();
    if (trimmed.length > MAX_NAME_LENGTH) {
      return badRequest(
        `'racerName' must be at most ${MAX_NAME_LENGTH} characters.`
      );
    }
    racerName = trimmed.length > 0 ? trimmed : DEFAULT_RACER_NAME;
  }

  const record = await db.raceRecord.create({
    data: {
      racerName,
      laps,
      timeMs,
      bestLapMs,
      topSpeedKmh: Math.round(topSpeedKmh),
      driftScore: Math.round(driftScore),
    },
  });

  return NextResponse.json({ ok: true, record }, { status: 201 });
}
