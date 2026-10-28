"use client";

import { useEffect, useRef, useState } from "react";
import {
  Car,
  Check,
  Copy,
  Crown,
  Eye,
  Flag,
  Loader2,
  LogOut,
  Pencil,
  Play,
  Radio,
  Users,
  WifiOff,
} from "lucide-react";
import { net } from "@/game/net";
import { useMPStore } from "@/game/net-store";
import { useGameStore } from "@/game/store";
import { carModelName } from "@/game/cars";
import { formatTime, MAP_NAMES, type MapId, type StandingEntry } from "@/game/types";
import type { GameEngine } from "@/game/engine";
import { ChatPanel } from "./ChatPanel";

function PlayerRow({
  p,
  isMe,
  isHost,
}: {
  p: { id: string; name: string; color: string; car: string; ready: boolean; connected: boolean; racing: boolean };
  isMe: boolean;
  isHost: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
        isMe ? "bg-[rgba(240,100,30,0.18)]" : "bg-[rgba(255,246,230,0.05)]"
      } ${p.connected ? "" : "opacity-50"}`}
    >
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[#fff6e6]"
        style={{ backgroundColor: p.color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="block truncate text-sm font-black text-[#fff6e6]">
          {p.name}
          {isMe && <span className="ml-1.5 text-[10px] font-bold text-[#ffb020]">(YOU)</span>}
        </span>
        <span className="flex items-center gap-1 text-[9px] font-black tracking-wider text-[#c9a06a]">
          <Car className="h-2.5 w-2.5" aria-hidden /> {carModelName(p.car)}
        </span>
      </span>
      {isHost && (
        <span className="flex items-center gap-0.5 rounded bg-[#ffb020] px-1.5 py-0.5 text-[9px] font-black tracking-wider text-[#2b1c12]" title="Host">
          <Crown className="h-3 w-3" aria-hidden /> HOST
        </span>
      )}
      {!p.connected && (
        <span className="flex items-center gap-0.5 rounded bg-[rgba(214,69,48,0.3)] px-1.5 py-0.5 text-[9px...[truncated]