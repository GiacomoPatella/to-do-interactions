/* The shape of a day, as pure functions of the clock: when the ink starts
   to go, how long is left, and what the room's light is doing. No state
   and no DOM here; clock.ts says what time it is, this says what that
   time means. */

/** Local calendar date, YYYY-MM-DD. Sorts as a string. */
export function dayKey(ms: number) {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local minutes since midnight, fractional. */
export function minuteOfDay(ms: number) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole days from one dayKey to another, DST-proof (noon to noon). */
export function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/* Dusk is a fixed 18:00, not the sun. The rule is the deadline, and a
   decay that started at 16:30 in December and 21:00 in June would make
   the same evening feel different depending on the season. The desk's
   light (below) follows its own curve. */
export const DUSK_MIN = 18 * 60;

/** How far the open rows have faded, 0 to 1. Pristine all day, then an
    ease-in from dusk to midnight: barely there at nine, most of the way
    by eleven. Not a function of anything but the clock — a sunset, not a
    scoreboard. The readability floor is not here; it is in the
    stylesheet, which decides what 1 looks like. */
export function decayAt(ms: number) {
  const m = minuteOfDay(ms);
  if (m < DUSK_MIN) return 0;
  const p = Math.min(1, (m - DUSK_MIN) / (24 * 60 - DUSK_MIN));
  return p * p;
}

/** What the status line says while the ink is going: the time left,
    rounded down to the minute. Empty before dusk. */
export function turnCountdown(ms: number) {
  if (minuteOfDay(ms) < DUSK_MIN) return "";
  const left = Math.floor((startOfDay(ms) + 86_400_000 - ms) / 60_000);
  if (left < 1) return "under a minute";
  const h = Math.floor(left / 60);
  const m = left % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
