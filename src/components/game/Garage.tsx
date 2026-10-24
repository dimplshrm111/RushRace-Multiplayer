"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Car, Gauge, ShieldCheck, X } from "lucide-react";
import { useGameStore } from "@/game/store";
import { useMPStore } from "@/game/net-store";
import { net } from "@/game/net";
import { getCarPreview } from "@/game/car-preview";
import { CAR_MODELS, type CarModelDef, type CarModelId } from "@/game/cars";

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

function CarCard({
  def,
  selected,
  onPick,
  preview,
}: {
  def: CarModelDef;
  selected: boolean;
  onPick: () => void;
  preview: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`group relative flex flex-col overflow-hidden rounded-lg border-[3px] text-left transition-all ${
        selected
          ? "border-[#ffb020] bg-[rgba(255,176,32,0.16)] shadow-[0_0_0_2px_rgba(255,176,32,0.45),0_6px_16px_rgba(0,0,0,0.4)]"
          : "border-[rgba(255,246,230,0.25)] bg-[rgba(43,28,18,0.72)] hover:border-[rgba(255,246,230,0.55)]"
      }`}
    >
      <div className="relative aspect-[23/14] w-full overflow-hidden bg-gradient-to-b from-[rgba(255,214,160,0.16)] to-[rgba(43,28,18,0.28)]">
        {preview ? (
          <img src={preview} alt={`${def.name} SUV preview`} className="h-full w-full object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Car className="h-10 w-10 animate-pulse text-[#c9a06a]" aria-hidden />
          </div>
        )}
        {selected && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-[#ffb020] px-1.5 py-0.5 text-[9px] font-black tracking-wider text-[#2b1c12]">
            <Check className="h-3 w-3" aria-hidden /> PICKED
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <span className="font-[family-name:var(--font-bungee)] text-base leading-none text-[#fff6e6]">
          {def.name}
        </span>
        <span className="text-[8.5px] font-black tracking-[0.14em] text-[#ffb020]">{def.tag}</span>
      </div>
    </button>
  );
}

/**
 * Car Selection Garage. Five original SUVs — every one shares IDENTICAL
 * gameplay stats (speed, grip, mass, collisions); only the look changes.
 * In a multiplayer room the pick syncs to everyone via the server.
 */
export function Garage() {
  const carModel = useGameStore((s) => s.carModel);
  const carColor = useGameStore((s) => s.carColor);
  const setCar = useGameStore((s) => s.setCar);
  const setGarageOpen = useGameStore((s) => s.setGarageOpen);
  const inRoom = useMPStore((s) => s.screen === "room" && s.room != null);

  const [pickModel, setPickModel] = useState<CarModelId>(carModel);
  const [pickColor, setPickColor] = useState<number>(carColor);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [bigPreview, setBigPreview] = useState<{ key: string; url: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const def = useMemo(
    () => CAR_MODELS.find((m) => m.id === pickModel) ?? CAR_MODELS[0],
    [pickModel]
  );
  const dirty = pickModel !== carModel || pickColor !== carColor;

  // load card previews (each model in its default colour)
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const m of CAR_MODELS) {
        const url = await getCarPreview(m.id, 0);
        if (!alive) return;
        setPreviews((p) => ({ ...p, [m.id]: url }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // big preview follows the current pick (model + colour)
  const pickKey = `${pickModel}|${pickColor}`;
  useEffect(() => {
    let alive = true;
    getCarPreview(pickModel, pickColor).then((url) => {
      if (alive) setBigPreview({ key: `${pickModel}|${pickColor}`, url });
    });
    return () => {
      alive = false;
    };
  }, [pickModel, pickColor]);
  const bigUrl = bigPreview && bigPreview.key === pickKey ? bigPreview.url : null;

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(t);
  }, [saved]);

  const apply = () => {
    setCar(pickModel, pickColor);
    if (inRoom) void net.setCar(pickModel, pickColor);
    setSaved(true);
  };

  const close = () => {
    setGarageOpen(false);
  };

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-y-auto bg-[rgba(24,14,8,0.9)] backdrop-blur-[4px]"
      role="dialog"
      aria-label="Car garage"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-2.5 p-3 sm:gap-4 sm:p-6 [@media(max-height:560px)]:gap-1.5 [@media(max-height:560px)]:p-2">
        {/* header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-[family-name:var(--font-bungee)] text-3xl leading-none text-[#ffb020] [text-shadow:0_3px_0_#2b1c12] sm:text-4xl">
              THE GARAGE
            </h2>
            <p className="mt-0.5 text-[10px] font-black tracking-[0.3em] text-[#f6e3c2]/80">
              FIVE RIDES · PICK YOUR LOOK
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md border-2 border-[rgba(255,246,230,0.4)] px-3 py-2 text-xs font-black tracking-wider text-[#f6e3c2] transition-colors hover:bg-[rgba(255,246,230,0.12)]"
            aria-label="Close garage"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* identical performance banner (this is a promise, not a suggestion) */}
        <div className="flex items-center gap-2 rounded-lg border-2 border-[#2f9e63] bg-[rgba(47,158,99,0.16)] px-3 py-2 text-[11px] font-bold text-[#c9ecd6]">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#7ee2a8]" aria-hidden />
          <span>
            <b className="text-[#9fe6bf]">IDENTICAL PERFORMANCE.</b> Every SUV shares the exact
            same speed, grip, boost &amp; collisions — the pick is 100% cosmetic. No pay-to-win,
            no meta, just style.
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
          {/* big preview */}
          <div className="flex min-h-[220px] flex-col overflow-hidden rounded-xl border-[3px] border-[#2b1c12] bg-gradient-to-b from-[rgba(255,214,160,0.14)] via-[rgba(43,28,18,0.4)] to-[rgba(24,14,8,0.6)] p-3 shadow-2xl">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="font-[family-name:var(--font-bungee)] text-2xl leading-none text-[#fff6e6] sm:text-3xl">
                  {def.name}
                </div>
                <div className="text-[9px] font-black tracking-[0.25em] text-[#ffb020]">{def.tag}</div>
              </div>
              <span className="flex items-center gap-1 rounded bg-[rgba(43,28,18,0.72)] px-2 py-1 text-[8.5px] font-black tracking-wider text-[#c9a06a]">
                <Gauge className="h-3 w-3" aria-hidden /> {def.stance}
              </span>
            </div>
            <div className="relative flex-1">
              {bigUrl ? (
                <img
                  src={bigUrl}
                  alt={`${def.name} in ${def.paints[pickColor]?.name ?? "paint"}`}
                  className="result-anim h-full w-full object-contain drop-shadow-[0_10px_16px_rgba(0,0,0,0.5)]"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Car className="h-14 w-14 animate-pulse text-[#c9a06a]" aria-hidden />
                </div>
              )}
            </div>
            <p className="mt-1 text-[11px] font-semibold leading-snug text-[#f6e3c2]/90">
              {def.blurb}
            </p>
            {/* colour options */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] font-black tracking-[0.25em] text-[#ffb020]">PAINT</span>
              {def.paints.map((p, i) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setPickColor(i)}
                  aria-pressed={i === pickColor}
                  aria-label={`Paint ${p.name}`}
                  title={p.name}
                  className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${
                    i === pickColor ? "border-[#fff6e6] shadow-[0_0_0_2px_#ffb020]" : "border-[rgba(43,28,18,0.7)]"
                  }`}
                  style={{
                    background: `linear-gradient(135deg, ${hex(p.body)} 0 62%, ${hex(p.roof)} 62% 100%)`,
                  }}
                />
              ))}
              <span className="ml-1 text-[10px] font-black tracking-wider text-[#f6e3c2]">
                {def.paints[pickColor]?.name}
              </span>
            </div>
          </div>

          {/* car grid */}
          <div className="flex min-h-0 flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2 overflow-y-auto settings-scroll pr-0.5 sm:grid-cols-2 [@media(max-height:560px)]:grid-cols-3">
              {CAR_MODELS.map((m) => (
                <CarCard
                  key={m.id}
                  def={m}
                  selected={m.id === pickModel}
                  onPick={() => {
                    setPickModel(m.id);
                    setPickColor((c) => Math.min(c, m.paints.length - 1));
                  }}
                  preview={previews[m.id] ?? null}
                />
              ))}
            </div>

            {/* actions */}
            <div className="mt-auto flex flex-col gap-1.5">
              <button
                type="button"
                onClick={apply}
                disabled={!dirty && saved}
                className={`-skew-x-6 rounded-lg border-[3px] border-[#2b1c12] px-6 py-3 font-[family-name:var(--font-bungee)] text-xl shadow-[0_5px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_3px_0_#2b1c12] active:translate-y-1 active:shadow-none ${
                  dirty
                    ? "bg-[#f0641e] text-[#fff6e6]"
                    : "bg-[#2f9e63] text-[#fff6e6]"
                }`}
              >
                <span className="flex skew-x-6 items-center justify-center gap-2">
                  {saved && !dirty ? <Check className="h-5 w-5" aria-hidden /> : null}
                  {saved && !dirty ? "LOCKED IN" : dirty ? "TAKE IT OUT" : "CURRENT RIDE"}
                </span>
              </button>
              <p className="text-center text-[9.5px] font-bold tracking-wider text-[#c9a06a]">
                {inRoom
                  ? "YOUR PICK INSTANTLY SYNCS TO EVERYONE IN THE ROOM"
                  : "SELECTION SAVED — RIVALS AND REPLAYS KEEP THEIR OWN RIDES"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
