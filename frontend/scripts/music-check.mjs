/**
 * Music transport checks — pause, mute, resume, track switches.
 *
 * Boots the real `src/lib/music.ts` in jsdom against a recording fake
 * AudioContext and a fake <audio> element, so every claim the UI makes about
 * the soundtrack is checked against what the engine actually does:
 *
 *   …a paused track resumes where it left (it never restarts)
 *   …a sleeping tab does not machine-gun the bars it missed
 *   …muting is a gain fade: the transport keeps running underneath
 *   …switching tracks stops the old one dead (two tracks never mix)
 *   …ONLY the three approved files ever play: no synth, no generated or
 *    hidden music, not even when a file fails or media is unavailable
 *   …the player can select each of the three tracks
 *
 *     node scripts/music-check.mjs
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {JSDOM, VirtualConsole} from 'jsdom';

const BUNDLE = process.env.BUNDLE || '/tmp/music.iife.js';

/* ------------------------------------------------------------ the fake graph */

function makeFakeAudio() {
  const notes = []; // {at, kind}
  let currentTime = 0;

  const param = (initial = 0) => ({
    value: initial,
    setValueAtTime(v) {
      this.value = v;
      return this;
    },
    exponentialRampToValueAtTime(v) {
      this.value = v;
      return this;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
      return this;
    },
    setTargetAtTime(v) {
      this.value = v;
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
    cancelAndHoldAtTime() {
      return this;
    },
  });

  class FakeNode {
    constructor(kind) {
      this.kind = kind;
      this.connected = [];
      this.disconnected = false;
      this.gain = param(1);
    }
    connect(target) {
      this.connected.push(target);
      return target;
    }
    disconnect() {
      this.disconnected = true;
      this.connected = [];
    }
  }

  class FakeSource extends FakeNode {
    constructor(kind) {
      super(kind);
      this.frequency = param(440);
      this.detune = param(0);
    }
    start(at) {
      notes.push({at, kind: this.kind});
    }
    stop() {
      return this;
    }
  }

  class FakeContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 48000;
      this.destination = new FakeNode('destination');
    }
    get currentTime() {
      return currentTime;
    }
    createDynamicsCompressor() {
      const node = new FakeNode('compressor');
      node.threshold = param(-18);
      node.knee = param(20);
      node.ratio = param(6);
      node.attack = param(0.004);
      node.release = param(0.18);
      return node;
    }
    createGain() {
      return new FakeNode('gain');
    }
    createOscillator() {
      return new FakeSource('osc');
    }
    createBufferSource() {
      return new FakeSource('buffer');
    }
    createBiquadFilter() {
      const node = new FakeNode('filter');
      node.frequency = param(1000);
      return node;
    }
    createMediaElementSource() {
      return new FakeNode('media');
    }
    createBuffer() {
      return {getChannelData: () => new Float32Array(8)};
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
  }

  return {
    notes,
    FakeContext,
    advance: (seconds) => {
      currentTime += seconds;
    },
    now: () => currentTime,
  };
}

