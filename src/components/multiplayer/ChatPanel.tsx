"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { net } from "@/game/net";
import { useMPStore } from "@/game/net-store";
import type { MPChatMessage } from "@/game/net-types";

function timeOf(at: number): string {
  const d = new Date(at);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function ChatBubble({ msg, myId }: { msg: MPChatMessage; myId: string | null }) {
  if (msg.sys) {
    return (
      <div className="px-1 py-0.5 text-[10px] font-semibold italic text-[#c9a06a]" role="note">
        — {msg.text} · {timeOf(msg.at)}
      </div>
    );
  }
  const mine = msg.pid === myId;
  return (
    <div className={`rounded px-1.5 py-0.5 ${mine ? "bg-[rgba(240,100,30,0.14)]" : ""}`}>
      <span className="text-[10px] font-bold text-[#c9a06a]">{timeOf(msg.at)} </span>
      <span className="text-[11px] font-black" style={{ color: mine ? "#ffb020" : "#9fe6bf" }}>
        {msg.name}
      </span>
      <span className="ml-1.5 break-words text-[11px] font-semibold text-[#fff6e6]">{msg.text}</span>
    </div>
  );
}

/**
 * Room chat. Two variants:
 *  - "lobby": always-open panel inside the lobby layout
 *  - "race": collapsed pill (click / T key) that expands without stealing
 *    driving keys (the input guard in InputManager ignores typed keys)
 */
export function ChatPanel({ variant }: { variant: "lobby" | "race" }) {
  const messages = useMPStore((s) => s.messages);
  const myId = useMPStore((s) => s.myId);
  const chatOpen = useMPStore((s) => s.chatOpen);
  const setChatOpen = useMPStore((s) => s.setChatOpen);
  const unread = useMPStore((s) => s.unread);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // auto-scroll to newest
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // race variant: T toggles (when not already typing), Escape closes
  useEffect(() => {
    if (variant !== "race") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "KeyT") {
        e.preventDefault();
        setChatOpen(!useMPStore.getState().chatOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, setChatOpen]);

  // focus the input when the race chat opens
  useEffect(() => {
    if (variant === "race" && chatOpen) inputRef.current?.focus();
  }, [chatOpen, variant]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setErr(null);
    setDraft("");
    const error = await net.sendChat(text);
    if (error) {
      setErr(error);
      setDraft(text);
    }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // keep keys away from the game
    if (e.key === "Enter") {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (variant === "race") setChatOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  // ---------------------------------------------------------------- race pill
  if (variant === "race" && !chatOpen) {
    return (
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="pointer-events-auto absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-full border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.82)] px-3.5 py-2 text-[#fff6e6] shadow-lg backdrop-blur-[2px] transition-transform hover:scale-105 active:scale-95"
        aria-label={`Open chat${unread ? ` (${unread} unread)` : ""}`}
      >
        <MessageSquare className="h-4 w-4 text-[#ffb020]" aria-hidden />
        <span className="text-[10px] font-black tracking-[0.2em]">CHAT</span>
        <span className="rounded bg-[#2b1c12] px-1 text-[9px] font-bold text-[#c9a06a]">T</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#fff6e6] bg-[#d64530] px-1 text-[10px] font-black text-[#fff6e6]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    );
  }

  const list = (
    <div
      ref={listRef}
      className="settings-scroll flex flex-col gap-0.5 overflow-y-auto"
      style={variant === "lobby" ? { height: "100%" } : { height: 208 }}
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
    >
      {messages.length === 0 ? (
        <div className="px-1 py-2 text-[11px] font-bold text-[#c9a06a]">
          No messages yet — say hi!
        </div>
      ) : (
        messages.map((m) => <ChatBubble key={m.id} msg={m} myId={myId} />)
      )}
    </div>
  );

  const input = (
    <div className="flex gap-1.5">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 200))}
        onKeyDown={onInputKey}
        placeholder="Message… (Enter)"
        maxLength={200}
        className="min-w-0 flex-1 rounded border-2 border-[#2b1c12] bg-[rgba(255,246,230,0.96)] px-2 py-1.5 text-xs font-bold text-[#2b1c12] outline-none placeholder:text-[#b99a78] focus:border-[#ffb020]"
        aria-label="Chat message"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={!draft.trim()}
        className="flex items-center justify-center rounded border-2 border-[#2b1c12] bg-[#ffb020] px-2.5 py-1.5 text-[#2b1c12] transition-colors hover:bg-[#ffc84d] disabled:opacity-40"
        aria-label="Send message"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // ---------------------------------------------------------------- race open
  if (variant === "race") {
    return (
      <div className="pointer-events-auto absolute bottom-3 right-3 z-20 flex w-72 flex-col gap-1.5 rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.88)] p-2 shadow-2xl backdrop-blur-[2px] sm:w-80">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.25em] text-[#ffb020]">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden /> ROOM CHAT
          </span>
          <button
            type="button"
            onClick={() => setChatOpen(false)}
            className="rounded p-0.5 text-[#c9a06a] hover:bg-[rgba(255,246,230,0.12)] hover:text-[#fff6e6]"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {list}
        {err && <div className="text-[10px] font-bold text-[#ff9a8a]">{err}</div>}
        {input}
      </div>
    );
  }

  // ---------------------------------------------------------------- lobby
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 rounded-lg border-2 border-[#2b1c12] bg-[rgba(43,28,18,0.88)] p-2 shadow-lg">
      <span className="flex items-center gap-1.5 px-0.5 text-[10px] font-black tracking-[0.25em] text-[#ffb020]">
        <MessageSquare className="h-3.5 w-3.5" aria-hidden /> ROOM CHAT
      </span>
      {list}
      {err && <div className="text-[10px] font-bold text-[#ff9a8a]">{err}</div>}
      {input}
    </div>
  );
}
