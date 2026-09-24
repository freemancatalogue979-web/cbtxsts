/**
 * Background music — the three uploaded tracks, played through one transport.
 *
 * Two backends behind it:
 *
 *  * a **file** backend — an <audio> element per track, looped, routed through
 *    the shared volume bus. This is what the soundtrack plays.
 *  * a **synth** backend — a generative drum/bass/arp/pad arrangement on a
 *    16th-note grid, used when a device has no media element or a file cannot
 *    be decoded, so the arena is never silent.
 *
 * Pause, mute and resume are the part that has to feel right, so the rules are
 * explicit:
 *
 *  * **Pause keeps your place.** A file element is paused and resumes from the
 *    exact sample it stopped on. The synth keeps its bar counter and re-anchors
 *    to "now + one breath" instead of replaying the bars it missed.
 *  * **Mute is not pause.** It fades the bus to zero and leaves playback
 *    running, so unmuting lands mid-phrase exactly as if you never touched it.
 *  * **Switching tracks stops the old one dead.** Every playback generation owns
 *    its own gain bus; a switch disconnects it, killing queued notes and
 *    sustained pads instantly. Two tracks can never sound at once.
 *  * **A sleeping tab never catches up.** The scheduler re-anchors whenever the
 *    clock jumped forward, so a hidden tab resumes with the next bar instead of
 *    machine-gunning every bar it slept through.
 */
import {audioBlobDeleteAll, audioBlobGet, audioBlobPut} from './audioStore';
import {cacheRead, cacheWrite} from './cache';
import {musicOn, musicTrack, musicVolume, setMusicOn, setMusicTrack, setMusicVolume, type MusicTrackId} from './prefs';

export type TrackId = MusicTrackId;
export type MusicState = 'off' | 'blocked' | 'playing' | 'paused';

export interface TrackInfo {
  id: TrackId;
  name: string;
  blurb: string;
  /** The one-line version phones get — the full blurb can wrap badly on a phone. */
  short: string;
  /** The uploaded file, served from /music. */
  src: string;
  /** Measured length of the file, shown in the picker. */
  seconds: number;
  /** The synth arrangement that covers for this file on a device that cannot play it. */
  synth: SynthId;
}

/** The soundtrack: three uploaded tracks, played from disk and looped. */
export const MUSIC_TRACKS: TrackInfo[] = [
  {
    id: 'rock',
    name: 'Arena Rock',
    blurb: 'Guitars over a driving beat — entrance music for the arena.',
    short: 'Guitars and a driving beat.',
    src: '/music/alex-morgan-gaming-rock-545508.mp3',
    seconds: 110,
    synth: 'arena',
  },
  {
    id: 'arcade',
    name: 'Arcade Session',
    blurb: 'Bright arcade synth, built for the duel lobby.',
    short: 'Bright arcade synth.',
    src: '/music/alex-morgan-gaming-stream-arcade-session-578484.mp3',
    seconds: 127,
    synth: 'boss',
  },
  {
    id: 'surfer',
    name: 'Sound Surfer',
    blurb: 'Electronic drift — long study nights, steady focus.',
    short: 'Electronic drift for focus.',
    src: '/music/soundsurfer-gaming-331807.mp3',
    seconds: 134,
    synth: 'neon',
  },
];

/* ------------------------------------------------------------------ types */

export type SynthId = 'arena' | 'neon' | 'focus' | 'boss';

interface SynthTrack {
  bpm: number;
  chords: number[][]; // Hz per bar, progression loops
  bassRoots: number[]; // Hz per bar
  drums: 'full' | 'half' | 'none';
  arp: {type: OscillatorType; octave: number; gain: number; divisions: 8 | 16} | null;
  padGain: number;
  bassType: OscillatorType;
  bassGain: number;
}

