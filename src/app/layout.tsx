import type { Metadata } from "next";
import {
  Kalam,
  Figtree,
  DM_Mono,
  Shantell_Sans,
} from "next/font/google";
import { roomLight } from "@/components/day";
import "./globals.css";

/* Kalam, the title's hand (organic and desk; clean swaps the title back
   to Figtree). A legible everyday hand rather than a brush script:
   Playpen and Architects Daughter were compared on a switch and lost,
   and Caveat rendered the "To-Do / To-Day" letterforms awkwardly. */
const headKalam = Kalam({
  variable: "--font-head-kalam",
  subsets: ["latin"],
  weight: ["400", "700"],
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
      className={`${headKalam.variable} ${text.variable} ${mono.variable} ${hand.variable}`}
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
            __html: `try{var v=localStorage.getItem("gp-lab-variant");document.documentElement.dataset.variant=v==="organic"||v==="clean"?v:"desk"}catch(e){document.documentElement.dataset.variant="desk"}`,
          }}
        />
        {/* The desk's room light, for the same reason: at night a page
            that paints in daylight and then goes dark is a flash in the
            face. roomLight is the same function Desk.tsx uses after
            hydration, inlined by its source, so the two cannot drift. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=new Date(),l=(${roomLight.toString()})(d.getHours()*60+d.getMinutes()),s=document.documentElement.style;s.setProperty("--night",l.night.toFixed(3));s.setProperty("--warm",l.warm.toFixed(3))}catch(e){}`,
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
