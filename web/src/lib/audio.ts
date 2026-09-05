/**
 * Sylva's sound, synthesized in the browser — no audio files ship with the app.
 * Cues are short chiptune blips to match the pixel sprites; the ambient bed is
 * filtered noise plus a slow pad, built to sit under work rather than demand
 * attention.
 */

const VOLUME_KEY = "sylva.volume";
const AMBIENT_VOLUME_KEY = "sylva.ambient-volume";
const MUTED_KEY = "sylva.muted";
const AMBIENT_KEY = "sylva.ambient";

export type Cue = "done" | "attention" | "error" | "commit" | "send" | "queue";

interface AmbientNodes {
  gain: GainNode;
  stop: () => void;
}

let ctx: AudioContext | null = null;
/** Mute lives here so one switch silences everything. */
let master: GainNode | null = null;
/** Cues and ambience get their own bus so their levels are independent. */
let cueBus: GainNode | null = null;
let ambientBus: GainNode | null = null;
let ambient: AmbientNodes | null = null;
let unlocked = false;

/**
 * Which set of sounds plays — the bed and the cues alike.
 *
 * A theme's sound is part of the theme: a forest at night, and a chiptune blip
 * when a turn lands, under a black-and-white interface with no forest in it is
 * a soundtrack to a different app. The value is set by the theme
 * (lib/theme.ts) rather than read from it here, so audio stays a module that
 * knows nothing about how anything looks.
 */
export type SoundVoice = "forest" | "studio";
let voice: SoundVoice = "forest";

let volume = readNumber(VOLUME_KEY, 0.6);
let ambientVolume = readNumber(AMBIENT_VOLUME_KEY, 0.35);
let muted = readBool(MUTED_KEY, false);
// On by default, at the low ambient level above. It shipped defaulting to off,
// which meant the forest was silent until you found the ♪ toggle and knew to
// press it.
let ambientOn = readBool(AMBIENT_KEY, true);

const listeners = new Set<() => void>();

function readNumber(key: string, fallback: number): number {
  // Number(null) is 0, and 0 is a valid volume — so an unset key has to be
  // checked before parsing, or the default silently becomes silence.
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === "true";
}

export interface AudioState {
  /** Level for one-shot cues: chimes, approval prompts, blips. */
  volume: number;
  /** Level for the ambient bed, independent of cues. */
  ambientVolume: number;
  muted: boolean;
  ambient: boolean;
}

/**
 * useSyncExternalStore compares snapshots by identity, so this object is
 * rebuilt only when something actually changes — returning a fresh object on
 * every read spins the render loop.
 */
let snapshot: AudioState = { volume, ambientVolume, muted, ambient: ambientOn };