/** The synth arrangements: a safety net, not the soundtrack. */
const SYNTH: Record<SynthId, SynthTrack> = {
  arena: {
    bpm: 126,
    chords: [
      [220.0, 261.63, 329.63], // Am
      [174.61, 220.0, 261.63], // F
      [196.0, 246.94, 329.63], // C
      [164.81, 196.0, 246.94], // G
    ],
    bassRoots: [110.0, 87.31, 98.0, 82.41],
    drums: 'full',
    arp: {type: 'square', octave: 2, gain: 0.16, divisions: 8},
    padGain: 0.05,
    bassType: 'sawtooth',
    bassGain: 0.3,
  },
  neon: {
    bpm: 104,
    chords: [
      [146.83, 174.61, 220.0], // Dm
      [130.81, 164.81, 196.0], // C
      [110.0, 130.81, 164.81], // Am(add low)
      [123.47, 146.83, 196.0], // Bb
    ],
    bassRoots: [73.42, 65.41, 55.0, 58.27],
    drums: 'half',
    arp: {type: 'triangle', octave: 2, gain: 0.18, divisions: 8},
    padGain: 0.06,
    bassType: 'sawtooth',
    bassGain: 0.26,
  },
  focus: {
    bpm: 80,
    chords: [
      [220.0, 261.63, 329.63], // Am
      [174.61, 220.0, 261.63], // F
      [196.0, 246.94, 329.63], // C
      [164.81, 196.0, 246.94], // G
    ],
    bassRoots: [110.0, 87.31, 98.0, 82.41],
    drums: 'none',
    arp: {type: 'sine', octave: 2, gain: 0.14, divisions: 8},
    padGain: 0.09,
    bassType: 'triangle',
    bassGain: 0.2,
  },
  boss: {
    bpm: 140,
    chords: [
      [110.0, 130.81, 164.81], // Am low
      [116.54, 146.83, 174.61], // Bb
      [123.47, 155.56, 185.0], // B
      [110.0, 138.59, 164.81], // A dim
    ],
    bassRoots: [55.0, 58.27, 61.74, 55.0],
    drums: 'full',
    arp: {type: 'sawtooth', octave: 2, gain: 0.14, divisions: 16},
    padGain: 0.045,
    bassType: 'square',
    bassGain: 0.3,
  },
};

/* ------------------------------------------------------------------ state */

let ctx: AudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/**
 * The bus every note of the current playback generation hangs off. Killing it
 * is how a pause, a stop and a track switch silence the old audio instantly
 * instead of letting queued notes and long pads ring over the new one.
 */
let bus: GainNode | null = null;
let busGeneration = 0;

/** File backend: one element per source, re-used so resuming keeps position. */
const elements = new Map<string, HTMLAudioElement>();
/** Files this device refused to decode — the synth covers for them instead. */
const failedSources = new Set<string>();

/* ---------------------------------------------------------------- storage */
/**
 * Every track is downloaded ONCE into IndexedDB and played from there — a
 * blob URL fed straight off the disk never crackles because the network
 * hiccuped mid-buffer. `localUrls` maps the shipped path to its live object
 * URL; priming runs on the first warm() and keeps going quietly in the
 * background. If storage is unavailable everything falls back to streaming,
 * which is exactly the old behaviour.
 */
const localUrls = new Map<string, string>();
let primeStarted = false;
let primePhase: 'idle' | 'busy' | 'ready' | 'unavailable' = 'idle';
let primedCount = 0;
const primeListeners = new Set<() => void>();

function notifyPrime(): void {
  primeListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* a status listener must never break the transport */
    }
  });
}

/** Swap a living element onto its local copy without losing its place. */
function adoptLocalUrl(src: string, url: string): void {
  localUrls.set(src, url);
  const el = elements.get(src);
  if (!el || el.src === url) return;
  const at = el.currentTime;
  const wasPlaying = !el.paused;
  el.src = url;
  try {
    el.currentTime = at;
  } catch {
    /* metadata not loaded yet — it will start from the top, once */
  }
  if (wasPlaying) void el.play().catch(() => undefined);
}

async function primeStorage(): Promise<void> {
  for (const track of MUSIC_TRACKS) {
    if (!track.src || localUrls.has(track.src)) continue;
    try {
      const hit = await audioBlobGet(track.src);
      if (hit) {
        adoptLocalUrl(track.src, URL.createObjectURL(hit));
        primedCount += 1;
        notifyPrime();
        continue;
      }
      // One quiet network trip, then this device owns the file forever.
      const response = await fetch(track.src);
      if (!response.ok) continue;
      const blob = await response.blob();
      if (!blob.size || !(await audioBlobPut(track.src, blob))) continue;
      adoptLocalUrl(track.src, URL.createObjectURL(blob));
      primedCount += 1;
      notifyPrime();
    } catch {
      /* offline or storage full — streaming remains the fallback */
    }
  }
  primePhase = primedCount > 0 ? 'ready' : 'unavailable';
  notifyPrime();
}

/** Kick the download once; safe to call from every warm-up path. */
function primeTracksLocally(): void {
  if (primeStarted || typeof window === 'undefined') return;
  primeStarted = true;
  primePhase = 'busy';
  notifyPrime();
  void primeStorage();
}

