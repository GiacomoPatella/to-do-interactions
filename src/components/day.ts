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

/* ---- the room's light, desk only ----

   Two numbers the stylesheet reads: `night`, how far the room has gone
   to lamplight (0 day, 1 dark room and lamp on), and `warm`, how golden
   the window light is (dawn and the hour before dusk). A fixed daily
   curve rather than a real sunset, for the same reason dusk is fixed:
   the light and the decay should tell the same story every evening.

   Self-contained on purpose: layout.tsx inlines this function's source
   into the pre-paint script, so a night visit never flashes daylight
   before hydration. It must not reference anything outside itself. */
export function roomLight(m: number): { night: number; warm: number } {
  // minute of day, night, warm
  const k = [
    [0, 1, 0],
    [330, 1, 0],
    [420, 0.2, 0.7],
    [510, 0, 0],
    [1020, 0, 0],
    [1110, 0.05, 1],
    [1185, 0.7, 0.55],
    [1230, 1, 0],
    [1440, 1, 0],
  ];
  let i = 0;
  while (i < k.length - 2 && m >= k[i + 1][0]) i++;
  const a = k[i];
  const b = k[i + 1];
  const t = Math.min(1, Math.max(0, (m - a[0]) / (b[0] - a[0])));
  const s = t * t * (3 - 2 * t);
  return {
    night: a[1] + (b[1] - a[1]) * s,
    warm: a[2] + (b[2] - a[2]) * s,
  };
}

export type Sky = {
  /** Window light: azimuth and elevation in degrees, colour, strength. */
  az: number;
  el: number;
  rgb: [number, number, number];
  intensity: number;
  amb: [number, number, number];
  /** The desk lamp, 0 off to 1 full. */
  lamp: number;
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** The desk's lighting at a minute of the day, for desk-wood.ts. Built on
    roomLight so the wood and the page always agree: the sun arcs through
    the window from the left in the morning to higher and squarer at
    midday and back down, the light warms with `warm`, and as `night`
    rises the window goes and the lamp takes over. */
export function skyAt(m: number): Sky {
  const { night, warm } = roomLight(m);
  const day = Math.min(1, Math.max(0, (m - 390) / (1215 - 390)));
  const arc = Math.sin(Math.PI * day);
  return {
    az: mix(-42, -8, day),
    el: 8 + 52 * arc,
    rgb: mix3([1, 0.98, 0.95], [1, 0.8, 0.58], warm),
    intensity: 2.3 * (1 - night) * (0.6 + 0.4 * arc),
    amb: mix3(
      mix3([0.3, 0.32, 0.36], [0.3, 0.26, 0.22], warm),
      [0.028, 0.03, 0.045],
      night,
    ),
    lamp: night,
  };
}

/** Where the plant's shadow falls (Shade.tsx), from the same sun as the
    wood. `rot` swings it about the plant with the sun's azimuth, at a
    third of the angle, and `len` stretches it as the sun drops, since a
    low sun casts long and a high one short. Both are held down because
    the shadow may only reach the title: the full swing, or a stretch
    down the page rather than across it, would carry it off. Neutral for
    the late-morning sun (about 11:20), which is what the scene is drawn
    for. `sun` is how much direct light there is to cast one at all. */
export function shadowAt(m: number) {
  const s = skyAt(m);
  const cot = 1 / Math.tan((Math.max(s.el, 1) * Math.PI) / 180);
  return {
    rot: (30 + s.az) * 0.3,
    len: 0.85 + 0.22 * Math.min(cot, 3),
    sun: 1 - roomLight(m).night,
  };
}
