import "@fontsource-variable/montserrat";
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