function notify(): void {
  snapshot = { volume, ambientVolume, muted, ambient: ambientOn };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAudioState(): AudioState {
  return snapshot;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  cueBus = ctx.createGain();
  cueBus.gain.value = volume;
  cueBus.connect(master);

  ambientBus = ctx.createGain();
  ambientBus.gain.value = ambientVolume;
  ambientBus.connect(master);
  return ctx;
}

/**
 * Browsers refuse to start audio until the user has interacted with the page,
 * so the context is created and resumed on the first gesture.
 */
export function initAudio(): void {
  const unlock = () => {
    if (unlocked) return;
    const context = ensureContext();
    if (!context) return;
    unlocked = true;
    // resume() is async, and startAmbient refuses to build anything while the
    // context is still suspended. Calling it straight after resume() therefore
    // did nothing at all, and the bed only ever appeared if you toggled
    // ambience off and on again by hand. Wait for the resume to land.
    void context
      .resume()
      .then(() => {
        if (ambientOn) startAmbient();
      })
      .catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

export function setVolume(next: number): void {
  volume = clamp01(next);
  localStorage.setItem(VOLUME_KEY, String(volume));
  if (cueBus && ctx) cueBus.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  notify();
}

export function setAmbientVolume(next: number): void {
  ambientVolume = clamp01(next);
  localStorage.setItem(AMBIENT_VOLUME_KEY, String(ambientVolume));
  if (ambientBus && ctx) ambientBus.gain.setTargetAtTime(ambientVolume, ctx.currentTime, 0.05);
  notify();
}

export function setMuted(next: boolean): void {
  muted = next;
  localStorage.setItem(MUTED_KEY, String(muted));
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  notify();
}

/**
 * Swap the sound set. Cues change on the next one played; the bed has to be
 * rebuilt, which is only worth doing while one is actually running — switching
 * themes with the ambience off should not start it.
 */
export function setSoundVoice(next: SoundVoice): void {
  if (next === voice) return;
  voice = next;
  if (!ambient) return;
  stopAmbient();
  startAmbient();
}

export function setAmbient(next: boolean): void {
  ambientOn = next;
  localStorage.setItem(AMBIENT_KEY, String(ambientOn));
  if (ambientOn) startAmbient();
  else stopAmbient();
  notify();
}

// ---------- one-shot cues ----------

interface Note {
  freq: number;
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function play(notes: Note[]): void {
  const context = ensureContext();
  if (!context || !master || muted) return;

  // A cue fired in the same tick as the unlocking gesture would otherwise be
  // dropped: resume() is async, so the context is still suspended when the
  // first cue arrives. Resume, then schedule — if the browser refuses because
  // there has been no gesture yet, the promise rejects and nothing plays.
  if (context.state === "suspended") {
    void context
      .resume()
      .then(() => schedule(context, notes))
      .catch(() => {});
    return;
  }
  schedule(context, notes);
}

function schedule(context: AudioContext, notes: Note[]): void {
  if (!cueBus) return;
  const now = context.currentTime;
  for (const note of notes) {
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = note.type ?? "square";
    osc.frequency.value = note.freq;

    const start = now + note.at;
    // Peaks are deliberately conservative per note; the master gain does the
    // loud/quiet work, so cues stay clean rather than clipping when turned up.
    const peak = (note.gain ?? 0.16) * 1.6;
    // Fast attack, exponential-ish decay: reads as a blip, not a beep.
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);

    osc.connect(env);
    env.connect(cueBus);
    osc.start(start);
    osc.stop(start + note.dur + 0.02);
  }
}

/**
 * The forest's cues: chiptune, to match the pixel sprites. Square and triangle
 * waves, fast decays, the sound of a thing that happened in a game.
 */
const CUES: Record<Cue, Note[]> = {
  // Rising major arpeggio — an agent finished cleanly.
  done: [
    { freq: 659, at: 0, dur: 0.1, type: "triangle" },
    { freq: 880, at: 0.075, dur: 0.1, type: "triangle" },
    { freq: 1319, at: 0.15, dur: 0.22, type: "triangle", gain: 0.14 },
  ],
  // Two insistent pairs — the agent is blocked waiting on you, so this is the
  // one cue allowed to nag slightly.
  attention: [
    { freq: 988, at: 0, dur: 0.09 },
    { freq: 1319, at: 0.1, dur: 0.12 },
    { freq: 988, at: 0.34, dur: 0.09 },
    { freq: 1319, at: 0.44, dur: 0.16 },
  ],
  // Falling minor third.
  error: [
    { freq: 440, at: 0, dur: 0.14, type: "sawtooth", gain: 0.12 },
    { freq: 294, at: 0.12, dur: 0.26, type: "sawtooth", gain: 0.12 },
  ],
  commit: [
    { freq: 523, at: 0, dur: 0.07, type: "triangle" },
    { freq: 784, at: 0.06, dur: 0.16, type: "triangle" },
  ],
  send: [{ freq: 720, at: 0, dur: 0.05, type: "sine", gain: 0.1 }],
  queue: [{ freq: 520, at: 0, dur: 0.05, type: "sine", gain: 0.08 }],
};

/**
 * The studio's cues.
 *
 * The same six events, said the way a piece of equipment says them rather than
 * the way a game does. Sine throughout — no square, no sawtooth, nothing with
 * an edge on it — longer decays, and intervals from the same minor set the
 * studio bed is built on, so a cue lands *in* the music instead of over it.
 *
 * Quieter across the board, and the attention cue is the only one that repeats
 * itself. A blocked agent is the one thing here worth interrupting you for.
 */
const STUDIO_CUES: Record<Cue, Note[]> = {
  // Two notes rising a fourth, unhurried. Finished, not fanfare.
  done: [
    { freq: 587, at: 0, dur: 0.5, type: "sine", gain: 0.09 },
    { freq: 880, at: 0.11, dur: 0.7, type: "sine", gain: 0.075 },
  ],
  // A fifth, struck twice. Open rather than dissonant: it should read as
  // "come back", not as something breaking.
  attention: [
    { freq: 659, at: 0, dur: 0.34, type: "sine", gain: 0.1 },
    { freq: 988, at: 0.05, dur: 0.4, type: "sine", gain: 0.07 },
    { freq: 659, at: 0.42, dur: 0.34, type: "sine", gain: 0.09 },
    { freq: 988, at: 0.47, dur: 0.5, type: "sine", gain: 0.065 },
  ],
  // Falling a whole tone, low and short. A shrug, not an alarm — the error is
  // already on screen in red, and the sound only has to make you look.
  error: [
    { freq: 392, at: 0, dur: 0.3, type: "sine", gain: 0.085 },
    { freq: 294, at: 0.14, dur: 0.55, type: "sine", gain: 0.08 },
  ],
  // One note with its octave a beat behind, which is what a thing being filed
  // away sounds like.
  commit: [
    { freq: 440, at: 0, dur: 0.26, type: "sine", gain: 0.08 },
    { freq: 880, at: 0.07, dur: 0.34, type: "sine", gain: 0.05 },
  ],
  send: [{ freq: 784, at: 0, dur: 0.11, type: "sine", gain: 0.055 }],
  queue: [{ freq: 587, at: 0, dur: 0.11, type: "sine", gain: 0.045 }],
};

export function playCue(cue: Cue): void {
  play((voice === "forest" ? CUES : STUDIO_CUES)[cue]);
}

// ---------- scenery sounds ----------

export type Noise = "rustle" | "water" | "fire" | "forge" | "owl" | "frog" | "cricket";

/** One short noise buffer, reused: allocating per sound would churn memory. */
let noiseBuffer: AudioBuffer | null = null;

function shortNoise(context: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.5), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/**
 * The sounds the world makes: a branch moving, water, the fire, the forge.
 *
 * Routed through the ambient bus on purpose. These are scenery, not
 * notifications — so they follow the ambience toggle and its volume, and
 * someone who turned the forest off gets silence rather than a quieter forest.
 */
export function playNoise(noise: Noise): void {
  const context = ensureContext();
  if (!context || !ambientBus || muted || !ambient) return;
  // No unlocking gesture yet; skip rather than queue, since ambience that
  // arrives late is worse than ambience that never came.
  if (context.state === "suspended") return;

  const now = context.currentTime;
  const out = context.createGain();
  out.connect(ambientBus);

  if (noise === "water") {
    // A drip: a sine falling fast in pitch is the whole trick.
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.11);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.05, now + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(out);
    osc.start(now);
    osc.stop(now + 0.2);
    return;
  }

  if (noise === "owl") {
    // Two soft, breathy notes a tone apart — the shape of a hoot matters far
    // more than the timbre at this volume.
    for (const [freq, at, dur] of [
      [498, 0, 0.34],
      [430, 0.42, 0.46],
    ] as const) {
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * 0.94, now + at);
      osc.frequency.linearRampToValueAtTime(freq, now + at + 0.09);
      env.gain.setValueAtTime(0, now + at);
      env.gain.linearRampToValueAtTime(0.05, now + at + 0.07);
      env.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      osc.connect(env);
      env.connect(out);
      osc.start(now + at);
      osc.stop(now + at + dur + 0.05);
    }
    return;
  }

  if (noise === "frog") {
    // A croak is a low pitch dropping fast through a rough waveform.
    const osc = context.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(215, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.16);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.05, now + 0.02);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(filter);
    filter.connect(out);
    osc.start(now);
    osc.stop(now + 0.26);
    return;
  }

  if (noise === "cricket") {
    // Three very short high pulses; crickets are rhythm, not tone.
    for (let i = 0; i < 3; i++) {
      const at = i * 0.075;
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.type = "triangle";
      osc.frequency.value = 4300 + i * 60;
      env.gain.setValueAtTime(0, now + at);
      env.gain.linearRampToValueAtTime(0.028, now + at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.045);
      osc.connect(env);
      env.connect(out);
      osc.start(now + at);
      osc.stop(now + at + 0.06);
    }
    return;
  }

  if (noise === "forge") {
    // Two inharmonic partials, which is what makes metal sound like metal.
    for (const [freq, gain] of [
      [2100, 0.035],
      [3170, 0.022],
    ] as const) {
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(env);
      env.connect(out);
      osc.start(now);
      osc.stop(now + 0.3);
    }
    return;
  }

  // Rustle and fire are both filtered noise; they differ in band and length.
  const source = context.createBufferSource();
  source.buffer = shortNoise(context);
  const filter = context.createBiquadFilter();
  const rustle = noise === "rustle";
  filter.type = rustle ? "bandpass" : "lowpass";
  filter.frequency.value = rustle ? 2600 : 900;
  filter.Q.value = rustle ? 0.8 : 1;

  const dur = rustle ? 0.42 : 0.09;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(rustle ? 0.045 : 0.06, now + (rustle ? 0.09 : 0.004));
  out.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  source.connect(filter);
  filter.connect(out);
  source.start(now, Math.random() * 0.2);
  source.stop(now + dur + 0.05);
}

