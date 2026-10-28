"use client";

import { Download, X, Share, Smartphone, Laptop, Check } from "lucide-react";
import { useState } from "react";
import { usePWA } from "@/hooks/usePWA";

/**
 * Install Game banner and instructions.
 * - Shows native one-click install button on supported browsers (Chrome, Edge, Android).
 * - Shows manual install guide for iOS Safari, IP-based testing, and other browsers.
 * - Hides automatically once installed in standalone mode.
 */
export function InstallBanner() {
  const { isInstalled, isInstallable, install } = usePWA();
  const [showInstructions, setShowInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // If already installed or user dismissed it in this session, do not show
  if (isInstalled || dismissed) return null;

  // Platform detection for tailored instructions
  const isIOS =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const isSecure =
    typeof window !== "undefined"
      ? Boolean(window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      : true;

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) {
        setShowInstructions(true);
      }
    } else {
      setShowInstructions(true);
    }
  };

  return (
    <div className="relative mt-2 flex flex-col items-center gap-1.5 z-30">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleInstallClick}
          className="group relative flex items-center gap-2 -skew-x-6 rounded-lg border-2 border-[#2b1c12] bg-gradient-to-r from-[#ffd23f] via-[#ffb020] to-[#f0641e] px-5 py-2.5 font-[family-name:var(--font-bungee)] text-xs text-[#2b1c12] shadow-[0_4px_0_#2b1c12] transition-all hover:translate-y-0.5 hover:shadow-[0_2px_0_#2b1c12] active:translate-y-1 active:shadow-none sm:text-sm"
          aria-label="Install Canyon Rush as an app"
        >
          <span className="flex skew-x-6 items-center gap-2">
            <Download className="h-4 w-4 animate-bounce" aria-hidden />
            INSTALL GAME
          </span>
          <span className="skew-x-6 rounded bg-[rgba(43,28,18,0.2)] px-1.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-wider text-[#2b1c12]">
            {isInstallable ? "1-Click" : isIOS ? "iOS" : "App"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(43,28,18,0.5)] text-[#f6e3c2] hover:bg-[rgba(43,28,18,0.8)] transition-colors"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Manual Installation Instructions Modal */}
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border-[3px] border-[#2b1c12] bg-[#fff6e6] p-5 shadow-2xl text-[#2b1c12]">
            <div className="flex items-center justify-between border-b-2 border-[#2b1c12]/20 pb-2">
              <h3 className="font-[family-name:var(--font-bungee)] text-base sm:text-lg text-[#f0641e]">
                INSTALL CANYON RUSH
              </h3>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="rounded p-1 hover:bg-[#2b1c12]/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 space-y-3 text-xs font-medium leading-relaxed">
              {isIOS ? (
                <>
                  <div className="flex items-center gap-2 text-[#7a3a1e] font-bold">
                    <Smartphone className="h-4 w-4 text-[#f0641e]" /> Safari on iPhone / iPad
                  </div>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f0641e] font-bold text-white text-[10px]">1</span>
                    <span>Tap the <strong>Share</strong> button <Share className="inline h-3.5 w-3.5 text-[#f0641e]" /> at the bottom of Safari.</span>
                  </p>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f0641e] font-bold text-white text-[10px]">2</span>
                    <span>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>.</span>
                  </p>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f0641e] font-bold text-white text-[10px]">3</span>
                    <span>Tap <strong>Add</strong> in the top-right corner to launch full-screen without address bar!</span>
                  </p>
                </>
              ) : isAndroid ? (
                <>
                  <div className="flex items-center gap-2 text-[#7a3a1e] font-bold">
                    <Smartphone className="h-4 w-4 text-[#f0641e]" /> Chrome on Android
                  </div>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f0641e] font-bold text-white text-[10px]">1</span>
                    <span>Tap the <strong>three dots menu (⋮)</strong> in Chrome.</span>
                  </p>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f0641e] font-bold text-white text-[10px]">2</span>
                    <span>Select <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home screen&quot;</strong>.</span>
                  </p>
                  {!isSecure && (
                    <div className="rounded-lg border border-amber-600/30 bg-amber-500/10 p-2.5 text-[11px] text-[#7a3a1e]">
                      ℹ️ <strong>Local Wi-Fi (HTTP):</strong> You are connected via a local IP address. Mobile Chrome requires <strong>HTTPS</strong> or <strong>localhost</strong> for 1-click install. In production (with HTTPS), it installs in 1 click!
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-[#7a3a1e] font-bold">
                    <Laptop className="h-4 w-4 text-[#f0641e]" /> Chrome / Edge on Desktop
                  </div>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f0641e] font-bold text-white text-[10px]">1</span>
                    <span>Click the <strong>Install</strong> icon (⊕) in the browser address bar (right side).</span>
                  </p>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f0641e] font-bold text-white text-[10px]">2</span>
                    <span>Or click browser menu (⋮) &gt; <strong>&quot;Install Canyon Rush&quot;</strong>.</span>
                  </p>
                </>
              )}

              <div className="rounded-lg bg-[#f0641e]/10 p-2.5 text-[11px] text-[#7a3a1e]">
                ✨ <strong>App Mode:</strong> Launches full-screen without the browser address bar, perfectly fitting mobile landscape mode!
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowInstructions(false)}
              className="mt-4 w-full rounded-lg border-2 border-[#2b1c12] bg-[#f0641e] py-2 font-[family-name:var(--font-bungee)] text-sm text-[#fff6e6] shadow-[0_3px_0_#2b1c12] active:translate-y-0.5 active:shadow-none"
            >
              GOT IT!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
