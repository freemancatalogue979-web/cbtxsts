/**
 * Background music: the three approved tracks and nothing else.
 *
 * The only music the app can ever play is one of the files in `MUSIC_TRACKS`
 * (served from /public/music). There is no generated/synth fallback, no
 * hidden ambient loop, no default song outside this list: when a file cannot
 * play on a device the player goes quiet and shows the play button instead of
 * substituting other music.
 *
 * Rules:
 *
 *  * **One track at a time.** Every element except the chosen one is paused
 *    before anything plays, so a switch can never layer two songs.
 *  * **Pause keeps your place.** The element pauses and resumes from the exact
 *    point it stopped at.
 *  * **Volume is not pause.** Volume is a gain change (WebAudio master gain, or
 *    the element's own volume where WebAudio is unavailable) and never touches
 *    the transport.
 *  * **A hidden tab pauses; coming back resumes** — but only if it was the tab
 *    that paused it. A player who pressed pause stays paused.
 *  * **Local copies never interrupt playback.** Tracks are cached in IndexedDB
 *    and a cached copy is only swapped in while its element is not playing
 *    (swapping `src` under a playing element aborts playback).
 */
import {audioBlobDelete, audioBlobDeleteAll, audioBlobGet, audioBlobKeys, audioBlobPut} from './audioStore';
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
}

/** The soundtrack — the ONLY music the app plays. Players pick one of these. */
export const MUSIC_TRACKS: readonly TrackInfo[] = Object.freeze([
  {
    id: 'rock',
    name: 'Arena Rock',
    blurb: 'Guitars over a driving beat — entrance music for the arena.',
    short: 'Guitars and a driving beat.',
    src: '/music/alex-morgan-gaming-rock-545508.mp3',
    seconds: 110,
  },
  {
    id: 'arcade',
    name: 'Arcade Session',
    blurb: 'Bright arcade synth, built for the duel lobby.',
    short: 'Bright arcade synth.',
    src: '/music/alex-morgan-gaming-stream-arcade-session-578484.mp3',
    seconds: 127,
  },
  {
    id: 'surfer',
    name: 'Sound Surfer',
    blurb: 'Electronic drift — long study nights, steady focus.',
    short: 'Electronic drift for focus.',
    src: '/music/soundsurfer-gaming-331807.mp3',
    seconds: 134,
  },
] as TrackInfo[]);

const APPROVED_SOURCES = new Set(MUSIC_TRACKS.map((track) => track.src));

/* ------------------------------------------------------------------ state */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** One element per approved track, created lazily. */
const elements = new Map<string, HTMLAudioElement>();
/** Tracks whose file could not be decoded even from the network. */
const brokenSources = new Set<string>();
/** Tracks already retried from the network after a blob failed to decode. */
const retriedFromNetwork = new Set<string>();

let state: MusicState = 'off';
let unlocked = false;
let pausedByVisibility = false;
const listeners = new Set<() => void>();

/**
 * Remembered across visits: once this device has played music, the next visit
 * tries to start straight away instead of showing the start button.
 */
const UNLOCK_KEY = 'arena.music.unlocked';
const SESSION_KEY = 'music.session';

function rememberUnlocked(): void {
  try {
    window.localStorage.setItem(UNLOCK_KEY, String(Date.now()));
  } catch {
    /* private mode — the start button still works */
  }
}

function wasUnlocked(): boolean {
  try {
    return Number(window.localStorage.getItem(UNLOCK_KEY) || 0) > 0;
  } catch {
    return false;
  }
}

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
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* a UI listener must never break the transport */
    }
  });
}

function currentTrack(): TrackInfo {
  return MUSIC_TRACKS.find((row) => row.id === musicTrack()) ?? MUSIC_TRACKS[0];
}

function volumeGain(): number {
  const v = musicVolume() / 100;
  return v * v * 0.9; // perceptual curve; 100% sits a touch under full scale
}

/* ------------------------------------------------------------ local copies */

/**
 * Every approved track is downloaded once into IndexedDB and played from
 * there, so a flaky network never makes the soundtrack stutter. Anything else
 * found in the store (an old or renamed file) is deleted — only the three
 * approved songs may live on the device.
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
      /* status listeners must never break the transport */
    }
  });
}

/** Point an element at its local copy — only while it is not playing. */
function adoptLocalUrl(src: string, url: string): void {
  localUrls.set(src, url);
  const el = elements.get(src);
  if (!el || el.src === url || !el.paused) return; // playing: keep streaming, swap next time
  const at = el.currentTime;
  el.src = url;
  if (at > 0) {
    const seek = () => {
      try {
        el.currentTime = at;
      } catch {
        /* keep the start */
      }
    };
    el.addEventListener('loadedmetadata', seek, {once: true});
  }
}

