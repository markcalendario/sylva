import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Both themes' faces. Plex Sans and Silkscreen are the forest's; Inter is the
// professional theme's, and both are loaded up front so switching is instant
// rather than a page of fallback while a font fetches.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/silkscreen/400.css";
import App from "./App";
import { initAudio } from "./lib/audio";
import { initMotion } from "./lib/motion";
import { initTextScale } from "./lib/textScale";
import { initTheme } from "./lib/theme";

initTextScale();
initMotion();
initTheme();
initAudio();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