// ---------- ambient bed ----------

/**
 * The forest at night, as a piece of music rather than a drone.
 *
 * Written in the shape of the music that plays under a survival game: a slow
 * chord progression, a soft piano-ish voice picking out a sparse melody over
 * it, and long silences between phrases. The silences are the important part —
 * what makes that style feel like company rather than a soundtrack is that it
 * stops for ten seconds at a time and lets the room back in.
 *
 * Everything is diatonic to C major, so a melody note can never land wrong
 * against the chord underneath it however the phrase wanders.
 */

const midi = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/**
 * C major, pitched high — a music box rather than a cello. Register does most
 * of the emotional work here: the same notes an octave down read as brooding.
 */
const SCALE = [64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];

/**
 * Four chords, each held long enough to stop being a progression and start
 * being a place. `pad` is what sustains; `tones` are the notes the melody
 * treats as home when a phrase begins or ends.
 *
 * All four are major, coloured with sixths and sevenths, and every voicing
 * keeps E4 sounding throughout. That common tone is why it settles rather than
 * travels — a minor chord or a moving bass here turns the whole thing uneasy,
 * which is exactly what it did before.
 */
const PROGRESSION = [
  { pad: [48, 59, 64], tones: [64, 67, 71] }, // Cmaj7
  { pad: [53, 57, 64], tones: [65, 69, 72] }, // Fmaj7
  { pad: [48, 57, 64], tones: [64, 67, 69] }, // C6
  { pad: [55, 59, 64], tones: [62, 67, 71] }, // G6
];