async function purgeUnapproved(): Promise<void> {
  try {
    const keys = await audioBlobKeys();
    await Promise.all(keys.filter((key) => !APPROVED_SOURCES.has(key)).map((key) => audioBlobDelete(key)));
  } catch {
    /* storage unavailable — nothing to purge */
  }
}

async function primeStorage(): Promise<void> {
  await purgeUnapproved();
  for (const track of MUSIC_TRACKS) {
    if (localUrls.has(track.src)) continue;
    try {
      const hit = await audioBlobGet(track.src);
      if (hit && hit.size) {
        adoptLocalUrl(track.src, URL.createObjectURL(hit));
        primedCount += 1;
        notifyPrime();
        continue;
      }
      const response = await fetch(track.src);
      if (!response.ok) continue;
      const blob = await response.blob();
      if (!blob.size || !(await audioBlobPut(track.src, blob))) continue;
      adoptLocalUrl(track.src, URL.createObjectURL(blob));
      primedCount += 1;
      notifyPrime();
    } catch {
      /* offline or storage full — streaming from /music still works */
    }
  }
  primePhase = primedCount > 0 ? 'ready' : 'unavailable';
  notifyPrime();
}

function primeTracksLocally(): void {
  if (primeStarted || typeof window === 'undefined') return;
  primeStarted = true;
  primePhase = 'busy';
  notifyPrime();
  void primeStorage();
}

/* ------------------------------------------------------------------ audio */

/** WebAudio is only used as a volume stage; playback works without it. */
function ensureGraph(): void {
  if (ctx || typeof window === 'undefined') return;
  const Ctor = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volumeGain();
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
}

function applyVolume(): void {
  const gain = volumeGain();
  if (master && ctx) master.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
  elements.forEach((el) => {
    const wired = (el as HTMLAudioElement & {__arenaWired?: boolean}).__arenaWired;
    el.volume = wired ? 1 : Math.min(1, gain);
  });
}

function elementFor(src: string): HTMLAudioElement | null {
  if (!APPROVED_SOURCES.has(src)) return null; // never play anything outside the list
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') return null;
  if (brokenSources.has(src)) return null;
  const existing = elements.get(src);
  if (existing) return existing;
  const el = new window.Audio();
  // A device (or test DOM) that cannot decode MP3 stays silent — no substitute music.
  if (typeof el.canPlayType === 'function' && el.canPlayType('audio/mpeg') === '') {
    brokenSources.add(src);
    return null;
  }
  el.src = localUrls.get(src) ?? src;
  el.loop = true;
  el.preload = 'auto';
  el.volume = Math.min(1, volumeGain());
  el.addEventListener('error', () => onElementError(src, el));
  elements.set(src, el);
  return el;
}

/** Route an element through the master gain once, if WebAudio is available. */
function connectElement(el: HTMLAudioElement): void {
  if (!ctx || !master) return;
  const tagged = el as HTMLAudioElement & {__arenaWired?: boolean};
  if (tagged.__arenaWired) return;
  try {
    ctx.createMediaElementSource(el).connect(master);
    tagged.__arenaWired = true;
    el.volume = 1;
  } catch {
    el.volume = Math.min(1, volumeGain());
  }
}

function currentElement(): HTMLAudioElement | null {
  return elementFor(currentTrack().src);
}

function pauseEveryElementExcept(keep: HTMLAudioElement | null): void {
  elements.forEach((el) => {
    if (el !== keep && !el.paused) el.pause();
  });
}

/**
 * A file failed to load. A cached blob gets one retry from the network copy;
 * if the real file fails too the track is marked broken and the player goes
 * quiet (never substituting other music).
 */
function onElementError(src: string, el: HTMLAudioElement): void {
  if (el.src.startsWith('blob:') && !retriedFromNetwork.has(src)) {
    retriedFromNetwork.add(src);
    localUrls.delete(src);
    void audioBlobDelete(src);
    const shouldPlay = state === 'playing' && currentTrack().src === src;
    el.src = src;
    if (shouldPlay) void el.play().catch(() => undefined);
    return;
  }
  brokenSources.add(src);
  if (currentTrack().src === src && state === 'playing') setState('paused');
}

function playElement(el: HTMLAudioElement, restart: boolean): void {
  pauseEveryElementExcept(el);
  connectElement(el);
  if (restart) {
    try {
      el.currentTime = 0;
    } catch {
      /* not loaded yet — starts at 0 anyway */
    }
  }
  const attempt = el.play();
  if (attempt && typeof attempt.then === 'function') {
    attempt.then(
      () => {
        rememberUnlocked();
      },
      (error: DOMException) => {
        if (error?.name === 'AbortError') return; // superseded by a newer play/pause/switch
        if (error?.name === 'NotAllowedError') {
          if (el === currentElement()) setState('blocked');
          return;
        }
        // NotSupportedError etc. is handled by the element's error listener.
      },
    );
  }
}

/* --------------------------------------------------------------- transport */

