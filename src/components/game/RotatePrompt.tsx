"use client";

import { useEffect, useState } from "react";

/** On touch devices in portrait, ask the player to rotate to landscape. */
export function RotatePrompt() {
  const [portrait, setPortrait] = useState(false);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const check = () => {
      setTouch(window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
      setPortrait(window.innerHeight > window.innerWidth);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  if (!touch || !portrait) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#2b1c12] p-6 text-center">
      <div className="animate-[rotate-nudge_1.6s_ease-in-out_infinite] text-7xl" aria-hidden>
        📱
      </div>
      <div className="font-[family-name:var(--font-bungee)] text-2xl text-[#ffb020]">ROTATE YOUR DEVICE</div>
      <p className="max-w-xs text-sm font-semibold text-[#f6e3c2]">
        Canyon Rush is built for landscape. Turn your phone sideways to hit the canyon floor running.
      </p>
    </div>
  );
}