let state: MusicState = 'off';
let unlocked = false;
let timer: number | null = null;
let nextBarTime = 0;
let bar = 0;

const listeners = new Set<() => void>();

/**
 * The audio graph is built while the player is still reading the screen. The
 * session still belongs in local storage: which track, how loud, whether the
 * browser has ever let us play. That is what makes the next visit start
 * instantly instead of asking again.
 */
const UNLOCK_KEY = 'arena.music.unlocked';
const SESSION_KEY = 'music.session';

function rememberUnlocked(): void {
  try {
    window.localStorage.setItem(UNLOCK_KEY, String(Date.now()));
  } catch {
    /* private mode — nothing to remember */
  }
}

function wasUnlocked(): boolean {
  try {
    return Number(window.localStorage.getItem(UNLOCK_KEY) || 0) > 0;
  } catch {
    return false;
  }
}

/** Snapshot of the current session so the next boot can resume it outright. */
function saveSession(): void {
  cacheWrite('app', SESSION_KEY, {
    track: musicTrack(),
    volume: musicVolume(),
    enabled: musicOn(),
    state,
    at: Date.now(),
  });
}

/** The cached session, used by the profile screen and for instant resume. */
export function cachedMusicSession(): {track?: TrackId; volume?: number; enabled?: boolean; at?: number} | null {
  return cacheRead('app', SESSION_KEY);
}

function setState(next: MusicState): void {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
}

function currentTrack(): TrackInfo {
  return MUSIC_TRACKS.find((row) => row.id === musicTrack()) ?? MUSIC_TRACKS[0];
}

/** The arrangement that plays this track when its file cannot. */
function currentSynth(): SynthTrack {
  return SYNTH[currentTrack().synth] ?? SYNTH.arena;
}

function barSeconds(): number {
  return (60 / currentSynth().bpm) * 4;
}

/* ------------------------------------------------------------------ audio */

function ensure(): boolean {
  if (typeof window === 'undefined') return false;
  const Ctor = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return false;
  if (!ctx) {
    ctx = new Ctor();
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    compressor.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = volumeGain();
    master.connect(compressor);
    // one second of white noise for drums
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return true;
}

function volumeGain(): number {
  return Math.max(0, Math.min(100, musicVolume())) / 100 * 0.55;
}

/** Open a fresh bus for a new playback generation. */
function openBus(): GainNode | null {
  if (!ctx || !master) return null;
  closeBus();
  bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(master);
  busGeneration += 1;
  return bus;
}

/** Disconnect the current bus: every note hanging off it dies at once. */
function closeBus(): void {
  if (!bus) return;
  try {
    bus.gain.cancelScheduledValues?.(ctx ? ctx.currentTime : 0);
    bus.disconnect();
  } catch {
    /* already gone */
  }
  bus = null;
}

function out(): AudioNode | null {
  return bus ?? master;
}

function kick(at: number, gainScale = 1): void {
  if (!ctx || !out()) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(155, at);
  osc.frequency.exponentialRampToValueAtTime(44, at + 0.11);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.95 * gainScale, at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
  osc.connect(env).connect(out() as AudioNode);
  osc.start(at);
  osc.stop(at + 0.3);
}

function noiseHit(at: number, opts: {highpass: number; gain: number; decay: number}): void {
  if (!ctx || !noiseBuffer || !out()) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = opts.highpass;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(opts.gain, at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay);
  src.connect(filter).connect(env).connect(out() as AudioNode);
  src.start(at, Math.random() * 0.4, opts.decay + 0.05);
}

function snare(at: number): void {
  noiseHit(at, {highpass: 1400, gain: 0.4, decay: 0.14});
}

function hat(at: number, open = false): void {
  noiseHit(at, {highpass: 7200, gain: open ? 0.14 : 0.16, decay: open ? 0.16 : 0.045});
}

function bassNote(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
  if (!ctx || !out()) return;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(850, at);
  filter.frequency.exponentialRampToValueAtTime(280, at + dur);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.96);
  osc.connect(filter).connect(env).connect(out() as AudioNode);
  osc.start(at);
  osc.stop(at + dur + 0.04);
}

function arpNote(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
  if (!ctx || !out()) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(out() as AudioNode);
  osc.start(at);
  osc.stop(at + dur + 0.04);
}

function padVoices(freqs: number[], at: number, dur: number, gain: number): void {
  if (!ctx || !out()) return;
  for (const freq of freqs) {
    for (const detune of [-5, 6]) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(gain, at + dur * 0.3);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(env).connect(out() as AudioNode);
      osc.start(at);
      osc.stop(at + dur + 0.06);
    }
  }
}

