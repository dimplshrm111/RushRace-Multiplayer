"use client";

import { useEffect, useRef } from "react";
import type { GameEngine } from "@/game/engine";
import { useGameStore } from "@/game/store";
import { useMPStore } from "@/game/net-store";
import { DIFFICULTIES, formatTime, type Telemetry } from "@/game/types";

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
  const nitroLabelRef = useRef<HTMLSpanElement>(null);
  const nitroBtnRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const surfaceChipRef = useRef<HTMLDivElement>(null);
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

  const countdownValue = useGameStore((s) => s.countdownValue);
  const bestTotalMs = useGameStore((s) => s.bestTotalMs);
  const difficulty = useGameStore((s) => s.settings.difficulty);
  const inMPRoom = useMPStore((s) => s.screen === "room" && s.room != null);

  const goFlashRef = useRef<HTMLDivElement>(null);

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

  // Telemetry updates directly into the DOM for 60fps performance without React re-renders
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let lastBestRender = -1;
    const unsub = engine.onTelemetry((t: Telemetry) => {
      if (speedRef.current) speedRef.current.textContent = String(Math.max(0, Math.round(t.speedKmh)));
      if (gearRef.current) gearRef.current.textContent = t.speedKmh < 1 ? "N" : String(t.gear);
      if (nitroLabelRef.current) {
        nitroLabelRef.current.textContent = `${Math.round(t.nitro)}%`;
      }
      if (nitroBtnRef.current) {
        nitroBtnRef.current.style.boxShadow = t.nitroActive
          ? "0 0 18px 4px rgba(255,210,63,0.85)"
          : "0 0 0 0 rgba(255,210,63,0)";
        nitroBtnRef.current.style.borderColor = t.nitro > 15 ? "#ffd23f" : "#7a3a1e";
      }

      // surface chip
      if (surfaceRef.current) surfaceRef.current.textContent = t.surfaceLabel;
      if (surfaceChipRef.current) {
        surfaceChipRef.current.style.background = t.surfaceColour;
        surfaceChipRef.current.style.color =
          t.surface === "asphalt" || t.surface === "wet" || t.surface === "mud"
            ? "#fff6e6"
            : "#2b1c12";
      }
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

      // Minimap dots
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

  // Build minimap path once
  useEffect(() => {
    const engine = engineRef.current;
    const canvas = minimapRef.current;
    if (!engine || !canvas) return;
    const pts = engine.track.minimapPts;
    const gates = engine.track.gatePts;
    const walls = engine.track.wallPts;
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

    for (const w of walls) {
      const x = ox + w.x * scale;
      const y = oy + w.z * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#ffb020";
      ctx.strokeStyle = "#2b1c12";
      ctx.lineWidth = 1.5;
      ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
      ctx.strokeRect(-3.4, -3.4, 6.8, 6.8);
      ctx.restore();
    }
    for (const g of gates) {
      ctx.beginPath();
      ctx.arc(ox + g.x * scale, oy + g.z * scale, g.finish ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = g.finish ? "#f0641e" : "#2b1c12";
      ctx.fill();
    }
    minimapDataRef.current = { canvas, scale, ox, oy, w: W, h: H };
  }, [engineRef]);

  const cycleCamera = () => {
    const st = useGameStore.getState();
    const next = ((st.settings.cameraMode + 1) % 3) as 0 | 1 | 2;
    st.setSettings({ cameraMode: next });
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-[family-name:var(--font-geist-sans)]">
      {/* ── TOP CENTER: Lap + Position + Times (safe-area aware) ── */}
      <div
        className="race-timing absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5 sm:gap-1"
        style={{ top: "max(6px, env(safe-area-inset-top, 6px))" }}
      >
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-2 rounded-md bg-[rgba(43,28,18,0.78)] px-2 py-0.5 sm:px-2.5 sm:py-1 text-[#fff6e6] shadow-lg backdrop-blur-sm">
            <span className="text-[8px] sm:text-[10px] font-bold tracking-[0.2em] text-[#ffb020]">LAP</span>
            <span ref={lapRef} className="font-[family-name:var(--font-bungee)] text-sm sm:text-lg leading-none">1/3</span>
          </div>
          <div ref={posChipRef} className="flex items-center gap-1 sm:gap-2 rounded-md bg-[rgba(43,28,18,0.78)] px-2 py-0.5 sm:px-2.5 sm:py-1 text-[#fff6e6] shadow-lg backdrop-blur-sm transition-colors">
            <span className="text-[8px] sm:text-[10px] font-bold tracking-[0.2em] text-[#ffb020]">POS</span>
            <span ref={posRef} className="font-[family-name:var(--font-bungee)] text-sm sm:text-lg leading-none">4/4</span>
          </div>
          <div className="flex items-center rounded-md bg-[rgba(43,28,18,0.78)] px-1.5 sm:px-2.5 py-0.5 sm:py-1 text-[#fff6e6] shadow-lg backdrop-blur-sm">
            <span className="text-[8px] sm:text-[10px] font-bold tracking-[0.2em] text-[#ffb020]">MODE</span>
            <span className="ml-1 sm:ml-1.5 font-[family-name:var(--font-bungee)] text-[11px] sm:text-sm leading-none">
              {inMPRoom ? "ONLINE" : DIFFICULTIES[difficulty].short}
            </span>
          </div>
        </div>
        <div ref={timeRef} className="font-[family-name:var(--font-bungee)] text-xl leading-none text-[#2b1c12] [text-shadow:0_2px_0_rgba(255,246,230,0.75)] sm:text-3xl">
          0:00.00
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[11px] font-semibold text-[#5a3c28]">
          <span>TOTAL <span ref={totalRef} className="tabular-nums">0:00.00</span></span>
          <span className="text-[#fff6e6] [text-shadow:0_1px_2px_rgba(43,28,18,0.8)]">BEST <span ref={bestRef} className="tabular-nums">{formatTime(bestTotalMs)}</span></span>
        </div>
        {/* Lap progress rail */}
        <div className="relative h-1 sm:h-1.5 w-28 sm:w-52 rounded-full bg-[rgba(43,28,18,0.35)]">
          <div ref={cpDotRef} className="absolute top-1/2 h-2 w-2 sm:h-2.5 sm:w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#fff6e6] sm:border-2 bg-[#f0641e] shadow" style={{ left: "0%" }} />
        </div>
      </div>

      {/* ── TOP LEFT: Minimap + Next Checkpoint ── */}
      <div
        className="race-minimap pointer-events-none absolute flex flex-col gap-1"
        style={{
          top: "max(8px, env(safe-area-inset-top, 8px))",
          left: "max(8px, env(safe-area-inset-left, 8px))",
        }}
      >
        <div className="relative rounded-lg border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.88)] p-1 shadow-md backdrop-blur-sm">
          <div className="relative">
          <canvas ref={minimapRef} width={148} height={118} className="block h-[86px] w-[110px] sm:h-[118px] sm:w-[148px]" aria-label="Track minimap" />
          {/* Rival blips */}
          {Array.from({ length: 9 }, (_, i) => (
            <div
              key={i}
              ref={(el) => {
                aiDotsRef.current[i] = el;
              }}
              className="absolute h-[6px] w-[6px] sm:h-[7px] sm:w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#fff6e6] opacity-0 shadow"
              style={{ left: "-20%", top: "-20%" }}
            />
          ))}
          {/* Player dot */}
          <div
            ref={carDotRef}
            className="absolute h-[8px] w-[8px] sm:h-[9px] sm:w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#fff6e6] bg-[#f0641e] shadow"
            style={{ left: "-20%", top: "-20%" }}
          />
          </div>
        </div>
        <div className="flex w-fit items-center gap-1 rounded bg-[rgba(43,28,18,0.85)] px-2 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-wider text-[#fff6e6] shadow-sm">
          <span className="text-[#ffb020]">NEXT CP</span>
          <span ref={cpRef} className="tabular-nums">0m</span>
        </div>
      </div>

      {/* ── REAR-VIEW CAMERA & MIRROR:
          Desktop: Bottom-Right corner
          Mobile: Top-Right (tucked beside Pause button)
          Live Three.js scissored pass paints directly into #rear-view-slot
      ── */}
      <div
        className="race-mirror pointer-events-auto absolute flex flex-col gap-0.5 transition-all
          /* Mobile layout: Top-Right corner next to pause */
          top-2 sm:top-auto sm:right-4 sm:bottom-4"
        style={{
          top: "max(8px, env(safe-area-inset-top, 8px))",
          right: "max(54px, calc(env(safe-area-inset-right, 10px) + 44px))",
        }}
      >
        <div className="flex items-center justify-between rounded-t-md bg-[rgba(43,28,18,0.85)] px-1.5 py-0.5 text-[8px] sm:text-[9px] font-black tracking-[0.2em] text-[#ffd23f] shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#d64530]" />
            <span className="hidden xs:inline">REAR VIEW</span>
            <span className="xs:hidden">REAR</span>
          </div>
          {/* Camera cycle button */}
          <button
            type="button"
            onClick={cycleCamera}
            className="ml-1.5 flex items-center gap-1 rounded bg-[rgba(255,255,255,0.18)] px-1.5 py-0.5 text-[8px] font-bold text-[#fff6e6] hover:bg-[rgba(255,255,255,0.3)] active:scale-95"
            aria-label="Switch camera angle"
            title="Switch camera angle (C)"
          >
            <span>📷</span>
            <span className="hidden sm:inline">CAM [C]</span>
          </button>
        </div>
        {/* Scissored WebGL canvas viewport */}
        <div
          id="rear-view-slot"
          onClick={cycleCamera}
          className="block h-[44px] w-[78px] cursor-pointer rounded-b-md border-2 border-t-0 border-[#2b1c12] bg-transparent shadow-lg sm:h-[86px] sm:w-[152px]"
          role="button"
          aria-label="Rear view mirror - Click to switch camera"
          title="Click to switch camera angle"
        />
      </div>

      {/* ── WRONG WAY WARNING ── */}
      <div ref={wrongRef} className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-md bg-[#d64530] px-5 py-2 font-[family-name:var(--font-bungee)] text-xl text-[#fff6e6] opacity-0 shadow-xl transition-opacity [text-shadow:0_2px_0_rgba(43,28,18,0.4)]">
        ⚠ WRONG WAY
      </div>

      {/* Speed sits above the steering controls on touch devices. */}
      <div
        className="race-speed pointer-events-none absolute flex flex-col items-center gap-1
          bottom-2 left-[max(10px,env(safe-area-inset-left,10px))] items-start
          sm:bottom-4 sm:left-[max(12px,env(safe-area-inset-left,12px))] sm:gap-2"
      >
        <div className="flex items-end gap-1.5 sm:gap-2 rounded-lg border border-[#2b1c12]/40 bg-[rgba(255,246,230,0.88)] px-2 py-0.5 shadow-sm backdrop-blur-sm sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
          <div ref={speedRef} className="font-[family-name:var(--font-bungee)] text-3xl leading-none text-[#2b1c12] [text-shadow:0_2px_0_rgba(255,246,230,0.7)] sm:text-6xl">
            0
          </div>
          <div className="mb-0.5 sm:mb-1 flex flex-col">
            <span className="text-[8px] sm:text-[10px] font-bold tracking-[0.25em] text-[#5a3c28]">KM/H</span>
            <span className="text-[10px] sm:text-xs font-bold text-[#5a3c28]">GEAR <span ref={gearRef} className="text-[#2b1c12]">N</span></span>
          </div>
          {/* Desktop Nitro key hint */}
          <div
            ref={nitroBtnRef}
            className="race-nitro-hint hidden sm:flex w-fit items-center gap-1 rounded border-2 bg-[rgba(43,28,18,0.72)] px-1.5 py-0.5 text-[9px] font-black tracking-[0.2em] text-[#ffd23f] transition-[box-shadow] duration-100"
            style={{ borderColor: "#ffd23f" }}
          >
            <span>NITRO</span>
            <span ref={nitroLabelRef} className="tabular-nums">100%</span>
            <span className="text-[#fff6e6]">[X]</span>
          </div>
        </div>

      </div>

      {/* ── DRIFT MULTIPLIER ── */}
      <div ref={driftRef} className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-md bg-[#ffb020] px-4 py-1.5 font-[family-name:var(--font-bungee)] text-lg text-[#2b1c12] opacity-0 shadow-xl transition-opacity [text-shadow:0_1px_0_rgba(255,246,230,0.6)]">
        DRIFT <b>x1.0</b>
      </div>



      {/* ── COUNTDOWN OVERLAY ── */}
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
