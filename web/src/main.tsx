import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Text face. Inter is installed as an alternative: swap these three imports
// and --font-ui in tokens.css to try it.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/silkscreen/400.css";
import App from "./App";
import { initAudio } from "./lib/audio";
import { initTextScale } from "./lib/textScale";

initTextScale();
initAudio();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
