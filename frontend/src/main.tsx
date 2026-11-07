// Space Mono (Colophon Foundry, SIL OFL): the default text style. Each face
// downloads only when something on screen uses it.
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/space-mono/400-italic.css";
import "@fontsource/space-mono/700-italic.css";
import "@fontsource-variable/montserrat";
// Symbol fallback (e.g. ⚝ in stylised names). Downloaded only when such a character is on screen.
import "@fontsource/noto-sans-symbols/500.css";
import "@fontsource-variable/montserrat/wght-italic.css";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
