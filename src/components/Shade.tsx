/**
 * The window light's weather, desk only: the shadow of a plant on the
 * sill just out of shot, falling across the desk and the corner of the
 * pad, and clouds that now and then pass over the sun.
 *
 * Drawn twice, by the same component: once over the wood (Desk.tsx) and
 * once over the pad (Booklet.tsx). The pad's copy has to live inside
 * the page's isolated group to blend with the paper, and the wood's
 * copy outside it, so one layer cannot do both. Both are fixed to the
 * window, so the pad slides under the shadow when the list scrolls, the
 * way a page slides on a desk; startAmbient() drives the two copies off
 * one timeline so they never drift apart.
 *
 * The leaves are generated here from a fixed seed (the same shapes on
 * the server and in every browser, so there is nothing to hydrate) and
 * baked into blurred SVG images, one per branch. The breeze then only
 * ever moves those images, with transforms: the blur is rasterised once,
 * not every frame. Each branch is blurred by its distance from the desk,
 * the far ones soft, the near ones sharper, which is what makes a cast
 * shadow read as cast rather than printed on.
 *
 * Where the shadow falls follows the sun (shadowAt in day.ts): swinging
 * across the desk through the day, longer when the sun is low, gone
 * when the lamp is on.
 */

type Pt = [number, number];

/* Mulberry32: a small seeded PRNG. Fixed seeds, so the plant is the same
   plant every day; only the weather changes. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type BranchSpec = {
  /* A stem as a quadratic curve, in scene px. The scene is 1000×800 with
     the plant off its top-left corner, and the light coming from there. */
  from: Pt;
  ctrl: Pt;
  to: Pt;
  leaves: number;
  /* Leaf length range, px. Width follows from it. */
  len: Pt;
  /* Penumbra: how far this branch is from the desk. */
  blur: number;
  /* How dark its shadow is, before the sun's own strength. */
  alpha: number;
  /* The breeze: how far a full gust turns this branch about its base,
     in degrees, and how long the air takes to reach it, in ms. */
  give: number;
  lag: number;
  seed: number;
};

/* Three branches, back to front, reaching across the top of the window
   rather than down it, since the shadow is only allowed as far as the
   title. The far one is large and soft and is most of the shade on the
   desk; the near one is small and crisp, and its tips cross the title. */
const BRANCHES: BranchSpec[] = [
  {
    from: [-90, 0],
    ctrl: [260, 70],
    to: [640, 150],
    leaves: 11,
    len: [78, 104],
    blur: 11,
    alpha: 0.4,
    give: 0.7,
    lag: 0,
    seed: 11,
  },
  {
    from: [-70, 90],
    ctrl: [220, 180],
    to: [480, 175],
    leaves: 10,
    len: [62, 84],
    blur: 7,
    alpha: 0.46,
    give: 1,
    lag: 70,
    seed: 23,
  },
  {
    from: [60, -40],
    ctrl: [340, 10],
    to: [700, 115],
    leaves: 9,
    len: [44, 62],
    blur: 3.5,
    alpha: 0.5,
    give: 1.5,
    lag: 130,
    seed: 37,
  },
];

/* The colour of shade, not of black: what's left where the sun is
   blocked is the sky's light, which is blue. Multiplied, a cool grey
   over a warm-lit desk is what makes it read as shadow at golden hour. */
const SHADE = "rgb(48,60,86)";

type Branch = {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /* The stem's base, relative to the image: what the breeze turns it about. */
  ox: number;
  oy: number;
  give: number;
  lag: number;
};

const f = (n: number) => n.toFixed(1);

