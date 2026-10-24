"use client";

import * as THREE from "three";
import { Track, SUN_DIR, type TrackBox } from "./track";
import { CarVisual } from "./car";
import { CarPhysics } from "./physics";
import { ParticleSystem } from "./particles";
import { DebrisSystem } from "./debris";
import { AudioSystem } from "./audio";
import { InputManager } from "./input";
import { gameStore } from "./store";
import { OPPONENT_GRID_LAT, OPPONENTS, Opponent, opponentInput } from "./ai";
import { RemotePlayer } from "./remote";
import type { MPRemoteState } from "./net-types";
import {
  BOX_RESPAWN_MS,
  DEFAULT_SETTINGS,
  DIFFICULTIES,
  PALETTE,
  WALL_RESPAWN_MS,
  clamp,
  damp,
  type DriveInput,
  type GamePhase,
  type GameSettings,
  type ResultsData,
  type StandingEntry,
  type Telemetry,
} from "./types";

export interface EngineCallbacks {
  onPhaseChange(p: GamePhase): void;
  onCountdown(v: number): void;
  onFinish(r: ResultsData): void;
}

const GHOST_KEY = "canyonrush.ghost.v1";

interface GhostFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class GameEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  track: Track;
  car: CarVisual;
  ghostCar: CarVisual;
  physics: CarPhysics;
  particles = new ParticleSystem();
  debris: DebrisSystem;
  private audio: AudioSystem;
  private input: InputManager;
  private cbs: EngineCallbacks;
  private settings: GameSettings = { ...DEFAULT_SETTINGS };

  phase: GamePhase = "title";
  paused = false;
  private raf = 0;
  private lastT = 0;
  private time = 0;

  // race state
  private countdownT = 0;
  private countdownShown = -99;
  private raceTime = 0;
  private lapStart = 0;
  lapsDone = 0;
  private totalLaps = 3;
  private lineAbs = 0; // progressS value of the current lap's start line
  private nextGateK = 0;
  private nextGateAbs = 0;
  private splits: number[] = [];
  private bestSplits: number[] = [];
  private bestTotalMs: number | null = null;
  private bestLapMs: number | null = null;
  private lapTimes: number[] = [];
  private bigAirCount = 0;
  private recoverT = 0;
  private titleCamS = 0;
  private finishOrbitT = 0;

  // ghost
  private ghost: GhostFrame[] = [];
  private ghostRec: GhostFrame[] = [];
  private ghostRecT = 0;

  // camera state
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camRoll = 0;
  private trauma = 0;
  private fov = 66;
  private wallRideLean = 0;

  // sun
  private sun: THREE.DirectionalLight;

  // AI rivals
  opponents: Opponent[] = [];
  private playerStartS = 0;
  private playerFinishMs: number | null = null;
  private standingsTimer = 0;
  private playerPos = 1;
  private lastStandingsKey = "";
  private lastBumpT = -10;

  // multiplayer (driven by net.ts — hidden AI rivals, network cars)
  remotes: RemotePlayer[] = [];
  mpActive = false;
  mpSpectating = false;
  mpMyName = "YOU";
  mpMyColor = "#f0641e";
  /** net layer hook — reports each completed lap to the server */
  onMpLap: ((lap: number, lapMs: number) => void) | null = null;

  private telemetryListeners = new Set<(t: Telemetry) => void>();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private disposed = false;
  private skidTimer = 0;
  private sparkTimer = 0;
  private boostTrailTimer = 0;

  constructor(
    canvas: HTMLCanvasElement,
    audio: AudioSystem,
    input: InputManager,
    cbs: EngineCallbacks
  ) {
    this.audio = audio;
    this.input = input;
    this.cbs = cbs;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    const isMobile =
      typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.3, 4200);
    // generous fog band — the road ahead must stay readable at racing speed
    this.scene.fog = new THREE.Fog(PALETTE.fog, 430, 1500);

    // sky
    this.buildSky();

    // lights
    const hemi = new THREE.HemisphereLight(0xffe9c9, 0xcaa06a, 0.8);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a8, 1.8);
    this.sun.castShadow = !isMobile;
    this.sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -95;
    sc.right = 95;
    sc.top = 95;
    sc.bottom = -95;
    sc.near = 20;
    sc.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // world
    this.track = new Track();
    this.scene.add(this.track.group);
    this.scene.add(this.particles.group);
    this.debris = new DebrisSystem(isMobile);
    this.scene.add(this.debris.group);

    // cars
    this.car = new CarVisual(false);
    this.scene.add(this.car.group);
    this.ghostCar = new CarVisual(true);
    this.ghostCar.group.visible = false;
    this.scene.add(this.ghostCar.group);

    // AI rivals (identical performance, different paint & skill)
    for (let i = 0; i < OPPONENTS.length; i++) {
      const op = new Opponent(OPPONENTS[i], this.track, OPPONENT_GRID_LAT[i]);
      // rival crate smashes shatter too (debris + a soft distant crack)
      op.boxHitHook = (box) => {
        const v = op.physics.vel;
        const sp = Math.hypot(v.x, v.z);
        const dirX = sp > 2 ? v.x / sp : 0;
        const dirZ = sp > 2 ? v.z / sp : 1;
        const power = clamp(6 + sp * 0.5, 7, 20);
        let n = 0;
        for (const b of this.track.boxes) {
          if (b.cluster !== box.cluster || (!b.active && b !== box)) continue;
          this.smashBox(b, dirX, dirZ, power, n * 0.045);
          n++;
        }
        const d = box.x - this.physics.pos.x;
        const dz = box.z - this.physics.pos.z;
        if (d * d + dz * dz < 70 * 70) {
          if (box.wall) this.audio.wallSmash();
          else this.audio.boxHit();
        }
      };
      this.scene.add(op.visual.group);
      this.opponents.push(op);
    }
    this.scatterOpponentsOnTrack();

    this.physics = new CarPhysics(this.track, {
      onJump: () => this.audio.jump(),
      onLanding: (i, clean) => {
        this.audio.landing(clean, i);
        this.trauma = Math.min(1, this.trauma + 0.18 + i * 0.3);
        this.input.rumble(0.2 + i * 0.5, 120);
        this.dustBurst(6 + Math.round(i * 6));
      },
      onCleanLand: (at) => {
        gameStore.getState().pushPopup("cleanland", `CLEAN LANDING +${Math.round(Math.min(30, at * 16))}`);
      },
      onBigAir: (at) => {
        this.bigAirCount++;
        gameStore.getState().pushPopup("airtime", `BIG AIR ${at.toFixed(1)}s +${Math.round(Math.min(30, at * 16))}`);
      },
      onDriftBank: (mult) => {
        gameStore.getState().pushPopup("driftbank", `DRIFT CHAIN x${mult.toFixed(1)}`);
        this.audio.driftBank(mult);
      },
      onNearMiss: () => {
        gameStore.getState().pushPopup("nearmiss", "NEAR MISS +9");
        this.audio.nearMiss();
        this.trauma = Math.min(1, this.trauma + 0.08);
      },
      onWallRideStart: () => {
        gameStore.getState().pushPopup("wallride", "WALL RIDE +");
      },
      onCrash: (i) => {
        this.audio.crash(i);
        this.trauma = Math.min(1, this.trauma + 0.25 + i * 0.45);
        this.input.rumble(0.4 + i * 0.6, 200);
        const p = this.physics.pos;
        this.particles.emitSparks(p.x, p.y, p.z, -Math.sin(this.physics.yaw), -Math.cos(this.physics.yaw), 8 + Math.round(i * 10));
      },
      onBoostStart: () => {
        this.audio.boostStart();
        this.input.rumble(0.25, 90);
      },
      onBoxHit: (box) => {
        // the whole stack / barricade shatters — chain-break every piece of
        // the cluster, with a tiny stagger so the break ripples outward
        const v = this.physics.vel;
        const sp = Math.hypot(v.x, v.z);
        const dirX = sp > 2 ? v.x / sp : Math.sin(this.physics.yaw);
        const dirZ = sp > 2 ? v.z / sp : Math.cos(this.physics.yaw);
        const power = clamp(6 + sp * 0.55, 7, 24);
        let n = 0;
        for (const b of this.track.boxes) {
          if (b.cluster !== box.cluster || (!b.active && b !== box)) continue;
          this.smashBox(b, dirX, dirZ, power, n * 0.045);
          n++;
        }
        if (box.wall) {
          this.audio.wallSmash();
          this.trauma = Math.min(1, this.trauma + 0.38);
          this.input.rumble(0.55, 240);
          const add = Math.round(15 * this.physics.boostScale);
          this.physics.boostMeter = clamp(this.physics.boostMeter + add, 0, 100);
          gameStore.getState().pushPopup("smash", `BREAK THROUGH! +${add}`);
        } else {
          this.audio.boxHit();
          this.trauma = Math.min(1, this.trauma + 0.16);
          this.input.rumble(0.3, 130);
          if (n > 1) {
            const add = Math.round(6 * this.physics.boostScale);
            this.physics.boostMeter = clamp(this.physics.boostMeter + add, 0, 100);
            gameStore.getState().pushPopup("smash", `CRATES SMASHED +${add}`);
          }
        }
      },
      requestRecovery: () => this.startRecovery(),
    });

    this.loadBest();
    this.physics.place(this.track.N - 10, 0, 0);
    this.syncCarVisual(0.016);
    this.updateSun();

    this.resize();
    // prewarm every shader while the loading overlay is still up — the first
    // real frame then paints instantly instead of hitching on compilation
    this.renderer.compile(this.scene, this.camera);
    this.lastT = performance.now();
    this.loop();
  }

  // ============================================================
  // setup helpers
  // ============================================================

  private buildSky() {
    const geo = new THREE.SphereGeometry(3900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZen: { value: new THREE.Color(PALETTE.skyZenith) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uHor: { value: new THREE.Color(PALETTE.skyHorizon) },
        uSun: { value: SUN_DIR.clone() },
      },
      vertexShader: `
        varying vec3 vW;
        void main() {
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uZen; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uSun;
        varying vec3 vW;
        void main() {
          vec3 d = normalize(vW);
          float h = d.y;
          vec3 col = h > 0.16 ? mix(uMid, uZen, smoothstep(0.16, 0.6, h))
                              : mix(uHor, uMid, smoothstep(-0.06, 0.16, h));
          float sd = max(dot(d, uSun), 0.0);
          col += vec3(1.0, 0.88, 0.62) * (pow(sd, 900.0) * 1.2 + pow(sd, 16.0) * 0.3 + pow(sd, 4.0) * 0.1);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  private loadBest() {
    try {
      const raw = localStorage.getItem("canyonrush.best.v1");
      if (raw) {
        const d = JSON.parse(raw) as {
          totalMs: number;
          bestLapMs: number;
          splits: number[];
          laps: number;
        };
        this.bestTotalMs = d.totalMs;
        this.bestLapMs = d.bestLapMs;
        this.bestSplits = d.splits ?? [];
      }
      const graw = localStorage.getItem(GHOST_KEY);
      if (graw) this.ghost = JSON.parse(graw) as GhostFrame[];
    } catch {
      /* ignore */
    }
  }

  // ============================================================
  // public control API
  // ============================================================

  onTelemetry(fn: (t: Telemetry) => void): () => void {
    this.telemetryListeners.add(fn);
    return () => this.telemetryListeners.delete(fn);
  }

  applySettings(s: GameSettings) {
    const prevShadows = this.settings.shadows;
    this.settings = { ...s };
    // HARD strips the safety net — no auto-correct, no anti-spin
    // (multiplayer always uses the player's own assist preference)
    this.physics.assist = this.mpActive
      ? s.assist
      : s.difficulty === "hard"
        ? false
        : s.assist;
    this.particles.setHighDensity(s.highParticles);
    this.debris.setHighDensity(s.highParticles);
    this.audio.setVolumes(s.musicVol, s.sfxVol);
    this.input.setMouseSteer(s.mouseSteer);
    // difficulty: crate traffic, rival pace/brain, boost economy
    // (multiplayer races use fixed MEDIUM handling so every car is equal)
    const diff = this.mpActive
      ? DIFFICULTIES.medium
      : DIFFICULTIES[s.difficulty] ?? DIFFICULTIES.medium;
    this.track.setActiveStacks(diff.stacks);
    this.physics.boostScale = diff.boostGain;
    for (const op of this.opponents) {
      op.brain = {
        skillScale: diff.aiSkill,
        mistakeEvery: diff.aiMistakeEvery,
        rubberAhead: diff.rubberAhead,
        rubberBehind: diff.rubberBehind,
        boostAggro: diff.aiBoostAggro,
        blocking: diff.blocking,
      };
      op.physics.speedCapScale = diff.aiSpeedCap;
    }
    if (prevShadows !== s.shadows) {
      this.renderer.shadowMap.enabled = s.shadows;
      this.sun.castShadow = s.shadows;
      this.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) (m as THREE.Material).needsUpdate = true;
        }
      });
    }
  }

  startRace(laps: number) {
    this.totalLaps = laps;
    this.loadBest();
    this.lapsDone = 0;
    this.raceTime = 0;
    this.lapStart = 0;
    this.splits = [];
    this.lapTimes = [];
    this.bigAirCount = 0;
    this.physics.boostMeter = (DIFFICULTIES[this.settings.difficulty] ?? DIFFICULTIES.medium)
      .startBoost;
    this.physics.driftScore = 0;
    this.physics.nearMisses = 0;
    this.physics.topSpeed = 0;
    this.placeRaceGrid();
    // fresh crates for the new race (respecting the difficulty limit)
    this.track.setActiveStacks((DIFFICULTIES[this.settings.difficulty] ?? DIFFICULTIES.medium).stacks);
    this.particles.clearSkids(this.time);
    this.ghostRec = [];
    this.ghostRecT = 0;
    this.ghostCar.group.visible = this.ghost.length > 0;
    this.countdownT = 3;
    this.countdownShown = -99;
    this.recoverT = 0;
    this.wallWarned.clear();
    this.lineAbs = this.track.length; // first line crossing = one length from spawn
    this.nextGateK = 0;
    this.nextGateAbs = this.gateAbs(0);
    this.playerFinishMs = null;
    this.lastStandingsKey = "";
    this.pushStandings(true);
    this.setPhase("countdown");
    this.audio.startMusic();
  }

  /** 2×2 start grid — two rivals on the front row, one alongside the player. */
  private placeRaceGrid() {
    const t = this.track;
    this.physics.place(t.N - 15, 2.6, 0);
    this.playerStartS = this.physics.progressS;
    for (let i = 0; i < this.opponents.length; i++) {
      const idx = i < 2 ? t.N - 8 : t.N - 15;
      this.opponents[i].place(idx, OPPONENT_GRID_LAT[i], 0);
    }
    this.syncCarVisual(0.016);
  }

  /** Drop the rivals around the loop so the title flyover feels alive. */
  private scatterOpponentsOnTrack() {
    const t = this.track;
    for (let i = 0; i < this.opponents.length; i++) {
      this.opponents[i].place(
        wrapI(t.N - 40 - i * 110, t.N),
        (i % 2 === 0 ? -1 : 1) * 2.2,
        22
      );
    }
  }

  restart() {
    if (this.phase === "countdown" || this.phase === "racing" || this.phase === "finished") {
      this.startRace(this.totalLaps);
    }
  }

  toTitle() {
    this.setPhase("title");
    this.physics.place(this.track.N - 10, 0, 0);
    this.ghostCar.group.visible = false;
    this.car.group.visible = !this.mpSpectating;
    this.scatterOpponentsOnTrack();
    gameStore.getState().setStandings([]);
  }

  setPaused(v: boolean) {
    this.paused = v;
    this.audio.setDucked(v);
  }

  // ============================================================
  // multiplayer session management (called from net.ts)
  // ============================================================

  /** Enter/leave a multiplayer session: AI rivals are hidden and network
   *  cars take their place. Single-player flow is untouched when inactive. */
  setMultiplayerSession(active: boolean) {
    if (this.mpActive === active) return;
    this.mpActive = active;
    if (!active) {
      for (const rp of this.remotes) {
        this.scene.remove(rp.visual.group);
        rp.dispose();
      }
      this.remotes = [];
      this.mpSpectating = false;
      this.car.group.visible = true;
    }
    for (const op of this.opponents) op.visual.group.visible = !active;
    // re-apply difficulty handling for the new mode (fair medium in MP)
    this.applySettings(this.settings);
  }

  /** Late joiners / quitters watch the canyon flythrough instead of racing. */
  setSpectating(v: boolean) {
    if (this.mpSpectating === v) return;
    this.mpSpectating = v;
    this.car.group.visible = !v;
    if (v) this.ghostCar.group.visible = false;
  }

  getRemote(id: string): RemotePlayer | undefined {
    return this.remotes.find((r) => r.id === id);
  }

  /** Match the rendered remote-car roster to the room's player list. */
  syncRemotes(roster: { id: string; name: string; color: string }[]) {
    const keep = new Set(roster.map((r) => r.id));
    this.remotes = this.remotes.filter((rp) => {
      if (keep.has(rp.id)) return true;
      this.scene.remove(rp.visual.group);
      rp.dispose();
      return false;
    });
    for (const r of roster) {
      const existing = this.getRemote(r.id);
      if (existing) {
        existing.setName(r.name);
        continue;
      }
      const rp = new RemotePlayer(r.id, r.name, r.color);
      this.scene.add(rp.visual.group);
      this.remotes.push(rp);
    }
  }

  applyRemoteSnapshot(id: string, st: MPRemoteState) {
    const rp = this.getRemote(id);
    if (!rp) return; // roster sync arrives with the next room state
    rp.push({
      x: st.x,
      y: st.y,
      z: st.z,
      yaw: st.yaw,
      steer: st.steer,
      spd: st.spd,
      boost: st.boost,
      drift: st.drift,
      ground: st.ground,
      prog: st.prog,
    });
  }

  setRemoteFinish(id: string, finishMs: number, pos: number | null) {
    const rp = this.getRemote(id);
    if (!rp) return;
    rp.finishMs = finishMs;
    rp.finishPos = pos;
    this.pushStandings(true);
  }

  resetRemoteRace() {
    for (const rp of this.remotes) {
      rp.finishMs = null;
      rp.finishPos = null;
      rp.progressS = 0;
    }
  }

  get steerInput(): number {
    return this.lastSteer;
  }

  /** Begin a multiplayer race: server-aligned countdown + shared grid slot. */
  startMultiplayerRace(laps: number, gridIndex: number, goInMs: number) {
    this.totalLaps = laps;
    this.loadBest();
    this.lapsDone = 0;
    this.raceTime = 0;
    this.lapStart = 0;
    this.splits = [];
    this.lapTimes = [];
    this.bigAirCount = 0;
    this.mpSpectating = false;
    this.car.group.visible = true;
    // fair fixed handling for every car (MEDIUM-equivalent economy)
    this.physics.assist = this.settings.assist;
    this.physics.boostScale = 1.0;
    this.physics.speedCapScale = 1.0;
    this.physics.boostMeter = DIFFICULTIES.medium.startBoost;
    this.physics.driftScore = 0;
    this.physics.nearMisses = 0;
    this.physics.topSpeed = 0;
    this.track.setActiveStacks(DIFFICULTIES.medium.stacks);
    // grid slot: two-wide rows behind the line, join order = pole outward
    const t = this.track;
    const row = Math.floor(gridIndex / 2);
    const col = gridIndex % 2;
    this.physics.place(wrapI(t.N - 15 - row * 6, t.N), col === 0 ? -2.6 : 2.6, 0);
    this.playerStartS = this.physics.progressS;
    this.particles.clearSkids(this.time);
    this.ghostRec = [];
    this.ghostRecT = 0;
    this.ghostCar.group.visible = false;
    this.countdownT = clamp(goInMs / 1000, 0.05, 6);
    this.countdownShown = -99;
    this.recoverT = 0;
    this.wallWarned.clear();
    this.lineAbs = this.track.length;
    this.nextGateK = 0;
    this.nextGateAbs = this.gateAbs(0);
    this.playerFinishMs = null;
    this.lastStandingsKey = "";
    this.pushStandings(true);
    this.setPhase("countdown");
    this.audio.startMusic();
  }

  /** Self-test helpers: deterministic stepping decoupled from rAF. */
  debugSelftestActive = false;

  /** Server compiled the results while we were still driving (timeout /
   *  everyone else finished / we were too slow) — end the local race as a
   *  DNF and show the final table instead of driving on in a dead race. */
  mpAbortRace() {
    if (this.phase !== "racing" && this.phase !== "countdown") return;
    this.pushStandings(true);
    const position = this.playerPos;
    this.nextGateK = this.track.gates.length;
    this.nextGateAbs = Infinity;
    this.setPhase("finished");
    this.finishOrbitT = 0;
    this.ghostCar.group.visible = false;
    this.cbs.onFinish({
      totalMs: this.raceTime,
      bestLapMs: this.lapTimes.length ? Math.min(...this.lapTimes) : this.raceTime,
      topSpeedKmh: Math.round(this.physics.topSpeed),
      driftScore: Math.round(this.physics.driftScore),
      nearMisses: this.physics.nearMisses,
      bigAirCount: this.bigAirCount,
      laps: this.totalLaps,
      isNewRecord: false,
      splits: [...this.splits],
      position,
      totalCars: this.mpActive ? 1 + this.remotes.length : 1 + this.opponents.length,
      dnf: true,
    });
  }

  debugSkipCountdown() {
    this.countdownT = 0;
    this.countdownShown = 0;
    this.setPhase("racing");
    this.raceTime = 0;
    this.lapStart = 0;
  }

  debugStep(input: DriveInput, dt = 1 / 60) {
    this.updateRacing(dt, input);
    this.syncCarVisual(dt);
  }

  private setPhase(p: GamePhase) {
    this.phase = p;
    this.cbs.onPhaseChange(p);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.track.dispose();
    this.car.dispose();
    this.ghostCar.dispose();
    for (const op of this.opponents) op.dispose();
    for (const rp of this.remotes) rp.dispose();
    this.particles.dispose();
    this.debris.dispose();
    this.renderer.dispose();
  }

  resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ============================================================
  // main loop
  // ============================================================

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.debugSelftestActive) return; // selftest drives physics deterministically
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    dt = clamp(dt, 0.0005, 1 / 30);
    if (this.paused) dt = 0;

    this.time += dt;

    const input = this.input.sample(Math.max(dt, 0.0001));
    this.curInput = input;
    // longitudinal accel estimate for body pitch
    const sp = this.physics.speed;
    if (dt > 0.0001) {
      this.lastAccel = damp(this.lastAccel, (sp - this.prevSpeed) / dt, 6, dt);
    }
    this.prevSpeed = sp;
    this.noteInput(input.steer, input.brake, this.lastAccel);

    if (this.phase === "countdown") this.updateCountdown(dt);
    else if (this.phase === "racing") this.updateRacing(dt, input);
    else if (this.phase === "finished") this.updateFinished(dt);
    else this.updateTitle(dt);

    if (this.recoverT > 0) this.recoverT -= dt;

    this.updateCamera(dt);
    this.updateSun();
    this.updateRemotes(dt);
    this.particles.update(dt, this.time);
    this.debris.update(dt);
    this.updateGateGlow();
    this.updateWallFx();
    this.track.updateBoxes(this.time * 1000); // smashed crates come back
    this.emitTelemetry();

    // audio
    const { rpm } = this.physics.gearAndRpm();
    const intensity =
      this.phase === "title"
        ? 0
        : this.phase === "countdown"
          ? 1
          : this.phase === "finished"
            ? 1
            : clamp(1 + (this.physics.speed > 26 ? 1 : 0) + (this.physics.boosting || this.physics.boostMeter > 82 ? 1 : 0), 0, 3);
    this.audio.update(dt, {
      rpm:
        this.phase === "countdown"
          ? 0.25 + input.throttle * 0.55
          : this.phase === "racing" || this.phase === "finished"
            ? rpm
            : 0.22,
      throttle: this.phase === "racing" ? input.throttle : this.phase === "countdown" ? input.throttle * 0.7 : 0,
      speed: this.physics.speed,
      driftIntensity: this.physics.drifting ? clamp(Math.abs(this.physics.slip) / 0.5, 0, 1) : 0,
      boosting: this.physics.boosting && this.phase === "racing",
      wallRide: this.physics.wallRiding,
      musicIntensity: intensity,
    });

    // render directly to the canvas — keeps MSAA + tone mapping crisp
    this.renderer.render(this.scene, this.camera);
  };

  private updateCountdown(dt: number) {
    this.countdownT -= dt;
    const v = Math.ceil(this.countdownT);
    if (v !== this.countdownShown && v >= 0) {
      this.countdownShown = v;
      // multiplayer races pre-roll up to ~4s before GO — keep the classic
      // 3·2·1 display and only beep inside the final three
      this.cbs.onCountdown(Math.min(v, 3));
      if (v <= 3) this.audio.countdownBeep(v === 0);
    }
    if (this.countdownT <= 0) {
      this.setPhase("racing");
      this.raceTime = 0;
      this.lapStart = 0;
    }
  }

  private updateRacing(dt: number, input: DriveInput) {
    if (this.recoverT > 0) {
      // player frozen briefly after recovery — the field keeps racing
      this.updateOpponents(dt, "race");
      this.resolveCarCollisions();
      return;
    }
    const prevS = this.physics.progressS;
    this.physics.update(input, dt);
    this.raceTime += dt * 1000;
    this.updateOpponents(dt, "race");
    this.resolveCarCollisions();
    this.updateStandings(dt);
    this.syncCarVisual(dt);
    this.emitEffects(dt);
    this.recordGhost(dt);
    this.playGhost();
    this.checkGates(prevS);
    // wrong-way popup (throttled)
    if (this.physics.wrongWay && this.time - this.lastWrongWayPopup > 2.5) {
      this.lastWrongWayPopup = this.time;
      gameStore.getState().pushPopup("wrongway", "WRONG WAY!");
    }
  }

  private lastWrongWayPopup = -10;

  private updateFinished(dt: number) {
    this.physics.update({ steer: 0, throttle: 0, brake: 0.25, handbrake: false, boost: false }, dt);
    this.raceTime += dt * 1000; // clock keeps running so the AI field can finish
    this.updateOpponents(dt, "race");
    this.resolveCarCollisions();
    this.updateStandings(dt);
    this.syncCarVisual(dt);
    this.finishOrbitT += dt;
  }

  private updateTitle(dt: number) {
    this.titleCamS += dt * 15;
    const t = this.track;
    const idx = Math.floor(this.titleCamS / t.step) % t.N;
    const s = t.sample(idx);
    const ahead = t.sample(idx + 22);
    this.camPos.set(
      s.x + s.rx * Math.sin(this.titleCamS * 0.05) * 6,
      s.y + 10 + Math.sin(this.titleCamS * 0.03) * 2.5,
      s.z + s.rz * Math.sin(this.titleCamS * 0.05) * 6
    );
    this.camLook.set(ahead.x, ahead.y + 5, ahead.z);
    this.camera.position.copy(this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
    this.camera.fov = damp(this.camera.fov, 62, 2, dt);
    this.camera.updateProjectionMatrix();
    this.syncCarVisual(dt);
    this.updateOpponents(dt, "cruise");
  }

  // ============================================================
  // racing internals
  // ============================================================

  private gateAbs(k: number): number {
    const t = this.track;
    const gate = t.gates[k];
    if (!gate) return Infinity;
    return this.lineAbs + (gate.isFinish ? t.length : gate.idx * t.step);
  }

  private checkGates(prevS: number) {
    const t = this.track;
    while (this.physics.progressS >= this.nextGateAbs) {
      const gate = t.gates[this.nextGateK];
      if (!gate) break;
      const latOk = Math.abs(this.physics.lateral) < t.sample(gate.idx).hw + 10;
      const prevOk = prevS <= this.nextGateAbs + 1;
      if (!latOk || !prevOk) break;
      if (gate.isFinish) {
        this.completeLap();
      } else {
        const lapMs = this.raceTime - this.lapStart;
        this.splits.push(lapMs);
        const best = this.bestSplits[this.splits.length - 1];
        const delta = best != null ? lapMs - best : null;
        gameStore.getState().pushPopup("checkpoint", `CHECKPOINT ${this.splits.length}`, { deltaMs: delta ?? undefined });
        // HARD trims the checkpoint top-up along with every other boost gain
        this.physics.boostMeter = clamp(
          this.physics.boostMeter + 12 * this.physics.boostScale,
          0,
          100
        );
        this.audio.checkpoint(delta);
        this.nextGateK++;
        this.nextGateAbs = this.gateAbs(this.nextGateK);
      }
    }
  }

  private completeLap() {
    const lapMs = this.raceTime - this.lapStart;
    this.lapTimes.push(lapMs);
    const lapIsBest = this.bestLapMs == null || lapMs < this.bestLapMs;
    if (lapIsBest) {
      this.bestLapMs = lapMs;
      if (this.ghostRec.length > 10) this.ghost = this.ghostRec;
    }
    this.lapsDone++;
    // multiplayer: report the lap for server-side validation
    this.onMpLap?.(this.lapsDone, lapMs);
    const store = gameStore.getState();
    if (this.lapsDone >= this.totalLaps) {
      // ---- finish ----
      const totalMs = this.raceTime;
      const bestLap = Math.min(...this.lapTimes);
      const isNewRecord = this.bestTotalMs == null || totalMs < this.bestTotalMs;
      if (isNewRecord) {
        this.bestTotalMs = totalMs;
        this.bestSplits = [...this.splits];
      }
      try {
        localStorage.setItem(
          "canyonrush.best.v1",
          JSON.stringify({
            totalMs: this.bestTotalMs,
            bestLapMs: this.bestLapMs,
            splits: this.bestSplits,
            laps: this.totalLaps,
          })
        );
        if (this.ghost.length > 10) {
          localStorage.setItem(GHOST_KEY, JSON.stringify(this.ghost));
        }
      } catch {
        /* ignore */
      }
      if (isNewRecord) {
        store.saveBest({ totalMs, bestLapMs: this.bestLapMs, splits: this.bestSplits, laps: this.totalLaps });
        store.pushPopup("newrecord", "NEW RECORD!");
      }
      this.audio.finish(isNewRecord);
      this.playerFinishMs = totalMs;
      this.pushStandings(true);
      const position = this.playerPos;
      this.setPhase("finished");
      this.finishOrbitT = 0;
      this.ghostCar.group.visible = false;
      // CRITICAL: advance past the finish gate so checkGates' while-loop
      // terminates instead of re-triggering completeLap forever (tab freeze)
      this.nextGateK = this.track.gates.length;
      this.nextGateAbs = Infinity;
      this.cbs.onFinish({
        totalMs,
        bestLapMs: bestLap,
        topSpeedKmh: Math.round(this.physics.topSpeed),
        driftScore: Math.round(this.physics.driftScore),
        nearMisses: this.physics.nearMisses,
        bigAirCount: this.bigAirCount,
        laps: this.totalLaps,
        isNewRecord,
        splits: [...this.splits],
        position,
        totalCars: this.mpActive ? 1 + this.remotes.length : 1 + this.opponents.length,
      });
      return;
    }
    // lap complete, more to go
    store.pushPopup("lap", `LAP ${this.lapsDone}/${this.totalLaps} — ${fmt(lapMs)}`);
    this.audio.checkpoint(-1);
    this.lapStart = this.raceTime;
    this.lineAbs += this.track.length;
    this.nextGateK = 0;
    this.nextGateAbs = this.gateAbs(0);
    this.ghostRec = [];
    this.ghostRecT = 0;
    this.ghostCar.group.visible = this.ghost.length > 0;
  }

  private startRecovery() {
    if (this.recoverT > 0 || this.phase !== "racing") return;
    this.recoverT = 0.85;
    this.audio.recovery();
    gameStore.getState().pushPopup("recovery", "RECOVERED — HOLD YOUR LINE!");
    const t = this.track;
    if (this.nextGateK > 0) {
      const gate = t.gates[this.nextGateK - 1];
      const idx = wrapI(gate.idx + 4, t.N);
      const baseS = this.lineAbs + gate.idx * t.step;
      this.physics.place(idx, 0, 13, false);
      this.physics.syncProgress(baseS + 4 * t.step);
    } else {
      // no gate passed yet this lap → back to the lap start line
      this.physics.place(t.N - 10, 0, 13, false);
      this.physics.syncProgress(this.lineAbs - 20);
    }
    this.syncCarVisual(0.016);
    this.trauma = Math.min(1, this.trauma + 0.3);
  }

  // ============================================================
  // opponents & standings
  // ============================================================

  private updateOpponents(dt: number, mode: "race" | "cruise") {
    if (this.mpActive) return; // network cars replace the AI rivals in MP
    const ctx = {
      playerDist: this.physics.progressS - this.playerStartS,
      playerLat: this.physics.lateral,
    };
    const raceLen = this.totalLaps * this.track.length;
    for (const op of this.opponents) {
      const inp = opponentInput(op, this.track, ctx, dt, mode);
      op.update(inp, dt);
      if (mode === "race" && op.finishMs == null && op.raceDist >= raceLen) {
        op.finishMs = this.raceTime;
      }
    }
  }

  /** Interpolate every network car (any phase — lobby flythrough included). */
  private updateRemotes(dt: number) {
    if (!this.remotes.length) return;
    const nowMs = performance.now();
    for (const rp of this.remotes) rp.update(nowMs, dt);
  }

  /** Soft sphere collisions between all cars (player + rivals). */
  private resolveCarCollisions() {
    const cars: CarPhysics[] = [this.physics];
    for (const op of this.opponents) cars.push(op.physics);
    const R = 2.55;
    const R2 = R * R;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        if (Math.abs(a.pos.y - b.pos.y) > 2.2) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R2 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const pen = (R - d) * 0.5;
        a.pos.x -= nx * pen;
        a.pos.z -= nz * pen;
        b.pos.x += nx * pen;
        b.pos.z += nz * pen;
        const rvx = b.vel.x - a.vel.x;
        const rvz = b.vel.z - a.vel.z;
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          // equal-mass bump with a bit of bounce
          const imp = -vn * 0.7;
          a.vel.x -= nx * imp;
          a.vel.z -= nz * imp;
          b.vel.x += nx * imp;
          b.vel.z += nz * imp;
          if ((a.isPlayer || b.isPlayer) && -vn > 4.5 && this.time - this.lastBumpT > 0.6) {
            this.lastBumpT = this.time;
            const impact = -vn;
            this.audio.crash(clamp(impact / 26, 0.12, 0.45));
            this.trauma = Math.min(1, this.trauma + 0.1 + impact * 0.012);
            this.input.rumble(clamp(impact / 20, 0.15, 0.6), 110);
          }
        }
      }
    }
    if (this.mpActive && !this.mpSpectating) this.resolveRemoteCollisions();
  }

  /** Player vs network cars: the local car reacts (owner stays authoritative
   *  on their own client — both sides feel the bump locally). */
  private resolveRemoteCollisions() {
    const a = this.physics;
    const R = 2.55;
    const R2 = R * R;
    for (const rp of this.remotes) {
      if (!rp.active) continue;
      if (Math.abs(a.pos.y - rp.ry) > 2.2) continue;
      const dx = rp.rx - a.pos.x;
      const dz = rp.rz - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R2 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      const pen = R - d;
      a.pos.x -= nx * pen;
      a.pos.z -= nz * pen;
      const rvx = rp.vel.x - a.vel.x;
      const rvz = rp.vel.z - a.vel.z;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const imp = -vn * 0.7;
        a.vel.x -= nx * imp;
        a.vel.z -= nz * imp;
        if (-vn > 4.5 && this.time - this.lastBumpT > 0.6) {
          this.lastBumpT = this.time;
          const impact = -vn;
          this.audio.crash(clamp(impact / 26, 0.12, 0.45));
          this.trauma = Math.min(1, this.trauma + 0.1 + impact * 0.012);
          this.input.rumble(clamp(impact / 20, 0.15, 0.6), 110);
        }
      }
    }
  }

  private updateStandings(dt: number) {
    this.standingsTimer -= dt;
    if (this.standingsTimer > 0) return;
    this.standingsTimer = 0.35;
    this.pushStandings(false);
  }

  /** Current race order (finished cars first, then track position). */
  getStandings(): StandingEntry[] {
    if (this.mpActive) {
      const raw = [
        {
          name: this.mpMyName,
          isPlayer: true,
          color: this.mpMyColor,
          s: this.physics.progressS,
          finishMs: this.playerFinishMs,
        },
        ...this.remotes.map((rp) => ({
          name: rp.name,
          isPlayer: false,
          color: rp.colorCss,
          s: rp.progressS,
          finishMs: rp.finishMs,
        })),
      ];
      raw.sort((x, y) => {
        if (x.finishMs != null && y.finishMs != null) return x.finishMs - y.finishMs;
        if (x.finishMs != null) return -1;
        if (y.finishMs != null) return 1;
        return y.s - x.s;
      });
      return raw.map((e, i) => ({
        pos: i + 1,
        name: e.name,
        isPlayer: e.isPlayer,
        color: e.color,
        timeMs: e.finishMs,
      }));
    }
    const raw = [
      {
        name: "YOU",
        isPlayer: true,
        color: "#f0641e",
        s: this.physics.progressS,
        finishMs: this.playerFinishMs,
      },
      ...this.opponents.map((op) => ({
        name: op.def.name,
        isPlayer: false,
        color: op.def.cssColor,
        s: op.physics.progressS,
        finishMs: op.finishMs,
      })),
    ];
    raw.sort((x, y) => {
      if (x.finishMs != null && y.finishMs != null) return x.finishMs - y.finishMs;
      if (x.finishMs != null) return -1;
      if (y.finishMs != null) return 1;
      return y.s - x.s;
    });
    return raw.map((e, i) => ({
      pos: i + 1,
      name: e.name,
      isPlayer: e.isPlayer,
      color: e.color,
      timeMs: e.finishMs,
    }));
  }

  private pushStandings(force: boolean) {
    const standings = this.getStandings();
    this.playerPos = standings.findIndex((s) => s.isPlayer) + 1;
    const key = standings.map((s) => `${s.pos}${s.name}${s.timeMs ?? "?"}`).join("|");
    if (force || key !== this.lastStandingsKey) {
      this.lastStandingsKey = key;
      gameStore.getState().setStandings(standings);
    }
  }

  // ============================================================
  // visuals sync & effects
  // ============================================================

  /** Hide one crate/wall segment, schedule its respawn and spray wooden debris. */
  private smashBox(b: TrackBox, dirX: number, dirZ: number, power: number, delay: number) {
    b.active = false;
    b.mesh.visible = false;
    // barricades rebuild slowly — a smashed-open wall should read as GONE
    b.respawnAt = this.time * 1000 + (b.wall ? WALL_RESPAWN_MS : BOX_RESPAWN_MS);
    this.particles.emitShards(b.x, b.y, b.z, b.wall ? 9 : 7);
    const groundY = b.y - b.halfH - 0.05;
    if (b.wall) {
      this.debris.spawnWallBurst(b.x, b.y, b.z, groundY, dirX, dirZ, power, delay);
    } else {
      this.debris.spawnCrateBurst(b.x, b.y, b.z, groundY, dirX, dirZ, power, delay);
    }
  }

  private syncCarVisual(dt: number) {
    const p = this.physics;
    const g = this.car.group;
    g.position.copy(p.pos);
    g.rotation.set(0, p.yaw, 0);
    // align to ground slope (continuous queries — no per-sample stepping)
    if (p.grounded) {
      const slopeL = this.track.slopeLatAtP(p.groundP, p.lateral);
      const slopeF = this.track.slopeFwdAtP(p.groundP, p.lateral);
      g.rotation.order = "YXZ";
      g.rotation.x = damp(g.rotation.x, clamp(-Math.atan(slopeF), -0.5, 0.5), 8, dt);
      g.rotation.z = damp(g.rotation.z, clamp(Math.atan(slopeL), -0.9, 0.9), 8, dt);
      if (p.wallRiding) {
        const side = this.track.sample(p.idx).wallRideR && p.lateral > 0 ? 1 : -1;
        g.rotation.z = damp(g.rotation.z, side * clamp(Math.atan(slopeL), -1.15, 1.15), 8, dt);
      }
    } else {
      g.rotation.order = "YXZ";
      g.rotation.x = damp(g.rotation.x, clamp(-p.vel.y * 0.02, -0.35, 0.35), 3, dt);
      g.rotation.z = damp(g.rotation.z, 0, 4, dt);
    }
    const { gear, rpm } = p.gearAndRpm();
    void gear;
    void rpm;
    this.car.update({
      speed: p.vel.x * Math.sin(p.yaw) + p.vel.z * Math.cos(p.yaw),
      steer: this.lastSteer,
      slip: p.drifting ? p.slip : 0,
      grounded: p.grounded,
      boosting: p.boosting,
      braking: this.lastBrake > 0.05,
      pitchRate: this.lastAccel,
      rollRate: p.drifting ? -p.slip * 12 : 0,
      dt,
    });
  }

  private curInput: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
  private lastSteer = 0;
  private lastBrake = 0;
  private lastAccel = 0;
  private prevSpeed = 0;

  private emitEffects(dt: number) {
    const p = this.physics;
    const fwd = this.tmpV.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const right = this.tmpV2.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw));

    const speedH = p.speed;

    if (p.grounded) {
      // drift smoke + skids
      if (p.drifting && speedH > 8) {
        const q = clamp(Math.abs(p.slip) / 0.5, 0.2, 1);
        for (const side of [-1, 1]) {
          const wx = p.pos.x - fwd.x * 1.25 + right.x * side * 0.85;
          const wz = p.pos.z - fwd.z * 1.25 + right.z * side * 0.85;
          const wy = p.pos.y;
          this.particles.emitSmoke(wx, wy, wz, q);
        }
        this.skidTimer -= dt;
        if (this.skidTimer <= 0) {
          this.skidTimer = 0.03;
          const vx = p.vel.x / Math.max(1, speedH);
          const vz = p.vel.z / Math.max(1, speedH);
          for (const side of [-1, 1]) {
            const wx = p.pos.x - fwd.x * 1.25 + right.x * side * 0.85;
            const wz = p.pos.z - fwd.z * 1.25 + right.z * side * 0.85;
            this.particles.emitSkid(wx, p.pos.y, wz, vx, vz, clamp(Math.abs(p.slip) * 2, 0.3, 1), this.time);
          }
        }
      }
      // off-road dust
      if (p.offRoad && speedH > 9) {
        this.particles.emitDust(
          p.pos.x - fwd.x * 1.4, p.pos.y, p.pos.z - fwd.z * 1.4,
          clamp(speedH / 30, 0.3, 1.2), p.vel.x, p.vel.z
        );
      }
      // wall-ride sparks
      if (p.wallRiding) {
        this.sparkTimer -= dt;
        if (this.sparkTimer <= 0) {
          this.sparkTimer = 0.06;
          const side = p.lateral > 0 ? 1 : -1;
          this.particles.emitSparks(
            p.pos.x + right.x * side * 1.1, p.pos.y + 0.2, p.pos.z + right.z * side * 1.1,
            -right.x * side, -right.z * side, 3
          );
        }
      }
    }
    // boost trail
    if (p.boosting) {
      this.boostTrailTimer -= dt;
      if (this.boostTrailTimer <= 0) {
        this.boostTrailTimer = 0.02;
        this.particles.emitBoost(p.pos.x - fwd.x * 2.0, p.pos.y + 0.45, p.pos.z - fwd.z * 2.0, -fwd.x, -fwd.z);
      }
    }
  }

  private dustBurst(n: number) {
    const p = this.physics;
    for (let i = 0; i < n; i++) {
      this.particles.emitDust(
        p.pos.x + (Math.random() - 0.5) * 2, p.pos.y + 0.1, p.pos.z + (Math.random() - 0.5) * 2,
        1.4, p.vel.x, p.vel.z
      );
    }
  }

  private updateGateGlow() {
    const t = this.track;
    for (let k = 0; k < t.gates.length; k++) {
      const g = t.gates[k];
      if (!g.glow) continue;
      const isNext = this.phase === "racing" && k === this.nextGateK;
      const passed = this.phase === "racing" && k < this.nextGateK;
      if (isNext) {
        g.glow.emissiveIntensity = 1.6 + Math.sin(this.time * 5) * 0.6;
      } else {
        g.glow.emissiveIntensity = passed ? 0.5 : 1.1;
      }
    }
  }

  /** BREAK-wall theatre: pulse the amber glow strips + beacons, sync them
   *  with the wall's live state, and warn the rider (alarm + popup) as they
   *  charge toward an intact barricade. */
  private wallWarned = new Set<number>();

  private updateWallFx() {
    const t = this.track;
    for (let i = 0; i < t.wallGlowMats.length; i++) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5 + i * 1.7);
      t.wallGlowMats[i].opacity = 0.45 + 0.55 * pulse;
    }
    for (const w of t.breakWalls) {
      const standing = w.firstBox.active;
      w.glow.visible = standing;
      if (this.phase !== "racing") continue;
      // signed distance ahead of the player (samples → meters)
      let d = w.idx - this.physics.idx;
      if (d < -t.N / 2) d += t.N;
      else if (d > t.N / 2) d -= t.N;
      const dist = d * t.step;
      if (standing && dist > 8 && dist < 80) {
        if (!this.wallWarned.has(w.cluster)) {
          this.wallWarned.add(w.cluster);
          this.audio.wallWarn();
          gameStore.getState().pushPopup("smash", "BREAK WALL AHEAD — SMASH IT!");
        }
      } else if (dist <= 8 || dist > 120) {
        // passed through (or broke it) → re-arm for the next approach
        this.wallWarned.delete(w.cluster);
      }
    }
  }

  // ============================================================
  // ghost
  // ============================================================

  private recordGhost(dt: number) {
    if (this.mpActive) return; // ghost replays are a solo feature
    this.ghostRecT += dt;
    if (this.ghostRecT >= 0.05) {
      this.ghostRecT = 0;
      const p = this.physics;
      this.ghostRec.push({ t: this.raceTime, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw });
      if (this.ghostRec.length > 4000) this.ghostRec.shift();
    }
  }

  private playGhost() {
    if (this.mpActive) {
      this.ghostCar.group.visible = false;
      return;
    }
    if (!this.ghost.length) {
      this.ghostCar.group.visible = false;
      return;
    }
    this.ghostCar.group.visible = true;
    const tMs = this.raceTime;
    const frames = this.ghost;
    // binary search
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t < tMs) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = frames[i - 1];
    const b = frames[Math.min(frames.length - 1, i)];
    const span = Math.max(1e-3, b.t - a.t);
    const f = clamp((tMs - a.t) / span, 0, 1);
    const g = this.ghostCar.group;
    g.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.set(0, a.yaw + dy * f, 0);
  }

  // ============================================================
  // camera
  // ============================================================

  private updateCamera(dt: number) {
    if (this.phase === "title") return; // handled in updateTitle
    const p = this.physics;
    const fwd = this.tmpV.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));

    if (this.phase === "countdown") {
      // cinematic sweep down to the chase position
      const t = clamp(1 - this.countdownT / 3, 0, 1);
      const e = t * t * (3 - 2 * t);
      const ang = 2.4 - e * 2.4;
      const dist = 30 - 24 * e;
      this.camPos.set(
        p.pos.x + Math.sin(ang) * dist + fwd.x * -4,
        p.pos.y + 14 - 11.5 * e,
        p.pos.z + Math.cos(ang) * dist + fwd.z * -4
      );
      this.camLook.set(p.pos.x + fwd.x * 6, p.pos.y + 1.2, p.pos.z + fwd.z * 6);
      this.camera.position.copy(this.camPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLook);
      this.camera.fov = damp(this.camera.fov, 66, 3, dt);
      this.camera.updateProjectionMatrix();
      return;
    }

    if (this.phase === "finished") {
      const a = this.finishOrbitT * 0.5;
      this.camPos.set(p.pos.x + Math.sin(a) * 9, p.pos.y + 3.2, p.pos.z + Math.cos(a) * 9);
      this.camLook.copy(p.pos).add(new THREE.Vector3(0, 1, 0));
      this.camera.position.copy(this.camPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLook);
      return;
    }

    // chase camera
    const mode = this.settings.cameraMode;
    const dist = mode === 1 ? 9.6 : 6.4;
    const height = mode === 1 ? 3.8 : 2.55;
    if (mode === 2) {
      // hood cam
      this.camPos.set(p.pos.x + fwd.x * 0.5, p.pos.y + 1.35, p.pos.z + fwd.z * 0.5);
      this.camLook.set(p.pos.x + fwd.x * 12, p.pos.y + 1.6, p.pos.z + fwd.z * 12);
      this.camera.position.copy(this.camPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLook);
    } else {
      const ffX = clamp(p.vel.x * 0.16, -7, 7);
      const ffZ = clamp(p.vel.z * 0.16, -7, 7);
      const tx = p.pos.x - fwd.x * dist + ffX;
      const ty = p.pos.y + height;
      const tz = p.pos.z - fwd.z * dist + ffZ;
      const rate = 6.5;
      this.camPos.x = damp(this.camPos.x, tx, rate, dt);
      this.camPos.y = damp(this.camPos.y, ty, rate, dt);
      this.camPos.z = damp(this.camPos.z, tz, rate, dt);
      this.camLook.set(p.pos.x + fwd.x * 7, p.pos.y + 1.3, p.pos.z + fwd.z * 7);
      this.camera.position.copy(this.camPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLook);
      // banking roll (positive rotateZ banks right, matching steer > 0)
      const targetRoll = clamp(-p.slip * 0.3 + this.lastSteer * 0.05, -0.24, 0.24);
      this.camRoll = damp(this.camRoll, targetRoll, 5, dt);
      this.camera.rotateZ(this.camRoll);
    }

    // wall-ride lean
    this.wallRideLean = damp(this.wallRideLean, p.wallRiding ? clamp(p.lateral / 24, 0, 1) * 0.5 : 0, 4, dt);
    if (this.wallRideLean > 0.01) this.camera.rotateZ(this.wallRideLean);

    // FOV kick
    const speedFrac = clamp(p.speed / 55, 0, 1.1);
    const targetFov = 64 + speedFrac * 10 + (p.boosting ? 9 : 0);
    this.fov = damp(this.fov, targetFov, 4, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    // restrained screen shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    if (sh > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * sh * 0.55;
      this.camera.position.y += (Math.random() - 0.5) * sh * 0.4;
      this.camera.position.z += (Math.random() - 0.5) * sh * 0.55;
      this.camera.rotateZ((Math.random() - 0.5) * sh * 0.03);
    }
  }

  private updateSun() {
    const p = this.physics.pos;
    this.sun.position.set(p.x + SUN_DIR.x * 190, p.y + SUN_DIR.y * 190, p.z + SUN_DIR.z * 190);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();
  }

  // ============================================================
  // telemetry
  // ============================================================

  private emitTelemetry() {
    const p = this.physics;
    const { gear, rpm } = p.gearAndRpm();
    const t: Telemetry = {
      speedKmh: p.speedKmh,
      boostMeter: p.boostMeter,
      boosting: p.boosting,
      drifting: p.drifting,
      driftMult: 1 + Math.min(2, p.driftChain / 6),
      lap: Math.min(this.lapsDone + 1, this.totalLaps),
      totalLaps: this.totalLaps,
      position: this.playerPos,
      totalCars: this.mpActive ? 1 + this.remotes.length : 1 + this.opponents.length,
      blips: this.mpActive
        ? this.remotes.map((rp) => ({
            x: rp.rx,
            z: rp.rz,
            color: rp.colorCss,
          }))
        : this.opponents.map((op) => ({
            x: op.physics.pos.x,
            z: op.physics.pos.z,
            color: op.def.cssColor,
          })),
      raceTimeMs: this.raceTime,
      lapTimeMs: this.raceTime - this.lapStart,
      bestLapMs: this.bestLapMs,
      bestTotalMs: this.bestTotalMs,
      wrongWay: p.wrongWay,
      airborne: !p.grounded,
      wallRide: p.wallRiding,
      offRoad: p.offRoad,
      nextCpDist: Math.max(0, (this.nextGateAbs - p.progressS) % this.track.length),
      gear,
      rpm,
      progressPct: p.lapProgress,
    };
    for (const fn of this.telemetryListeners) fn(t);
  }

  /** expose a bit of input state for car visuals */
  noteInput(steer: number, brake: number, accel: number) {
    this.lastSteer = steer;
    this.lastBrake = brake;
    this.lastAccel = accel;
  }
}

function wrapI(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function fmt(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}
