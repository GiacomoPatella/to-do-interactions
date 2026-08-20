# To-do app: an interaction study

A working to-do list where the craft is the subject. What happens when a row is
added, completed, reordered, edited, killed. The list is a pretext.

Read `src/components/RowsStudy.tsx` before changing anything: it is heavily
commented and the animation system is not obvious. `src/app/globals.css` owns
every visual state; the component owns timing and layout.

`INBOX.md` is Giacomo's braindump. Raw lines land in **Dump** with no format or
category — reading and categorising them is your job, not his. Move each one
into **Triaged** with your interpretation attached; never act straight from the
dump, and never delete from it. Anything you'd file as **direction** collides
with a settled decision below and needs a conversation, not a commit.

It is **gitignored on purpose** — a working scratchpad, not part of the
deliverable, and it holds unbuilt ideas that shouldn't ship with the source. It
lives on Giacomo's machine only, so expect it to be absent from a fresh clone.
Don't commit it, and don't recreate it as a tracked file.

**This is a standalone project.** It is not part of the gpcodes.com portfolio and
must not look like it. Giacomo's portfolio links out to this; it does not contain
it. An earlier session built it inside the portfolio repo by mistake and it was
moved here verbatim.

**The risk to manage, permanently:** a to-do app is the most clichéd demo there
is. It only earns a place on a senior designer's portfolio if the interaction
craft is explicitly the subject. If it ends up looking like a tutorial to-do app
with transitions bolted on, it has failed. This is also why the source is part of
the deliverable — the commented reasoning is what is actually being shown.

---

## Where it stands

**The app is called To-Do To-Day.** Splitting *Today* into *To-Day* mirrors
*To-Do*; the title highlights the second half. Light mode only, on purpose —
there is no `prefers-color-scheme` block and there should not be one.

**Two skins ship, and both are keepers.** A pill toggle top-right sets
`data-variant` on `<html>` (persisted as `gp-lab-variant`), and the whole
difference is a token block plus `--stroke-filter`:

- **organic** — the default. Felt-tip sketchbook: warm paper, uneven radii, every
  straight edge displaced through the `#rough` SVG filter. The hand is not
  confined to the marks, it sets the whole interface: Shantell Sans reads *and*
  does the instrumentation, with Kalam on the title. A second toggle
  (`data-heading`, organic only) swaps the title between Kalam / Playpen /
  Architects; Kalam is the current pick. Caveat was tried and rejected — its
  letterforms read badly at this size.
- **clean** — Figtree, DM Mono, straight edges, `--stroke-filter: none`, one
  indigo accent.

The accent in **organic** is black felt-tip, not a colour. It was marker red; the
palette is down to one colour with a job — the highlighter yellow — and
everything else is ink on paper. Yellow is the only shout in the piece, which is
what makes it land, and blue (`--biro`) is system-only: focus rings, never
decoration. **clean** deliberately collapses that: one indigo does accent, focus
and system, because a modern skin that hoarded three inks would be arguing with
itself.

**Signature moments, deliberately only two:** the add sweep (the rule draws itself
in) and the delete (the row is drawn into its own bin). Everything else is quietly
excellent rather than narrated. Restraint is what makes those two land — if a
third metaphor appears, one of these should probably go.

**Feature-complete.** Everything once flagged here as a candidate ships now, all
of it as quiet work rather than signature moments:

- the empty state is a dashed hand-drawn frame with a restore link;
- a completed row mutes and strikes, wipes any highlighter back off in the same
  move, and sinks to the bottom of the list on the existing reorder FLIP;
- **hide done** folds those rows away — each fades where it stood, on its own
  ghost state, while the status line closes the gap. Not the bin: hiding isn't
  destructive and must not borrow a destructive metaphor. Completing something
  is the most common action in the app, so a just-completed row is held on
  screen through its own tick and strike before the filter takes it, or the
  filter would look like a bug;
- **the add composer** is a link at rest — a checkbox-shaped plus and "Add New
  Task" in the action colour, sharing the rows' column geometry so it reads as
  the row that doesn't exist yet. The ruled line only appears once there is
  something to edit. A persistent input box above the list looked like a form to
  fill out rather than an invitation.

Nothing else is committed, and that is the position, not a gap. A third narrated
interaction would weaken the two that carry the piece. Add one only with a
specific reason, and expect to retire something in exchange.

---

## Settled decisions. Do not silently revisit

### No animation library. CSS and WAAPI only

