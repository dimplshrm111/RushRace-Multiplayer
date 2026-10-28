"use client";

/**
 * Multiplayer UI state (rooms, chat, connection status, results).
 * The engine-adjacent net client (net.ts) writes; React components read.
 */
import { create } from "zustand";
import type { MPChatMessage, MPRemoteState, MPResultEntry, MPRoomState } from "./net-types";

export type MPConnection = "offline" | "connecting" | "online";
export interface MPNetworkHealth {
  status: "offline" | "rejoining" | "downlink-stale" | "remote-uplink-stale" | "uplink-stale" | "high-latency" | "healthy";
  incomingAge: number;
  sendAge: number;
  sentStates: number;
  receivedUpdates: number;
  ping: number;
}

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
  networkHealth: MPNetworkHealth;
  setNetworkHealth: (health: MPNetworkHealth) => void;

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
  networkHealth: {status:"offline",incomingAge:-1,sendAge:-1,sentState...[truncated]