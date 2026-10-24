"use client";

import { clamp, damp, type DriveInput } from "./types";

export type InputAction = "camera" | "restart" | "pause" | "mute";

interface TouchState {
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
  boost: boolean;
}

const STEER_ATTACK = 7.5;
const STEER_RELEASE = 12;

/**
 * Unified input: keyboard + mouse steering (optional) + gamepad + touch overlay.
 * Provides smoothed analog steering and forgiving input buffering for
 * drift/boost presses (so a press slightly before landing still counts).
 */
export class InputManager {
  private keys = new Set<string>();
  private touch: TouchState = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
  private steerCur = 0;
  private mouseX = 0; // -1..1 normalized
  private mouseDown = false;
  private lastDriftPress = -1;
  private lastBoostPress = -1;
  private lastActionAt: Record<string, number> = {};
  onAction: (a: InputAction) => void = () => {};
  mouseSteerEnabled = false;
  gamepadActive = false;
  usingGamepad = false;

  /** True when a key event originates from a text field (chat, inputs) —
   *  the game must ignore those so typing never drives the car. */
  private editableTarget(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.editableTarget(e)) return; // typing in chat — hands off
    const code = e.code;
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "Tab"].includes(code)
    ) {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.keys.add(code);
    const now = performance.now();
    if (code === "Space") this.lastDriftPress = now;
    if (code === "ShiftLeft" || code === "KeyK") this.lastBoostPress = now;
    if (code === "KeyC") this.fireAction("camera");
    if (code === "KeyR") this.fireAction("restart");
    if (code === "Escape" || code === "KeyP") this.fireAction("pause");
    if (code === "KeyM") this.fireAction("mute");
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.mouseSteerEnabled) return;
    const w = window.innerWidth;
    this.mouseX = clamp(((e.clientX - w * 0.5) / (w * 0.35)) * 1.15, -1, 1);
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (!this.mouseSteerEnabled) return;
    if (e.button === 0) this.mouseDown = true;
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };

  private handleBlur = () => {
    this.keys.clear();
    this.mouseDown = false;
  };

  private fireAction(a: InputAction) {
    const now = performance.now();
    if (now - (this.lastActionAt[a] ?? -1e9) < 350) return; // debounce
    this.lastActionAt[a] = now;
    this.onAction(a);
  }

  attach() {
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("blur", this.handleBlur);
  }

  detach() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("blur", this.handleBlur);
  }

  setTouch(t: Partial<TouchState>) {
    this.touch = { ...this.touch, ...t };
  }

  setMouseSteer(enabled: boolean) {
    this.mouseSteerEnabled = enabled;
    if (!enabled) {
      this.mouseX = 0;
      this.mouseDown = false;
    }
  }

  /** Returns active gamepad (if any) for rumble etc. */
  getGamepad(): Gamepad | null {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (p && p.connected) return p;
    }
    return null;
  }

  rumble(intensity: number, ms: number) {
    const pad = this.getGamepad() as (Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<string> } }) | null;
    if (pad?.vibrationActuator) {
      pad.vibrationActuator
        .playEffect("dual-rumble", {
          startDelay: 0,
          duration: ms,
          weakMagnitude: clamp(intensity * 0.7, 0, 1),
          strongMagnitude: clamp(intensity, 0, 1),
        })
        .catch(() => undefined);
    }
  }

  private gamepadInput(out: DriveInput): boolean {
    const pad = this.getGamepad();
    if (!pad) return false;
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    const ax = dz(pad.axes[0] ?? 0);
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
    const anyInput =
      Math.abs(ax) > 0.12 || rt > 0.05 || lt > 0.05 || btn(0) || btn(2) || btn(1);
    if (anyInput) this.usingGamepad = true;
    if (!this.usingGamepad) return false;
    if (ax !== 0) out.steer = clamp(ax * Math.abs(ax) * 0.6 + ax * 0.4, -1, 1); // response curve
    out.throttle = Math.max(out.throttle, rt > 0.05 ? rt : 0);
    out.brake = Math.max(out.brake, lt > 0.05 ? lt : 0);
    if (btn(0)) out.handbrake = true;
    if (btn(2) || btn(5)) out.boost = true;
    return true;
  }

  /** Build the combined, smoothed drive input for this frame. */
  sample(dt: number): DriveInput {
    const out: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    const k = this.keys;

    let keySteer = 0;
    if (k.has("KeyA") || k.has("ArrowLeft")) keySteer -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) keySteer += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) out.throttle = 1;
    if (k.has("KeyS") || k.has("ArrowDown")) out.brake = 1;
    if (k.has("Space")) out.handbrake = true;
    if (k.has("ShiftLeft") || k.has("KeyK")) out.boost = true;
    if (keySteer !== 0) out.steer = keySteer;

    if (this.mouseSteerEnabled && !this.usingGamepad) {
      if (Math.abs(this.mouseX) > 0.04) out.steer = this.mouseX;
      if (this.mouseDown) out.throttle = 1;
    }

    // touch overlay
    const t = this.touch;
    if (t.steer !== 0) out.steer = t.steer;
    if (t.throttle > 0) out.throttle = Math.max(out.throttle, t.throttle);
    if (t.brake > 0) out.brake = Math.max(out.brake, t.brake);
    if (t.drift) out.handbrake = true;
    if (t.boost) out.boost = true;

    this.gamepadActive = this.gamepadInput(out);

    // smooth digital steering toward target
    const target = clamp(out.steer, -1, 1);
    const rate = Math.abs(target) > Math.abs(this.steerCur) ? STEER_ATTACK : STEER_RELEASE;
    this.steerCur = damp(this.steerCur, target, rate, dt);
    out.steer = clamp(this.steerCur, -1, 1);
    return out;
  }

  /** True if the action was pressed within `windowMs` (input buffering). */
  buffered(kind: "drift" | "boost", windowMs = 320): boolean {
    const t = kind === "drift" ? this.lastDriftPress : this.lastBoostPress;
    return t >= 0 && performance.now() - t < windowMs;
  }

  consumeBuffer(kind: "drift" | "boost") {
    if (kind === "drift") this.lastDriftPress = -1;
    else this.lastBoostPress = -1;
  }
}