function scheduleBar(at: number): void {
  const track = currentSynth();
  const seconds = barSeconds();
  const step = seconds / 16; // 16th-note grid — rock-solid timing
  const chordIndex = bar % track.chords.length;
  const chord = track.chords[chordIndex];
  const root = track.bassRoots[chordIndex % track.bassRoots.length];

  // pads sustain the whole bar
  padVoices(chord, at, seconds - 0.08, track.padGain);

  // bass: 8th-note drive (16th gallop doubles the root on boss)
  for (let i = 0; i < 8; i += 1) {
    bassNote(i % 4 === 3 ? root * 1.5 : root, at + i * step * 2, step * 1.7, track.bassType, track.bassGain);
  }

  // drums
  if (track.drums === 'full') {
    for (let beat = 0; beat < 4; beat += 1) {
      kick(at + beat * step * 4, beat === 0 ? 1 : 0.85);
      hat(at + beat * step * 4 + step * 2, beat === 3);
    }
    snare(at + step * 4);
    snare(at + step * 12);
  } else if (track.drums === 'half') {
    kick(at, 1);
    kick(at + step * 8, 0.9);
    snare(at + step * 4);
    snare(at + step * 12);
    hat(at + step * 2);
    hat(at + step * 6);
    hat(at + step * 10);
    hat(at + step * 14, true);
  }

  // arp: cycles the chord an octave up on the 8th (or 16th) grid
  if (track.arp) {
    const {type, octave, gain, divisions} = track.arp;
    const notes = [chord[0], chord[1], chord[2], chord[1] * 1.5];
    const steps = divisions === 16 ? 16 : 8;
    for (let i = 0; i < steps; i += 1) {
      const freq = notes[(bar * 3 + i) % notes.length] * octave;
      arpNote(freq, at + i * (seconds / steps), (seconds / steps) * 0.85, type, gain * (i % 4 === 0 ? 1 : 0.75));
    }
  }

  bar += 1;
}

/** How far ahead the synth is allowed to write notes into the future. */
const HORIZON = 1.2;

/**
 * The heartbeat. Re-anchors before it schedules, so a tick that arrives late —
 * a background tab, a laptop lid, a long GC pause — starts the next bar from
 * now instead of dumping every bar that was missed on top of each other.
 */
function tick(): void {
  if (!ctx || !bus) return;
  const now = ctx.currentTime;
  const barLength = barSeconds();
  if (nextBarTime < now - 0.05) nextBarTime = now + 0.12;
  let written = 0;
  while (nextBarTime < now + HORIZON && written < 4) {
    scheduleBar(Math.max(nextBarTime, now + 0.02));
    nextBarTime += barLength;
    written += 1;
  }
}

/* ------------------------------------------------------------------- file */

function elementFor(src: string): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') return null;
  if (failedSources.has(src)) return null;
  const existing = elements.get(src);
  if (existing) return existing;
  const el = new window.Audio();
  // Prefer the copy stored on this device; stream only until it exists.
  el.src = localUrls.get(src) ?? src;
  el.loop = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  elements.set(src, el);
  return el;
}

/** Route a file element through the shared volume bus (once per element). */
function connectElement(el: HTMLAudioElement): void {
  if (!ctx || !master) return;
  const wired = (el as HTMLAudioElement & {__arenaWired?: boolean}).__arenaWired;
  if (wired) return;
  try {
    ctx.createMediaElementSource(el).connect(master);
    (el as HTMLAudioElement & {__arenaWired?: boolean}).__arenaWired = true;
  } catch {
    /* the element is already wired elsewhere; its own volume still applies */
    el.volume = volumeGain();
  }
}

function currentElement(): HTMLAudioElement | null {
  const src = currentTrack().src;
  return src ? elementFor(src) : null;
}

/**
 * Only one file may ever sound at a time. Called before any new track starts:
 * every element that is not the one we are about to play gets paused, so a
 * switch can never leave two tracks playing over each other.
 */
function pauseEveryElementExcept(keep: HTMLAudioElement | null): void {
  elements.forEach((el) => {
    if (el !== keep && !el.paused) el.pause();
  });
}

/** True when this track has to be played by the synth on this device. */
function synthOnly(): boolean {
  const track = currentTrack();
  return !track.src || failedSources.has(track.src) || elementFor(track.src) === null;
}

