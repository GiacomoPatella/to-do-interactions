import RowsStudy from "@/components/RowsStudy";

/* The copy is carried over from the version built inside the portfolio: it
   explains the study accurately and there was no reason to rewrite it. The
   portfolio chrome around it (site menu, shared page classes) is gone, since
   this is its own thing now. */
export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">
        skip to content
      </a>

      <main id="main" className="wrap">
        <p className="eyebrow">interaction study</p>
        <h1>What a row does when you touch it.</h1>

        <p className="lede">
          This is a working to-do list, and that is the least interesting thing
          about it. The list is a pretext: the actual work is the transitions,
          how a row enters, how it settles, how its neighbours close the gap it
          leaves behind. Nothing here animates height. Everything you see move
          is transform and opacity, so the layout never&nbsp;lurches.
        </p>
        <p className="lede">
          The panel beside the list is the instrumentation. It names each
          transition as it plays, with its duration and easing curve, and the
          0.25&times; toggle runs the whole study at quarter speed so you can
          watch the seams. Every action has a keyboard shortcut, all of them
          shown. Rows persist in localStorage and never leave
          this&nbsp;page.
        </p>

        <RowsStudy />

        <section className="notes" aria-labelledby="rows-notes-title">
          <h2 id="rows-notes-title">How it moves, honestly</h2>
          <p>
            Adding or removing a row changes the height of the list, and
            animating height is layout work: it is the tell of a tutorial to-do
            app. So before every mutation I record where each row sits, let the
            browser lay out the new list instantly, pin every row to its old
            position with a transform, and release it on the next frame, so
            each one glides to its new place on transform alone. The technique
            is called FLIP: first, last, invert, play. A deleted row leaves the
            flow at once and exits as a ghost pinned where it stood, while its
            neighbours close the&nbsp;gap.
          </p>
          <p>
            Reduced motion is respected in both places it has to be. The
            stylesheet drops every translate and scale and keeps the opacity
            crossfades, and the script checks the same media query before
            applying a transform, because a media query cannot stop JavaScript
            from setting&nbsp;one.
          </p>
        </section>
      </main>
    </>
  );
}