const CHORD_SECONDS = 13;

function startAmbient(): void {
  const context = ensureContext();
  if (!context || !ambientBus || ambient) return;
  if (context.state === "suspended") return; // starts when audio unlocks

  // The fade and the bus are the same either way; only what hangs off the bed
  // is a voice's business.
  const bed = context.createGain();
  bed.gain.value = 0;
  bed.connect(ambientBus);
  bed.gain.setTargetAtTime(0.5, context.currentTime, 3);

  ambient = {
    gain: bed,
    stop: voice === "forest" ? forestBed(context, bed) : studioBed(context, bed),
  };
}

/** Everything the forest bed builds, and how to take it down again. */
function forestBed(context: AudioContext, bed: GainNode): () => void {
  // ---- air, well underneath everything ----
  const seconds = 6;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // Integrating white noise puts the energy low, which sounds like moving
    // air rather than static.
    last = (last + Math.random() * 2 - 1) * 0.5;
    data[i] = last * 0.5;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "lowpass";
  // Brighter and quieter than a low rumble. Energy below ~300Hz under a slow
  // pad is the sound of something approaching, and there is nothing here.
  noiseFilter.frequency.value = 1100;
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.018;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(bed);
  noise.start();

  const breath = context.createOscillator();
  breath.frequency.value = 0.045;
  const breathDepth = context.createGain();
  breathDepth.gain.value = 0.008;
  breath.connect(breathDepth);
  breathDepth.connect(noiseGain.gain);
  breath.start();

  // ---- pad: three voices that glide from chord to chord ----
  const padGain = context.createGain();
  padGain.gain.value = 0.038;
  padGain.connect(bed);

  const padFilter = context.createBiquadFilter();
  padFilter.type = "lowpass";
  // Open and fixed. A filter crawling up and down is tension — it makes the
  // ear track something it can't see.
  padFilter.frequency.value = 1500;
  padFilter.Q.value = 0.4;
  padFilter.connect(padGain);

  const padVoices = PROGRESSION[0]!.pad.map((note, i) => {
    const osc = context.createOscillator();
    osc.type = i === 0 ? "triangle" : "sine";
    osc.frequency.value = midi(note);
    const voice = context.createGain();
    voice.gain.value = i === 0 ? 1 : 0.62;
    osc.connect(voice);
    voice.connect(padFilter);
    osc.start();
    return osc;
  });

  // A shallow breath on the filter rather than a sweep: enough that the pad
  // isn't dead still, far too little to read as movement.
  const sweep = context.createOscillator();
  sweep.frequency.value = 0.021;
  const sweepDepth = context.createGain();
  sweepDepth.gain.value = 110;
  sweep.connect(sweepDepth);
  sweepDepth.connect(padFilter.frequency);
  sweep.start();

  // ---- the voice that carries the tune ----
  /**
   * A struck note: fundamental, a quiet octave and a whisper of the twelfth,
   * with a fast attack and a long tail. Not a real piano — but the envelope is
   * what the ear identifies, far more than the spectrum.
   */
  const strike = (note: number, velocity: number): void => {
    const now = context.currentTime;
    const freq = midi(note);
    for (const [ratio, gain, dur] of [
      [1, 0.07 * velocity, 3.2],
      [2.002, 0.032 * velocity, 2.1],
      [4.01, 0.009 * velocity, 0.8],
    ] as const) {
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq * ratio;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.014);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(env);
      env.connect(bed);
      osc.start(now);
      osc.stop(now + dur + 0.1);
    }
  };

  let chord = 0;
  let chordTimer: number | undefined;
  const advanceChord = (): void => {
    chordTimer = window.setTimeout(() => {
      chord = (chord + 1) % PROGRESSION.length;
      const next = PROGRESSION[chord]!;
      const at = context.currentTime;
      padVoices.forEach((osc, i) => {
        const target = midi(next.pad[i] ?? next.pad[0]!);
        // Glide rather than jump: the chord should arrive without an edge.
        osc.frequency.exponentialRampToValueAtTime(target, at + 2.4);
      });
      advanceChord();
    }, CHORD_SECONDS * 1000);
  };

  // Phrases of a few notes, then a long rest. Stepwise motion with the odd
  // leap, which is what keeps a sparse melody sounding written rather than
  // sampled from a scale.
  let cursor = 72;
  let phraseLeft = 0;
  let melodyTimer: number | undefined;

  const nextNote = (): number => {
    const tones = PROGRESSION[chord]!.tones;
    // Land on a chord tone at the start and end of a phrase; wander between.
    if (phraseLeft <= 1 || Math.random() < 0.3) {
      const near = tones
        .flatMap((t) => [t, t + 12])
        .reduce((best, t) => (Math.abs(t - cursor) < Math.abs(best - cursor) ? t : best));
      return near;
    }
    const here = SCALE.indexOf(cursor);
    const from = here === -1 ? SCALE.findIndex((n) => n >= cursor) : here;
    const step = (Math.random() < 0.78 ? 1 : 2) * (Math.random() < 0.5 ? -1 : 1);
    const index = Math.min(SCALE.length - 1, Math.max(0, from + step));
    return SCALE[index] ?? cursor;
  };

  const playMelody = (): void => {
    if (!ambient || muted) {
      melodyTimer = window.setTimeout(playMelody, 4000);
      return;
    }
    if (phraseLeft <= 0) {
      // Rest. Long enough that the music has clearly stopped, which is the
      // whole character of the style.
      phraseLeft = 3 + Math.floor(Math.random() * 5);
      cursor = PROGRESSION[chord]!.tones[Math.floor(Math.random() * 3)] ?? 72;
      melodyTimer = window.setTimeout(playMelody, 7000 + Math.random() * 9000);
      return;
    }
    cursor = nextNote();
    phraseLeft -= 1;
    strike(cursor, 0.75 + Math.random() * 0.35);
    // Uneven note lengths; a steady pulse would turn this into a metronome.
    melodyTimer = window.setTimeout(playMelody, 620 + Math.random() * 1150);
  };

  advanceChord();
  melodyTimer = window.setTimeout(playMelody, 3500);

  // Crickets, rare enough to be a surprise.
  let chirpTimer: number | undefined;
  const scheduleChirp = (): void => {
    chirpTimer = window.setTimeout(
      () => {
        if (ambient && !muted) {
          const osc = context.createOscillator();
          const env = context.createGain();
          osc.type = "sine";
          osc.frequency.value = 1700 + Math.random() * 900;
          const now = context.currentTime;
          env.gain.setValueAtTime(0, now);
          env.gain.linearRampToValueAtTime(0.012, now + 0.01);
          env.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
          osc.connect(env);
          env.connect(bed);
          osc.start(now);
          osc.stop(now + 0.15);
        }
        scheduleChirp();
      },
      14000 + Math.random() * 20000,
    );
  };
  scheduleChirp();

  return () => {
    for (const t of [chordTimer, melodyTimer, chirpTimer]) {
      if (t !== undefined) clearTimeout(t);
    }
    const end = context.currentTime;
    bed.gain.setTargetAtTime(0, end, 0.8);
    window.setTimeout(() => {
      noise.stop();
      breath.stop();
      for (const osc of padVoices) osc.stop();
      sweep.stop();
      bed.disconnect();
    }, 3000);
  };
}

