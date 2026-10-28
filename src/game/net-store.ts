"use client";

/**
 * Multiplayer UI state (rooms, chat, connection status, results).
 * The engine-adjacent net client (net.ts) writes; React components read.
 */
import { create } from "zustand";
import type { MPChatMessage, MPRemoteState, MPResultEntry, MPRoomState } from "./net-types";

export type MPConnection = "offline" | "connecting" | "online";
export type MPHealth = "offline" | "connecting" | "healthy" | "high-latency" | "downlink-stale" | "uplink-stale" | "remote-uplink-stale";
/** "none" = multiplayer not open · "home" = create/join screen · "room" = inside a room */
export type MPScreen = "none" | "home" | "room";

interface MPStore {
  screen: MPScreen;
  connection: MPConnection;
  room: MPRoomState | null;
  myId: string | null;
  messages: MPChatMessage[];
  finalResults: MPResultEntry[] | null;
  chatOpen: boolean;
  unread: number;
  lastChatAt: number;
  toast: { kind: "info" | "error" | "success"; text: string; at: number } | null;
  ping: number;
  networkHealth: MPHealth;
  networkAgeMs: number;
  setNetworkHealth: (health: MPHealth, ageMs: number) => void;

  setScreen: (s: MPScreen) => void;
  setConnection: (c: MPConnection) => void;
  setRoom: (r: MPRoomState | null) => void;
  setMyId: (id: string | null) => void;
  pushMessage: (m: MPChatMessage) => void;
  clearMessages: () => void;
  setFinalResults: (r: MPResultEntry[] | null) => void;
  setChatOpen: (v: boolean) => void;
  markRead: () => void;
  setPing: (ms: number) => void;
  showToast: (kind: "info" | "error" | "success", text: string) => void;
  reset: () => void;
}

export const useMPStore = create<MPStore>((set, get) => ({
  screen: "none",
  connection: "offline",
  room: null,
  myId: null,
  messages: [],
  finalResults: null,
  chatOpen: false,
  unread: 0,
  lastChatAt: 0,
  toast: null,
  ping: 0,
  networkHealth: "offline",
  networkAgeMs: -1,
  setNetworkHealth: (health, ageMs) => set({networkHealth:health, networkAgeMs:ageMs}),

  setScreen: (s) => set({ screen: s }),
  setConnection: (c) => set({ connection: c }),
  setRoom: (r) => set({ room: r }),
  setMyId: (id) => set({ myId: id }),
  pushMessage: (m) =>
    set((st) => ({
      messages: [...st.messages, m].slice(-150),
      unread: st.chatOpen ? 0 : m.sys ? st.unread : st.unread + 1,
      lastChatAt: m.at,
    })),
  clearMessages: () => set({ messages: [], unread: 0 }),
  setFinalResults: (r) => set({ finalResults: r }),
  setChatOpen: (v) =>
    set((st) => ({ chatOpen: v, ...(v ? { unread: 0 } : {}) })),
  markRead: () => set({ unread: 0 }),
  setPing: (ms) => set({ ping: ms }),
  showToast: (kind, text) => set({ toast: { kind, text, at: Date.now() } }),
  reset: () =>
    set({
      screen: "none",
      room: null,
      myId: null,
      messages: [],
      finalResults: null,
      chatOpen: false,
      unread: 0,
      toast: null,
    }),
}));

/** Non-hook accessor for net client code. */
export const mpStore = useMPStore;

/** Type re-export convenience for consumers. */
export type { MPChatMessage, MPRemoteState, MPResultEntry, MPRoomState };
