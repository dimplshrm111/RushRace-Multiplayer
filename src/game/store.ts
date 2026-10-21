"use client";

import { create } from "zustand";
import {
  DEFAULT_SETTINGS,
  type GamePhase,
  type GameSettings,
  type ResultsData,
  type UIEvent,
  type UIEventType,
} from "./types";

const SETTINGS_KEY = "canyonrush.settings.v1";
const TUTORIAL_KEY = "canyonrush.tutorial.v1";
const BEST_KEY = "canyonrush.best.v1";

interface BestData {
  totalMs: number;
  bestLapMs: number;
  splits: number[];
  laps: number;
}

interface PopupItem extends UIEvent {
  at: number;
}

interface GameStore {
  phase: GamePhase;
  paused: boolean;
  settings: GameSettings;
  popups: PopupItem[];
  results: ResultsData | null;
  tutorialSeen: boolean;
  hint: string | null;
  countdownValue: number; // 3..1, 0 = GO, -1 idle
  /** local best (from localStorage) for current lap count */
  bestTotalMs: number | null;
  bestLapMs: number | null;
  setPhase: (p: GamePhase) => void;
  setPaused: (v: boolean) => void;
  setSettings: (patch: Partial<GameSettings>) => void;
  pushPopup: (type: UIEventType, text: string, extra?: { amount?: number; deltaMs?: number }) => void;
  prunePopups: (now: number) => void;
  setResults: (r: ResultsData | null) => void;
  setCountdown: (v: number) => void;
  setHint: (h: string | null) => void;
  markTutorialSeen: () => void;
  loadBest: (laps: number) => void;
  saveBest: (data: BestData) => void;
  resetBest: () => void;
}

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function persistSettings(s: GameSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let popupId = 1;

export const useGameStore = create<GameStore>((set, get) => ({
  phase: "title",
  paused: false,
  settings: loadSettings(),
  popups: [],
  results: null,
  tutorialSeen: (() => {
    try {
      return localStorage.getItem(TUTORIAL_KEY) === "1";
    } catch {
      return false;
    }
  })(),
  hint: null,
  countdownValue: -1,
  bestTotalMs: null,
  bestLapMs: null,

  setPhase: (p) => set({ phase: p }),
  setPaused: (v) => set({ paused: v }),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    persistSettings(settings);
    set({ settings });
  },
  pushPopup: (type, text, extra) => {
    const popups = [...get().popups, { id: popupId++, type, text, at: Date.now(), ...extra }].slice(-5);
    set({ popups });
  },
  prunePopups: (now) => {
    const popups = get().popups;
    if (popups.length && now - popups[0].at > 2400) {
      set({ popups: popups.filter((p) => now - p.at <= 2400) });
    }
  },
  setResults: (r) => set({ results: r }),
  setCountdown: (v) => set({ countdownValue: v }),
  setHint: (h) => set({ hint: h }),
  markTutorialSeen: () => {
    try {
      localStorage.setItem(TUTORIAL_KEY, "1");
    } catch {
      /* ignore */
    }
    set({ tutorialSeen: true });
  },
  loadBest: (laps) => {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (raw) {
        const data = JSON.parse(raw) as BestData;
        if (data.laps === laps) {
          set({ bestTotalMs: data.totalMs, bestLapMs: data.bestLapMs });
          return;
        }
      }
    } catch {
      /* ignore */
    }
    set({ bestTotalMs: null, bestLapMs: null });
  },
  saveBest: (data) => {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    set({ bestTotalMs: data.totalMs, bestLapMs: data.bestLapMs });
  },
  resetBest: () => {
    try {
      localStorage.removeItem(BEST_KEY);
    } catch {
      /* ignore */
    }
    set({ bestTotalMs: null, bestLapMs: null });
  },
}));

/** Non-hook accessor for engine code. */
export const gameStore = useGameStore;