/* ---------- the studio bed ---------- */

/**
 * The professional theme's music.
 *
 * The forest bed is a music box in a wood: a bright major scale, a tune you
 * can hum, crickets. None of that belongs under a black-and-white interface —
 * it would be a soundtrack to a different app playing over this one.
 *
 * So this is the other tradition of ambient music: sustained tones that change
 * so slowly you notice they have changed rather than watching them change. No
 * melody, no pulse, nothing to tap along to. Two things only — a chord that
 * takes most of a minute to become the next chord, and single struck tones
 * that fall a long way apart.
 *
 * Minor, and low. The forest is C major an octave up because it wanted to feel
 * like company; this wants to feel like a room you are working in, and a room
 * is not cheerful at you.
 */

/** A minor, spread wide. Every voicing keeps A sounding, so it never travels. */
const STUDIO_CHORDS = [
  [45, 57, 64, 72], // Am add9, open
  [45, 55, 62, 69], // Am7, closer
  [41, 57, 60, 67], // Fmaj7 over A
  [45, 57, 63, 70], // Am6
];

/** The tones a struck note may land on: A minor pentatonic, two octaves up. */
const STUDIO_TONES = [69, 72, 74, 76, 79, 81, 84, 86];

const STUDIO_CHORD_SECONDS = 26;