Motion and GSAP were both considered and rejected, after the no-dependencies rule
was explicitly lifted for this project. **The original reasoning was too strong and
has been corrected — read this before re-arguing it.**

What was written here before: *"the time control is incompatible with springs,
because a spring has no duration."* That is true of **runtime** springs only. It is
false of **baked** springs, which is what ships.

`tools/spring.mjs` samples a real damped harmonic oscillator into a CSS `linear()`
easing function. These are genuine springs — multiple direction reversals, correct
decay envelope, things a `cubic-bezier` cannot express (it has two control points,
so it can overshoot once and never oscillate). And because a baked spring is just
an easing function over a duration, multiplying by `--t` is an *exact* time-scale.
The control stays honest.

Three curves, all in `globals.css`:

| token | visual | total | used for |
| --- | --- | --- | --- |
| `--ease-spring` | 110ms | 320ms | most controls |
| `--ease-spring-lively` | 120ms | 500ms | the bin lid, and nothing else |
| `--ease-land` | 160ms | 172ms | anything the drawer prints a number for |

**The rule that matters:** a spring's `transition-duration` must be its **total**,
not its visual duration. Setting the visual number squashes the whole oscillation
into that window and you get a shiver, not a spring. That is why durations the
timings drawer displays get `--ease-land` (total ≈ visual, so a slider reading
130ms means 130ms), while the bouncy totals live on `--b-pop` / `--b-pop-lively`,
which are internal and deliberately not sliders.

Springs are **asymmetric throughout**: only arrival springs. Leaving is a short
plain decelerate, because a 320ms spring running backwards on un-hover makes a
control feel reluctant to let go.

**Not sprung, on purpose:** the FLIP glides. A row travelling to a new slot should
arrive decisively, and five rows bouncing into place at once reads as unstable.

**What Motion would actually buy**, stated honestly so it can be weighed rather
than dismissed: the `layout` prop would delete ~80 lines — `snap()`, the
invert/commit/play `useLayoutEffect`, `prevTops`, `clearTransitionAfter`. That is a
real win. It costs ~30kb, and it breaks one specific property: the FLIP transitions
are written as `var(--d-reorder)`, so **dragging a slider retimes a glide already
in flight.** Motion reads its transition config when the animation starts. That
live retiming is the most direct proof the bottom bar is real and not a stage prop.

**Revisit only if** burst-testing shows stutter that WAAPI `composite: "add"`
cannot fix. That is a testable claim; test it rather than assuming.

### The bottom bar is a TIME SCALE, not a speed

`--t` **multiplies every duration**. So `0.25×` is a quarter of the time and runs
*faster*; `3.00×` is triple and runs *slower*. The field is `Params.timeScale`.

It used to be called `Params.speed` and labelled "speed", and the `s` shortcut set
`0.25` while announcing "slow motion on" — so the slow-motion key made the entire
app run **four times faster**, and `2.00×` meant half speed. The name caused it.
Do not reintroduce either the label or the field name.

Micro-interaction timings (`--b-press`, `--b-hover`, `--b-pop`, `--b-pop-lively`,
`--b-stagger`) are intentionally **not** in the drawer. Exposing a 320ms number for
something that reads as a 110ms pop would be the same category of lie.

### Delete: into the bin, and the lid does the acting

The original brief said *"crumble up and throw in a bin."* What shipped converges
the row on its own bin in 150ms. The reasoning, because it generalises:

- **The flourish goes on the small element, not the big one.** The instinct is to
  make the *row* perform. That is exactly what dies on the tenth repeat — a big
  object travelling a long way that you cannot help watching. The lid is 10px and
  moves for 75ms, so it still reads at the fiftieth delete.
- **No crumple.** You cannot crumple with transform and opacity; a faked one reads
  as a glitch, and it needs ~400ms to be legible at all, which is the duration that
  stops being charming.
- **Semantics first.** `⌘z` exists. A metaphor that says *destroyed* — crumpling,
  tearing, burning — contradicts the undo sitting in the status line. A bin is the
  one delete metaphor that is honestly recoverable.
- `transform-origin` lands on the delete control, so one `scale(0.12)` converges
  everything on the bin for free — no coordinates, and the target travels with the
  ghost because the ghost renders its own bin.
- The easing is **in-out**, and this was measured, not guessed. At the 75ms mark
  where the lid shuts: `ease-in` leaves the row at 87% scale (lid closes on
  something that hasn't moved), `ease-out` puts it at 15% (gone before the lid
  starts), `in-out` lands it at 56% — visibly half-swallowed exactly as the lid
  comes down.

