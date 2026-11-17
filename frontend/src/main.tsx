// Courier Prime (Alan Dague-Greene, SIL OFL): the bundled stand-in for Courier
// Std Bold, which Adobe licenses and cannot ship with the app. Courier Std is
// still used first wherever it is installed. Each face downloads only when used.
import "@fontsource/courier-prime/700-italic.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/courier-prime/400-italic.css";
import "@fontsource/courier-prime/400.css";
// Symbol fallback (e.g. ⚝ in stylised names). Downloaded only when such a character is on screen.
import "@fontsource/noto-sans-symbols/500.css";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppStatus } from "./components/AppControls";
import { TrashUndo } from "./components/TrashUndo";
import { registerServiceWorker } from "./lib/pwa";

// Installable app: offline shell, install prompt and "new version" reload (production builds only).
registerServiceWorker();

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <AppStatus />
    <TrashUndo />
  </React.StrictMode>,
);
