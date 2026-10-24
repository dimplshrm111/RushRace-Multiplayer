"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsRight, Radio, Users } from "lucide-react";
import { useGameStore } from "@/game/store";
import { useMPStore } from "@/game/net-store";
import { net } from "@/game/net";
import { AudioSystem } from "@/game/audio";
import { InputManager, type InputAction } from "@/game/input";
import { GameEngine } from "@/game/engine";
import { autopilotInput } from "@/game/physics";
import type { ResultsData } from "@/game/types";
import { HUD } from "./HUD";
import { TitleScreen } from "./TitleScreen";
import { Tutorial } from "./Tutorial";
import { PauseMenu } from "./PauseMenu";
import { Results } from "./Results";
import { TouchControls } from "./TouchControls";
import { RotatePrompt } from "./RotatePrompt";
import { MPHome } from "../multiplayer/MPHome";
import { Lobby } from "../multiplayer/Lobby";
import { ChatPanel } from "../multiplayer/ChatPanel";
import { Garage } from "./Garage";

export default function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const audioRef = useRef<AudioSystem | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  /** false until the world is built + shaders prewarmed — drives the loading overlay */
  const [ready, setReady] = useState(false);

  const phase = useGameStore((s) => s.phase);
  const paused = useGameStore((s) => s.paused);
  const results = useGameStore((s) => s.results);
  const settings = useGameStore((s) => s.settings);
  const tutorialSeen = useGameStore((s) => s.tutorialSeen);
  const garageOpen = useGameStore((s) => s.garageOpen);
  const carModel = useGameStore((s) => s.carModel);
  const carColor = useGameStore((s) => s.carColor);
  const setPhase = useGameStore((s) => s.setPhase);
  const setPaused = useGameStore((s) => s.setPaused);
  const setCountdown = useGameStore((s) => s.setCountdown);
  const setResults = useGameStore((s) => s.setResults);
  const setSettings = useGameStore((s) => s.setSettings);
  const loadBest = useGameStore((s) => s.loadBest);

  // multiplayer UI state
  const mpScreen = useMPStore((s) => s.screen);
  const mpRoom = useMPStore((s) => s.room);
  const myId = useMPStore((s) => s.myId);
  const mpConnection = useMPStore((s) => s.connection);
  const mpPing = useMPStore((s) => s.ping);
  const mpToast = useMPStore((s) => s.toast);
  const setMPScreen = useMPStore((s) => s.setScreen);
  const clearMPChatOpen = useMPStore((s) => s.setChatOpen);

  const inMPRoom = mpScreen === "room" && mpRoom != null;
  const inMPRace =
    inMPRoom && (phase === "countdown" || phase === "racing" || phase === "finished");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let buildTimer: ReturnType<typeof setTimeout> | undefined;

    const audio = new AudioSystem();
    const input = new InputManager();
    audioRef.current = audio;
    inputRef.current = input;
    input.attach();

    const attachEngine = (engine: GameEngine) => {
      engineRef.current = engine;
      (window as unknown as { __canyonRush?: unknown }).__canyonRush = { engine, audio, input };
      input.onAction = (a: InputAction) => {
        const st = useGameStore.getState();
        if (a === "camera") {
          const next = ((st.settings.cameraMode + 1) % 3) as 0 | 1 | 2;
          st.setSettings({ cameraMode: next });
        } else if (a === "restart") {
          // no local restarts in a shared race — it would desync the room
          if (net.inRoom) return;
          if (st.phase === "racing" || st.phase === "countdown" || st.phase === "finished") {
            if (st.paused) st.setPaused(false);
            engine.restart();
          }
        } else if (a === "pause") {
          if (st.phase === "racing" || st.phase === "countdown") {
            st.setPaused(!st.paused);
          }
        } else if (a === "mute") {
          const muted = st.settings.musicVol === 0 && st.settings.sfxVol === 0;
          st.setSettings(muted ? { musicVol: 0.75, sfxVol: 0.9 } : { musicVol: 0, sfxVol: 0 });
        }
      };
      engine.applySettings(useGameStore.getState().settings);
      loadBest(useGameStore.getState().settings.laps);
      // hand the engine to the multiplayer layer (lap reporting + state sync)
      net.attachEngine(engine);
    };

    // audio unlock on first gesture
    const unlock = () => {
      audio.unlock();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    // auto-pause on blur while racing — never in a shared multiplayer race:
    // the race keeps running server-side, so pausing would just freeze our
    // car while everyone else drives on
    const onBlur = () => {
      const st = useGameStore.getState();
      if (
        (st.phase === "racing" || st.phase === "countdown") &&
        !st.paused &&
        !net.inRoom
      ) {
        st.setPaused(true);
      }
    };
    window.addEventListener("blur", onBlur);

    const onResize = () => engineRef.current?.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => engineRef.current?.resize());
    ro.observe(canvas);

    // prevent context menu / scrolling on the canvas
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener("contextmenu", noMenu);

    // Build the world only after the loading overlay has painted: the scene
    // build + shader prewarm is one heavy synchronous block, and without this
    // the first seconds look like a frozen screen "still loading".
    const raf = requestAnimationFrame(() => {
      buildTimer = setTimeout(() => {
        if (cancelled) return;
        const engine = new GameEngine(canvas, audio, input, {
          onPhaseChange: (p) => setPhase(p),
          onCountdown: (v) => setCountdown(v),
          onFinish: (r: ResultsData) => {
            setResults(r);
            if (r.dnf) return; // DNF (server-ended race) — nothing to report
            // multiplayer: report the validated finish to the room server
            net.sendFinish(r);
            // persist to the local leaderboard backend (use the MP name when racing online)
            const mpName = useMPStore.getState().room?.players.find(
              (p) => p.id === useMPStore.getState().myId
            )?.name;
            void fetch("/api/records", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                laps: r.laps,
                timeMs: Math.round(r.totalMs),
                bestLapMs: Math.round(r.bestLapMs),
                topSpeedKmh: r.topSpeedKmh,
                driftScore: r.driftScore,
                racerName: net.inRoom && mpName ? mpName : undefined,
              }),
            }).catch(() => undefined);
          },
        });
        if (cancelled) {
          engine.dispose();
          return;
        }
        attachEngine(engine);
        setReady(true);
      }, 40);
    });

    // ---------- self-test mode (?selftest=1) ----------
    let selftestCleanup: (() => void) | undefined;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("selftest")) {
      const errors: string[] = [];
      const onErr = (e: ErrorEvent) => errors.push(e.message);
      window.addEventListener("error", onErr);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      void (async () => {
        await sleep(1800); // let first frames render (engine builds behind the loading overlay)
        const eng = engineRef.current;
        if (!eng) return;
        eng.debugSelftestActive = true;
        eng.startRace(1);
        eng.debugSkipCountdown();
        const p = eng.physics;
        const track = eng.track;
        const maxSteps = 60 * 240; // up to 240s of game time
        let steps = 0;
        while (steps < maxSteps && eng.phase === "racing") {
          eng.debugStep(autopilotInput(p, track), 1 / 60);
          steps++;
          if (steps % 300 === 0) await sleep(0);
        }
        eng.debugSelftestActive = false;
        const finished = eng.phase === "finished";
        const standings = eng.getStandings();
        const res = {
          ok:
            finished &&
            errors.length === 0 &&
            p.topSpeed > 80 &&
            (p.nearMisses > 0 || p.driftScore > 0),
          finished,
          phase: eng.phase,
          stepsSimulated: steps,
          topSpeedKmh: Math.round(p.topSpeed),
          nearMisses: p.nearMisses,
          driftScore: Math.round(p.driftScore),
          boostMeter: Math.round(p.boostMeter),
          progressPct: +(p.lapProgress.toFixed(3)),
          rivals: standings.map((s) => ({
            name: s.name,
            pos: s.pos,
            timeMs: s.timeMs == null ? null : Math.round(s.timeMs),
          })),
          errors,
        };
        console.log("[SELFTEST]", JSON.stringify(res));
        const el = document.getElementById("selftest-result");
        if (el) el.textContent = JSON.stringify(res);
      })();
      selftestCleanup = () => window.removeEventListener("error", onErr);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (buildTimer) clearTimeout(buildTimer);
      selftestCleanup?.();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("contextmenu", noMenu);
      ro.disconnect();
      net.detachEngine();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // apply settings when they change
  useEffect(() => {
    engineRef.current?.applySettings(settings);
  }, [settings]);

  // swap the player's SUV when the garage selection changes (visual only)
  useEffect(() => {
    engineRef.current?.setPlayerCar(carModel, carColor);
  }, [carModel, carColor, ready]);

  // hide MP overlays whenever the game screen changes away from them
  useEffect(() => {
    if (mpScreen === "none") clearMPChatOpen(false);
  }, [mpScreen, clearMPChatOpen]);

  // leaving a race back to the title while in a room → back to the lobby view
  useEffect(() => {
    if (phase === "title" && net.inRoom) {
      clearMPChatOpen(false);
    }
  }, [phase, clearMPChatOpen]);

  // auto-dismiss multiplayer toasts
  useEffect(() => {
    if (!mpToast) return;
    const t = setTimeout(() => {
      useMPStore.setState({ toast: null });
    }, 4200);
    return () => clearTimeout(t);
  }, [mpToast]);

  const startRace = () => {
    audioRef.current?.unlock();
    engineRef.current?.startRace(settings.laps);
  };

  const beginFromTitle = () => {
    if (!tutorialSeen) {
      setPhase("title");
      useGameStore.getState().setHint("tutorial");
    } else {
      startRace();
    }
  };

  const isHost = !!mpRoom && mpRoom.hostId === myId;
  const connectedCount = mpRoom?.players.filter((p) => p.connected).length ?? 0;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#f3c98f] select-none" style={{ touchAction: "none" }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Canyon Rush 3D game viewport" />

      {/* Loading overlay — visible while the canyon is built & shaders prewarm */}
      {!ready && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-7 bg-gradient-to-b from-[#ffd9a0] via-[#f3c98f] to-[#e8a86b]"
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <h1 className="text-4xl font-black tracking-[0.18em] text-[#2b1c12] sm:text-6xl">
              CANYON RUSH
            </h1>
            <p className="mt-3 text-xs font-bold tracking-[0.42em] text-[#7a4526] sm:text-sm">
              SUNSTONE CIRCUIT
            </p>
          </div>
          <div className="flex items-center text-[#f0641e]" aria-hidden="true">
            <ChevronsRight className="h-7 w-7 animate-pulse" style={{ animationDelay: "0ms" }} />
            <ChevronsRight className="h-7 w-7 animate-pulse" style={{ animationDelay: "220ms" }} />
            <ChevronsRight className="h-7 w-7 animate-pulse" style={{ animationDelay: "440ms" }} />
          </div>
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-[#2b1c12]/15">
            <div className="loading-bar-anim h-full w-1/3 rounded-full bg-[#f0641e]" />
          </div>
          <p className="text-[11px] font-bold tracking-[0.32em] text-[#7a4526]">
            CARVING THE CANYON&hellip;
          </p>
        </div>
      )}

      {ready && (
        <>
          {/* HUD during countdown/racing */}
          {(phase === "countdown" || phase === "racing") && (
            <HUD engineRef={engineRef} countdownActive={phase === "countdown"} />
          )}

          {/* Touch controls while racing on touch devices */}
          {phase === "racing" && <TouchControls inputRef={inputRef} onPause={() => setPaused(true)} />}

          {/* multiplayer: connection chip + in-race chat */}
          {inMPRace && !paused && (
            <>
              <div className="pointer-events-none absolute bottom-[60px] right-3 z-20 flex items-center gap-2 rounded-full border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.72)] px-3 py-1 text-[10px] font-black tracking-wider text-[#fff6e6] shadow-lg">
                <span className="flex items-center gap-1 text-[#ffb020]">
                  <Radio className="h-3 w-3" aria-hidden />
                  {mpConnection === "online" ? "LIVE" : "…"}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" aria-hidden />
                  {connectedCount}/{mpRoom?.maxPlayers ?? 10}
                </span>
                <span className="text-[#c9a06a]">{mpPing}ms</span>
              </div>
              <ChatPanel variant="race" />
            </>
          )}

          {/* Title */}
          {phase === "title" && !paused && mpScreen === "none" && (
            <TitleScreen
              onRace={beginFromTitle}
              onHowToPlay={() => useGameStore.getState().setHint("tutorial")}
              engineRef={engineRef}
            />
          )}

          {/* Multiplayer entry screen */}
          {phase === "title" && mpScreen === "home" && <MPHome />}

          {/* Multiplayer room lobby (also the spectate view during races) */}
          {phase === "title" && inMPRoom && !paused && <Lobby engineRef={engineRef} />}

          {/* Tutorial (shown when hint === 'tutorial') */}
          <Tutorial
            onComplete={() => {
              useGameStore.getState().markTutorialSeen();
              useGameStore.getState().setHint(null);
              startRace();
            }}
          />

          {/* Pause */}
          {paused && (phase === "racing" || phase === "countdown") && (
            <PauseMenu
              onResume={() => setPaused(false)}
              onRestart={() => {
                setPaused(false);
                engineRef.current?.restart();
              }}
              onQuit={() => {
                setPaused(false);
                // in a shared race, tell the server we're out so the field
                // isn't held waiting (DNF) — then return to the lobby view
                if (inMPRoom) net.forfeit();
                engineRef.current?.toTitle();
              }}
              canRestart={!inMPRoom}
              quitLabel={inMPRoom ? "BACK TO LOBBY (DNF)" : "QUIT TO TITLE"}
              engineRef={engineRef}
            />
          )}

          {/* Results */}
          {phase === "finished" && results && (
            <Results
              data={results}
              onRetry={() => engineRef.current?.restart()}
              onTitle={() => engineRef.current?.toTitle()}
              mp={
                inMPRoom
                  ? {
                      isMultiplayer: true,
                      isHost,
                      roomPhase: mpRoom?.phase ?? "lobby",
                      onRematch: () => void net.rematch(),
                      onLobby: () => engineRef.current?.toTitle(),
                    }
                  : undefined
              }
            />
          )}
        </>
      )}

      {/* Car garage overlay (title screen, lobby, anywhere) */}
      {ready && garageOpen && <Garage />}

      {/* MP toast (errors / notices) */}
      {mpToast && Date.now() - mpToast.at < 4200 && (
        <div
          role="status"
          className={`absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-md border-2 px-4 py-2 text-xs font-black tracking-wider shadow-xl ${
            mpToast.kind === "error"
              ? "border-[#2b1c12] bg-[#d64530] text-[#fff6e6]"
              : mpToast.kind === "success"
                ? "border-[#2b1c12] bg-[#2f9e63] text-[#fff6e6]"
                : "border-[#2b1c12] bg-[#fff6e6] text-[#2b1c12]"
          }`}
        >
          {mpToast.text}
        </div>
      )}

      <RotatePrompt />
      <div id="selftest-result" className="sr-only" aria-hidden="true" />
    </div>
  );
}
