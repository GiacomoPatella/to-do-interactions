# to-do interactions

A study in interaction design and design engineering, built with Claude Code.

A working to-do list where the motion is the subject — what happens when a row is
added, completed, highlighted, reordered, edited, deleted. The list is a pretext.

Every duration in the app is exposed as a live control in the bottom bar, because
the point is that the motion was *chosen* rather than accepted from a default.

**[Live demo →](#)** *(link once deployed)*

---

## What's in here

- **No animation library.** CSS and the Web Animations API only. Motion and GSAP
  were both considered and rejected; the reasoning is in `CLAUDE.md`.
- **Real springs, baked.** `tools/spring.mjs` samples a damped harmonic oscillator
  into a CSS `linear()` easing. These oscillate properly — a `cubic-bezier` has two
  control points, so it can overshoot once and never reverse twice.
- **FLIP for every position change.** Nothing animates height. Rows are measured
  before a mutation, pinned to their old position with a transform, and released a
  frame later.
- **Momentum on release.** Dragging is the one interaction with real input
  velocity, so it's the one place that got physics — measured over the last 90ms of
  the gesture, with the overshoot capped.
- **Reduced motion honoured twice**, in the stylesheet and again in the script,
  because a media query can't stop JavaScript from setting a transform.

`CLAUDE.md` is the brief the work runs against: the settled decisions, the
constraints, and the traps that have already cost time once.

## Credits

- The easing set is the standard published curves from
  [easings.net](https://easings.net) — easeOutQuint `(0.22, 1, 0.36, 1)`,
  easeOutExpo `(0.16, 1, 0.3, 1)`, easeInOutCubic `(0.65, 0, 0.35, 1)`.
- The polish pass — hit areas, icon transitions, enter/exit asymmetry — follows
  [Emil Kowalski](https://emilkowal.ski)'s design-engineering principles.
- Type is Caveat, Figtree and DM Mono, all via `next/font`.

## Running it

```bash
npm install
npm run dev            # localhost:3000
npm run build          # static export to out/
node tools/spring.mjs  # regenerate the spring curves
```

Next 16, TypeScript, static export. No server runtime, no database — rows live in
`localStorage` and never leave the page.
