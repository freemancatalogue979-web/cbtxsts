import { useEffect, useRef, useState } from "react";
import { heroArt, sectionTheme, type SectionId } from "../lib/theme";
import {
  LOCAL_ART, cachedSplash, resolveWallArt, shouldUpgradeArt, subscribeSplash,
} from "../lib/heroWallpaper";

/**
 * The live wallpaper behind the hub: a drifting 3D wall of MLBB hero art plus a
 * large spotlight portrait, washed in the current area's accent colour.
 *
 * Sharpness strategy:
 * - The bundled portraits are only 240×390, so they are never blown up: the CSS
 *   caps their rendered size at their native pixel size for the current DPR.
 * - On large or high-DPR screens the spotlight upgrades to a sharper source
 *   (repo HD pack, then the official catalogue painting) once it has loaded;
 *   the bundled art paints first and stays if anything fails.
 * - No blur filters are used. Softness in the original design was the blur, not
 *   the art.
 *
 * The layer is decorative: hidden from assistive tech and it never takes clicks.
 */
export function AmbientBackdrop({ section, motion }: { section: SectionId; motion: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const theme = sectionTheme(section);
  const [sharp, setSharp] = useState<Record<string, string>>({});
  const [upgrade, setUpgrade] = useState(false);

  // Cap local art at native pixels and react to zoom / monitor changes.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const sync = () => {
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      node.style.setProperty("--art-dpr", dpr.toFixed(2));
      setUpgrade(shouldUpgradeArt({ width: window.innerWidth }));
    };
    sync();
    window.addEventListener("resize", sync);
    // Moving a window between monitors changes DPR without a resize event.
    const query = typeof window.matchMedia === "function"
      ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      : null;
    query?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      query?.removeEventListener?.("change", sync);
    };
  }, []);

  // Paint any already-resolved art immediately (no flash on tab switches).
  useEffect(() => {
    const known: Record<string, string> = {};
    for (const slug of [theme.spotlight, ...theme.shelf]) {
      const url = cachedSplash(slug);
      if (url) known[slug] = url;
    }
    if (Object.keys(known).length) setSharp((previous) => ({ ...known, ...previous }));
  }, [theme]);

  useEffect(() => {
    if (!upgrade) return;
    let alive = true;
    // The spotlight matters most; the wall fills in behind it.
    void resolveWallArt([theme.spotlight]).then((found) => {
      if (alive && Object.keys(found).length) setSharp((previous) => ({ ...found, ...previous }));
    });
    const timer = window.setTimeout(() => {
      void resolveWallArt(theme.shelf).then((found) => {
        if (alive && Object.keys(found).length) setSharp((previous) => ({ ...found, ...previous }));
      });
    }, 900);
    const off = subscribeSplash(() => {
      void resolveWallArt([theme.spotlight, ...theme.shelf]).then((found) => {
        if (alive && Object.keys(found).length) setSharp((previous) => ({ ...found, ...previous }));
      });
    });
    return () => { alive = false; window.clearTimeout(timer); off(); };
  }, [theme, upgrade]);

  // Pointer parallax on desktop only, and never against reduced motion.
  useEffect(() => {
    const node = root.current;
    if (!node || !motion) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        node.style.setProperty("--px", x.toFixed(3));
        node.style.setProperty("--py", y.toFixed(3));
      });
    };
    const onLeave = () => { node.style.setProperty("--px", "0"); node.style.setProperty("--py", "0"); };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [motion]);

  const spotlight = sharp[theme.spotlight];

  return (
    <div ref={root} className="ambient" aria-hidden="true">
      <div className="ambient__wash" />
      <div className="ambient__stage">
        <div className="ambient__shelf" key={`shelf-${section}`}>
          {theme.shelf.map((slug) => (
            <img key={slug} src={sharp[slug] ?? heroArt(slug)} alt="" width={LOCAL_ART.width} height={LOCAL_ART.height}
              decoding="async" draggable={false} data-art={sharp[slug] ? "hd" : "local"} />
          ))}
        </div>
        <div className="ambient__spotlight" key={`spotlight-${section}`} data-art={spotlight ? "hd" : "local"}>
          <img src={spotlight ?? heroArt(theme.spotlight)} alt="" width={LOCAL_ART.width} height={LOCAL_ART.height}
            decoding="async" fetchPriority="low" referrerPolicy="no-referrer" draggable={false} />
        </div>
      </div>
      <div className="ambient__grid" />
      <div className="ambient__vignette" />
    </div>
  );
}
