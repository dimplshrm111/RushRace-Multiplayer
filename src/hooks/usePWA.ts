"use client";

import { useEffect, useState, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type PWAState =
  | "unavailable"   // browser doesn't support PWA install prompt
  | "installable"   // prompt captured, ready to install
  | "installed"     // already running as installed PWA
  | "dismissed";    // user dismissed the install prompt

export function usePWA() {
  const [state, setState] = useState<PWAState>("unavailable");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // 1. Check if running in standalone display mode (installed PWA)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      setState("installed");
      return;
    }

    // 2. Check if prompt was captured early by root inline script
    const globalPrompt = (window as unknown as { __pwaPrompt?: BeforeInstallPromptEvent | null }).__pwaPrompt;
    if (globalPrompt) {
      setDeferredPrompt(globalPrompt);
      setState("installable");
    }

    // 3. Listen for standard event and custom early-notification event
    const onPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent =
        (e.type === "beforeinstallprompt" ? (e as BeforeInstallPromptEvent) : null) ||
        (window as unknown as { __pwaPrompt?: BeforeInstallPromptEvent | null }).__pwaPrompt;

      if (promptEvent) {
        setDeferredPrompt(promptEvent);
        setState("installable");
      }
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("pwa-prompt-available", onPrompt);

    const onAppInstalled = () => {
      setState("installed");
      setDeferredPrompt(null);
      (window as unknown as { __pwaPrompt?: null }).__pwaPrompt = null;
    };
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("pwa-prompt-available", onPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const promptToUse =
      deferredPrompt ||
      (typeof window !== "undefined"
        ? (window as unknown as { __pwaPrompt?: BeforeInstallPromptEvent | null }).__pwaPrompt
        : null);

    if (!promptToUse) return false;

    try {
      await promptToUse.prompt();
      const { outcome } = await promptToUse.userChoice;
      if (outcome === "accepted") {
        setState("installed");
        return true;
      } else {
        setState("dismissed");
        return false;
      }
    } catch (err) {
      console.warn("[PWA] Prompt call error:", err);
      return false;
    } finally {
      setDeferredPrompt(null);
      if (typeof window !== "undefined") {
        (window as unknown as { __pwaPrompt?: null }).__pwaPrompt = null;
      }
    }
  }, [deferredPrompt]);

  const isInstallable = state === "installable" || deferredPrompt !== null;

  return {
    state,
    isInstalled: state === "installed",
    isInstallable,
    install,
  };
}
