"use client";

import dynamic from "next/dynamic";

const GameShell = dynamic(() => import("@/components/game/GameShell"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-[#f3c98f]">
      <div className="font-[family-name:var(--font-bungee)] text-4xl text-[#f0641e] [text-shadow:0_3px_0_#2b1c12]">
        CANYON RUSH
      </div>
      <div className="text-xs font-black tracking-[0.3em] text-[#5a3c28]">CARVING THE CANYON…</div>
    </div>
  ),
});

export default function Page() {
  return <GameShell />;
}
