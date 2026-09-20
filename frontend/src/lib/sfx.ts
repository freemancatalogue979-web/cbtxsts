/**
 * Arena sound effects — synthesised with WebAudio, zero asset files.
 *
 * Tactical command audio engine:
 * Short, quiet, clean, futuristic click/tap sounds on all UI interactions (`uiClick()`),
 * with a 38ms cooldown preventing machine-gunning on rapid repeated taps.
 *
 * AudioContext is unlocked lazily on the first user gesture (browser autoplay policy).
 */
import {setSoundOn, soundOn} from './prefs';

type SfxName =
  | 'tap'
  | 'tick'
  | 'correct'
  | 'wrong'
  | 'coin'
  | 'win'
  | 'lose'
  | 'whoosh'
  | 'levelup'
  | 'chat'
  | 'duel';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = typeof window !== 'undefined' && soundOn();
let noiseBuffer: AudioBuffer | null = null;
let unlocked = false;

let lastClickTime = 0;
const CLICK_COOLDOWN_MS = 38;

function ensure(): AudioContext | null {
  if (!unlocked) return null;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.38;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  c: AudioContext,
  {freq, at = 0, dur = 0.12, type = 'sine', gain = 0.2, glide}: {
    freq: number;
    at?: number;
    dur?: number;
    type?: OscillatorType;
    gain?: number;
    glide?: number;
  },
): void {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glide), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master as GainNode);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(c: AudioContext, {at = 0, dur = 0.25, from = 900, to = 2600, gain = 0.16}): void {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(env).connect(master as GainNode);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const RECIPES: Record<SfxName, (c: AudioContext) => void> = {
  tap: (c) => tone(c, {freq: 720, dur: 0.04, type: 'triangle', gain: 0.08}),
  tick: (c) => tone(c, {freq: 1200, dur: 0.025, type: 'square', gain: 0.04}),
  correct: (c) => {
    tone(c, {freq: 587.33, dur: 0.07, type: 'sine', gain: 0.16});
    tone(c, {freq: 880.0, at: 0.06, dur: 0.12, type: 'triangle', gain: 0.18});
    tone(c, {freq: 1760.0, at: 0.06, dur: 0.08, type: 'sine', gain: 0.05});
  },
  wrong: (c) => {
    tone(c, {freq: 220, dur: 0.14, type: 'sawtooth', gain: 0.12, glide: 110});
    tone(c, {freq: 165, at: 0.08, dur: 0.16, type: 'sawtooth', gain: 0.1, glide: 82});
  },
  coin: (c) => {
    tone(c, {freq: 1046.5, dur: 0.05, type: 'triangle', gain: 0.08});
    tone(c, {freq: 1396.91, at: 0.05, dur: 0.12, type: 'triangle', gain: 0.09});
  },
  win: (c) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      tone(c, {freq, at: i * 0.08, dur: 0.14, type: 'triangle', gain: 0.15}),
    );
    tone(c, {freq: 1567.98, at: 0.32, dur: 0.35, type: 'sine', gain: 0.1});
    noise(c, {at: 0.3, dur: 0.35, from: 2200, to: 5800, gain: 0.05});
  },
  lose: (c) => {
    [349.23, 293.66, 220.0].forEach((freq, i) => tone(c, {freq, at: i * 0.12, dur: 0.2, type: 'sine', gain: 0.14}));
  },
  whoosh: (c) => noise(c, {dur: 0.18, from: 800, to: 2800, gain: 0.08}),
  levelup: (c) => {
    [659.25, 880.0, 1046.5, 1318.51].forEach((freq, i) =>
      tone(c, {freq, at: i * 0.06, dur: 0.11, type: 'triangle', gain: 0.08}),
    );
    tone(c, {freq: 2093, at: 0.24, dur: 0.26, type: 'sine', gain: 0.09});
  },
  chat: (c) => {
    tone(c, {freq: 987.77, dur: 0.04, type: 'sine', gain: 0.1});
    tone(c, {freq: 1318.51, at: 0.04, dur: 0.06, type: 'sine', gain: 0.08});
  },
  duel: (c) => {
    tone(c, {freq: 349.23, dur: 0.09, type: 'sawtooth', gain: 0.1});
    tone(c, {freq: 440.0, at: 0.08, dur: 0.1, type: 'sawtooth', gain: 0.1});
    tone(c, {freq: 698.46, at: 0.16, dur: 0.18, type: 'triangle', gain: 0.14});
  },
};

export const sfx = {
  play(name: SfxName): void {
    if (!enabled) return;
    const c = ensure();
    if (!c || !master) return;
    try {
      RECIPES[name](c);
    } catch {
      /* audio must never break gameplay */
    }
  },
  playUiClick(type: 'tap' | 'nav' | 'select' | 'toggle' | 'confirm' | 'cancel' = 'tap'): void {
    if (!enabled) return;
    const c = ensure();
    if (!c || !master) return;
    try {
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const env = c.createGain();
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 2.8;
      const centerFreq = type === 'confirm' ? 1400 : type === 'cancel' ? 680 : type === 'nav' ? 1150 : 1600;
      filter.frequency.setValueAtTime(centerFreq, t0);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(centerFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(type === 'cancel' ? 300 : 700, t0 + 0.016);
      const gainVal = 0.07;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gainVal, t0 + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.016);
      osc.connect(filter).connect(env).connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.02);
    } catch {
      /* audio must never break UI */
    }
  },
  unlock(): void {
    unlocked = true;
    if (enabled) ensure();
  },
  isEnabled(): boolean {
    return enabled;
  },
  setEnabled(on: boolean): void {
    enabled = on;
    setSoundOn(on);
    if (on) {
      ensure();
      RECIPES.tap(ensure() as AudioContext);
    }
  },
  getVolume(): number {
    return master ? Math.round(master.gain.value * 100) : 38;
  },
  setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(100, vol)) / 100;
    if (master) master.gain.value = clamped;
  },
};

/** Global tactical click caller with debounce */
export function uiClick(type: 'tap' | 'nav' | 'select' | 'toggle' | 'confirm' | 'cancel' = 'tap'): void {
  const now = Date.now();
  if (now - lastClickTime < CLICK_COOLDOWN_MS) return;
  lastClickTime = now;
  sfx.playUiClick(type);
}
