"use client";

import { useEffect, useRef, useState } from "react";
import type { GameEngine } from "@/game/engine";
import { useGameStore } from "@/game/store";
import { formatTime, type RaceRecord } from "@/game/types";
import { SettingsPanel } from "./SettingsPanel";

function useRecords(laps: number) {
  const [records, setRecords] = useState<RaceRecord[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/records?laps=${laps}`)
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
  }, [laps]);
  return records;
}

export function TitleScreen({
  onRace,
  onHowToPlay,
  engineRef,
}: {
  onRace: () => void;
  onHowToPlay: () => void;
  engineRef: React.RefObject<GameEngine | null>;
}) {
  const [tab, setTab] = useState<"main" | "settings" | "controls">("main");
  const settings = useGameStore((s) => s.settings);
  const bestTotalMs = useGameStore((s) => s.bestTotalMs);
  const bestLapMs = useGameStore((s) => s.bestLapMs);
  const records = useRecords(settings.laps);
  const [ready, setReady] = useState(false);

  // wait for the engine's title flythrough to have rendered at least one frame
  useEffect(() => {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (engineRef.current || tries > 120) {
        setReady(true);
        clearInterval(iv);
      }
    }, 100);
    return () => clearInterval(iv);
  }, [engineRef]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto">
      {/* backdrop: concept art + warm gradient */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/concept/title-canyon.png)" }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(43,28,18,0.25)] via-[rgba(43,28,18,0.45)] to-[rgba(43,28,18,0.82)]" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-4 py-6 sm:py-10">
        {/* logo */}
        <div className="mt-2 text-center sm:mt-6">
          <div className="font-[family-name:var(--font-bungee)] text-[13vw] leading-[0.95] tracking-tight text-[#ffb020] [text-shadow:0_4px_0_#2b1c12,0_10px_30px_rgba(0,0,0,0.45)] sm:text-7xl">
            CANYON
            <br />
            <span className="text-[#fff6e6]">RUSH</span>
          </div>
          <div className="mt-2 inline-block -rotate-1 rounded bg-[#f0641e] px-3 py-1 text-[11px] font-black tracking-[0.3em] text-[#fff6e6] shadow-lg sm:text-xs">
            SUNSTONE CANYON · STUNT RACING
          </div>
        </div>

        {tab === "main" && (
          <div className="mt-6 flex w-full max-w-3xl flex-1 flex-col items-center gap-5 sm:mt-10">
            <div className="flex w-full flex-col items-center gap-3">
              <button
                type="button"
                disabled={!ready}
                onClick={onRace}
                className="group relative w-72 -skew-x-6 rounded-lg border-[3px] border-[#2b1c12] bg-[#f0641e] px-8 py-4 font-[family-name:var(--font-bungee)] text-2xl text-[#fff6e6] shadow-[0_6px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_4px_0_#2b1c12] active:translate-y-1 active:shadow-none disabled:opacity-60 sm:w-80"
              >
                <span className="block skew-x-6">RACE</span>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 skew-x-6 rounded bg-[rgba(43,28,18,0.35)] px-1.5 py-0.5 text-[10px] tracking-widest">
                  {settings.laps} LAP{settings.laps > 1 ? "S" : ""}
                </span>
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onHowToPlay}
                  className="w-32 -skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#fff6e6] px-4 py-2 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
                >
                  <span className="block skew-x-6">HOW TO PLAY</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("settings")}
                  className="w-32 -skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#fff6e6] px-4 py-2 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
                >
                  <span className="block skew-x-6">SETTINGS</span>
                </button>
              </div>
            </div>

            {/* best + records */}
            <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.92)] p-3 shadow-lg">
                <div className="mb-1 text-[10px] font-black tracking-[0.25em] text-[#8a6a4e]">YOUR BEST ({settings.laps} LAPS)</div>
                <div className="font-[family-name:var(--font-bungee)] text-2xl text-[#2b1c12]">{formatTime(bestTotalMs)}</div>
                <div className="text-xs font-bold text-[#5a3c28]">BEST LAP <span className="tabular-nums">{formatTime(bestLapMs)}</span></div>
              </div>
              <div className="rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.82)] p-3 text-[#fff6e6] shadow-lg">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-black tracking-[0.25em] text-[#ffb020]">CANYON RECORDS</span>
                  <span className="text-[10px] font-bold text-[#c9a06a]">{settings.laps} LAPS</span>
                </div>
                <div className="max-h-28 overflow-y-auto settings-scroll pr-1">
                  {records == null ? (
                    <div className="py-2 text-xs font-bold text-[#c9a06a]">LOADING…</div>
                  ) : records.length === 0 ? (
                    <div className="py-2 text-xs font-bold text-[#c9a06a]">NO RECORDS YET — SET THE FIRST ONE!</div>
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
            </div>

            <p className="mb-2 max-w-md text-center text-[11px] font-semibold leading-relaxed text-[#f6e3c2]/90">
              Every car is equal — no upgrades, no advantages. Chains of drifts, near-misses,
              wall-rides and clean landings feed your boost. Master the line.
            </p>
          </div>
        )}

        {tab === "settings" && (
          <div className="mt-6 flex w-full max-w-lg flex-col gap-3">
            <SettingsPanel />
            <button
              type="button"
              onClick={() => setTab("main")}
              className="self-center rounded-md border-2 border-[#2b1c12] bg-[#ffb020] px-6 py-2 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
            >
              BACK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