/* --------------------------------------------------------------- transport */

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function startTimer(): void {
  stopTimer();
  timer = window.setInterval(tick, 250);
  tick();
}

/** Silence the current generation without losing the player's place. */
function hush(): void {
  stopTimer();
  closeBus();
}

function beginSynth(): void {
  if (!ctx) return;
  openBus();
  // Continue the progression rather than snapping back to bar 0: paused music
  // that resumes on the same phrase feels like a player, not a restart.
  nextBarTime = ctx.currentTime + 0.14;
  startTimer();
  setState('playing');
  saveSession();
}

function beginFile(el: HTMLAudioElement, restart: boolean): void {
  connectElement(el);
  if (restart) el.currentTime = 0;
  const play = el.play();
  if (play && typeof play.then === 'function') {
    play.catch((error: DOMException) => {
      if (error?.name === 'NotAllowedError') {
        setState('blocked'); // autoplay policy: the start button fixes this
        return;
      }
      // The file itself will not play here — cover it with the arrangement
      // rather than leaving the arena silent. A blob URL maps back to the
      // track path it was stored under, so the synth still covers it.
      const srcKey = [...elements.entries()].find(([, candidate]) => candidate === el)?.[0] ?? el.src.replace(/^https?:\/\/[^/]+/, '');
      failedSources.add(srcKey);
      beginSynth();
    });
  }
}

function start(restart = true): void {
  if (!musicOn() || !unlocked || state === 'playing') return;
  if (!ensure() || !ctx) {
    setState('off'); // no WebAudio at all — stay silent, no nag button
    return;
  }
  ctx.resume().then(
    () => {
      if (!musicOn() || !unlocked) return;
      if (master) master.gain.value = volumeGain();
      if (restart) bar = 0;
      if (synthOnly()) {
        beginSynth();
        rememberUnlocked();
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
        return;
      }
      const el = elementFor(currentTrack().src);
      if (!el) {
        beginSynth();
        rememberUnlocked();
        return;
      }
      beginFile(el, restart);
      rememberUnlocked();
      setState('playing');
      saveSession();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    },
    () => setState('blocked'),
  );
}

/**
 * Pause: keep the place, drop the sound. Nothing is scheduled while paused, so
 * a paused app costs no battery and cannot drift behind the clock.
 */
function pause(fromVisibility = false): void {
  if (state !== 'playing') return;
  hush();
  if (fromVisibility) document.removeEventListener('visibilitychange', onVisibility);
  // Files keep their own position, so their pause is the whole story; the synth
  // never sounds again until resume re-opens a bus.
  pauseEveryElementExcept(null);
  setState('paused');
  saveSession();
}

/** Resume: pick the phrase back up where it stopped. Never replays, never skips. */
function resume(): void {
  if (state !== 'paused') return;
  if (!musicOn()) return;
  if (!synthOnly()) {
    const el = elementFor(currentTrack().src);
    if (el) {
      ctx?.resume();
      beginFile(el, false); // the element resumes from its own position
      setState('playing');
      saveSession();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      return;
    }
  }
  if (!ctx) return;
  ctx.resume().then(() => {
    if (state !== 'paused') return;
    beginSynth();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  });
}

function stop(): void {
  hush();
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  pauseEveryElementExcept(null);
  setState(musicOn() ? 'blocked' : 'off');
}

function onVisibility(): void {
  if (typeof document === 'undefined') return;
  if (document.hidden) pause(true);
  else resume();
}

/**
 * Build the audio graph ahead of time so pressing play (or the autoplay retry)
 * sounds instantly: context, compressor, master gain and the noise buffer are
 * all created while the player is still reading the screen. Nothing is audible
 * until a track starts.
 */
function prefetch(): void {
  primeTracksLocally();
  if (!ensure() || !ctx) return;
  if (ctx.state === 'suspended' && state === 'playing') void ctx.resume();
}

/* ------------------------------------------------------------------ public */

