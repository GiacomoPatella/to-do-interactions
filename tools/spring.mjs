/**
 * Damped-harmonic-oscillator -> CSS linear() easing.
 *
 * Parameterised the way Motion does it, because stiffness/damping/mass
 * are impossible to reason about by eye:
 *
 *   visualDuration = time to FIRST reach the target (what you perceive
 *                    as "how fast is it")
 *   bounce         = 0 -> critically damped, no overshoot
 *                    0.3 -> lively
 *                    0.5+ -> toy
 *
 * Closed form for the underdamped step response, normalised 0 -> 1:
 *   x(t) = 1 - e^(-zw0 t) [ cos(wd t) + (z w0 / wd) sin(wd t) ]
 */

function spring({ visualDuration, bounce, steps = 44 }) {
  const z = 1 - bounce; // damping ratio
  const s = Math.sqrt(1 - z * z); // sqrt(1 - z^2)

  // First crossing of the target happens at wd*t = pi - acos(z).
  // Solve that for w0 given the visual duration we asked for.
  const w0 = (Math.PI - Math.acos(z)) / (visualDuration * s);
  const wd = w0 * s;

  // Total duration: run until the envelope has decayed to 0.4%, i.e.
  // until the remaining wobble is smaller than a pixel on anything
  // we animate. This is longer than visualDuration and that is the
  // whole point -- the tail is settle, not travel.
  const total = Math.log(1 / (0.004 * s)) / (z * w0);

  const at = (t) =>
    1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));

  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    out.push(i === steps ? 1 : at(t));
  }

  const fmt = out
    .map((v, i) => {
      const n = Number(v.toFixed(4));
      // Pin the endpoints exactly; a linear() that starts at 0.0001
      // is a wrong "from" state, not a rounding detail.
      if (i === 0) return "0";
      if (i === out.length - 1) return "1";
      return String(n);
    })
    .join(", ");

  return {
    css: `linear(${fmt})`,
    totalMs: Math.round(total * 1000),
    visualMs: Math.round(visualDuration * 1000),
    peak: Math.max(...out),
  };
}

const PRESETS = {
  // The workhorse: buttons, checkbox, icon reactions. Quick to the
  // target, one clear overshoot, settles fast.
  "ease-spring": { visualDuration: 0.11, bounce: 0.34 },
  // Livelier, for the small delight moments (bin lid, nib dip) where a
  // second visible wobble is the charm rather than noise.
  "ease-spring-lively": { visualDuration: 0.12, bounce: 0.46 },
  // Almost no overshoot: for anything that must land decisively but
  // still decelerate like an object rather than a curve.
  "ease-settle": { visualDuration: 0.16, bounce: 0.09 },
};

for (const [name, cfg] of Object.entries(PRESETS)) {
  const r = spring(cfg);
  console.log(`\n/* --${name}: visual ${r.visualMs}ms, total ${r.totalMs}ms, peak ${r.peak.toFixed(3)} */`);
  console.log(`  --${name}: ${r.css};`);
}
