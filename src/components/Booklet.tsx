"use client";

/**
 * The stationery around the desk skin's page: everything that makes the
 * page an agenda or a notepad rather than a loose sheet. None of it is
 * interactive and none of it moves — it is the object the list is written
 * in, rendered once.
 *
 * Two formats. The notepad is the one in use, at every width: the agenda
 * was tried first and its left-hand page pulled the eye off today's list.
 * The agenda stays reachable at ?book=agenda (set in layout.tsx's pre-paint
 * script) until it's deleted:
 *
 * - AGENDA. A page-a-day diary lying open. The live app is
 *   the right-hand page, today. The left-hand page is the back of
 *   yesterday's leaf, already turned — which is what the one-day list's
 *   midnight page turn will produce — and yesterday's ink shows through it,
 *   mirrored, the way felt-tip bleeds through real paper. That show-through
 *   is where the carry-over choice will live once the one-day list ships.
 * - NOTEPAD. Top-bound, one page, no spread to fit. Spiral-bound: the
 *   coil, a few leaves under today's showing at the sides, the hard back
 *   board under those, and the pages already used curled over the coil
 *   behind it. ?binding=tape swaps the coil for the glued head it
 *   replaced, for comparison.
 *
 * Every element here is rendered in every skin and shown only by the desk
 * rules in globals.css, so organic and clean never see any of it. All of it
 * sits inside .wrap and is positioned around it; nothing here is an
 * ancestor of the list, so FLIP's measurements are untouched.
 */

import { useEffect, useState } from "react";

/* The shape the show-through needs from a day's page. A subset of
   RowsStudy's Row, so yesterday's real rows drop straight in. */
type InkRow = { text: string; done: boolean; marked: boolean };

/* PLACEHOLDER. Yesterday's page does not exist yet: the one-day list (the
   midnight page turn, see CLAUDE.md) is decided but unbuilt. Until it ships,
   the show-through is this fixed sample, so the agenda can be judged with
   something bleeding through it. When it ships, replace this with the
   stored previous page and pass it in as `yesterday` below — null for a
   first day, which already renders a blank left page. */
const YESTERDAY_PLACEHOLDER: InkRow[] = [
  { text: "Send the invoice before lunch", done: true, marked: false },
  { text: "Water the plants", done: true, marked: false },
  { text: "Reply to the landlord", done: false, marked: true },
  { text: "Pick up batteries", done: true, marked: false },
  { text: "Sketch the new shelf", done: false, marked: false },
];

/* Edges of the pages stacked under each side of the spread. An agenda
   open at today is as thick on each side as the year is: the days gone on
   the left, the days to come on the right. One alternating line per slice
   of the year, so the stack reads as separate leaves rather than a grey
   border. */
const STACK_LINES = 8;
function stackEdges(lines: number, dir: 1 | -1) {
  const tones = ["#efe9da", "#fbf8ef", "#e9e2d0", "#f7f3e8"];
  return Array.from(
    { length: lines },
    (_, i) => `${dir * (i + 1)}px ${i < 2 ? 0 : 1}px 0 ${tones[i % 4]}`,
  ).join(", ");
}

function printedDate(d: Date) {
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
    day: d.toLocaleDateString(undefined, { day: "numeric", month: "long" }),
    iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  };
}

/* Yesterday's page, as its ink would reach the back of the leaf: the same
   layout as today's page, mirrored as a whole. Styled by .book-through in
   globals.css — faint, softened, warm, multiplied into the paper. */
function ShowThrough({ rows, date }: { rows: InkRow[]; date: Date }) {
  const p = printedDate(date);
  return (
    <div className="book-through">
      <p className="book-through-date">
        <span className="book-date-weekday">{p.weekday}</span>
        <span className="book-date-day">{p.day}</span>
      </p>
      <p className="book-through-title">
        To-Do <span className="book-through-hl">To-Day</span>
      </p>
      <ul className="book-through-rows">
        {rows.map((r, i) => (
          <li
            key={i}
            data-done={r.done ? "true" : undefined}
            data-marked={r.marked ? "true" : undefined}
          >
            <span className="book-through-box" />
            <span className="book-through-text">{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Booklet() {
  /* Null until mount: this is a static export, so the build would
     otherwise print the day it was built, then hydrate a different one. */
  const [today, setToday] = useState<Date | null>(null);
  const [yesterday, setYesterday] = useState<InkRow[] | null>(
    YESTERDAY_PLACEHOLDER,
  );

  useEffect(() => {
    const now = new Date();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(now);
    /* TEMPORARY, alongside ?book=: ?yesterday=none shows a first day, with
       nothing to bleed through. Goes when the real previous page does. */
    if (new URLSearchParams(location.search).get("yesterday") === "none") {
      setYesterday(null);
    }

    /* The year's thickness either side of the spread. Written to <html>
       because the right-hand page's stack is drawn by .wrap::before,
       which lives outside this component. */
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
    const gone = (now.getTime() - start) / (end - start);
    const left = Math.min(
      STACK_LINES - 1,
      Math.max(1, Math.round(gone * STACK_LINES)),
    );
    const root = document.documentElement.style;
    root.setProperty("--verso-edges", stackEdges(left, -1));
    root.setProperty("--recto-edges", stackEdges(STACK_LINES - left, 1));
  }, []);

  const p = today ? printedDate(today) : null;

  return (
    <>
      <div className="book-cover" aria-hidden="true" />
      <div className="book-verso" aria-hidden="true">
        {today && yesterday && (
          <ShowThrough
            rows={yesterday}
            date={
              new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
            }
          />
        )}
      </div>
      <div className="book-spine" aria-hidden="true" />
      <div className="book-used" aria-hidden="true" />
      <div className="book-binding" aria-hidden="true" />
      {/* Printed, not written: the one thing on the page the agenda came
          with. Real text, not decoration — it is the date this list is
          for. */}
      <p className="book-date">
        {p && (
          <time dateTime={p.iso}>
            <span className="book-date-weekday">{p.weekday}</span>
            <span className="book-date-day">{p.day}</span>
          </time>
        )}
      </p>
    </>
  );
}