### ~~The readout must stay honest~~ · SUPERSEDED 2026-07-20

The readout panel is **gone**, along with the lede and the "how it moves, honestly"
notes. Giacomo's instruction: "even though this is an experiment, I don't want the
research around it. I just want the app, no paragraphs, no readouts."

Do not reinstate any of it. The app is a to-do list centred on the page with a
bottom bar; the bar is where the study survives, as controls rather than commentary.

What the readout was defending is still defended, differently. Its purpose was to
prove the motion was *chosen* rather than accepted from a default. The timing
drawer does that better by making every value adjustable and visible. The old
argument holds — **if a change makes those controls vaguer, or hides a real number
behind a label, the change is wrong.** The `speed`/`timeScale` bug above was
exactly this failure, and it survived a long time.

---

## Constraints

- Next 16 App Router, TypeScript, static export. No server runtime.
- No heavyweight dependencies. See the settled decision above.
- localStorage persistence. Rows never leave the page.
- **Animate transform and opacity only.** Nothing animates height: position changes
  are FLIP glides driven from `RowsStudy.tsx` (first, last, invert, play). The one
  deliberate exception is a 1.3px `filter: blur()` on non-dragged rows during a
  drag, which is depth-of-field, not layout.
- `prefers-reduced-motion` respected in **both** places it has to be: the stylesheet
  drops translates and scales while keeping opacity crossfades, and the script checks
  the same media query before applying a transform, because a media query cannot stop
  JavaScript from setting one.
- Keyboard operable throughout. This is not a pointer-only toy.
- Every interactive control has a **≥40px hit area**, extended by a pseudo-element
  so layout is untouched. Mark and delete sit 4px apart, so 2px per side is the
  ceiling — they meet at exactly 0px overlap. Two interactive elements must never
  share a pixel.
- `npm run build` must pass.
- **`--muted` sits at 3.8:1 contrast, below WCAG AA's 4.5:1, on purpose.**
  Flagged in an accessibility pass 2026-08-20 across its 15+ uses (completed
  rows, status line, disabled states); Giacomo's ruling was "muted is fine" —
  the dimness is the deliberate "recede" signal for secondary content, and
  pushing it to full AA contrast would fight that everywhere it's used at
  once. Don't re-flag or "fix" this without a specific reason to revisit it.

## Traps that have already been sprung once

- **The leaving ghost is a different element from the row.** Anything driven off a
  `data-*` attribute on `.rows-row` must be mirrored onto the ghost `<li>`, or the
  exit starts from a state the row was never in. This is how deleting a highlighted
  row silently lost its highlight on the first frame.
- **A running WAAPI animation outranks inline styles.** The drag-release momentum
  animation has to be cancelled before FLIP can move that row — see the top of the
  layout effect.
- **Params persist in localStorage.** Changing `DEFAULTS` does nothing visible until
  you hit "reset to defaults" in the timings drawer. Expect to be confused by this.
- **Centre things with margins, not transforms**, when the element also has a hover
  transform. Composing `translate(-50%)` into every other rule is a trap that gets
  forgotten in exactly one place.
- **A drag reorder fires many times before React re-renders.** `maybeReorder` runs
  on every `pointermove`, so a fast drag makes several calls close over the same
  stale `rows` snapshot while `setRows` already sees fresh state. Splicing the fresh
  array with an index taken from the stale snapshot drops the dragged row and
  duplicates another — a duplicate React key, and corrupted localStorage that
  survives reload. Resolve the dragged row by **id inside the updater**, never by a
  snapshot index, and clamp the insertion point the same way. `moveRow` (keyboard)
  looks similar but is safe: discrete events re-render between each move.

## Running it

```
npm install
npm run dev          # port 3000 by default
npm run build        # static export to out/
node tools/spring.mjs   # regenerate the spring curves
```

**Verify changes by driving the app in a browser, not by the build passing.**
Animation regressions do not show up in a typecheck.

Two things that will waste an hour if you don't know them:

- **Background tabs freeze `requestAnimationFrame` and CSS transitions, but keep
  `setTimeout` running.** Under automation this makes the app look broken — rows
  stuck at `opacity: 0`, transitions pinned at `currentTime: 0` — when nothing is
  wrong.
- To inspect a curve headlessly, **scrub it**: `el.animate(...)`, `.pause()`, then
  set `.currentTime`. To check a resolved end state, inject
  `transition: none !important` and read the computed value.
