import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

/* Carried over so the study renders exactly as it did before the move.
   Part of the rebrand: pick a face with more personality than this. */
const mono = Geist_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "What a row does when you touch it",
  description:
    "A to-do list as an interaction study: every transition named in a live readout as it plays, slowed to quarter speed on demand, fully keyboard operable.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={mono.variable}>
      <body>{children}</body>
    </html>
  );
}
