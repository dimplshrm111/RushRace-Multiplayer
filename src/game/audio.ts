"use client";

/**
 * Fully procedural audio for CANYON RUSH — original desert-rock soundtrack and
 * all SFX are synthesized live with the Web Audio API (no samples, no licensed
 * material). Layers: engine (osc stack), tires, wind, boost, plus a lookahead
 * music sequencer in E Phrygian dominant.
 */

interface AudioTelemetry {
  rpm: number; // 0..1
  throttle: number; // 0..1
  speed: number; // m/s
  driftIntensity: number; // 0..1
  boosting: boolean;
  wallRide: boolean;
  musicIntensity: number; // 0..3
}

const BPM = 112;
const SIXTEENTH = 60 / BPM / 4;

// E Phrygian dominant MIDI notes
const BASS_ROOTS = [40, 41, 40, 44]; // E2, F2, E2, G#2 per bar
const LEAD_SCALE = [64, 65, 68, 69, 71, 72, 74]; // E4 F4 G#4 A4 B4 C5 D5
const LEAD_PATTERNS = [
  [0, 2, 4, 2, 5, 4, 2, 0],
  [0, 2, 4, 6, 4, 2, 1, 0],
  [4, 5, 4, 2, 1, 2, 4, 6],
  [2, 4, 2, 0, 1, 0, 6, 4],
];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  // continuous loops
  private engOsc1: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engSub: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;
  private engNoiseGain: GainNode | null = null;
  private screechGain: GainNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private boostGain: GainNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;

  // music
  private musicOn = false;
  private step = 0;
  private nextNoteTime = 0;
  private leadDelay: DelayNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;

  private musicVol = 0.75;
  private sfxVol = 0.9;
  private ducked = false;
  private curIntensity = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture. Safe to call multiple times. */
  unlock(): boolean {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return true;
    }
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      this.ctx = ctx;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(comp);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxVol;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVol;
      this.musicBus.connect(this.master);

      // white noise buffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      this.buildEngineLoops();
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  private makeNoiseLoop(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start();
    return src;
  }

  private buildEngineLoops() {
    const ctx = this.ctx!;
    // Engine: saw + square + sub sine through a lowpass, plus exhaust noise
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.frequency.value = 500;
    this.engFilter.Q.value = 1.2;

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.sfxBus!);

    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = "sawtooth";
    this.engOsc1.frequency.value = 60;
    this.engOsc1.connect(this.engFilter);
    this.engOsc1.start();

    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = "square";
    this.engOsc2.frequency.value = 91;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    this.engOsc2.connect(o2g);
    o2g.connect(this.engFilter);
    this.engOsc2.start();

    this.engSub = ctx.createOscillator();
    this.engSub.type = "sine";
    this.engSub.frequency.value = 30;
    const subG = ctx.createGain();
    subG.gain.value = 0.6;
    this.engSub.connect(subG);
    subG.connect(this.engGain);
    this.engSub.start();

    const exN = this.makeNoiseLoop();
    const exF = ctx.createBiquadFilter();
    exF.type = "bandpass";
    exF.frequency.value = 140;
    exF.Q.value = 0.8;
    this.engNoiseGain = ctx.createGain();
    this.engNoiseGain.gain.value = 0;
    exN.connect(exF);
    exF.connect(this.engNoiseGain);
    this.engNoiseGain.connect(this.sfxBus!);

    // Tire screech
    const scN = this.makeNoiseLoop();
    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = "bandpass";
    this.screechFilter.frequency.value = 1250;
    this.screechFilter.Q.value = 6;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    scN.connect(this.screechFilter);
    this.screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.sfxBus!);

    // Wind
    const wN = this.makeNoiseLoop();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 700;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wN.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.sfxBus!);

    // Boost roar
    const bN = this.makeNoiseLoop();
    this.boostFilter = ctx.createBiquadFilter();
    this.boostFilter.type = "bandpass";
    this.boostFilter.frequency.value = 900;
    this.boostFilter.Q.value = 1.4;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    bN.connect(this.boostFilter);
    this.boostFilter.connect(this.boostGain);
    this.boostGain.connect(this.sfxBus!);
  }

  setVolumes(music: number, sfx: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(this.ducked ? music * 0.12 : music, this.ctx!.currentTime, 0.08);
    }
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(sfx, this.ctx!.currentTime, 0.05);
  }

  setDucked(v: boolean) {
    this.ducked = v;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(
        this.ducked ? this.musicVol * 0.12 : this.musicVol,
        this.ctx.currentTime,
        0.15
      );
    }
  }

  /** Called every frame with blended telemetry. */
  update(_dt: number, t: AudioTelemetry) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const rpm = Math.max(0, Math.min(1, t.rpm));
    const baseFreq = 52 + rpm * 300;

    this.engOsc1!.frequency.setTargetAtTime(baseFreq, now, 0.035);
    this.engOsc2!.frequency.setTargetAtTime(baseFreq * 1.503, now, 0.035);
    this.engSub!.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.035);
    this.engFilter!.frequency.setTargetAtTime(280 + rpm * 2400 + t.throttle * 900, now, 0.05);
    const engVol = (0.045 + t.throttle * 0.075 + rpm * 0.075) * (t.boosting ? 1.25 : 1);
    this.engGain!.gain.setTargetAtTime(engVol, now, 0.05);
    this.engNoiseGain!.gain.setTargetAtTime(0.02 + t.throttle * 0.05 + rpm * 0.03, now, 0.06);

    const screech = t.driftIntensity * 0.16 + (t.wallRide ? 0.1 : 0);
    this.screechGain!.gain.setTargetAtTime(screech, now, 0.05);
    this.screechFilter!.frequency.setTargetAtTime(950 + t.driftIntensity * 500, now, 0.1);

    const wind = Math.min(1, t.speed / 55);
    this.windGain!.gain.setTargetAtTime(wind * wind * 0.14, now, 0.1);
    this.windFilter!.frequency.setTargetAtTime(500 + wind * 1400, now, 0.1);

    this.boostGain!.gain.setTargetAtTime(t.boosting ? 0.17 : 0, now, t.boosting ? 0.03 : 0.12);
    this.boostFilter!.frequency.setTargetAtTime(t.boosting ? 1400 : 700, now, 0.08);

    this.curIntensity = t.musicIntensity;
    if (this.musicOn) this.scheduleMusic();
  }

  // ---------------- Music sequencer ----------------

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;

    // lead delay
    this.leadDelay = this.ctx.createDelay(1);
    this.leadDelay.delayTime.value = SIXTEENTH * 3;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.32;
    const dwet = this.ctx.createGain();
    dwet.gain.value = 0.35;
    this.leadDelay.connect(fb);
    fb.connect(this.leadDelay);
    this.leadDelay.connect(dwet);
    dwet.connect(this.musicBus!);

    // drone (always-on bed)
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 420;
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.musicBus!);
    for (const det of [-6, 5]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiToFreq(40); // E2
      o.detune.value = det;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g);
      g.connect(this.droneFilter);
      o.start();
    }
    this.droneGain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 1.2);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.droneGain && this.ctx) {
      this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
  }

  private scheduleMusic() {
    const ctx = this.ctx!;
    while (this.nextNoteTime < ctx.currentTime + 0.18) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.step++;
      this.nextNoteTime += SIXTEENTH;
    }
  }

  private scheduleStep(step: number, time: number) {
    const ctx = this.ctx!;
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const inten = this.curIntensity;

    // drone opens up with intensity
    if (this.droneFilter) {
      this.droneFilter.frequency.setTargetAtTime(380 + inten * 260, time, 0.3);
    }

    if (inten >= 1) {
      // kick — four on the floor
      if (s16 % 4 === 0) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(150, time);
        o.frequency.exponentialRampToValueAtTime(42, time + 0.11);
        g.gain.setValueAtTime(0.65, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
        o.connect(g);
        g.connect(this.musicBus!);
        o.start(time);
        o.stop(time + 0.18);
        this.duckMusic(time);
      }
      // clap on backbeat
      if (inten >= 2 && (s16 === 4 || s16 === 12)) {
        this.noiseBurst(this.musicBus!, time, 0.14, 1900, "bandpass", 0.3);
        this.noiseBurst(this.musicBus!, time + 0.012, 0.1, 2100, "bandpass", 0.2);
      }
      // hats
      if (inten >= 2 && s16 % 2 === 1) {
        this.noiseBurst(this.musicBus!, time, 0.04, 8000, "highpass", inten >= 3 ? 0.14 : 0.09);
      }
      if (inten >= 3 && s16 % 4 === 2) {
        this.noiseBurst(this.musicBus!, time, 0.12, 6500, "highpass", 0.1);
      }
      // bass
      const bassSteps = [0, 3, 6, 8, 11, 14];
      if (bassSteps.includes(s16)) {
        const note = BASS_ROOTS[bar] + (s16 === 14 ? 12 : 0);
        this.pluck(note, time, 0.22, 0.2, 900 + inten * 500, "sawtooth");
      }
    }

    // lead arps
    if (inten >= 2) {
      const pat = LEAD_PATTERNS[bar];
      if (s16 % 2 === 0) {
        const idx = pat[(s16 / 2) % pat.length];
        const oct = inten >= 3 && (s16 / 2) % 4 === 3 ? 12 : 0;
        const g = this.pluck(LEAD_SCALE[idx] + oct, time, 0.16, 0.085, 2400, "square");
        // route through delay for space
        if (g && this.leadDelay) {
          const send = ctx.createGain();
          send.gain.value = 0.5;
          g.connect(send);
          send.connect(this.leadDelay);
        }
      }
    }
  }

  private duckMusic(time: number) {
    if (!this.droneGain) return;
    this.droneGain.gain.cancelScheduledValues(time);
    this.droneGain.gain.setValueAtTime(0.05, time);
    this.droneGain.gain.setTargetAtTime(0.16, time + 0.05, 0.09);
  }

  /** Plucked note; returns the voice gain node for further routing. */
  private pluck(
    midi: number,
    time: number,
    dur: number,
    vol: number,
    cutoff: number,
    type: OscillatorType
  ): GainNode | null {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midiToFreq(midi);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, time);
    f.frequency.exponentialRampToValueAtTime(Math.max(220, cutoff * 0.25), time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.musicBus!);
    o.start(time);
    o.stop(time + dur + 0.05);
    return g;
  }

  private noiseBurst(
    dest: AudioNode,
    time: number,
    dur: number,
    freq: number,
    type: BiquadFilterType,
    vol: number,
    sweepTo?: number
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, time);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, time + dur);
    f.Q.value = type === "bandpass" ? 1.2 : 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(time);
    src.stop(time + dur + 0.05);
  }

  private tone(
    freq: number,
    dur: number,
    vol: number,
    type: OscillatorType,
    when = 0,
    slideTo?: number
  ) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const time = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g);
    g.connect(this.sfxBus!);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  // ---------------- One-shot SFX ----------------

  countdownBeep(go: boolean) {
    if (!this.ctx) return;
    if (go) {
      this.tone(932, 0.55, 0.3, "square");
      this.tone(466, 0.55, 0.18, "sawtooth");
      this.noiseBurst(this.sfxBus!, this.ctx.currentTime, 0.4, 3000, "highpass", 0.12);
    } else {
      this.tone(622, 0.14, 0.25, "square");
    }
  }

  checkpoint(deltaMs: number | null) {
    if (deltaMs != null && deltaMs < 0) {
      this.tone(880, 0.09, 0.22, "triangle");
      this.tone(1318, 0.14, 0.22, "triangle", 0.08);
    } else {
      this.tone(740, 0.09, 0.18, "triangle");
      this.tone(554, 0.13, 0.16, "triangle", 0.08);
    }
  }

  nearMiss() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.sfxBus!, t, 0.3, 400, "bandpass", 0.3, 3400);
    this.tone(220, 0.22, 0.06, "sawtooth", 0, 660);
  }

  jump() {
    if (!this.ctx) return;
    this.noiseBurst(this.sfxBus!, this.ctx.currentTime, 0.35, 600, "bandpass", 0.1, 2400);
  }

  landing(clean: boolean, intensity: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(120, 0.18, Math.min(0.4, 0.15 + intensity * 0.25), "sine", 0, 46);
    this.noiseBurst(this.sfxBus!, t, 0.22, 500, "lowpass", Math.min(0.35, 0.12 + intensity * 0.2));
    if (clean) {
      this.tone(1318, 0.1, 0.1, "triangle", 0.05);
      this.tone(1760, 0.12, 0.08, "triangle", 0.13);
    }
  }

  crash(intensity: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(90, 0.3, Math.min(0.5, 0.2 + intensity * 0.3), "sine", 0, 34);
    this.noiseBurst(this.sfxBus!, t, 0.32, 700, "lowpass", Math.min(0.5, 0.2 + intensity * 0.3));
    this.tone(180, 0.25, 0.14, "square", 0.02, 90);
  }

  boostStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.sfxBus!, t, 0.45, 300, "highpass", 0.22, 4500);
    this.tone(140, 0.4, 0.16, "sawtooth", 0, 420);
  }

  /** Wooden crate shatter — bright crack + hollow body thump. */
  boxHit() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.sfxBus!, t, 0.14, 2400, "bandpass", 0.42, 700);
    this.noiseBurst(this.sfxBus!, t + 0.03, 0.16, 520, "lowpass", 0.3);
    this.tone(150, 0.14, 0.22, "square", 0, 62);
    this.tone(98, 0.2, 0.14, "sine", 0.02, 44);
  }

  /** Big plank barricade smash — deep boom + a splintering crack cascade. */
  wallSmash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.sfxBus!, t, 0.5, 190, "lowpass", 0.55);
    this.noiseBurst(this.sfxBus!, t, 0.3, 1900, "bandpass", 0.4, 900);
    this.noiseBurst(this.sfxBus!, t + 0.07, 0.22, 3000, "bandpass", 0.3, 1400);
    this.noiseBurst(this.sfxBus!, t + 0.16, 0.18, 2400, "bandpass", 0.22, 800);
    this.tone(70, 0.42, 0.32, "square", 0, 40);
    this.tone(110, 0.24, 0.2, "sawtooth", 0.02, 55);
    this.tone(180, 0.12, 0.16, "triangle", 0.05, 80);
  }

  /** Approach alarm for the BREAK barricade — urgent two-tone warning beeps. */
  wallWarn() {
    if (!this.ctx) return;
    const seq = [640, 850, 640, 850];
    seq.forEach((f, i) => {
      this.tone(f, 0.09, 0.16, "square", i * 0.12);
    });
    this.tone(160, 0.5, 0.1, "sawtooth", 0, 120);
  }

  driftBank(mult: number) {
    this.tone(660 + mult * 60, 0.08, 0.16, "square");
    this.tone(990 + mult * 90, 0.1, 0.16, "square", 0.07);
  }

  finish(isRecord: boolean) {
    const notes = isRecord ? [64, 68, 71, 76, 80] : [64, 68, 71, 76];
    notes.forEach((n, i) => {
      this.tone(midiToFreq(n), 0.3, 0.2, "triangle", i * 0.11);
      this.tone(midiToFreq(n - 12), 0.3, 0.12, "sawtooth", i * 0.11);
    });
  }

  recovery() {
    this.tone(520, 0.12, 0.16, "square");
    this.tone(392, 0.14, 0.16, "square", 0.1);
    this.tone(311, 0.2, 0.16, "square", 0.2);
  }

  uiClick() {
    this.tone(880, 0.05, 0.1, "triangle");
  }
}
