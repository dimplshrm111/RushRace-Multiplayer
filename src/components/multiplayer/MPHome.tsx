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
  const network = useMPStore((s) => s.networkHealth);
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
      setError("...[truncated]