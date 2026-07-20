# To-do app: an interaction study

A working to-do list where the craft is the subject. What happens when a row is
added, completed, reordered, edited, killed. The list is a pretext.

Live copy of the framing is in `src/app/page.tsx`. Read `src/components/RowsStudy.tsx`
before changing anything: it is commented and the animation system is not obvious.

**This is a standalone project.** It is not part of the gpcodes.com portfolio and
must not look like it. Giacomo's portfolio links out to this; it does not contain
it. An earlier session built it inside the portfolio repo by mistake and it was
moved here verbatim, which is why the current styling still looks like that site.

---

## The job right now: the rebrand

The portfolio is deliberately restrained: cool slate neutrals, one deep petrol
accent, mono labels, minimal motion. **This is the opposite brief.**

Give it its own identity. Playful, colourful, characterful. Pick a palette and a
typeface that would look *wrong* on a restrained portfolio, and commit to it.

Giacomo's words: treat it as real design work, not a token swap.

**Where to work:** the top of `src/app/globals.css` declares 22 tokens under a
marked header. Nothing in the `rows-*` block below reads a hardcoded colour, size
or radius, so changing those values rebrands the whole thing. They currently hold
the portfolio's values, which is the starting point to move away from, not the
destination.

The page furniture (`.lede`, `.notes`, `h1`, `.eyebrow`, `.skip-link`) is minimal
on purpose and is fair game to replace entirely.

---

## Stage 2 is still outstanding

Stage 1 is done and verified. A working slice of Stage 2 exists: `add` sprouts
(`data-enter="sprout"`, 380ms) and `delete` crumples into a transient bin
(`data-kind="crumple"`, 400ms, gravity easing, trajectory in `--fall-x/--fall-y`).

Giacomo's brief, in his words: "start adding actual special touches for every
action and reaction. Crumble up and throw in a bin for deleting, throwing a seed
and growing for a new task, I don't know, stuff like that."

Weigh these rather than obeying them:

- **Do not give every action a metaphor.** If everything is a small story the thing
  becomes a toy and slows down. Two or three signature moments, and let the rest be
  quietly excellent. Restraint is what makes the flourishes land.
- **Delight must survive repetition.** An elaborate delete is charming once and
  irritating by the tenth. Keep signature animations under roughly 400ms and make
  rapid repeated actions interrupt gracefully rather than queueing.
- Being showier here than on the portfolio is the point. This is the lab.

**The risk to manage:** a to-do app is the most clichéd demo there is. It only earns
a place on a senior designer's portfolio if the interaction craft is explicitly the
subject. If it ends up looking like a tutorial to-do app with transitions bolted on,
it has failed.

---

## Settled decisions. Do not silently revisit

### No animation library. CSS and WAAPI only

Motion and GSAP were both considered and rejected, after the no-dependencies rule
was explicitly lifted for this project. The deciding argument:

**The speed control is incompatible with springs, and it is the best thing in the
piece.** It works because every duration is a number multiplied by `--t`. A spring
has no duration; slowing one means changing stiffness and damping, which alters its
*character*, not just its speed. What you inspected at quarter speed would no longer
be what plays at full speed, so the control would become a lie.

This decision **survived** the removal of the readout, and is now load-bearing in a
stronger way: the whole bottom bar is duration-based. Every slider writes a `--b-*`
base value and the speed slider writes `--t`; springs would have nothing to write.

Supporting points:

- Velocity-on-interrupt is the one real argument for springs, but the native fix is
  WAAPI: `element.animate()` with `composite: "add"` layers onto a running animation
  instead of restarting it, and `playbackRate` gives exact time-scaling a spring
  cannot. Zero dependencies, and it strengthens the readout rather than muddying it.
- Drag-reorder already works (pointer capture, `touch-action` on the grip,
  `offsetTop` targeting so mid-glide rows report their true slot). A library would
  buy a rewrite back to where it already is.
- The crumple plays on a ghost that is already out of flow and is then destroyed. It
  never retargets, so fire-and-forget keyframes are genuinely correct there.

**Revisit only if** burst-testing shows stutter that `composite: "add"` cannot fix.
That is a testable claim; test it rather than assuming.

### ~~The readout must stay honest~~ · SUPERSEDED 2026-07-20

The readout panel is **gone**, along with the lede and the "how it moves, honestly"
notes. Giacomo's instruction: "even though this is an experiment, I don't want the
research around it. I just want the app, no paragraphs, no readouts."

Do not reinstate any of it. The app is now a to-do list centred on the page with a
bottom bar; the bar is where the study survives, as controls rather than commentary.

What the readout was defending is still defended, differently. Its purpose was to
prove the motion was *chosen* rather than accepted from a default. The timing
drawer now does that better by making every value adjustable and visible: sliders
for add / complete / delete / reorder / settle / enter, a movement-curve select, and
a speed multiplier. The old argument holds — if a change makes those controls
vaguer, or hides a real number behind a label, the change is wrong.

---

## Constraints

- Next 16 App Router, TypeScript, static export. No server runtime.
- No heavyweight dependencies. See the settled decision above.
- localStorage persistence. Rows never leave the page.
- **Animate transform and opacity only.** Nothing animates height: position changes
  are FLIP glides driven from `RowsStudy.tsx` (first, last, invert, play).
- `prefers-reduced-motion` respected in **both** places it has to be: the stylesheet
  drops translates and scales while keeping opacity crossfades, and the script checks
  the same media query before applying a transform, because a media query cannot stop
  JavaScript from setting one.
- Keyboard operable throughout. This is not a pointer-only toy.
- `npm run build` must pass.

## Running it

```
npm install
npm run dev          # port 3000 by default
npm run build        # static export to out/
```

Verify changes by driving the app in a browser, not by the build passing. Animation
regressions do not show up in a typecheck.
