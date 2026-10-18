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
 *
 * And it holds the wood's copy of the plant's shadow and the clouds
 * (Shade.tsx), placing the shadow for the sun and starting the sway and
 * the weather along with the wood.
 */

import { useEffect, useRef } from "react";
import { getClock, subscribeClock } from "./clock";
import { dayKey, minuteOfDay, roomLight, shadowAt, skyAt } from "./day";
import { startDesk } from "./desk-wood";
import { ShadeScene, startAmbient } from "./Shade";

export default function Desk() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    let desk: ReturnType<typeof startDesk> | null = null;
    let stopAmbient: (() => void) | null = null;
    const minute = () => minuteOfDay(getClock().now);

    // The scene is drawn for a wide window; on a narrow one, where the
    // pad fills nearly all of it, the plant is smaller and further off,
    // or its shadow would lie across the whole title.
    const fit = () =>
      root.style.setProperty(
        "--shade-fit",
        Math.min(1, Math.max(0.55, innerWidth / 1300)).toFixed(3),
      );

    const relight = () => {
      const m = minute();
      const { night, warm } = roomLight(m);
      root.style.setProperty("--night", night.toFixed(3));
      root.style.setProperty("--warm", warm.toFixed(3));
      const sh = shadowAt(m);
      root.style.setProperty("--shade-rot", `${sh.rot.toFixed(2)}deg`);
      root.style.setProperty("--shade-len", sh.len.toFixed(3));
      // Hidden until placed, so the server's guess never shows.
      root.dataset.shade = "";
      desk?.setSky(skyAt(m));
    };
    const sync = () => {
      if (!desk && ref.current && root.dataset.variant === "desk") {
        desk = startDesk(ref.current, skyAt(minute()));
        stopAmbient = startAmbient({
          sun: () => shadowAt(minute()).sun,
          day: () => dayKey(getClock().now),
        });
      }
    };
    fit();
    relight();
    sync();
    addEventListener("resize", fit);
    const unsubscribe = subscribeClock(relight);
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["data-variant"] });
    return () => {
      unsubscribe();
      mo.disconnect();
      removeEventListener("resize", fit);
      desk?.stop();
      stopAmbient?.();
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="desk-canvas" aria-hidden="true" />
      <div className="desk-shade" aria-hidden="true">
        <ShadeScene />
      </div>
    </>
  );
}
