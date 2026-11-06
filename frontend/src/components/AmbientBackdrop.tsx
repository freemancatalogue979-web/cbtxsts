import { useEffect, useRef } from "react";
import { heroArt, sectionTheme, type SectionId } from "../lib/theme";

/**
 * The live wallpaper behind the hub: a drifting 3D shelf of MLBB hero art plus a
 * large spotlight portrait, washed in the current area's accent colour.
 *
 * - Hero art is bundled (`/heroes/<slug>.webp`), so it works offline.
 * - Pointer movement tilts the layers a little (skipped for touch and when the
 *   member has turned motion off, including `prefers-reduced-motion`).
 * - It is decorative, hidden from assistive tech and never intercepts clicks.
 */
export function AmbientBackdrop({ section, motion }: { section: SectionId; motion: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const theme = sectionTheme(section);

  useEffect(() => {
    const node = root.current;
    if (!node || !motion) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A mouse tilt on a phone would only ever fire once, so skip touch screens.
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

  return (
    <div ref={root} className="ambient" aria-hidden="true">
      <div className="ambient__wash" />
      <div className="ambient__stage">
        <div className="ambient__shelf" key={`shelf-${section}`}>
          {theme.shelf.map((slug) => (
            <img key={slug} src={heroArt(slug)} alt="" width={240} height={390} decoding="async" loading="lazy" draggable={false} />
          ))}
        </div>
        <div className="ambient__spotlight" key={`spotlight-${section}`}>
          <img src={heroArt(theme.spotlight)} alt="" width={240} height={390} decoding="async" fetchPriority="low" draggable={false} />
        </div>
      </div>
      <div className="ambient__grid" />
      <div className="ambient__vignette" />
    </div>
  );
}
