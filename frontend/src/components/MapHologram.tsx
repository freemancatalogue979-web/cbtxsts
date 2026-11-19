import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MapChipPreset } from "../lib/types";
import { calmMotion } from "./Charts";

type HoloModule = typeof import("../lib/holoEngine");
export type HoloEngine = NonNullable<ReturnType<HoloModule["holoEngine"]>>;

let loading: Promise<HoloEngine | null> | null = null;
/** three.js only downloads once a hologram is actually shown. Resolves null without WebGL. */
export function loadHoloEngine(): Promise<HoloEngine | null> {
  loading ??= import("../lib/holoEngine").then((m) => m.holoEngine()).catch(() => null);
  return loading;
}

/** The model is drawn centred on the chip spot. */
export const HOLO_BASE = 0.5;
/** Canvas size relative to the chip, so the projector ring lines up with the chip disc. */
export const HOLO_SCALE = 1.7;

/**
 * A free-standing 3D hologram on the map spot (no ring or disc under it), with a soft ground shadow.
 * Shows `fallback` (the flat portrait) while three.js loads or when the device has no WebGL.
 */
export function ChipHologram({ preset, color, size, fallback }: {
  preset: MapChipPreset; color: string; size: number; fallback: ReactNode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "on" | "off">("loading");

  useEffect(() => {
    let alive = true;
    const canvas = ref.current;
    loadHoloEngine().then((engine) => {
      if (!alive || !canvas) return;
      if (!engine) { setState("off"); return; }
      engine.setStill(calmMotion());
      engine.add(canvas, preset, color);
      setState("on");
    });
    return () => {
      alive = false;
      if (canvas) void loadHoloEngine().then((engine) => engine?.remove(canvas));
    };
  }, [preset, color]);

  const px = Math.round(size * HOLO_SCALE);
  return (
    <>
      {state !== "on" && fallback}
      {state !== "off" && (
        <span className="map-holo" data-holo={preset} aria-hidden="true" style={{ "--holo": color } as React.CSSProperties}>
          {state === "on" && <span className="map-holo__shadow" />}
          <canvas ref={ref} width={192} height={192} className="map-holo__canvas"
            style={{ width: px, height: px, opacity: state === "on" ? 1 : 0 }} />
        </span>
      )}
    </>
  );
}
