import RowsStudy from "@/components/RowsStudy";

/* Stripped back to the app itself. The lede, the "how it moves, honestly"
   notes and the readout panel are gone by decision: this reads as a to-do
   app you would use, not a write-up of one. What survives of the study is
   the thing you can operate — the timing controls in the bottom bar. */
export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">
        skip to content
      </a>

      <main id="main" className="wrap">
        <h1>
          things to <span className="hl">do</span>.
        </h1>
        <RowsStudy />
      </main>
    </>
  );
}
