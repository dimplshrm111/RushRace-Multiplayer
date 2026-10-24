"use client";

import { useState } from "react";
import { useGameStore } from "@/game/store";

interface Step {
  title: string;
  body: React.ReactNode;
  accent: string;
}

const STEPS: Step[] = [
  {
    title: "DRIVE",
    accent: "#f0641e",
    body: (
      <>
        <p><b>W / ↑</b> throttle · <b>S / ↓</b> brake &amp; reverse · <b>A D / ← →</b> steer.</p>
        <p className="mt-1 text-[#5a3c28]">Gamepad: <b>left stick</b> steers, <b>RT</b> gas, <b>LT</b> brake. Touch: on-screen pedals.</p>
      </>
    ),
  },
  {
    title: "DRIFT",
    accent: "#ffb020",
    body: (
      <>
        <p>Hold <b>SPACE</b> (or <b>A</b> / DRIFT) while turning to slide.</p>
        <p className="mt-1 text-[#5a3c28]">Long, clean drift chains fill your boost meter. Release gently to bank the bonus — crash and the chain is lost.</p>
      </>
    ),
  },
  {
    title: "NITRO & BOOST",
    accent: "#d64530",
    body: (
      <>
        <p>Hold <b>X</b> or <b>NUM 0</b> (also <b>SHIFT</b> / <b>K</b> / RB / NITRO button) for raw speed.</p>
        <p className="mt-1 text-[#5a3c28]"><b>NITRO</b> is your main boost bar — it recharges fully in <b>10s</b> when you let go. Identical for every car.</p>
        <p className="mt-1 text-[#5a3c28]">Drifting, <b>airtime</b>, <b>wall-rides</b>, <b>near-misses</b>, clean landings and checkpoints also feed the bonus <b>BOOST</b> bank.</p>
      </>
    ),
  },
  {
    title: "SURFACES",
    accent: "#9b6b3f",
    body: (
      <>
        <p>Every surface drives differently — watch the chip under your speed.</p>
        <p className="mt-1 text-[#5a3c28]"><b>Tarmac</b> &amp; <b>concrete</b> = max grip. <b>Dirt</b> &amp; <b>gravel</b> = loose. <b>Grass</b> drags. <b>Sand</b> &amp; <b>mud</b> slow you hard. <b>Wet</b> road is slippy. <b>Rock</b> is bumpy.</p>
        <p className="mt-1 text-[#5a3c28]">Brake earlier off-road, drifts are easier on loose surfaces, and slopes affect your speed naturally.</p>
      </>
    ),
  },
  {
    title: "SMASH",
    accent: "#a34e33",
    body: (
      <>
        <p>Smash straight through <b>crate stacks</b> and the painted <b>BREAK barricade</b> — they explode into flying planks.</p>
        <p className="mt-1 text-[#5a3c28]">Look for the <b>BREAK</b> sign — walls that carry it are fair game. Crates cost a little speed, the barricade barely slows you, and every smash feeds your boost.</p>
      </>
    ),
  },
  {
    title: "FLY & RIDE",
    accent: "#2f9e63",
    body: (
      <>
        <p>Hit the <b>big ramp</b> fast to clear the canyon gap. Keep speed high on the <b>banked carousel</b> to ride the wall.</p>
        <p className="mt-1 text-[#5a3c28]">Land straight for a clean-landing bonus. Undershoot the jump and you land in the dry riverbed — floor it up the sand ramp to rejoin the race.</p>
      </>
    ),
  },
  {
    title: "RACE",
    accent: "#1f8a70",
    body: (
      <>
        <p>Pass every <b>checkpoint gate</b> in order, then cross the finish. Beat your best time and race your own <b>ghost</b>.</p>
        <p className="mt-1 text-[#5a3c28]"><b>C</b> camera · <b>R</b> restart · <b>ESC</b> pause · <b>M</b> mute. Every car is identical — the canyon is the opponent.</p>
      </>
    ),
  },
];

export function Tutorial({ onComplete }: { onComplete: () => void }) {
  const hint = useGameStore((s) => s.hint);
  const [step, setStep] = useState(0);
  if (hint !== "tutorial") return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(43,28,18,0.6)] p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-xl border-[3px] border-[#2b1c12] bg-[#fff6e6] p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-black tracking-[0.3em] text-[#8a6a4e]">HOW TO PLAY</span>
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full border border-[#2b1c12]"
                style={{ background: i <= step ? s.accent : "transparent" }}
              />
            ))}
          </div>
        </div>
        <h2 className="font-[family-name:var(--font-bungee)] text-3xl leading-none" style={{ color: s.accent, textShadow: "0 2px 0 rgba(43,28,18,0.15)" }}>
          {s.title}
        </h2>
        <div className="mt-3 text-sm font-semibold leading-relaxed text-[#2b1c12]">{s.body}</div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((v) => Math.max(0, v - 1))}
            disabled={step === 0}
            className="rounded-md border-2 border-[#2b1c12] bg-[#f6e3c2] px-4 py-2 text-xs font-black tracking-wider text-[#2b1c12] disabled:opacity-40"
          >
            BACK
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => (last ? onComplete() : setStep((v) => v + 1))}
            className="-skew-x-6 rounded-md border-2 border-[#2b1c12] px-6 py-2 text-sm font-black tracking-wider text-[#fff6e6] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none"
            style={{ background: s.accent }}
          >
            <span className="block skew-x-6">{last ? "LET'S RACE!" : "NEXT"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
