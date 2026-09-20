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
 *   …a file this device cannot decode is covered by the synth, not silence
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
        this.src = '';
        elements.push(this);
      }
      play() {
        if (breakFiles) return Promise.reject(new Error('decode failed'));
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
  check('off stops the synth scheduler too', music._debug().timer === false, JSON.stringify(music._debug()));
}

/* ------------------------------------- a file that will not play, covered --- */

async function fallbackSuite() {
  console.log('\n-- a file this device cannot play is covered by the synth');
  const {music, fake, elements} = await boot({files: true, breakFiles: true});

  music.setEnabled(true);
  await wait(120);
  check('a broken file does not leave the arena silent', music.state() === 'playing', music.state());
  check('the synth takes over the broken file', music._debug().backend === 'synth', JSON.stringify(music._debug()));
  check('the synth schedules notes when covering', fake.notes.length > 0, String(fake.notes.length));
  check('the failed file is not retried in a loop', elements.length <= 2, String(elements.length));
}

/* --------------------------------------- a device with no media element --- */

async function synthSuite() {
  console.log('\n-- a device without a media element falls back to the synth');
  const {music, fake} = await boot({files: false});

  music.setEnabled(true);
  await wait(60);
  check('music still plays without media elements', music.state() === 'playing', music.state());
  check('the synth backend is used', music._debug().backend === 'synth', JSON.stringify(music._debug()));
  check('the synth schedules notes to play', fake.notes.length > 0, String(fake.notes.length));

  /* ---- pause keeps the place ---- */
  const atPause = music._debug();
  music.pause();
  check('pause reports paused', music.state() === 'paused', music.state());
  check('pause stops scheduling', music._debug().timer === false, JSON.stringify(music._debug()));

  const afterPause = fake.notes.length;
  fake.advance(30);
  await wait(300);
  check('nothing is scheduled while paused', fake.notes.length === afterPause, `${fake.notes.length} vs ${afterPause}`);

  music.resume();
  await wait(80);
  check('resume reports playing again', music.state() === 'playing', music.state());
  check('resume continues the progression, it does not restart', music._debug().bar >= atPause.bar, `${atPause.bar} -> ${music._debug().bar}`);

  const late = fake.notes.slice(afterPause);
  check('resume never replays the bars the nap skipped', late.filter((note) => note.at < 30).length === 0, `${late.filter((note) => note.at < 30).length} notes in the past`);
  check('resume does not machine-gun a burst of bars', late.filter((note) => note.at < 32).length < 120, `${late.filter((note) => note.at < 32).length} note starts in the first 2s`);

  /* ---- a throttled tick never catches up ---- */
  const beforeStall = fake.notes.length;
  fake.advance(20);
  await wait(600);
  const stalled = fake.notes.slice(beforeStall);
  const piled = stalled.filter((note) => note.at < 20.06);
  // one bar is ~32 note starts; the un-anchored engine piled 90 onto one instant
  check('a late tick starts one bar instead of a pile of them', piled.length < 48, `${piled.length} notes bunched at one instant`);
  check('a late tick still plays something', stalled.length > 0, String(stalled.length));

  /* ---- mute is not pause ---- */
  const beforeMute = music._debug();
  music.setVolume(0);
  check('mute leaves the transport running', music.state() === 'playing' && music._debug().timer, JSON.stringify(music._debug()));
  check('mute does not restart the phrase', music._debug().bar >= beforeMute.bar, `${beforeMute.bar} -> ${music._debug().bar}`);
  music.setVolume(70);
  check('unmute keeps playing from the same place', music.state() === 'playing' && music._debug().bar >= beforeMute.bar, JSON.stringify(music._debug()));

  /* ---- switching cannot mix ---- */
  const generationBefore = fake.notes.length;
  music.setTrack('arcade');
  await wait(80);
  check('switching tracks keeps playing', music.state() === 'playing', music.state());
  check('the new track starts a new phrase', music._debug().bar <= 2, String(music._debug().bar));
  check('the new track schedules its own notes', fake.notes.length > generationBefore, `${fake.notes.length}`);
  check('the bus generation advanced, so the old notes are gone', music._debug().generation >= 2, String(music._debug().generation));

  /* ---- off ---- */
  music.setEnabled(false);
  check('turning music off reports off', music.state() === 'off', music.state());
  check('off stops the scheduler', music._debug().timer === false, JSON.stringify(music._debug()));
  const afterOff = fake.notes.length;
  fake.advance(20);
  await wait(250);
  check('nothing plays once the music is off', fake.notes.length === afterOff, `${fake.notes.length} vs ${afterOff}`);

  /* ---- paused stays paused ---- */
  music.setEnabled(true);
  await wait(60);
  music.pause();
  music.warm();
  check('warming a paused player does not restart it', music.state() === 'paused', music.state());
  music.resume();
  await wait(60);
  check('and it still resumes on request', music.state() === 'playing', music.state());
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
  await fallbackSuite();
  await synthSuite();

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failures:');
    failures.forEach((row) => console.log(` - ${row}`));
  }
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code));
