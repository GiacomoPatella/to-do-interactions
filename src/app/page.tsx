import Booklet from "@/components/Booklet";
import Desk from "@/components/Desk";
import RowsStudy from "@/components/RowsStudy";

/* Stripped back to the app itself. The lede, the "how it moves, honestly"
   notes and the readout panel are gone by decision: this reads as a to-do
   app you would use, not a write-up of one. What survives of the study is
   the thing you can operate — the timing controls in the bottom bar. */
export default function Home() {
  return (
    <>
      {/* The desk skin's wood. Hidden in organic and clean. */}
      <Desk />
      <a className="skip-link" href="#main">
        skip to content
      </a>

      <main id="main" className="wrap">
        {/* The desk skin's notepad. Renders nothing visible in
            organic or clean. */}
        <Booklet />
        <h1>
          To-Do <span className="hl">To-Day</span>
          {/* A margin doodle in the felt-tip hand — a little sun for
              'to-day', not a mascot. Personality without a face, and a hook
              for later: it could set into a moon as midnight nears. */}
          <svg
            className="title-doodle"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4.3" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 6 V3.1 M12 18 V20.9 M6 12 H3.1 M18 12 H20.9 M16.24 7.76 L18.3 5.7 M7.76 7.76 L5.7 5.7 M16.24 16.24 L18.3 18.3 M7.76 16.24 L5.7 18.3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </h1>
        <RowsStudy />
      </main>
    </>
  );
}
