"use client";

import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useGameStore } from "@/game/store";
import { DIFFICULTIES, DIFFICULTY_ORDER, PALETTE, type Difficulty } from "@/game/types";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="flex flex-col">
        <span className="text-sm font-bold tracking-wide text-[#2b1c12]">{label}</span>
        {hint && <span className="text-[11px] leading-tight text-[#8a6a4e]">{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border-2 border-[#2b1c12] bg-[#fff6e6]">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={`min-w-11 px-2.5 py-1.5 text-xs font-black tracking-wider transition-colors ${
            value === o.v ? "bg-[#f0641e] text-[#fff6e6]" : "bg-transparent text-[#2b1c12] hover:bg-[#f6e3c2]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);
  const loadBest = useGameStore((s) => s.loadBest);
  const resetBest = useGameStore((s) => s.resetBest);

  return (
    <div className={`settings-scroll ${compact ? "max-h-[46vh]" : "max-h-[52vh]"} overflow-y-auto rounded-lg border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.94)] px-4 py-1 shadow-inner`}>
      <Row label="LAPS" hint="Race length">
        <Seg
          value={settings.laps}
          options={[
            { v: 1, label: "1" },
            { v: 2, label: "2" },
            { v: 3, label: "3" },
            { v: 5, label: "5" },
          ]}
          onChange={(v) => {
            setSettings({ laps: v });
            loadBest(v);
          }}
        />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label="DIFFICULTY" hint={DIFFICULTIES[settings.difficulty].hint}>
        <Seg
          value={settings.difficulty}
          options={DIFFICULTY_ORDER.map((d) => ({ v: d, label: DIFFICULTIES[d].short }))}
          onChange={(v: Difficulty) => setSettings({ difficulty: v })}
        />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label="STEERING ASSIST" hint="Gentle auto-correct & anti-spin">
        <Switch checked={settings.assist} onCheckedChange={(v) => setSettings({ assist: v })} />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label="MOUSE STEERING" hint="Steer with mouse, hold LMB to accelerate">
        <Switch checked={settings.mouseSteer} onCheckedChange={(v) => setSettings({ mouseSteer: v })} />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label="CAMERA" hint="Cycle anytime with C / Y">
        <Seg
          value={settings.cameraMode}
          options={[
            { v: 0 as const, label: "CHASE" },
            { v: 1 as const, label: "FAR" },
            { v: 2 as const, label: "HOOD" },
          ]}
          onChange={(v) => setSettings({ cameraMode: v })}
        />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label={`MUSIC — ${Math.round(settings.musicVol * 100)}%`}>
        <Slider
          className="w-36"
          value={[settings.musicVol]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => setSettings({ musicVol: v })}
        />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label={`SOUND FX — ${Math.round(settings.sfxVol * 100)}%`}>
        <Slider
          className="w-36"
          value={[settings.sfxVol]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => setSettings({ sfxVol: v })}
        />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label="RICH PARTICLES">
        <Switch checked={settings.highParticles} onCheckedChange={(v) => setSettings({ highParticles: v })} />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <Row label="SHADOWS" hint="Long canyon shadows">
        <Switch checked={settings.shadows} onCheckedChange={(v) => setSettings({ shadows: v })} />
      </Row>
      <div className="h-px bg-[#e5d2b3]" />
      <div className="flex items-center justify-between py-3">
        <span className="text-sm font-bold text-[#2b1c12]">RESET BEST TIMES</span>
        <button
          type="button"
          onClick={() => {
            resetBest();
            try {
              localStorage.removeItem("canyonrush.ghost.v1");
            } catch {
              /* ignore */
            }
            window.location.reload();
          }}
          className="rounded-md border-2 border-[#2b1c12] bg-[#d64530] px-3 py-1.5 text-xs font-black tracking-wider text-[#fff6e6] transition-transform hover:scale-105 active:scale-95"
          style={{ backgroundColor: PALETTE.uiRed }}
        >
          CLEAR
        </button>
      </div>
    </div>
  );
}
