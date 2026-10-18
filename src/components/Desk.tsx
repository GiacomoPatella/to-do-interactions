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
 *
 * It also keeps the room's light in step with the clock (real or faked,
 * see clock.ts): the wood is relit, and --night and --warm on <html> tell
 * the stylesheet how to light the page. layout.tsx writes the same two
 * numbers before first paint, so this only ever moves them on.
 */

import { useEffect, useRef } from "react";
import { getClock, subscribeClock } from "./clock";
import { minuteOfDay, roomLight, skyAt } from "./day";
import { startDesk } from "./desk-wood";

export default function Desk() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    let desk: ReturnType<typeof startDesk> | null = null;
    const minute = () => minuteOfDay(getClock().now);

    const relight = () => {
      const m = minute();
      const { night, warm } = roomLight(m);
      root.style.setProperty("--night", night.toFixed(3));
      root.style.setProperty("--warm", warm.toFixed(3));
      desk?.setSky(skyAt(m));
    };
    const sync = () => {
      if (!desk && ref.current && root.dataset.variant === "desk") {
        desk = startDesk(ref.current, skyAt(minute()));
      }
    };
    sync();
    relight();
    const unsubscribe = subscribeClock(relight);
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["data-variant"] });
    return () => {
      unsubscribe();
      mo.disconnect();
      desk?.stop();
    };
  }, []);

  return <canvas ref={ref} className="desk-canvas" aria-hidden="true" />;
}
