"use client";

import { useRef, useState } from "react";
import type { InputManager } from "@/game/input";

/**
 * Landscape touch controls: steer left/right on the left, pedals on the right.
 * Multi-touch safe via pointer capture. Buttons are ≥ 56px targets.
 */
export function TouchControls({
  inputRef,
  onPause,
}: {
  inputRef: React.RefObject<InputManager | null>;
  onPause: () => void;
}) {
  // client-only component (page is ssr:false) — safe to probe at first render
  const [touchMode] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window)
  );
  const stateRef = useRef({ steer: 0, throttle: 0, brake: 0, drift: false, boost: false });

  if (!touchMode) return null;

  const set = (patch: Partial<typeof stateRef.current>) => {
    Object.assign(stateRef.current, patch);
    inputRef.current?.setTouch(stateRef.current);
  };

  const hold = (patchOn: Partial<typeof stateRef.current>, patchOff: Partial<typeof stateRef.current>) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      set(patchOn);
    },
    onPointerUp: () => set(patchOff),
    onPointerCancel: () => set(patchOff),
    onPointerLeave: () => set(patchOff),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const btn =
    "pointer-events-auto flex select-none items-center justify-center rounded-2xl border-[3px] border-[#2b1c12] font-[family-name:var(--font-bungee)] text-[#fff6e6] shadow-[0_4px_0_#2b1c12] active:translate-y-1 active:shadow-none";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* pause button */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          onPause();
        }}
        className="pointer-events-auto absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-lg border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.85)] text-lg font-black text-[#2b1c12] shadow-lg"
        aria-label="Pause"
      >
        II
      </button>

      {/* steering (left) */}
      <div className="absolute bottom-5 left-4 flex gap-3">
        <button
          type="button"
          aria-label="Steer left"
          className={`${btn} h-20 w-20 bg-[rgba(255,246,230,0.55)] text-3xl text-[#2b1c12]`}
          {...hold({ steer: -1 }, { steer: 0 })}
        >
          ◀
        </button>
        <button
          type="button"
          aria-label="Steer right"
          className={`${btn} h-20 w-20 bg-[rgba(255,246,230,0.55)] text-3xl text-[#2b1c12]`}
          {...hold({ steer: 1 }, { steer: 0 })}
        >
          ▶
        </button>
      </div>

      {/* pedals (right) */}
      <div className="absolute bottom-5 right-4 flex items-end gap-3">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-label="Drift"
            className={`${btn} h-16 w-16 bg-[rgba(255,176,32,0.85)] text-sm`}
            {...hold({ drift: true }, { drift: false })}
          >
            DRIFT
          </button>
          <button
            type="button"
            aria-label="Brake"
            className={`${btn} h-16 w-16 bg-[rgba(214,69,48,0.85)] text-sm`}
            {...hold({ brake: 1 }, { brake: 0 })}
          >
            BRAKE
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-label="Boost"
            className={`${btn} h-16 w-16 bg-[rgba(240,100,30,0.9)] text-sm`}
            {...hold({ boost: true }, { boost: false })}
          >
            BOOST
          </button>
          <button
            type="button"
            aria-label="Accelerate"
            className={`${btn} h-24 w-16 bg-[rgba(47,158,99,0.88)] text-base`}
            {...hold({ throttle: 1 }, { throttle: 0 })}
          >
            GAS
          </button>
        </div>
      </div>
    </div>
  );
}
