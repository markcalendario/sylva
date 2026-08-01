import { useSyncExternalStore } from "react";
import { getAudioState, setAmbient, setMuted, setVolume, subscribe } from "../lib/audio";

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

/** Mute, volume, and the ambient-bed toggle, next to the text size stepper. */
export function AudioControls() {
  const state = useSyncExternalStore(subscribe, getAudioState, getAudioState);

  return (
    <div className="audio" role="group" aria-label="Sound">
      <button
        className="audio-btn"
        onClick={() => setMuted(!state.muted)}
        role="switch"
        aria-checked={!state.muted}
        title={state.muted ? "Unmute sound" : "Mute sound"}
        aria-label={state.muted ? "Unmute sound" : "Mute sound"}
      >
        <SpeakerIcon muted={state.muted} />
      </button>
      <input
        className="audio-volume"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={state.volume}
        disabled={state.muted}
        onChange={(e) => setVolume(Number(e.target.value))}
        title={`Volume ${Math.round(state.volume * 100)}%`}
        aria-label="Volume"
      />
      <button
        className={`audio-btn ${state.ambient ? "audio-btn-on" : ""}`}
        onClick={() => setAmbient(!state.ambient)}
        role="switch"
        aria-checked={state.ambient}
        title={
          state.ambient
            ? "Stop the forest ambience"
            : "Play forest ambience (wind, a low pad, the occasional cricket)"
        }
        aria-label="Forest ambience"
      >
        ♪
      </button>
    </div>
  );
}
