"use client";

/**
 * The desk under the desk skin's notepad: a canvas fixed behind the page,
 * drawn by desk-wood.ts. Rendered in every skin, but only started the
 * first time the skin is desk, so someone who only ever uses organic or
 * clean never pays for the WebGL context or the bake. Once started it
 * stays, hidden by CSS in the other skins: switching back is instant, and
 * nothing re-renders while hidden. The skin lives on <html data-variant>
 * (RowsStudy writes it), so this watches that attribute rather than
 * sharing React state.
 */

import { useEffect, useRef } from "react";
import { startDesk } from "./desk-wood";

export default function Desk() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    let stop: (() => void) | null = null;
    const sync = () => {
      if (!stop && ref.current && root.dataset.variant === "desk") {
        stop = startDesk(ref.current);
      }
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["data-variant"] });
    return () => {
      mo.disconnect();
      stop?.();
    };
  }, []);

  return <canvas ref={ref} className="desk-canvas" aria-hidden="true" />;
}