function branch(s: BranchSpec): Branch {
  const r = rng(s.seed);
  const at = (t: number): Pt => {
    const u = 1 - t;
    return [
      u * u * s.from[0] + 2 * u * t * s.ctrl[0] + t * t * s.to[0],
      u * u * s.from[1] + 2 * u * t * s.ctrl[1] + t * t * s.to[1],
    ];
  };
  const tangent = (t: number) =>
    Math.atan2(
      2 * (1 - t) * (s.ctrl[1] - s.from[1]) + 2 * t * (s.to[1] - s.ctrl[1]),
      2 * (1 - t) * (s.ctrl[0] - s.from[0]) + 2 * t * (s.to[0] - s.ctrl[0]),
    );

  const pts: Pt[] = [0, 0.25, 0.5, 0.75, 1].map(at);
  let leaves = "";
  const leaf = (
    base: Pt,
    a: number,
    len: number,
    wid: number,
    bend: number,
  ) => {
    const dx = Math.cos(a),
      dy = Math.sin(a);
    const nx = -dy,
      ny = dx;
    // A short petiole, then an almond with its midrib bent a little, so
    // no two leaves are the same shape turned.
    const p: Pt = [base[0] + dx * 6, base[1] + dy * 6];
    const tip: Pt = [
      p[0] + dx * len + nx * bend * len,
      p[1] + dy * len + ny * bend * len,
    ];
    const c = (along: number, side: number): Pt => [
      p[0] + dx * len * along + nx * (wid * side + bend * len * along),
      p[1] + dy * len * along + ny * (wid * side + bend * len * along),
    ];
    const a1 = c(0.22, 0.95),
      a2 = c(0.72, 0.6),
      b1 = c(0.72, -0.6),
      b2 = c(0.22, -0.95);
    pts.push(tip, a1, b2);
    leaves +=
      `M${f(base[0])} ${f(base[1])}L${f(p[0])} ${f(p[1])}` +
      `C${f(a1[0])} ${f(a1[1])} ${f(a2[0])} ${f(a2[1])} ${f(tip[0])} ${f(tip[1])}` +
      `C${f(b1[0])} ${f(b1[1])} ${f(b2[0])} ${f(b2[1])} ${f(p[0])} ${f(p[1])}Z`;
  };

  for (let i = 0; i < s.leaves; i++) {
    const t = 0.22 + (0.74 * (i + r() * 0.6)) / s.leaves;
    const side = i % 2 ? 1 : -1;
    const a = tangent(t) + side * (0.62 + r() * 0.4);
    // Smaller towards the tip, and some seen nearly edge-on: a leaf
    // turned to the light casts a sliver, not an almond.
    const len = (s.len[0] + r() * (s.len[1] - s.len[0])) * (1 - 0.3 * t * t);
    const turned = r() < 0.25 ? 0.35 + r() * 0.25 : 0.8 + r() * 0.35;
    leaf(at(t), a, len, len * 0.27 * turned, (r() - 0.5) * 0.24);
  }
  leaf(s.to, tangent(1), s.len[0] * 0.75, s.len[0] * 0.2, 0.06);

  const m = s.blur * 3 + 6;
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs) - m),
    y = Math.floor(Math.min(...ys) - m);
  const w = Math.ceil(Math.max(...xs) + m) - x,
    h = Math.ceil(Math.max(...ys) + m) - y;

  const stem = `M${f(s.from[0])} ${f(s.from[1])}Q${f(s.ctrl[0])} ${f(s.ctrl[1])} ${f(s.to[0])} ${f(s.to[1])}`;
  // One group, one opacity: overlapping leaves are one shadow, not two
  // stacked, which is how shade works.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">` +
    `<filter id="b" x="${x}" y="${y}" width="${w}" height="${h}" filterUnits="userSpaceOnUse">` +
    `<feGaussianBlur stdDeviation="${s.blur}"/></filter>` +
    `<g filter="url(#b)" opacity="${s.alpha}">` +
    `<path d="${stem}" fill="none" stroke="${SHADE}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path d="${leaves}" fill="${SHADE}" stroke="${SHADE}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `</g></svg>`;

  return {
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    x,
    y,
    w,
    h,
    ox: s.from[0] - x,
    oy: s.from[1] - y,
    give: s.give,
    lag: s.lag,
  };
}

const PLANT = BRANCHES.map(branch);

export function ShadeScene() {
  return (
    <div className="shade-day">
      <div className="shade-reach">
        <div className="shade-sun">
          <div className="shade-gap">
            {PLANT.map((b, i) => (
              <img
                key={i}
                className="shade-branch"
                src={b.src}
                alt=""
                width={b.w}
                height={b.h}
                data-give={b.give}
                data-lag={b.lag}
                style={{
                  left: b.x,
                  top: b.y,
                  transformOrigin: `${b.ox}px ${b.oy}px`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="shade-cloud" />
    </div>
  );
}

/* ---- the moving parts ----

   The breeze: a plant by an open window is still most of the time. Now
   and then a puff of air reaches it, and each branch jolts, quickly and
   only a degree or so, then rings back to rest. That's a light, stiff
   stem struck by an impulse, so it is one: a damped oscillator (about
   2Hz, which puts the peak ~120ms after the air arrives) with a faster,
   smaller flutter of the leaves riding on it, sampled into keyframes the
   way tools/spring.mjs bakes the UI's springs. A steady sine sway was
   tried first and read as slow motion of the real thing: the stillness
   between gusts is what makes the gusts read. The air reaches the far
   branch first and the near one a beat later, each gust a little
   different, sometimes two in quick succession. Gusts add (composite:
   "add"), so a second one landing on the first doesn't snap it back.
   Off under reduced motion; the shadow itself stays.

   The clouds: a cloud over the sun doesn't sweep a shadow edge across a
   room the way it does across a field. The window is lit by the sun's
   disc, so the whole patch of sunlight dims at once over a few seconds,
   the leaf shadows soften away with it, and it all comes back. That's
   opacity only, so it plays the same under reduced motion. How cloudy
   it is is decided once a day, from the date: some days a cloud every
   minute or so, some days one every few minutes. */

/* One gust, as keyframes: the stem's damped ring (2.1Hz, damping ratio
   0.28) plus a leaf flutter (7Hz, gone in a few cycles), driven by an
   impulse, so it starts at rest, peaks fast, and settles back to exactly
   rest. `give` is the peak in degrees; the flutter adds a few tenths of
   a pixel of shiver along with it. */
const RING_MS = 1800;
function ring(give: number): Keyframe[] {
  const n = 54;
  const w = 2 * Math.PI * 2.1,
    z = 0.28;
  const wd = w * Math.sqrt(1 - z * z);
  const wf = 2 * Math.PI * 7;
  // Normalise so the first peak is `give`.
  const tp = Math.atan(wd / (z * w)) / wd;
  const peak = Math.exp(-z * w * tp) * Math.sin(wd * tp);
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (RING_MS / 1000);
    const env = i === n ? 0 : 1;
    const th = (env * give * Math.exp(-z * w * t) * Math.sin(wd * t)) / peak;
    const fl = env * give * 0.35 * Math.exp(-9 * t) * Math.sin(wf * t);
    frames.push({
      transform: `rotate(${th.toFixed(3)}deg) translate(${(fl * 0.8).toFixed(2)}px, ${(fl * 0.5).toFixed(2)}px)`,
    });
  }
  return frames;
}

function dayCover(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return 0.15 + 0.85 * rng(h)();
}

export function startAmbient(opts: {
  /** Is the sun out right now, 0 to 1 (0 at night). */
  sun: () => number;
  /** Today's date, for the day's cloud cover. */
  day: () => string;
}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let gustTimer = 0;
  function gust() {
    gustTimer = window.setTimeout(gust, 3_000 + Math.random() * 10_000);
    if (document.hidden || document.documentElement.dataset.variant !== "desk")
      return;
    if (opts.sun() < 0.15) return;
    puff(0.5 + Math.random() * 0.5);
    // Sometimes the air comes in twice.
    if (Math.random() < 0.3) {
      const again = 350 + Math.random() * 500;
      window.setTimeout(() => puff(0.3 + Math.random() * 0.4), again);
    }
  }
  function puff(strength: number) {
    const now = document.timeline.currentTime as number;
    // One gust's shape per branch, applied to both copies of that branch.
    const shapes = new Map<string, { frames: Keyframe[]; at: number }>();
    document.querySelectorAll<HTMLElement>(".shade-branch").forEach((el) => {
      const key = `${el.dataset.give}`;
      let g = shapes.get(key);
      if (!g) {
        g = {
          frames: ring(
            Number(el.dataset.give) * strength * (0.75 + Math.random() * 0.5),
          ),
          at: now + Number(el.dataset.lag) + Math.random() * 40,
        };
        shapes.set(key, g);
      }
      const a = el.animate(g.frames, { duration: RING_MS, composite: "add" });
      a.startTime = g.at;
      a.onfinish = () => a.cancel();
    });
  }
  if (!reduced)
    gustTimer = window.setTimeout(gust, 2_000 + Math.random() * 4_000);

  let timer = 0;
  const schedule = (ms: number) => {
    timer = window.setTimeout(cloud, ms);
  };
  const gap = () => {
    const cover = dayCover(opts.day());
    const mean = 330_000 - 260_000 * cover;
    return mean * (0.5 + Math.random());
  };

  function cloud() {
    const sun = opts.sun();
    if (
      document.hidden ||
      document.documentElement.dataset.variant !== "desk" ||
      sun < 0.15
    ) {
      schedule(gap());
      return;
    }
    // A thin cloud or a thick one, and never quite even while it's over.
    const depth = 0.45 + Math.random() * 0.55;
    const duration = 16_000 + Math.random() * 40_000;
    const mid = () => depth * (0.7 + Math.random() * 0.3);
    const dim = [0, depth, mid(), depth, mid(), depth, 0];
    const offsets = [0, 0.14, 0.3, 0.5, 0.68, 0.84, 1];
    const timing: KeyframeAnimationOptions = { duration, easing: "linear" };
    const now = document.timeline.currentTime;
    document.querySelectorAll<HTMLElement>(".shade-cloud").forEach((el) => {
      const a = el.animate(
        dim.map((o, i) => ({
          opacity: o,
          offset: offsets[i],
          easing: "ease-in-out",
        })),
        timing,
      );
      a.startTime = now;
    });
    document.querySelectorAll<HTMLElement>(".shade-gap").forEach((el) => {
      const a = el.animate(
        dim.map((o, i) => ({
          opacity: 1 - o * 0.85,
          offset: offsets[i],
          easing: "ease-in-out",
        })),
        timing,
      );
      a.startTime = now;
    });
    schedule(duration + gap());
  }
  // The first one soon, so a visit sees the weather at all.
  schedule(12_000 + Math.random() * 25_000);
  // In development, `__cloud()` in the console passes one now.
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __cloud: () => void }).__cloud = () => {
      window.clearTimeout(timer);
      cloud();
    };
  }

  return () => {
    window.clearTimeout(timer);
    window.clearTimeout(gustTimer);
    document
      .querySelectorAll(".shade-branch")
      .forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  };
}
