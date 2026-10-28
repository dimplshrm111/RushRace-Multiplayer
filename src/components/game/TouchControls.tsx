"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { InputManager } from "@/game/input";
import type { GameEngine } from "@/game/engine";

/**
 * Mobile touch controls — intentional landscape ergonomics:
 *
 * LEFT ZONE (bottom-left):
 *   [⚡ NITRO]  ← positioned above the Left & Right steering buttons
 *   [◀]   [▶]   ← steering controls side-by-side
 *
 * RIGHT ZONE (bottom-right):
 *   [DRIFT] [BRAKE]  ← secondary controls above the accelerator
 *        [GAS]       ← large primary acceleration pedal
 *
 * TOP-RIGHT:
 *   [ ⏸ PAUSE ]      ← comfortable reach, safe from accidental taps
 *
 * Features:
 * - Multi-touch safe via pointer capture
 * - Guaranteed release on gestures, blur, or window cancellation (no stuck buttons)
 * - Large touch targets (>= 60px) with clear active/pressed feedback
 * - Safe-area inset support for notches and rounded corners
 */
export function TouchControls({
  inputRef,
  engineRef,
  onPause,
}: {
  inputRef: React.RefObject<InputManager | null>;
  engineRef: React.RefObject<GameEngine | null>;
  onPause: () => void;
}) {
  const [touchMode] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window)
  );

  // Active state feedback for responsive animations
  const [active, setActive] = useState({
    left: false,
    right: false,
    gas: false,
    brake: false,
    drift: false,
    nitro: false,
  });

  const stateRef = useRef({ steer: 0, throttle: 0, brake: 0, drift: false, boost: false });
  const activeRef = useRef(active);
  const nitroButtonRef = useRef<HTMLButtonElement>(null);
  const nitroFillRef = useRef<HTMLSpanElement>(null);
  const nitroAmountRef = useRef<HTMLSpanElement>(null);

  const set = useCallback(
    (patch: Partial<typeof stateRef.current>) => {
      Object.assign(stateRef.current, patch);
      inputRef.current?.setTouch(stateRef.current);
    },
    [inputRef]
  );

  // Global safety net: if window blurs, gesture is cancelled, or visibility changes, release all inputs
  useEffect(() => {
    const releaseAll = () => {
      stateRef.current = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
      activeRef.current = { left: false, right: false, gas: false, brake: false, drift: false, nitro: false };
      inputRef.current?.setTouch(stateRef.current);
      setActive({
        left: false,
        right: false,
        gas: false,
        brake: false,
        drift: false,
        nitro: false,
      });
    };

    window.addEventListener("pointercancel", releaseAll);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", releaseAll);
    return () => {
      window.removeEventListener("pointercancel", releaseAll);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", releaseAll);
    };
  }, [inputRef]);

  useEffect(() => {
    if (!touchMode) return;
    const engine = engineRef.current;
    if (!engine) return;
    let previous = -1;
    return engine.onTelemetry((telemetry) => {
      const amount = Math.max(0, Math.min(100, Math.round(telemetry.nitro)));
      if (amount === previous) return;
      previous = amount;
      if (nitroFillRef.current) nitroFillRef.current.style.transform = `scaleX(${amount / 100})`;
      if (nitroAmountRef.current) nitroAmountRef.current.textContent = `${amount}%`;
      nitroButtonRef.current?.setAttribute("aria-label", `Activate Nitro boost, ${amount} percent remaining`);
    });
  }, [engineRef, touchMode]);

  if (!touchMode) return null;

  const makeHold = (
    key: keyof typeof active,
    patchOn: Partial<typeof stateRef.current>,
    patchOff: Partial<typeof stateRef.current>
  ) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {}
      activeRef.current = { ...activeRef.current, [key]: true };
      const { left, right } = activeRef.current;
      set(key === "left" || key === "right" ? { steer: left === right ? 0 : left ? -1 : 1 } : patchOn);
      setActive(activeRef.current);
    },
    onPointerUp: (e: React.PointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {}
      activeRef.current = { ...activeRef.current, [key]: false };
      const { left, right } = activeRef.current;
      set(key === "left" || key === "right" ? { steer: left === right ? 0 : left ? -1 : 1 } : patchOff);
      setActive(activeRef.current);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {}
      activeRef.current = { ...activeRef.current, [key]: false };
      const { left, right } = activeRef.current;
      set(key === "left" || key === "right" ? { steer: left === right ? 0 : left ? -1 : 1 } : patchOff);
      setActive(activeRef.current);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const baseBtn =
    "pointer-events-auto select-none flex items-center justify-center rounded-2xl border-[3px] border-[#2b1c12] font-[family-name:var(--font-bungee)] text-[#fff6e6] touch-none transition-all duration-75";

  const steerStyle = (on: boolean) =>
    `${baseBtn} touch-steer h-[58px] w-[67px] sm:h-[66px] sm:w-[75px] text-2xl ` +
    (on
      ? "bg-[rgba(255,246,230,0.95)] shadow-none translate-y-1 scale-95 text-[#2b1c12]"
      : "bg-[rgba(255,246,230,0.65)] shadow-[0_4px_0_#2b1c12] text-[#2b1c12]");

  const nitroStyle = (on: boolean) =>
    `${baseBtn} touch-nitro h-[46px] w-[142px] sm:h-[52px] sm:w-[158px] text-xs font-black tracking-widest ` +
    (on
      ? "bg-gradient-to-r from-[#ff3a1f] to-[#ffb020] shadow-none translate-y-1 scale-95 ring-4 ring-[#ffd23f]"
      : "bg-gradient-to-r from-[#f0641e] to-[#ff8a3f] shadow-[0_4px_0_#2b1c12] ring-2 ring-[#ffd23f]/70");

  const gasStyle = (on: boolean) =>
    `${baseBtn} touch-gas h-[114px] w-[86px] sm:h-[130px] sm:w-[96px] text-base tracking-widest ` +
    (on
      ? "bg-[#25824c] shadow-none translate-y-1 scale-95"
      : "bg-[#2f9e63] shadow-[0_4px_0_#2b1c12]");

  const brakeStyle = (on: boolean) =>
    `${baseBtn} touch-brake h-[58px] w-[74px] sm:h-[66px] sm:w-[82px] text-xs tracking-wider ` +
    (on
      ? "bg-[#b0301e] shadow-none translate-y-1 scale-95"
      : "bg-[#d64530] shadow-[0_4px_0_#2b1c12]");

  const driftStyle = (on: boolean) =>
    `${baseBtn} touch-drift h-[50px] w-[74px] sm:h-[56px] sm:w-[82px] text-xs tracking-wider text-[#2b1c12] ` +
    (on
      ? "bg-[#e59b15] shadow-none translate-y-1 scale-95"
      : "bg-[#ffb020] shadow-[0_4px_0_#2b1c12]");

  return (
    <div className="pointer-events-none absolute inset-0 z-20" style={{ touchAction: "none" }}>
      {/* ── TOP-RIGHT PAUSE BUTTON ── */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          onPause();
        }}
        className="pointer-events-auto absolute flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.92)] text-base sm:text-lg font-black text-[#2b1c12] shadow-md backdrop-blur-sm active:translate-y-0.5 active:shadow-none"
        aria-label="Pause game"
        style={{
          touchAction: "none",
          top: "max(8px, env(safe-area-inset-top, 8px))",
          right: "max(10px, env(safe-area-inset-right, 10px))",
        }}
      >
        ⏸
      </button>

      {/* ══════════════════════════════════════════════════
          LEFT ZONE — NITRO (above) + STEERING (below)
          Nitro spans full width directly above Left / Right buttons
          ══════════════════════════════════════════════════ */}
      <div
        className="absolute flex flex-col items-start gap-1.5 sm:gap-2"
        style={{
          bottom: "max(10px, env(safe-area-inset-bottom, 10px))",
          left: "max(10px, env(safe-area-inset-left, 10px))",
        }}
      >
        {/* Nitro button positioned directly above Left / Right steering */}
        <button
          type="button"
          ref={nitroButtonRef}
          aria-label="Activate Nitro boost, 100 percent remaining"
          className={`${nitroStyle(active.nitro)} relative overflow-hidden`}
          style={{ touchAction: "none" }}
          {...makeHold("nitro", { boost: true }, { boost: false })}
        >
          <span ref={nitroFillRef} aria-hidden="true" className="pointer-events-none absolute inset-0 origin-left bg-[#ffd269]/45" />
          <span className="relative flex items-center gap-2">⚡ NITRO <span ref={nitroAmountRef} className="tabular-nums">100%</span></span>
        </button>

        {/* Left and Right steering buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Steer left"
            className={steerStyle(active.left)}
            style={{ touchAction: "none" }}
            {...makeHold("left", { steer: -1 }, { steer: 0 })}
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Steer right"
            className={steerStyle(active.right)}
            style={{ touchAction: "none" }}
            {...makeHold("right", { steer: 1 }, { steer: 0 })}
          >
            ▶
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          RIGHT ZONE — DRIFT & BRAKE (left) + GAS (right)
          ══════════════════════════════════════════════════ */}
      <div
        className="absolute flex items-end gap-2"
        style={{
          bottom: "max(10px, env(safe-area-inset-bottom, 10px))",
          right: "max(10px, env(safe-area-inset-right, 10px))",
        }}
      >
        {/* DRIFT & BRAKE column */}
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <button
            type="button"
            aria-label="Handbrake / drift"
            className={driftStyle(active.drift)}
            style={{ touchAction: "none" }}
            {...makeHold("drift", { drift: true }, { drift: false })}
          >
            DRIFT
          </button>
          <button
            type="button"
            aria-label="Brake / reverse"
            className={brakeStyle(active.brake)}
            style={{ touchAction: "none" }}
            {...makeHold("brake", { brake: 1 }, { brake: 0 })}
          >
            BRAKE
          </button>
        </div>

        {/* GAS (accelerate) primary pedal */}
        <button
          type="button"
          aria-label="Accelerate"
          className={gasStyle(active.gas)}
          style={{ touchAction: "none" }}
          {...makeHold("gas", { throttle: 1 }, { throttle: 0 })}
        >
          GAS
        </button>
      </div>
    </div>
  );
}
