import type { Metadata } from "next";
import {
  Kalam,
  Playpen_Sans,
  Architects_Daughter,
  Figtree,
  DM_Mono,
  Shantell_Sans,
} from "next/font/google";
import "./globals.css";

/* Three heading hands, switchable at runtime to compare (organic skin only;
   clean swaps the title back to Figtree). Each carries its own CSS variable,
   and --font-display points at whichever data-heading selects. All are
   legible everyday hands rather than brush scripts — Caveat rendered the
   "To-Do / To-Day" letterforms awkwardly and is gone. */
const headKalam = Kalam({
  variable: "--font-head-kalam",
  subsets: ["latin"],
  weight: ["400", "700"],
});
const headPlaypen = Playpen_Sans({
  variable: "--font-head-playpen",
  subsets: ["latin"],
});
const headArchitects = Architects_Daughter({
  variable: "--font-head-architects",
  subsets: ["latin"],
  weight: ["400"],
});

/* Figtree does the reading: lede, notes, and every row title. Warm and
   current rather than neutral-corporate, which keeps it from sanding the
   fun off while staying crisp at 15px. */
const text = Figtree({
  variable: "--font-text-src",
  subsets: ["latin"],
});

/* DM Mono holds the instrumentation: readout, keycaps, status line, labels.
   The study's honesty lives in those numbers, so they get a face chosen for
   an even colour and unambiguous figures, not for character. */
const mono = DM_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/* The organic variant takes the sketchbook idea to its logical end: the
   hand is not confined to the marks, it sets the whole interface. Shantell
   Sans is a modern, bouncy, genuinely legible hand — readable at 15px in a
   way a brush script is not. The clean variant never loads it. */
const hand = Shantell_Sans({
  variable: "--font-hand-src",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "To-Do To-Day",
  description:
    "A to-do list with its transition timings exposed as live controls. Fully keyboard operable.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${headKalam.variable} ${headPlaypen.variable} ${headArchitects.variable} ${text.variable} ${mono.variable} ${hand.variable}`}
      /* The script below writes data-variant before React hydrates. */
      suppressHydrationWarning
    >
      <head>
        {/* Set the skin before first paint. The skins differ in layout,
            not just colour — desk draws the page as a sheet on a desk,
            organic fills the window — so applying it after hydration
            jumped the whole app on load. Desk is the default. */}
        <script
          dangerouslySetInnerHTML={{
            /* The desk's notepad binding too, for the same reason: it
               changes the page's layout. TEMPORARY comparison override,
               to delete once settled: ?binding=tape shows the glued head
               the spiral replaced. */
            __html: `try{var v=localStorage.getItem("gp-lab-variant");document.documentElement.dataset.variant=v==="organic"||v==="clean"?v:"desk"}catch(e){document.documentElement.dataset.variant="desk"}try{var q=new URLSearchParams(location.search);document.documentElement.dataset.binding=q.get("binding")==="tape"?"tape":"spiral"}catch(e){}`,
          }}
        />
      </head>
      <body>
        {/* One roughen filter, referenced by the organic skin as
            filter: url(#rough). It displaces straight edges into a drawn
            wobble; the clean skin sets --stroke-filter: none and never
            touches it. The wide filter region stops the displaced strokes
            from clipping at the element box. */}
        <svg className="svg-defs" aria-hidden="true" focusable="false">
          <filter
            id="rough"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            filterUnits="objectBoundingBox"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.017 0.013"
              numOctaves="2"
              seed="8"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="2.4"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>
        {children}
      </body>
    </html>
  );
}