function studioBed(context: AudioContext, bed: GainNode): () => void {
  // ---- room tone: quieter and duller than the forest's air ----
  const seconds = 6;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + Math.random() * 2 - 1) * 0.5;
    data[i] = last * 0.5;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "lowpass";
  // Lower than the forest's 1100Hz: this is the hum of a room rather than
  // moving air, and it should be felt more than heard.
  noiseFilter.frequency.value = 620;
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.012;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(bed);
  noise.start();

  // ---- the chord: four voices, gliding ----
  const padGain = context.createGain();
  padGain.gain.value = 0.03;
  padGain.connect(bed);

  const padFilter = context.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 1200;
  padFilter.Q.value = 0.3;
  padFilter.connect(padGain);

  const padVoices = STUDIO_CHORDS[0]!.map((note, i) => {
    const osc = context.createOscillator();
    osc.type = "sine";
    // A couple of cents off true on the upper voices. Two sines at exactly the
    // same pitch sound like one synthesiser; detuned they beat slowly against
    // each other, which is most of what makes a pad sound like it is in a room.
    osc.frequency.value = midi(note) * (i === 0 ? 1 : 1 + (i % 2 ? 0.0012 : -0.0009));
    const voice = context.createGain();
    voice.gain.value = i === 0 ? 0.9 : 0.5;
    osc.connect(voice);
    voice.connect(padFilter);
    osc.start();
    return osc;
  });

  let chord = 0;
  let chordTimer: number | undefined;
  const advanceChord = (): void => {
    chordTimer = window.setTimeout(() => {
      chord = (chord + 1) % STUDIO_CHORDS.length;
      const next = STUDIO_CHORDS[chord]!;
      const at = context.currentTime;
      padVoices.forEach((osc, i) => {
        const target = midi(next[i] ?? next[0]!);
        // Eight seconds to arrive. Long enough that you cannot hear it start.
        osc.frequency.exponentialRampToValueAtTime(target, at + 8);
      });
      advanceChord();
    }, STUDIO_CHORD_SECONDS * 1000);
  };

  // ---- struck tones, far apart ----
  /**
   * Glass rather than piano: a sine fundamental with one high inharmonic
   * partial above it and a very long tail. The partial is what stops it
   * sounding like a test tone.
   */
  const strike = (note: number): void => {
    const now = context.currentTime;
    const freq = midi(note);
    for (const [ratio, gain, dur] of [
      [1, 0.05, 6],
      [2.76, 0.012, 2.6],
      [5.4, 0.004, 1.2],
    ] as const) {
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(env);
      env.connect(bed);
      osc.start(now);
      osc.stop(now + dur + 0.1);
    }
  };

  let toneTimer: number | undefined;
  const scheduleTone = (): void => {
    toneTimer = window.setTimeout(
      () => {
        if (ambient && !muted) {
          strike(STUDIO_TONES[Math.floor(Math.random() * STUDIO_TONES.length)] ?? 72);
          // Now and then a second note lands under the first and holds with it.
          // Two is a chord; three would be a phrase, and a phrase is a tune.
          if (Math.random() < 0.35) {
            window.setTimeout(
              () => {
                if (ambient && !muted) {
                  strike((STUDIO_TONES[Math.floor(Math.random() * 4)] ?? 69) - 12);
                }
              },
              900 + Math.random() * 1400,
            );
          }
        }
        scheduleTone();
      },
      // Nine to twenty-five seconds. The silence is the instrument.
      9000 + Math.random() * 16000,
    );
  };

  advanceChord();
  scheduleTone();

  return () => {
    for (const t of [chordTimer, toneTimer]) {
      if (t !== undefined) clearTimeout(t);
    }
    const end = context.currentTime;
    bed.gain.setTargetAtTime(0, end, 0.8);
    window.setTimeout(() => {
      noise.stop();
      for (const osc of padVoices) osc.stop();
      bed.disconnect();
    }, 3000);
  };
}

function stopAmbient(): void {
  ambient?.stop();
  ambient = null;
}
