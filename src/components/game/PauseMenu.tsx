"use client";

import { useState } from "react";
import type { GameEngine } from "@/game/engine";
import { useGameStore } from "@/game/store";
import { SettingsPanel } from "./SettingsPanel";

export function PauseMenu({
  onResume,
  onRestart,
  onQuit,
  canRestart = true,
  quitLabel = "QUIT TO TITLE",
}: {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  /** false in multiplayer — a local restart would desync the shared race */
  canRestart?: boolean;
  quitLabel?: string;
  engineRef: React.RefObject<GameEngine | null>;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const phase = useGameStore((s) => s.phase);
  void phase;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(43,28,18,0.62)] p-4 backdrop-blur-[3px]">
      <div className="w-full max-w-sm max-h-[92vh] overflow-y-auto settings-scroll rounded-xl border-[3px] border-[#2b1c12] bg-[#fff6e6]/97 p-4 sm:p-5 shadow-2xl">
        <h2 className="text-center font-[family-name:var(--font-bungee)] text-4xl text-[#2b1c12]">PAUSED</h2>
        <p className="mb-4 text-center text-[10px] font-black tracking-[0.3em] text-[#8a6a4e]">SUNSTONE CANYON</p>

        {showSettings ? (
          <div className="flex flex-col gap-3">
            <SettingsPanel compact />
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="self-center rounded-md border-2 border-[#2b1c12] bg-[#ffb020] px-6 py-2 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
            >
              BACK
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="-skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#f0641e] px-6 py-3 font-[family-name:var(--font-bungee)] text-xl text-[#fff6e6] shadow-[0_5px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_3px_0_#2b1c12] active:translate-y-1 active:shadow-none"
            >
              <span className="block skew-x-6">RESUME</span>
            </button>
            {canRestart && (
              <button
                type="button"
                onClick={onRestart}
                className="-skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#ffb020] px-6 py-2.5 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
              >
                <span className="block skew-x-6">RESTART RACE</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="-skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#fff6e6] px-6 py-2.5 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
            >
              <span className="block skew-x-6">SETTINGS</span>
            </button>
            <button
              type="button"
              onClick={onQuit}
              className="-skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#e5d2b3] px-6 py-2.5 text-sm font-black tracking-wider text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
            >
              <span className="block skew-x-6">{quitLabel}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
