"use client";

import { useEffect, useRef } from "react";
import type { GameEngine } from "@/game/engine";
import { useGameStore } from "@/game/store";
import { DIFFICULTIES, formatDelta, formatTime, type Telemetry } from "@/game/types";

interface MinimapData {
  canvas: HTMLCanvasElement;
  scale: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export function HUD({
  engineRef,
  countdownActive,
}: {
  engineRef: React.RefObject<GameEngine | null>;
  countdownActive: boolean;
}) {
  const speedRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const boostRef = useRef<HTMLDivElement>(null);
  const boostLabelRef = useRef<HTMLSpanElement>(null);
  const driftRef = useRef<HTMLDivElement>(null);
  const lapRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const totalRef = useRef<HTMLDivElement>(null);
  const bestRef = useRef<HTMLDivElement>(null);
  const wrongRef = useRef<HTMLDivElement>(null);
  const cpRef = useRef<HTMLDivElement>(null);
  const cpDotRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapDataRef = useRef<MinimapData | null>(null);
  const carDotRef = useRef<HTMLDivElement>(null);
  const aiDotsRef = useRef<Array<HTMLDivElement | null>>([]);
  const posRef = useRef<HTMLSpanElement>(null);
  const posChipRef = useRef<HTMLDivElement>(null);

  const popups = useGameStore((s) => s.popups);
  const countdownValue = useGameStore((s) => s.countdownValue);
  const prunePopups = useGameStore((s) => s.prunePopups);
  const bestTotalMs = useGameStore((s) => s.bestTotalMs);
  const difficulty = useGameStore((s) => s.settings.difficulty);

  const goFlashRef = useRef<HTMLDivElement>(null);

  // prune old popups
  useEffect(() => {
    const iv = setInterval(() => prunePopups(Date.now()), 400);
    return () => clearInterval(iv);
  }, [prunePopups]);

  // GO! flash
  useEffect(() => {
    if (countdownValue === 0 && goFlashRef.current) {
      const el = goFlashRef.current;
      el.classList.remove("hidden");
      el.classList.remove("go-anim");
      void el.offsetWidth;
      el.classList.add("go-anim");
      const t = setTimeout(() => el.classList.add("hidden"), 950);
      return () => clearTimeout(t);
    }
  }, [countdownValue]);

  // telemetry via direct DOM updates (no react re-render)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let lastBestRender = -1;
    const unsub = engine.onTelemetry((t: Telemetry) => {
      if (speedRef.current) speedRef.current.textContent = String(Math.max(0, Math.round(t.speedKmh)));
      if (gearRef.current) gearRef.current.textContent = t.speedKmh < 1 ? "N" : String(t.gear);
      if (boostRef.current) {
        boostRef.current.style.width = `${t.boostMeter}%`;
        boostRef.current.style.background = t.boosting
          ? "linear-gradient(90deg,#ffd23f,#ff6a2a)"
          : t.boostMeter > 70
            ? "linear-gradient(90deg,#ffb020,#ff8a1f)"
            : "linear-gradient(90deg,#e8a04c,#d97a2e)";
      }
      if (boostLabelRef.current) boostLabelRef.current.textContent = t.boosting ? "BOOST!" : "BOOST";
      if (driftRef.current) {
        driftRef.current.style.opacity = t.drifting ? "1" : "0";
        const mult = driftRef.current.querySelector("b");
        if (mult) mult.textContent = `x${t.driftMult.toFixed(1)}`;
      }
      if (lapRef.current) lapRef.current.textContent = `${t.lap}/${t.totalLaps}`;
      if (posRef.current) posRef.current.textContent = `${t.position}/${t.totalCars}`;
      if (posChipRef.current) {
        posChipRef.current.style.background = t.position === 1 ? "#ffb020" : "rgba(43,28,18,0.72)";
        posChipRef.current.style.color = t.position === 1 ? "#2b1c12" : "#fff6e6";
      }
      if (timeRef.current) timeRef.current.textContent = formatTime(t.lapTimeMs);
      if (totalRef.current) totalRef.current.textContent = formatTime(t.raceTimeMs);
      if (bestRef.current && t.bestTotalMs !== lastBestRender) {
        lastBestRender = t.bestTotalMs ?? -1;
        bestRef.current.textContent = t.bestTotalMs != null ? formatTime(t.bestTotalMs) : "--:--.--";
      }
      if (wrongRef.current) {
        wrongRef.current.style.opacity = t.wrongWay ? "1" : "0";
      }
      if (cpRef.current && cpDotRef.current) {
        const d = Math.min(999, Math.round(t.nextCpDist));
        cpRef.current.textContent = `${d}m`;
        cpDotRef.current.style.left = `${Math.round(t.progressPct * 100)}%`;
      }
      // minimap car dot + rival blips (percent-based so it tracks the CSS size)
      const mm = minimapDataRef.current;
      if (mm && engine) {
        const p = engine.physics.pos;
        if (carDotRef.current) {
          carDotRef.current.style.left = `${((mm.ox + p.x * mm.scale) / mm.w) * 100}%`;
          carDotRef.current.style.top = `${((mm.oy + p.z * mm.scale) / mm.h) * 100}%`;
        }
        const dots = aiDotsRef.current;
        for (let i = 0; i < dots.length; i++) {
          const dot = dots[i];
          if (!dot) continue;
          const b = t.blips[i];
          if (!b) {
            dot.style.opacity = "0";
            continue;
          }
          dot.style.opacity = "1";
          dot.style.backgroundColor = b.color;
          dot.style.left = `${((mm.ox + b.x * mm.scale) / mm.w) * 100}%`;
          dot.style.top = `${((mm.oy + b.z * mm.scale) / mm.h) * 100}%`;
        }
      }
    });
    return unsub;
  }, [engineRef]);

  // build the minimap path once
  useEffect(() => {
    const engine = engineRef.current;
    const canvas = minimapRef.current;
    if (!engine || !canvas) return;
    const pts = engine.track.minimapPts;
    const gates = engine.track.gatePts;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.z); maxY = Math.max(maxY, p.z);
    }
    const W = canvas.width, H = canvas.height;
    const pad = 10;
    const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
    const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (H - (maxY - minY) * scale) / 2 - minY * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = ox + p.x * scale;
      const y = oy + p.z * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = "rgba(43,28,18,0.75)";
    ctx.lineWidth = 14;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,246,230,0.9)";
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = "rgba(240,100,30,0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    for (const g of gates) {
      ctx.beginPath();
      ctx.arc(ox + g.x * scale, oy + g.z * scale, g.finish ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = g.finish ? "#f0641e" : "#2b1c12";
      ctx.fill();
    }
    minimapDataRef.current = { canvas, scale, ox, oy, w: W, h: H };
  }, [engineRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-[family-name:var(--font-geist-sans)]">
      {/* top center: lap + position + times */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md bg-[rgba(43,28,18,0.72)] px-3 py-1 text-[#fff6e6] shadow-lg backdrop-blur-[2px]">
            <span className="text-[10px] font-bold tracking-[0.2em] text-[#ffb020]">LAP</span>
            <span ref={lapRef} className="font-[family-name:var(--font-bungee)] text-lg leading-none">1/3</span>
          </div>
          <div ref={posChipRef} className="flex items-center gap-2 rounded-md bg-[rgba(43,28,18,0.72)] px-3 py-1 text-[#fff6e6] shadow-lg backdrop-blur-[2px] transition-colors">
            <span className="text-[10px] font-bold tracking-[0.2em] text-[#ffb020]">POS</span>
            <span ref={posRef} className="font-[family-name:var(--font-bungee)] text-lg leading-none">4/4</span>
          </div>
          <div className="flex items-center rounded-md bg-[rgba(43,28,18,0.72)] px-2.5 py-1 text-[#fff6e6] shadow-lg backdrop-blur-[2px]">
            <span className="text-[10px] font-bold tracking-[0.2em] text-[#ffb020]">MODE</span>
            <span className="ml-1.5 font-[family-name:var(--font-bungee)] text-sm leading-none">
              {DIFFICULTIES[difficulty].short}
            </span>
          </div>
        </div>
        <div ref={timeRef} className="font-[family-name:var(--font-bungee)] text-2xl leading-none text-[#2b1c12] [text-shadow:0_2px_0_rgba(255,246,230,0.65)] sm:text-3xl">
          0:00.00
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#5a3c28]">
          <span>TOTAL <span ref={totalRef} className="tabular-nums">0:00.00</span></span>
          <span className="text-[#fff6e6] [text-shadow:0_1px_2px_rgba(43,28,18,0.7)]">BEST <span ref={bestRef} className="tabular-nums">{formatTime(bestTotalMs)}</span></span>
        </div>
        {/* lap progress rail */}
        <div className="relative h-1.5 w-40 rounded-full bg-[rgba(43,28,18,0.35)] sm:w-52">
          <div ref={cpDotRef} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#fff6e6] bg-[#f0641e] shadow" style={{ left: "0%" }} />
        </div>
      </div>

      {/* top left: minimap + next checkpoint */}
      <div className="absolute left-3 top-3 flex flex-col gap-1">
        <div className="relative rounded-lg bg-[rgba(255,246,230,0.82)] p-1 shadow-lg backdrop-blur-[2px]">
          <canvas ref={minimapRef} width={148} height={118} className="block h-[86px] w-[108px] sm:h-[118px] sm:w-[148px]" aria-label="Track minimap" />
          {/* rival blips */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              ref={(el) => {
                aiDotsRef.current[i] = el;
              }}
              className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#fff6e6] opacity-0 shadow"
              style={{ left: "-20%", top: "-20%" }}
            />
          ))}
          {/* player dot */}
          <div
            ref={carDotRef}
            className="absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#fff6e6] bg-[#f0641e] shadow"
            style={{ left: "-20%", top: "-20%" }}
          />
        </div>
        <div className="flex w-fit items-center gap-1.5 self-start rounded bg-[rgba(43,28,18,0.72)] px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#fff6e6]">
          <span className="text-[#ffb020]">NEXT CP</span>
          <span ref={cpRef} className="tabular-nums">0m</span>
        </div>
      </div>

      {/* wrong way */}
      <div ref={wrongRef} className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-md bg-[#d64530] px-5 py-2 font-[family-name:var(--font-bungee)] text-xl text-[#fff6e6] opacity-0 shadow-xl transition-opacity [text-shadow:0_2px_0_rgba(43,28,18,0.4)]">
        ⚠ WRONG WAY
      </div>

      {/* bottom left: speed + boost */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <div ref={speedRef} className="font-[family-name:var(--font-bungee)] text-5xl leading-none text-[#2b1c12] [text-shadow:0_3px_0_rgba(255,246,230,0.7)] sm:text-6xl">
            0
          </div>
          <div className="mb-1 flex flex-col">
            <span className="text-[10px] font-bold tracking-[0.25em] text-[#5a3c28]">KM/H</span>
            <span className="text-xs font-bold text-[#5a3c28]">GEAR <span ref={gearRef} className="text-[#2b1c12]">N</span></span>
          </div>
        </div>
        {/* boost meter */}
        <div className="w-44 sm:w-56">
          <div className="mb-0.5 flex items-center justify-between">
            <span ref={boostLabelRef} className="text-[10px] font-black tracking-[0.25em] text-[#2b1c12] [text-shadow:0_1px_0_rgba(255,246,230,0.6)]">BOOST</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.6)]">
            <div ref={boostRef} className="h-full w-0 rounded-full transition-[width] duration-100" style={{ background: "linear-gradient(90deg,#e8a04c,#d97a2e)" }} />
          </div>
        </div>
      </div>

      {/* drift chain chip */}
      <div ref={driftRef} className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-md bg-[#ffb020] px-4 py-1.5 font-[family-name:var(--font-bungee)] text-lg text-[#2b1c12] opacity-0 shadow-xl transition-opacity [text-shadow:0_1px_0_rgba(255,246,230,0.6)]">
        DRIFT <b>x1.0</b>
      </div>

      {/* event popups */}
      <div className="absolute left-1/2 top-[22%] flex -translate-x-1/2 flex-col items-center gap-1.5">
        {popups.map((p) => (
          <div
            key={p.id}
            className={`popup-anim rounded-md px-4 py-1.5 font-[family-name:var(--font-bungee)] text-base shadow-xl [text-shadow:0_1px_0_rgba(43,28,18,0.35)] sm:text-lg ${
              p.type === "wrongway"
                ? "bg-[#d64530] text-[#fff6e6]"
                : p.type === "checkpoint"
                  ? "bg-[rgba(43,28,18,0.85)] text-[#fff6e6]"
                  : p.type === "newrecord"
                    ? "bg-[#2f9e63] text-[#fff6e6]"
                    : p.type === "smash"
                      ? "bg-[#f0641e] text-[#fff6e6]"
                      : "bg-[rgba(255,246,230,0.94)] text-[#2b1c12]"
            }`}
          >
            {p.text}
            {p.type === "checkpoint" && p.deltaMs != null && (
              <span className={`ml-2 ${p.deltaMs < 0 ? "text-[#7ee2a8]" : "text-[#ff9a8a]"}`}>
                {formatDelta(p.deltaMs)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* countdown */}
      {countdownActive && countdownValue > 0 && (
        <div
          key={countdownValue}
          className="count-anim absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-[family-name:var(--font-bungee)] text-[9rem] leading-none text-[#fff6e6] [text-shadow:0_6px_0_#2b1c12,0_0_40px_rgba(240,100,30,0.6)] sm:text-[12rem]"
        >
          {countdownValue}
        </div>
      )}
      <div ref={goFlashRef} className="go-anim hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-[family-name:var(--font-bungee)] text-[8rem] leading-none text-[#2f9e63] [text-shadow:0_6px_0_#2b1c12,0_0_50px_rgba(47,158,99,0.7)] sm:text-[11rem]">
        GO!
      </div>
    </div>
  );
}
