import { useSyncExternalStore } from "react";
import {
  getAudioState,
  setAmbient,
  setAmbientVolume,
  setMuted,
  setVolume,
  subscribe,
} from "../lib/audio";

/**
 * Drawn rather than emoji: platform emoji render full-colour and read as a
 * foreign object against the flat theme, and don't inherit the on/off colour.
 */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 6h2.5L9 3v10L5.5 10H3V6z" fill="currentColor" />
      {muted ? (
        <path
          d="M11.5 6.5l3 3M14.5 6.5l-3 3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d="M11.2 5.8a3.2 3.2 0 010 4.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path
            d="M13.2 4a5.6 5.6 0 010 8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

/**
 * Mute, volume, and the ambient-bed toggle. `compact` renders the mute switch
 * alone — the top bar keeps that one because silencing is the thing you want
 * instantly; the rest lives in Settings.
 */
export function AudioControls({ compact = false }: { compact?: boolean }) {
  const state = useSyncExternalStore(subscribe, getAudioState, getAudioState);

  if (compact) {
    return (
      <button
        className={`audio-btn audio-btn-solo ${state.muted ? "audio-btn-muted" : ""}`}
        onClick={() => setMuted(!state.muted)}
        role="switch"
        aria-checked={!state.muted}
        aria-label={state.muted ? "Unmute sound" : "Mute sound"}
        data-tip={state.muted ? "Turn Sylva's sounds back on" : "Silence every Sylva sound"}
      >
        <SpeakerIcon muted={state.muted} />
      </button>
    );
  }

  return (
    <div className="audio-panel" role="group" aria-label="Sound">
      <div className="audio-row">
        <button
          className={`audio-btn audio-btn-solo ${state.muted ? "audio-btn-muted" : ""}`}
          onClick={() => setMuted(!state.muted)}
          role="switch"
          aria-checked={!state.muted}
          aria-label={state.muted ? "Unmute sound" : "Mute sound"}
          data-tip={state.muted ? "Turn Sylva's sounds back on" : "Silence every Sylva sound"}
        >
          <SpeakerIcon muted={state.muted} />
        </button>
        <span className="audio-row-label">{state.muted ? "muted" : "sound on"}</span>
      </div>

      <label className="audio-row">
        <span className="audio-row-label" data-tip="Chimes, approval prompts, and UI blips">
          Chimes
        </span>
        <input
          className="audio-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.volume}
          disabled={state.muted}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Chime volume"
          data-tip={`Cue volume — ${Math.round(state.volume * 100)}%`}
        />
        <span className="audio-row-value tabular">{Math.round(state.volume * 100)}%</span>
      </label>

      <label className="audio-row">
        <span className="audio-row-label" data-tip="The looping forest bed, independent of cues">
          Ambience
        </span>
        <input
          className="audio-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.ambientVolume}
          disabled={state.muted || !state.ambient}
          onChange={(e) => setAmbientVolume(Number(e.target.value))}
          aria-label="Ambience volume"
          data-tip={`Ambience volume — ${Math.round(state.ambientVolume * 100)}%`}
        />
        <button
          className={`audio-btn ${state.ambient ? "audio-btn-on" : ""}`}
          onClick={() => setAmbient(!state.ambient)}
          role="switch"
          aria-checked={state.ambient}
          aria-label="Forest ambience"
          data-tip={
            state.ambient
              ? "Stop the forest ambience"
              : "Play a forest ambience — wind, a low pad, the odd cricket"
          }
        >
          ♪
        </button>
      </label>
    </div>
  );
}
