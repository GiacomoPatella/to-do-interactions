/* The app's clock: real time, or a faked time of day set from the bar's
   Clock drawer. Everything time-of-day reads this instead of Date.now(),
   so scrubbing the clock moves the whole app at once: the decay of open
   rows, the countdown, the midnight page turn and the desk's light.

   A faked time is an offset from real time, not a frozen instant, so it
   keeps ticking: set it to ten seconds before midnight and the page turns
   ten seconds later, the same way it would at the real midnight. It is
   never persisted; a reload is always back to real time.

   Listeners hear about every change of the minute, not every second.
   Nothing in the app is finer than a minute (the countdown reads in
   minutes, the decay is imperceptible minute to minute), and the
   component that owns the rows is far too big to re-render every second
   for nothing. */

export type ClockState = { now: number; faked: boolean };

let offset = 0;
let state: ClockState | null = null;
let timer = 0;
const listeners = new Set<() => void>();

export function clockNow() {
  return Date.now() + offset;
}

function emit() {
  state = { now: clockNow(), faked: offset !== 0 };
  listeners.forEach((l) => l());
  schedule();
}

/* To the next minute boundary of the clock's own time, faked or not.
   Background tabs throttle timers to about once a minute, which is
   exactly this resolution anyway; visibilitychange catches up the rest. */
function schedule() {
  window.clearTimeout(timer);
  if (listeners.size === 0) return;
  timer = window.setTimeout(emit, 60_000 - (clockNow() % 60_000) + 20);
}

function onVisible() {
  if (!document.hidden) emit();
}

/** Fake the clock to `ms`, or pass null to return to real time. */
export function setClock(ms: number | null) {
  offset = ms === null ? 0 : ms - Date.now();
  emit();
}

export function subscribeClock(fn: () => void) {
  if (listeners.size === 0) {
    document.addEventListener("visibilitychange", onVisible);
  }
  listeners.add(fn);
  schedule();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

export function getClock(): ClockState {
  if (!state) state = { now: clockNow(), faked: offset !== 0 };
  return state;
}

/* The static export has no clock at build time. Zero means "not known
   yet", and every consumer waits for a real value before rendering
   anything time-dependent. */
const SERVER: ClockState = { now: 0, faked: false };
export function getServerClock(): ClockState {
  return SERVER;
}
