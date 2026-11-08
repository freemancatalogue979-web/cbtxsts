// Montserrat (Julieta Ulanovsky, SIL OFL): the only typeface. One variable
// font covers weights 100–900, so bold is a real face.
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
