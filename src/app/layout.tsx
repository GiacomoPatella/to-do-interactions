import type { Metadata } from "next";
import { Caveat, Figtree, DM_Mono } from "next/font/google";
import "./globals.css";

/* Three faces, and the split between them is the whole argument.

   The hand is decorative, so it stays decorative: Caveat sets the headline
   and nothing else. The temptation with a sketchbook identity is to set the
   row titles in handwriting too, and that is exactly how this kind of thing
   starts looking like a craft-fair flyer — a felt-tip face at 15px is both
   harder to read and cheaper-looking than the real thing. The hand belongs
   in the marks (the wobbly checkbox, the highlighter swipe), not in the
   functional text. */
const display = Caveat({
  variable: "--font-display-src",
  subsets: ["latin"],
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

export const metadata: Metadata = {
  title: "things to do",
  description:
    "A to-do list with its transition timings exposed as live controls. Fully keyboard operable.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${text.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
