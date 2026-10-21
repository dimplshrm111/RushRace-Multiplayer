"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "@/game/store";
import { formatTime, type RaceRecord, type ResultsData, type StandingEntry } from "@/game/types";

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-lg border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.9)] px-3 py-2 text-center shadow">
      <div className="text-[9px] font-black tracking-[0.25em] text-[#8a6a4e]">{label}</div>
      <div className={`font-[family-name:var(--font-bungee)] leading-tight text-[#2b1c12] ${big ? "text-2xl" : "text-lg"}`}>{value}</div>
    </div>
  );
}

function StandingsRow({ entry }: { entry: StandingEntry }) {
  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1 text-xs font-bold ${
        entry.isPlayer ? "bg-[rgba(240,100,30,0.25)] text-[#fff6e6]" : "text-[#fff6e6]"
      }`}
    >
      <span className="w-4 text-right font-[family-name:var(--font-bungee)] text-[#ffb020]">{entry.pos}</span>
      <span className="h-3 w-3 shrink-0 rounded-full border border-[#fff6e6]" style={{ backgroundColor: entry.color }} />
      <span className="flex-1 truncate">{entry.name}</span>
      <span className="tabular-nums text-[11px]">
        {entry.timeMs != null ? formatTime(entry.timeMs) : <span className="text-[#c9a06a]">RACING…</span>}
      </span>
    </div>
  );
}

export function Results({ data, onRetry, onTitle }: { data: ResultsData; onRetry: () => void; onTitle: () => void }) {
  const [records, setRecords] = useState<RaceRecord[] | null>(null);
  const settings = useGameStore((s) => s.settings);
  const standings = useGameStore((s) => s.standings);

  useEffect(() => {
    let alive = true;
    fetch(`/api/records?laps=${data.laps}`)
      .then((r) => r.json())
      .then((d: { records?: RaceRecord[] }) => {
        if (alive) setRecords(d.records ?? []);
      })
      .catch(() => {
        if (alive) setRecords([]);
      });
    return () => {
      alive = false;
    };
  }, [data.laps]);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(43,28,18,0.55)] p-4 backdrop-blur-[2px]">
      <div className="result-anim my-auto w-full max-w-lg rounded-xl border-[3px] border-[#2b1c12] bg-gradient-to-b from-[#ffb020]/25 to-[#fff6e6] p-5 shadow-2xl">
        <div className="text-center">
          {data.isNewRecord && (
            <div className="mx-auto mb-2 inline-block -rotate-2 rounded bg-[#2f9e63] px-3 py-1 text-xs font-black tracking-[0.25em] text-[#fff6e6] shadow-lg">
              ★ NEW RECORD ★
            </div>
          )}
          <h2 className="font-[family-name:var(--font-bungee)] text-5xl leading-none text-[#f0641e] [text-shadow:0_3px_0_#2b1c12]">
            {data.position === 1 ? "VICTORY!" : "FINISH!"}
          </h2>
          <div className="mt-1 flex items-center justify-center gap-2 text-[10px] font-black tracking-[0.3em] text-[#8a6a4e]">
            <span
              className="inline-block rounded bg-[#2b1c12] px-2 py-0.5 font-[family-name:var(--font-bungee)] text-sm tracking-normal text-[#ffb020]"
              aria-label={`Finished position ${data.position} of ${data.totalCars}`}
            >
              P{data.position}/{data.totalCars}
            </span>
            <span>SUNSTONE CANYON · {data.laps} LAP{data.laps > 1 ? "S" : ""}</span>
          </div>
        </div>

        {/* live race standings */}
        <div className="mt-3 rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.82)] p-2 text-[#fff6e6]">
          <div className="mb-1 px-1 text-[10px] font-black tracking-[0.25em] text-[#ffb020]">RACE STANDINGS</div>
          <div className="flex flex-col gap-0.5">
            {(standings.length ? standings : []).map((e) => (
              <StandingsRow key={e.name} entry={e} />
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-3">
            <Stat label="TOTAL TIME" value={formatTime(data.totalMs)} big />
          </div>
          <Stat label="BEST LAP" value={formatTime(data.bestLapMs)} />
          <Stat label="TOP SPEED" value={`${data.topSpeedKmh} KM/H`} />
          <Stat label="DRIFT SCORE" value={String(data.driftScore)} />
          <Stat label="NEAR MISSES" value={String(data.nearMisses)} />
          <Stat label="BIG AIRS" value={String(data.bigAirCount)} />
          <Stat label="BEST SET" value={settings.laps === data.laps ? "THIS CLASS" : `${settings.laps}L`} />
        </div>

        <div className="mt-3 rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.82)] p-3 text-[#fff6e6]">
          <div className="mb-1 text-[10px] font-black tracking-[0.25em] text-[#ffb020]">CANYON RECORDS — {data.laps} LAPS</div>
          <div className="max-h-28 overflow-y-auto settings-scroll pr-1">
            {records == null ? (
              <div className="py-1 text-xs font-bold text-[#c9a06a]">LOADING…</div>
            ) : records.length === 0 ? (
              <div className="py-1 text-xs font-bold text-[#c9a06a]">NO RECORDS</div>
            ) : (
              records.slice(0, 5).map((r, i) => (
                <div key={r.id} className="flex items-baseline justify-between gap-2 py-0.5 text-xs font-bold">
                  <span className="text-[#ffb020]">{i + 1}.</span>
                  <span className="flex-1 truncate">{r.racerName}</span>
                  <span className="tabular-nums">{formatTime(r.timeMs)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="-skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#f0641e] px-6 py-3 font-[family-name:var(--font-bungee)] text-xl text-[#fff6e6] shadow-[0_5px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_3px_0_#2b1c12] active:translate-y-1 active:shadow-none"
          >
            <span className="block skew-x-6">RETRY</span>
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="-skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#fff6e6] px-6 py-3 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_5px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_3px_0_#2b1c12] active:translate-y-1 active:shadow-none"
          >
            <span className="block skew-x-6">TITLE</span>
          </button>
        </div>
      </div>
    </div>
  );
}