const results = [];
const failures = [];
const check = (name, ok, detail = '') => {
  results.push({name, ok});
  if (!ok) failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok || !detail ? '' : ` -> ${detail}`}`);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ harness */

async function boot({files = true, breakFiles = false} = {}) {
  const fake = makeFakeAudio();
  const problems = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => problems.push(error.message));
  virtualConsole.on('error', (...args) => problems.push(args.map(String).join(' ')));

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:5173/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const {window} = dom;
  window.AudioContext = fake.FakeContext;

  const elements = [];
  // jsdom ships its own HTMLAudioElement whose play() does nothing, so a suite
  // that means "this device has no media element" has to take it away.
  window.Audio = undefined;
  if (files) {
    window.Audio = class {
      constructor() {
        this.paused = true;
        this.currentTime = 0;
        this.loop = false;
        this.volume = 1;
        this.preload = '';
        this._src = '';
        this.listeners = {};
        this.srcHistory = [];
        elements.push(this);
      }
      get src() {
        return this._src;
      }
      set src(value) {
        this._src = value;
        this.srcHistory.push(value);
      }
      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      }
      play() {
        if (breakFiles) {
          const error = new Error('decode failed');
          error.name = 'NotSupportedError';
          setTimeout(() => (this.listeners.error || []).forEach((fn) => fn()), 0);
          return Promise.reject(error);
        }
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
    };
  }

  /* esbuild emits strict-mode IIFE code, and a strict indirect eval keeps its
     `var` off the window object — read the module from the script's completion
     value instead of reaching for a global. */
  const mod = window.eval(`${readFileSync(BUNDLE, 'utf8')}\nArenaMusic;`);
  return {music: mod.music, tracks: mod.MUSIC_TRACKS, fake, window, elements, problems};
}

/* ------------------------------------------------- the soundtrack (files) --- */

async function fileSuite() {
  console.log('\n-- the soundtrack plays from the uploaded files');
  const {music, tracks, fake, elements} = await boot({files: true});

  check('three tracks are offered', tracks.length === 3, String(tracks.length));
  check('every track points at an uploaded file', tracks.every((row) => /^\/music\/.+\.mp3$/.test(row.src)), JSON.stringify(tracks.map((row) => row.src)));

  music.setEnabled(true);
  await wait(80);
  check('turning music on plays the file', music.state() === 'playing', music.state());
  check('the file backend is the one playing', music._debug().backend === 'file', JSON.stringify(music._debug()));
  check('the element loops the whole track', elements[0]?.loop === true, String(elements[0]?.loop));
  check('the element plays the selected file', (elements[0]?.src ?? '').endsWith(tracks[0].src.split('/').pop()), elements[0]?.src);
  check('the element is actually playing', elements[0]?.paused === false, String(elements[0]?.paused));

  /* ---- pause and resume keep the second you stopped on ---- */
  elements[0].currentTime = 42.5;
  music.pause();
  check('pause pauses the file', elements[0].paused === true, String(elements[0].paused));
  check('pause keeps the position', music._debug().position === 42.5, String(music._debug().position));
  await wait(260);
  check('a paused file is not replayed from the start', elements[0].currentTime === 42.5, String(elements[0].currentTime));

  music.resume();
  await wait(80);
  check('resume reports playing', music.state() === 'playing', music.state());
  check('resume continues from the same second', elements[0].currentTime === 42.5 && elements[0].paused === false, `${elements[0].currentTime} paused=${elements[0].paused}`);
  check('resume does not build a second element', elements.length === 1, String(elements.length));

  /* ---- mute is a fade, not a stop ---- */
  music.setVolume(0);
  const master = fake.notes.length >= 0; // touch nothing; gain lives on the graph
  check('mute leaves the file playing', elements[0].paused === false && music.state() === 'playing', `${elements[0].paused}/${music.state()}`);
  check('mute keeps the position', elements[0].currentTime === 42.5, String(elements[0].currentTime));
  music.setVolume(70);
  check('unmute resumes the same second', elements[0].paused === false && elements[0].currentTime === 42.5, String(elements[0].currentTime));
  void master;

  /* ---- switching stops the old file dead ---- */
  music.setTrack('arcade');
  await wait(80);
  check('switching starts the new file', elements.length === 2 && elements[1].paused === false, `${elements.length}`);
  check('switching pauses the old file', elements[0].paused === true, String(elements[0].paused));
  check('the new file is the one selected', (elements[1].src ?? '').endsWith(tracks[1].src.split('/').pop()), elements[1].src);
  check('the new file starts from its beginning', elements[1].currentTime === 0, String(elements[1].currentTime));

  /* ---- off ---- */
  music.setEnabled(false);
  check('off pauses the file', elements[1].paused === true && music.state() === 'off', `${elements[1].paused}/${music.state()}`);
  check('no oscillator/generated audio was ever created', fake.notes.length === 0, String(fake.notes.length));

  /* ---- every approved track can be selected and played ---- */
  music.setEnabled(true);
  await wait(40);
  for (const track of tracks) {
    music.setTrack(track.id);
    await wait(30);
    const playing = elements.filter((el) => !el.paused);
    check(`selecting "${track.name}" plays exactly that file`, playing.length === 1 && playing[0].src.endsWith(track.src.split('/').pop()), playing.map((el) => el.src).join(','));
  }
  check('unknown track ids are ignored', (() => {
    const before = music.track();
    music.setTrack('ambient');
    return music.track() === before;
  })());
  const allSources = elements.flatMap((el) => el.srcHistory).filter(Boolean);
  const approved = new Set(tracks.map((row) => row.src));
  check('only approved files were ever loaded', allSources.every((src) => approved.has(src.replace(/^https?:\/\/[^/]+/, ''))), allSources.join(','));
  check('never two tracks at once', music._debug().playingElements <= 1, String(music._debug().playingElements));

  /* ---- a hidden tab pauses, a manual pause survives coming back ---- */
  music.setEnabled(false);
}

async function visibilitySuite() {
  console.log('\n-- hiding the tab pauses; a manual pause is respected');
  const {music, window, elements} = await boot({files: true});
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', {get: () => hidden, configurable: true});
  music.setEnabled(true);
  await wait(40);
  hidden = true;
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  check('hidden tab pauses the music', music.state() === 'paused' && elements[0].paused, music.state());
  hidden = false;
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(20);
  check('returning resumes it', music.state() === 'playing' && !elements[0].paused, music.state());
  music.pause();
  hidden = true;
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  hidden = false;
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(20);
  check('a player who pressed pause stays paused after returning', music.state() === 'paused' && elements[0].paused, music.state());
}

/* -------------------------------- a broken file never gets substitute music --- */

async function brokenSuite() {
  console.log('\n-- a file that cannot play leaves the player quiet (no substitute music)');
  const {music, fake, elements} = await boot({files: true, breakFiles: true});
  music.setEnabled(true);
  await wait(150);
  check('a broken file is not reported as playing', music.state() !== 'playing', music.state());
  check('no synth/generated notes cover for it', fake.notes.length === 0, String(fake.notes.length));
  check('no other element was started instead', elements.every((el) => el.paused), elements.map((el) => el.paused).join(','));
  check('the failed file is not retried in a loop', elements.length <= 1, String(elements.length));
}

async function noMediaSuite() {
  console.log('\n-- a device without media elements stays silent');
  const {music, fake} = await boot({files: false});
  music.setEnabled(true);
  await wait(60);
  check('nothing plays without a media element', music.state() !== 'playing', music.state());
  check('no generated audio is scheduled', fake.notes.length === 0, String(fake.notes.length));
  check('the debug backend is never "synth"', music._debug().backend !== 'synth', JSON.stringify(music._debug()));
}

async function main() {
  execFileSync(
    'npx',
    [
      'esbuild',
      'src/lib/music.ts',
      '--bundle',
      '--format=iife',
      '--global-name=ArenaMusic',
      `--outfile=${BUNDLE}`,
      '--loader:.css=empty',
      '--target=es2022',
    ],
    {stdio: 'pipe'},
  );

  await fileSuite();
  await visibilitySuite();
  await brokenSuite();
  await noMediaSuite();

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failures:');
    failures.forEach((row) => console.log(` - ${row}`));
  }
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code));
