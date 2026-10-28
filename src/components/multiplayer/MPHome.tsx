"use client";

import { useEffect, useState } from "react";
import { Globe, Loader2, LogIn, Plus, RotateCcw, Users } from "lucide-react";
import { net, NetClient } from "@/game/net";
import { useMPStore } from "@/game/net-store";

/**
 * Multiplayer entry screen: pick a display name, then create a room
 * (get a shareable code) or join with a code. Styled to match the
 * CANYON RUSH title screen (cream/ink/orange, skewed arcade buttons).
 */
export function MPHome() {
  const connection = useMPStore((s) => s.connection);
  const setScreen = useMPStore((s) => s.setScreen);
  const [name, setName] = useState(() => NetClient.loadName());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | "rejoin" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRoom] = useState(() => NetClient.loadLastRoom());
  const [canRejoin] = useState(() => {
    try {
      return (
        !!lastRoom && !!localStorage.getItem("canyonrush.mp.token." + lastRoom)
      );
    } catch {
      return false;
    }
  });

  const nameOk = name.trim().length >= 1 && name.trim().length <= 14;

  // connect the socket as soon as the multiplayer screen opens
  useEffect(() => {
    net.warmup();
  }, []);

  const rejoin = async () => {
    if (!lastRoom || busy) return;
    setBusy("rejoin");
    setError(null);
    const ok = await net.tryRejoin(lastRoom);
    setBusy(null);
    if (ok) setScreen("room");
    else setError("Could not rejoin — the room may have closed");
  };

  const create = async () => {
    if (!nameOk || busy) return;
    setBusy("create");
    setError(null);
    const ok = await net.createRoom(name.trim());
    setBusy(null);
    if (!ok) setError("Could not create a room — is the server online?");
  };

  const join = async () => {
    if (!nameOk || busy) return;
    const c = code.trim().toUpperCase();
    if (c.length !== 4) {
      setError("Room codes are 4 characters");
      return;
    }
    setBusy("join");
    setError(null);
    const ok = await net.joinRoom(c, name.trim());
    setBusy(null);
    if (!ok) setError("Could not join that room — check the code");
  };

  const online = connection === "online";

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-y-auto">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/concept/title-canyon.png)" }} aria-hidden />
      <div className="absolute inset-0 bg-[rgba(43,28,18,0.66)] backdrop-blur-[2px]" aria-hidden />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-md flex-col items-center justify-start gap-2.5 overflow-y-auto px-4 py-3 sm:justify-center sm:gap-4 sm:py-8 [@media(max-height:560px)]:gap-2 [@media(max-height:560px)]:py-2">
        <div className="text-center [@media(max-height:560px)]:hidden">
          <div className="flex items-center justify-center gap-2 text-[#ffb020]">
            <Globe className="h-5 w-5" aria-hidden />
            <span className="text-[11px] font-black tracking-[0.35em]">ONLINE MULTIPLAYER</span>
          </div>
          <h2 className="mt-1 font-[family-name:var(--font-bungee)] text-4xl leading-none text-[#fff6e6] [text-shadow:0_4px_0_#2b1c12]">
            CANYON <span className="text-[#ffb020]">CLASH</span>
          </h2>
          <p className="mt-1 text-[11px] font-bold text-[#f6e3c2]/85">
            Up to 10 racers · room codes · live chat
          </p>
        </div>
        <div className="hidden text-center [@media(max-height:560px)]:block">
          <h2 className="font-[family-name:var(--font-bungee)] text-2xl leading-none text-[#fff6e6] [text-shadow:0_3px_0_#2b1c12]">
            CANYON <span className="text-[#ffb020]">CLASH</span>
          </h2>
        </div>

        {/* connection status */}
        <div
          className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-[10px] font-black tracking-widest ${
            online
              ? "border-[#2f9e63] bg-[rgba(47,158,99,0.2)] text-[#9fe6bf]"
              : "border-[#d64530] bg-[rgba(214,69,48,0.2)] text-[#ffb0a5]"
          }`}
          role="status"
        >
          <span className={`h-2 w-2 rounded-full ${online ? "bg-[#2f9e63]" : "bg-[#d64530] animate-pulse"}`} />
          {connection === "online" ? "SERVER ONLINE" : connection === "connecting" ? "CONNECTING…" : "SERVER OFFLINE"}
        </div>

        {/* name */}
        <label className="w-full">
          <span className="mb-1 block text-[10px] font-black tracking-[0.3em] text-[#ffb020]">YOUR NAME</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 14))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void create();
              if (e.key === "Escape") setScreen("none");
            }}
            placeholder="DUST DEVIL"
            maxLength={14}
            className="w-full rounded-md border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.96)] px-3 py-2.5 text-sm font-bold text-[#2b1c12] shadow-inner outline-none placeholder:text-[#b99a78] focus:border-[#f0641e]"
            aria-label="Your display name"
          />
          <span className="mt-0.5 block text-[10px] font-semibold text-[#f6e3c2]/70">
            {name.trim().length}/14 characters {name.trim().length > 14 ? "— too long" : ""}
          </span>
        </label>

        {/* rejoin last room (reconnect after reload) */}
        {canRejoin && (
          <button
            type="button"
            onClick={() => void rejoin()}
            disabled={busy != null}
            className="flex w-full -skew-x-6 items-center justify-center gap-2 rounded-md border-2 border-[#ffb020] bg-[rgba(255,176,32,0.16)] px-4 py-2.5 font-[family-name:var(--font-bungee)] text-base text-[#ffb020] shadow-[0_4px_0_rgba(255,176,32,0.35)] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_rgba(255,176,32,0.35)] active:translate-y-1 active:shadow-none disabled:opacity-50"
          >
            <span className="flex skew-x-6 items-center gap-2">
              {busy === "rejoin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              REJOIN ROOM {lastRoom}
            </span>
          </button>
        )}

        {/* create */}
        <button
          type="button"
          disabled={!nameOk || !online || busy != null}
          onClick={() => void create()}
          className="group flex w-full -skew-x-6 items-center justify-center gap-2 rounded-lg border-[3px] border-[#2b1c12] bg-[#f0641e] px-6 py-3.5 font-[family-name:var(--font-bungee)] text-xl text-[#fff6e6] shadow-[0_5px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_3px_0_#2b1c12] active:translate-y-1 active:shadow-none disabled:opacity-50"
        >
          <span className="flex skew-x-6 items-center gap-2">
            {busy === "create" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            CREATE ROOM
          </span>
        </button>

        <div className="flex w-full items-center gap-2" aria-hidden>
          <div className="h-0.5 flex-1 rounded bg-[rgba(255,246,230,0.25)]" />
          <span className="text-[10px] font-black tracking-[0.25em] text-[#f6e3c2]/60">OR JOIN</span>
          <div className="h-0.5 flex-1 rounded bg-[rgba(255,246,230,0.25)]" />
        </div>

        {/* join */}
        <div className="flex w-full gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void join();
            }}
            placeholder="CODE"
            maxLength={4}
            className="w-28 -skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.96)] px-2 py-2.5 text-center font-[family-name:var(--font-bungee)] text-xl tracking-[0.2em] text-[#2b1c12] shadow-inner outline-none placeholder:text-[#b99a78] focus:border-[#f0641e]"
            aria-label="Room code"
          />
          <button
            type="button"
            disabled={!nameOk || !online || busy != null}
            onClick={() => void join()}
            className="flex-1 -skew-x-6 rounded-md border-2 border-[#2b1c12] bg-[#ffb020] px-4 py-2.5 font-[family-name:var(--font-bungee)] text-lg text-[#2b1c12] shadow-[0_5px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_3px_0_#2b1c12] active:translate-y-1 active:shadow-none disabled:opacity-50"
          >
            <span className="flex skew-x-6 items-center justify-center gap-2">
              {busy === "join" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
              JOIN
            </span>
          </button>
        </div>

        {error && (
          <div role="alert" className="w-full rounded-md border-2 border-[#d64530] bg-[rgba(214,69,48,0.25)] px-3 py-2 text-xs font-bold text-[#ffb0a5]">
            {error}
          </div>
        )}

        <div className="mt-1 flex w-full items-center justify-between">
          <button
            type="button"
            onClick={() => setScreen("none")}
            className="rounded-md border-2 border-[rgba(255,246,230,0.4)] px-4 py-2 text-xs font-black tracking-wider text-[#f6e3c2] transition-colors hover:bg-[rgba(255,246,230,0.12)]"
          >
            ← BACK
          </button>
          <span className="flex items-center gap-1 text-[10px] font-bold text-[#f6e3c2]/60">
            <Users className="h-3.5 w-3.5" aria-hidden /> 10 cars max per room
          </span>
        </div>
      </div>
    </div>
  );
}
