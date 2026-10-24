"use client";

import { useEffect, useRef, useState } from "react";
import {
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
import { formatTime, type StandingEntry } from "@/game/types";
import type { GameEngine } from "@/game/engine";
import { ChatPanel } from "./ChatPanel";

function PlayerRow({
  p,
  isMe,
  isHost,
}: {
  p: { id: string; name: string; color: string; ready: boolean; connected: boolean; racing: boolean };
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
      <span className="min-w-0 flex-1 truncate text-sm font-black text-[#fff6e6]">
        {p.name}
        {isMe && <span className="ml-1.5 text-[10px] font-bold text-[#ffb020]">(YOU)</span>}
      </span>
      {isHost && (
        <span className="flex items-center gap-0.5 rounded bg-[#ffb020] px-1.5 py-0.5 text-[9px] font-black tracking-wider text-[#2b1c12]" title="Host">
          <Crown className="h-3 w-3" aria-hidden /> HOST
        </span>
      )}
      {!p.connected && (
        <span className="flex items-center gap-0.5 rounded bg-[rgba(214,69,48,0.3)] px-1.5 py-0.5 text-[9px] font-black tracking-wider text-[#ffb0a5]" title="Disconnected — can reconnect">
          <WifiOff className="h-3 w-3" aria-hidden /> OFF
        </span>
      )}
      <span
        className={`w-[74px] shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-black tracking-wider ${
          p.ready ? "bg-[#2f9e63] text-[#fff6e6]" : "bg-[rgba(255,246,230,0.14)] text-[#c9a06a]"
        }`}
      >
        {p.ready ? "READY" : "NOT READY"}
      </span>
    </div>
  );
}

/** Room lobby: roster, ready/host controls, settings, chat (+ spectate view). */
export function Lobby({ engineRef }: { engineRef: React.RefObject<GameEngine | null> }) {
  const room = useMPStore((s) => s.room);
  const myId = useMPStore((s) => s.myId);
  const connection = useMPStore((s) => s.connection);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [standings, setStandings] = useState<StandingEntry[]>([]);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const my = room?.players.find((p) => p.id === myId) ?? null;
  const isHost = !!my && room?.hostId === my.id;
  const connectedCount = room?.players.filter((p) => p.connected).length ?? 0;
  const allReady =
    !!room && room.players.filter((p) => p.connected).every((p) => p.ready);
  const raceLive = room?.phase === "countdown" || room?.phase === "racing" || room?.phase === "results";
  const spectating = raceLive && !my?.racing;

  // live standings while spectating a race
  useEffect(() => {
    if (!raceLive) return;
    const iv = setInterval(() => {
      const eng = engineRef.current;
      if (eng && eng.mpActive) setStandings(eng.getStandings());
    }, 500);
    return () => clearInterval(iv);
  }, [raceLive, engineRef]);

  const shownStandings = raceLive ? standings : [];

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  if (!room || !my) return null;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
    } catch {
      /* clipboard may be unavailable — the code is displayed anyway */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const startRename = () => {
    setRenameDraft(my.name);
    setRenameErr(null);
    setRenaming(true);
  };

  const commitRename = async () => {
    const name = renameDraft.trim();
    if (!name || name === my.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    const err = await net.rename(name);
    setBusy(false);
    if (err) {
      setRenameErr(err);
      return;
    }
    setRenaming(false);
  };

  const toggleReady = async () => {
    setBusy(true);
    await net.setReady(!my.ready);
    setBusy(false);
  };

  const startRace = async () => {
    setBusy(true);
    await net.startRace();
    setBusy(false);
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-y-auto bg-[rgba(43,28,18,0.45)] backdrop-blur-[3px]">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-5 [@media(max-height:560px)]:gap-1.5 [@media(max-height:560px)]:p-1.5">
        {/* header: code + connection */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.88)] p-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[9px] font-black tracking-[0.3em] text-[#ffb020]">ROOM CODE</div>
              <div className="flex items-center gap-2">
                <span className="font-[family-name:var(--font-bungee)] text-3xl leading-none tracking-[0.12em] text-[#fff6e6]">
                  {room.code}
                </span>
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="rounded border-2 border-[#2b1c12] bg-[#ffb020] p-1.5 text-[#2b1c12] transition-colors hover:bg-[#ffc84d]"
                  aria-label="Copy room code"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {copied && <div className="text-[9px] font-black text-[#2f9e63]">COPIED — SHARE IT!</div>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="flex items-center gap-1.5 rounded-full bg-[rgba(255,246,230,0.1)] px-3 py-1 text-xs font-black text-[#fff6e6]">
              <Users className="h-4 w-4 text-[#ffb020]" aria-hidden />
              {room.players.length}/{room.maxPlayers}
              <span className="text-[10px] font-bold text-[#c9a06a]">({connectedCount} online)</span>
            </span>
            <span
              className={`flex items-center gap-1 text-[10px] font-black tracking-wider ${
                connection === "online" ? "text-[#9fe6bf]" : "text-[#ffb0a5]"
              }`}
              role="status"
            >
              <Radio className="h-3 w-3" aria-hidden />
              {connection === "online" ? "CONNECTED" : "RECONNECTING…"}
            </span>
          </div>
        </div>

        {/* spectate banner */}
        {spectating && (
          <div className="flex items-center gap-2 rounded-lg border-2 border-[#ffb020] bg-[rgba(255,176,32,0.15)] p-2.5 text-xs font-bold text-[#ffe9c9]">
            <Eye className="h-4 w-4 shrink-0 text-[#ffb020]" aria-hidden />
            {room.phase === "countdown"
              ? "Race is starting — you joined too late for this one. Watch the canyon cam!"
              : room.phase === "racing"
                ? "RACE IN PROGRESS — spectating from the canyon cam. You're in for the next one!"
                : "Race finishing up — next race starts when the host rematches."}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1.1fr_1fr]">
          {/* left: roster + controls */}
          <div className="flex min-h-0 flex-col gap-3">
            <div className="rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.88)] p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-black tracking-[0.3em] text-[#ffb020]">
                  DRIVERS ({room.players.length}/{room.maxPlayers})
                </span>
                {/* rename */}
                {renaming ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={renameInputRef}
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value.slice(0, 14))}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setRenaming(false);
                      }}
                      maxLength={14}
                      className="w-32 rounded border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.96)] px-2 py-1 text-xs font-bold text-[#2b1c12] outline-none focus:border-[#ffb020]"
                      aria-label="New name"
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename()}
                      disabled={busy || !renameDraft.trim()}
                      className="rounded bg-[#2f9e63] px-2 py-1 text-[10px] font-black text-[#fff6e6] disabled:opacity-50"
                    >
                      SAVE
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startRename}
                    className="flex items-center gap-1 rounded border border-[rgba(255,246,230,0.35)] px-2 py-1 text-[10px] font-black text-[#f6e3c2] transition-colors hover:bg-[rgba(255,246,230,0.12)]"
                    aria-label="Rename yourself"
                  >
                    <Pencil className="h-3 w-3" aria-hidden /> RENAME
                  </button>
                )}
              </div>
              {renameErr && <div className="mb-1.5 text-[10px] font-bold text-[#ff9a8a]">{renameErr}</div>}
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto settings-scroll pr-0.5">
                {room.players.map((p) => (
                  <PlayerRow
                    key={p.id}
                    p={p}
                    isMe={p.id === myId}
                    isHost={p.id === room.hostId}
                  />
                ))}
              </div>
            </div>

            {/* spectate standings */}
            {spectating && shownStandings.length > 1 && (
              <div className="rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.82)] p-2.5 shadow-lg">
                <div className="mb-1 text-[10px] font-black tracking-[0.25em] text-[#ffb020]">LIVE STANDINGS</div>
                <div className="flex flex-col gap-0.5">
                  {standings.map((e) => (
                    <div key={e.name + e.pos} className="flex items-center gap-2 text-xs font-bold text-[#fff6e6]">
                      <span className="w-4 text-right font-[family-name:var(--font-bungee)] text-[#ffb020]">{e.pos}</span>
                      <span className="h-2.5 w-2.5 rounded-full border border-[#fff6e6]" style={{ backgroundColor: e.color }} />
                      <span className="flex-1 truncate">{e.name}</span>
                      <span className="tabular-nums text-[11px]">
                        {e.timeMs != null ? formatTime(e.timeMs) : <span className="text-[#c9a06a]">RACING…</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* race controls */}
            {room.phase === "lobby" ? (
              <div className="flex flex-col gap-2">
                {/* laps (host) */}
                <div className="flex items-center justify-between rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.88)] px-3 py-2 shadow-lg">
                  <span className="text-[10px] font-black tracking-[0.3em] text-[#ffb020]">RACE LENGTH</span>
                  {isHost ? (
                    <div className="flex gap-1" role="radiogroup" aria-label="Laps">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={room.laps === n}
                          onClick={() => void net.setLaps(n)}
                          className={`h-7 w-7 rounded border-2 font-[family-name:var(--font-bungee)] text-sm transition-colors ${
                            room.laps === n
                              ? "border-[#2b1c12] bg-[#ffb020] text-[#2b1c12]"
                              : "border-[rgba(255,246,230,0.3)] bg-transparent text-[#f6e3c2] hover:bg-[rgba(255,246,230,0.12)]"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="font-[family-name:var(--font-bungee)] text-lg text-[#fff6e6]">
                      {room.laps} LAP{room.laps > 1 ? "S" : ""}
                    </span>
                  )}
                </div>

                {/* ready */}
                <button
                  type="button"
                  onClick={() => void toggleReady()}
                  disabled={busy}
                  className={`-skew-x-6 rounded-lg border-2 border-[#2b1c12] px-6 py-3 font-[family-name:var(--font-bungee)] text-xl shadow-[0_5px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_3px_0_#2b1c12] active:translate-y-1 active:shadow-none disabled:opacity-50 ${
                    my.ready ? "bg-[#2f9e63] text-[#fff6e6]" : "bg-[#fff6e6] text-[#2b1c12]"
                  }`}
                >
                  <span className="block skew-x-6">{busy ? "…" : my.ready ? "READY ✓" : "READY UP"}</span>
                </button>

                {/* host start */}
                {isHost ? (
                  <button
                    type="button"
                    onClick={() => void startRace()}
                    disabled={busy || !allReady || connectedCount < 1}
                    className="-skew-x-6 rounded-lg border-[3px] border-[#2b1c12] bg-[#f0641e] px-6 py-3.5 font-[family-name:var(--font-bungee)] text-2xl text-[#fff6e6] shadow-[0_6px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_4px_0_#2b1c12] active:translate-y-1 active:shadow-none disabled:opacity-50"
                  >
                    <span className="flex skew-x-6 items-center justify-center gap-2">
                      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
                      START RACE
                    </span>
                  </button>
                ) : (
                  <div className="rounded-lg border-2 border-dashed border-[rgba(255,246,230,0.35)] px-4 py-3 text-center text-xs font-bold text-[#f6e3c2]/85">
                    <Crown className="mr-1 inline h-3.5 w-3.5 text-[#ffb020]" aria-hidden />
                    Waiting for the host to start {allReady ? "" : "— players must ready up"}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-[#ffb020] bg-[rgba(43,28,18,0.82)] px-4 py-3 text-xs font-black tracking-wider text-[#ffe9c9]">
                <Flag className="h-4 w-4 text-[#ffb020]" aria-hidden />
                {room.phase === "countdown" && "GET READY — COUNTDOWN RUNNING"}
                {room.phase === "racing" && (my.racing ? "RACE RUNNING" : "SPECTATING")}
                {room.phase === "results" && "RESULTS — HOST CAN REMATCH"}
              </div>
            )}
          </div>

          {/* right: chat */}
          <div className="min-h-[190px] lg:min-h-0 [@media(max-height:560px)]:min-h-[150px]">
            <ChatPanel variant="lobby" />
          </div>
        </div>

        {/* leave */}
        <button
          type="button"
          onClick={() => void net.leaveRoom()}
          className="mx-auto mb-1 flex shrink-0 items-center gap-1.5 rounded-md border-2 border-[rgba(214,69,48,0.7)] px-4 py-1.5 text-xs font-black tracking-wider text-[#ffb0a5] transition-colors hover:bg-[rgba(214,69,48,0.2)]"
          aria-label="Leave room"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden /> LEAVE ROOM
        </button>
      </div>
    </div>
  );
}