export const music = {
  /** Local-storage status for the UI: what is saved on this device. */
  storage(): {phase: 'idle' | 'busy' | 'ready' | 'unavailable'; stored: number; total: number} {
    return {phase: primePhase, stored: primedCount, total: MUSIC_TRACKS.filter((t) => t.src).length};
  },
  subscribeStorage(listener: () => void): () => void {
    primeListeners.add(listener);
    return () => primeListeners.delete(listener);
  },
  /** Drop the local copies and fetch them again (e.g. after re-uploading a file). */
  refreshStorage(): void {
    void (async () => {
      await audioBlobDeleteAll();
      // Do NOT revoke live URLs — a playing element still owns its blob; the
      // primed replacement swaps the source and the old one is collected then.
      localUrls.clear();
      primedCount = 0;
      primePhase = 'busy';
      notifyPrime();
      primeStarted = false;
      primeTracksLocally();
    })();
  },
  /** 'off' | 'blocked' (autoplay refused — show the start button) | 'playing' | 'paused' */
  state(): MusicState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isEnabled(): boolean {
    return musicOn();
  },
  setEnabled(on: boolean): void {
    setMusicOn(on);
    saveSession();
    if (on) {
      unlocked = true; // the toggle click is itself a gesture
      if (state === 'paused') {
        resume();
        return;
      }
      start(false);
    } else {
      stop();
      setState('off');
    }
  },
  /** Hold the music where it is; `resume()` picks it back up from there. */
  pause(): void {
    pause(false);
  },
  resume(): void {
    if (!unlocked) {
      unlocked = true;
      start(false);
      return;
    }
    resume();
  },
  /** Pause if playing, resume if paused — what the header button calls. */
  toggle(): void {
    if (state === 'playing') music.pause();
    else if (state === 'paused') music.resume();
    else if (state === 'blocked') music.unlock();
    else music.setEnabled(true);
  },
  isPaused(): boolean {
    return state === 'paused';
  },
  track(): TrackId {
    return musicTrack();
  },
  setTrack(id: TrackId): void {
    if (id === musicTrack()) return;
    // Read the outgoing element before the preference changes: asking for
    // "the current element" after the switch returns the *new* track's one and
    // leaves the old file playing underneath it.
    const wasPlaying = state === 'playing';
    setMusicTrack(id);
    saveSession();
    // Kill the old arrangement before the new one starts: a switch must never
    // leave two tracks sounding at once, and it must never skip a beat either.
    hush();
    pauseEveryElementExcept(null);
    if (!wasPlaying || !ctx) {
      if (state === 'playing') setState('paused');
      return;
    }
    if (!synthOnly()) {
      const next = elementFor(currentTrack().src);
      if (next) {
        beginFile(next, true);
        setState('playing');
        saveSession();
        return;
      }
    }
    bar = 0; // a new arrangement starts at its first bar, cleanly
    beginSynth();
  },
  volume(): number {
    return musicVolume();
  },
  setVolume(value: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setMusicVolume(clamped);
    saveSession();
    // Volume is a fade on the master bus: it never touches the transport, so
    // muting and unmuting cannot skip, restart or double a track.
    if (master && ctx) master.gain.setTargetAtTime(volumeGain(), ctx.currentTime, 0.05);
  },
  /** Called from the first pointer/key gesture — same unlock path as the sfx. */
  unlock(): void {
    if (!musicOn()) return;
    unlocked = true;
    if (state === 'paused') {
      resume();
      return;
    }
    start(false);
  },
  /** Called once at boot: try to autoplay, else report 'blocked' for the UI. */
  autoplay(): void {
    if (!musicOn()) {
      setState('off');
      return;
    }
    // Warm the graph first — a resumed context starts in a few milliseconds.
    prefetch();
    const activation = (navigator as Navigator & {userActivation?: {hasBeenActive?: boolean}}).userActivation;
    // This device has played before: try immediately rather than showing the
    // "start music" nag (the browser still gets the final say).
    if (!wasUnlocked() && activation && !activation.hasBeenActive) {
      setState('blocked');
      return;
    }
    unlocked = true;
    start(false);
    if (timer === null && state !== 'playing' && musicOn()) setState('blocked');
  },

  /** Public pre-warm: called on the first gesture and whenever the tab wakes. */
  warm(): void {
    if (!musicOn()) return;
    if (state === 'paused') return; // a paused player stays paused until asked
    prefetch();
  },

  /** Test seam: the generation counter proves old audio is disconnected. */
  _debug(): {
    state: MusicState;
    bar: number;
    nextBarTime: number;
    bus: number;
    generation: number;
    timer: boolean;
    backend: 'file' | 'synth' | 'idle';
    source: string | null;
    position: number | null;
  } {
    const el = currentElement();
    return {
      state,
      bar,
      nextBarTime,
      bus: busGeneration,
      generation: busGeneration,
      timer: timer !== null,
      backend: state === 'playing' || state === 'paused' ? (el ? 'file' : 'synth') : 'idle',
      source: el ? el.src : null,
      position: el ? el.currentTime : null,
    };
  },
};
