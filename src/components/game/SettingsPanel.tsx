"use client";

import { useState, useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useGameStore } from "@/game/store";
import { usePWA } from "@/hooks/usePWA";
import { DIFFICULTIES, DIFFICULTY_ORDER, PALETTE, type Difficulty } from "@/game/types";
import { Maximize, Minimize, Download, Check } from "lucide-react";

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

function subscribeFullscreen(callback: () => void) {
  document.addEventListener("fullscreenchange", callback);
  return () => document.removeEventListener("fullscreenchange", callback);
}
const serverFullscreen = () => false;
const fullscreenSupportedSnapshot = () => Boolean(document.fullscreenEnabled);
const fullscreenSnapshot = () => Boolean(document.fullscreenElement);

export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);
  const loadBest = useGameStore((s) => s.loadBest);
  const resetBest = useGameStore((s) => s.resetBest);
  const { isInstalled, isInstallable, install } = usePWA();

  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const fullscreenSupported = useSyncExternalStore(subscribeFullscreen, fullscreenSupportedSnapshot, serverFullscreen);
  const isFullscreen = useSyncExternalStore(subscribeFullscreen, fullscreenSnapshot, serverFullscreen);

  const handleSettingsInstall = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) setShowInstallGuide(true);
    } else {
      setShowInstallGuide(true);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* Fullscreen blocked or unsupported */
    }
  };

  return (
    <div className={`settings-scroll ${compact ? "max-h-[62vh] sm:max-h-[46vh]" : "max-h-[72vh] sm:max-h-[54vh]"} overflow-y-auto rounded-lg border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.94)] px-4 py-1 shadow-inner`}>
      {/* Fullscreen & PWA Status Row */}
      {fullscreenSupported && (
        <>
          <Row label="FULLSCREEN" hint="Immersive edge-to-edge gameplay">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex items-center gap-1.5 rounded-md border-2 border-[#2b1c12] bg-[#f0641e] px-3 py-1.5 text-xs font-black tracking-wider text-[#fff6e6] shadow-[0_2px_0_#2b1c12] active:translate-y-0.5 active:shadow-none"
            >
              {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
              {isFullscreen ? "EXIT" : "ENTER"}
            </button>
          </Row>
          <div className="h-px bg-[#e5d2b3]" />
        </>
      )}

      {/* App Install Row in Settings */}
      <Row
        label={isInstalled ? "APP INSTALLED" : "APP INSTALLATION"}
        hint={isInstalled ? "Running in standalone app mode" : "Play without browser bars"}
      >
        {isInstalled ? (
          <span className="flex items-center gap-1 rounded bg-[#2f9e63]/20 px-2.5 py-1 text-xs font-bold text-[#2f9e63]">
            <Check className="h-3.5 w-3.5" /> INSTALLED
          </span>
        ) : (
          <button
            type="button"
            onClick={handleSettingsInstall}
            className="flex items-center gap-1 rounded-md border-2 border-[#2b1c12] bg-[#ffb020] px-3 py-1.5 text-xs font-black tracking-wider text-[#2b1c12] shadow-[0_2px_0_#2b1c12] active:translate-y-0.5 active:shadow-none hover:bg-[#ffa000]"
          >
            <Download className="h-3.5 w-3.5" />
            INSTALL
          </button>
        )}
      </Row>
      <div className="h-px bg-[#e5d2b3]" />

      {/* Install Guide Modal from Settings */}
      {showInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border-[3px] border-[#2b1c12] bg-[#fff6e6] p-5 shadow-2xl text-[#2b1c12]">
            <h3 className="font-[family-name:var(--font-bungee)] text-base text-[#f0641e] border-b-2 border-[#2b1c12]/20 pb-2">
              INSTALL CANYON RUSH
            </h3>
            <div className="mt-3 space-y-2.5 text-xs leading-relaxed font-medium">
              <p>📱 <strong>iOS (Safari):</strong> Tap Share ⬆️ ➔ &quot;Add to Home Screen&quot; ➔ Tap Add.</p>
              <p>🤖 <strong>Android (Chrome):</strong> Tap Menu ⋮ ➔ &quot;Install app&quot; or &quot;Add to Home screen&quot;.</p>
              <p>💻 <strong>Desktop (Chrome/Edge):</strong> Click the ⊕ Install icon in the address bar (top right).</p>
              <p className="rounded bg-[#f0641e]/10 p-2 text-[11px] text-[#7a3a1e]">
                🚀 Launches full-screen without address bars for the best performance!
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowInstallGuide(false)}
              className="mt-4 w-full rounded-lg border-2 border-[#2b1c12] bg-[#f0641e] py-2 font-[family-name:var(--font-bungee)] text-sm text-[#fff6e6] shadow-[0_2px_0_#2b1c12] active:translate-y-0.5 active:shadow-none"
            >
              GOT IT!
            </button>
          </div>
        </div>
      )}

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
