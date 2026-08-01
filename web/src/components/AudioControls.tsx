import { useSyncExternalStore } from "react";
import { getAudioState, setAmbient, setMuted, setVolume, subscribe } from "../lib/audio";

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
        {state.muted ? "🔇" : "🔊"}
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