function start(restart = false): void {
  if (!musicOn() || !unlocked || state === 'playing') return;
  const el = currentElement();
  if (!el) {
    setState('paused'); // this device cannot play the file: stay quiet
    return;
  }
  ensureGraph();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  if (master && ctx) master.gain.value = volumeGain();
  pausedByVisibility = false;
  playElement(el, restart);
  setState('playing');
  saveSession();
  watchVisibility(true);
}

function pause(): void {
  if (state !== 'playing') return;
  pauseEveryElementExcept(null);
  setState('paused');
  saveSession();
}

function resume(): void {
  if (state !== 'paused' || !musicOn()) return;
  const el = currentElement();
  if (!el) return;
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  playElement(el, false);
  setState('playing');
  saveSession();
  watchVisibility(true);
}

function stop(): void {
  pauseEveryElementExcept(null);
  watchVisibility(false);
  pausedByVisibility = false;
  setState(musicOn() ? 'blocked' : 'off');
}

let watching = false;
function watchVisibility(on: boolean): void {
  if (typeof document === 'undefined' || on === watching) return;
  watching = on;
  if (on) document.addEventListener('visibilitychange', onVisibility);
  else document.removeEventListener('visibilitychange', onVisibility);
}

function onVisibility(): void {
  if (document.hidden) {
    if (state === 'playing') {
      pausedByVisibility = true;
      pause();
    }
  } else if (pausedByVisibility) {
    pausedByVisibility = false;
    resume();
  }
}

/* ------------------------------------------------------------------ public */

export const music = {
  /** Local-storage status for the UI: what is saved on this device. */
  storage(): {phase: 'idle' | 'busy' | 'ready' | 'unavailable'; stored: number; total: number} {
    return {phase: primePhase, stored: primedCount, total: MUSIC_TRACKS.length};
  },
  subscribeStorage(listener: () => void): () => void {
    primeListeners.add(listener);
    return () => primeListeners.delete(listener);
  },
  /** Drop the local copies and fetch them again (e.g. after re-uploading a file). */
  refreshStorage(): void {
    void (async () => {
      await audioBlobDeleteAll();
      localUrls.clear();
      retriedFromNetwork.clear();
      brokenSources.clear();
      primedCount = 0;
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
      if (state === 'paused') resume();
      else start(false);
    } else {
      stop();
      setState('off');
    }
  },
  /** Hold the music where it is; `resume()` picks it back up from there. */
  pause(): void {
    pausedByVisibility = false;
    pause();
  },
  resume(): void {
    unlocked = true;
    if (state === 'paused') resume();
    else start(false);
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
  /** Switch to another approved track. The old one stops before the new one starts. */
  setTrack(id: TrackId): void {
    if (!MUSIC_TRACKS.some((track) => track.id === id)) return;
    if (id === musicTrack()) return;
    const wasPlaying = state === 'playing';
    pauseEveryElementExcept(null);
    setMusicTrack(id);
    saveSession();
    if (!wasPlaying) return;
    const next = currentElement();
    if (!next) {
      setState('paused');
      return;
    }
    playElement(next, true);
    saveSession();
  },
  volume(): number {
    return musicVolume();
  },
  setVolume(value: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setMusicVolume(clamped);
    saveSession();
    applyVolume();
  },
  /** Called from the first pointer/key gesture. */
  unlock(): void {
    if (!musicOn()) return;
    unlocked = true;
    if (state === 'paused') return; // a paused player stays paused until asked
    start(false);
  },
  /** Called once at boot: try to autoplay, else report 'blocked' for the UI. */
  autoplay(): void {
    if (!musicOn()) {
      setState('off');
      return;
    }
    primeTracksLocally();
    const activation = (navigator as Navigator & {userActivation?: {hasBeenActive?: boolean}}).userActivation;
    if (!wasUnlocked() && activation && !activation.hasBeenActive) {
      setState('blocked');
      return;
    }
    unlocked = true;
    start(false);
  },
  /** Pre-warm: called on the first gesture and whenever the tab wakes. */
  warm(): void {
    if (!musicOn()) return;
    primeTracksLocally();
    ensureGraph();
    if (ctx && ctx.state === 'suspended' && state === 'playing') void ctx.resume().catch(() => undefined);
  },

  /** Test seam. */
  _debug(): {
    state: MusicState;
    backend: 'file' | 'idle';
    source: string | null;
    position: number | null;
    playingElements: number;
    approved: string[];
  } {
    const el = elements.get(currentTrack().src) ?? null;
    let playingElements = 0;
    elements.forEach((candidate) => {
      if (!candidate.paused) playingElements += 1;
    });
    return {
      state,
      backend: state === 'playing' || state === 'paused' ? 'file' : 'idle',
      source: el ? el.src : null,
      position: el ? el.currentTime : null,
      playingElements,
      approved: [...APPROVED_SOURCES],
    };
  },
};
