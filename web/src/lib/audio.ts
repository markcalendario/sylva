/**
 * Sylva's sound, synthesized in the browser — no audio files ship with the app.
 * Cues are short chiptune blips to match the pixel sprites; the ambient bed is
 * filtered noise plus a slow pad, built to sit under work rather than demand
 * attention.
 */

const VOLUME_KEY = "sylva.volume";
const MUTED_KEY = "sylva.muted";
const AMBIENT_KEY = "sylva.ambient";

export type Cue = "done" | "attention" | "error" | "commit" | "send" | "queue";

interface AmbientNodes {
  gain: GainNode;
  stop: () => void;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: AmbientNodes | null = null;
let unlocked = false;

let volume = readNumber(VOLUME_KEY, 0.35);
let muted = readBool(MUTED_KEY, false);
let ambientOn = readBool(AMBIENT_KEY, false);

const listeners = new Set<() => void>();

function readNumber(key: string, fallback: number): number {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === "true";
}

export interface AudioState {
  volume: number;
  muted: boolean;
  ambient: boolean;
}

/**
 * useSyncExternalStore compares snapshots by identity, so this object is
 * rebuilt only when something actually changes — returning a fresh object on
 * every read spins the render loop.
 */
let snapshot: AudioState = { volume, muted, ambient: ambientOn };

function notify(): void {
  snapshot = { volume, muted, ambient: ambientOn };
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
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(ctx.destination);
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
    void context.resume();
    unlocked = true;
    if (ambientOn) startAmbient();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, Math.round(next * 100) / 100));
  localStorage.setItem(VOLUME_KEY, String(volume));
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
  notify();
}

export function setMuted(next: boolean): void {
  muted = next;
  localStorage.setItem(MUTED_KEY, String(muted));
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
  notify();
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
  if (context.state === "suspended") return; // not unlocked yet; stay silent

  const now = context.currentTime;
  for (const note of notes) {
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = note.type ?? "square";
    osc.frequency.value = note.freq;

    const start = now + note.at;
    const peak = note.gain ?? 0.16;
    // Fast attack, exponential-ish decay: reads as a blip, not a beep.
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);

    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(start + note.dur + 0.02);
  }
}

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

export function playCue(cue: Cue): void {
  play(CUES[cue]);
}

// ---------- ambient bed ----------

function startAmbient(): void {
  const context = ensureContext();
  if (!context || !master || ambient) return;
  if (context.state === "suspended") return; // starts when audio unlocks

  const bed = context.createGain();
  bed.gain.value = 0;
  bed.connect(master);
  bed.gain.setTargetAtTime(0.5, context.currentTime, 2);

  // Wind: filtered noise from a looping buffer.
  const seconds = 4;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // Brown-ish noise: integrating white noise puts the energy low, which
    // sounds like wind rather than static.
    last = (last + Math.random() * 2 - 1) * 0.5;
    data[i] = last * 0.5;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = 420;
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.09;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(bed);
  noise.start();

  // Pad: two slightly detuned low sines, breathing via a slow LFO.
  const padGain = context.createGain();
  padGain.gain.value = 0.05;
  padGain.connect(bed);
  const padFilter = context.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 700;
  padFilter.connect(padGain);

  const pads = [110, 110.6, 164.8].map((freq) => {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(padFilter);
    osc.start();
    return osc;
  });

  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0.025;
  lfo.connect(lfoDepth);
  lfoDepth.connect(padGain.gain);
  lfo.start();

  // Occasional crickets, so the bed isn't a static drone.
  let chirpTimer: number | undefined;
  const scheduleChirp = () => {
    chirpTimer = window.setTimeout(
      () => {
        if (!ambient || muted) {
          scheduleChirp();
          return;
        }
        const osc = context.createOscillator();
        const env = context.createGain();
        osc.type = "sine";
        osc.frequency.value = 1700 + Math.random() * 900;
        const now = context.currentTime;
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.02, now + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        osc.connect(env);
        env.connect(bed);
        osc.start(now);
        osc.stop(now + 0.15);
        scheduleChirp();
      },
      5000 + Math.random() * 9000,
    );
  };
  scheduleChirp();

  ambient = {
    gain: bed,
    stop: () => {
      if (chirpTimer !== undefined) clearTimeout(chirpTimer);
      const end = context.currentTime;
      bed.gain.setTargetAtTime(0, end, 0.6);
      window.setTimeout(() => {
        noise.stop();
        for (const osc of pads) osc.stop();
        lfo.stop();
        bed.disconnect();
      }, 2500);
    },
  };
}

function stopAmbient(): void {
  ambient?.stop();
  ambient = null;
}
