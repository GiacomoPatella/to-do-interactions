"use client";

/**
 * The to-do app.
 *
 * It began as an interaction study with a readout panel naming every
 * transition as it played, plus a page of prose explaining the technique.
 * All of that is gone: this is now just the app, centred, with a bottom
 * bar. What survived of the study is the part you can operate — the
 * timing controls — and the discipline underneath.
 *
 * Three structural decisions everything else hangs off:
 *
 * 1. No layout-shifting animation, ever. Height is never animated. Every
 *    glide is FLIP: snap() records where everything sits before a
 *    mutation, the browser lays the new list out instantly, and the
 *    layout effect below pins each element to its old position with a
 *    transform and releases it a frame later. Anything carrying
 *    data-flip participates, so the status line moves with the list
 *    rather than jumping.
 *
 * 2. Every duration is a base (--b-*) times --t, and BOTH come from the
 *    controls, written as inline custom properties on the root element
 *    below. That is the whole mechanism: no second set of timings, no
 *    JS animation loop. The inline FLIP transitions here reference
 *    var(--d-reorder) and var(--ease-move) rather than hardcoded
 *    numbers, so dragging a slider retimes glides already in flight.
 *
 * 3. Each row is driven by data-state (idle / entering / leaving /
 *    done), and the stylesheet owns what those states look like.
 *
 * Reduced motion is honoured twice on purpose: the stylesheet drops
 * transforms, and the code checks the same media query before setting
 * element.style.transform, because CSS cannot stop JS from doing that.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/* `marked` is the highlighter: emphasis chosen by you, not a state the
   app infers. Deliberately separate from `done` — see the note in
   globals.css about why completion must never highlight anything. */
type Row = { id: string; text: string; done: boolean; marked: boolean };
/* A leaving row, pinned where it stood while its neighbours close the
   gap. The flick and the reduced-motion crossfade are the same
   transition with the transform dropped by the stylesheet. */
/* kind distinguishes a deleted row (into the bin, see the "leaving"
   data-state) from a hidden one (a plain quick fade, see "hiding") — two
   different reasons a row leaves the flow, so two different exits. */
type Ghost = { row: Row; top: number; out: boolean; kind: "delete" | "hide" };

type DragState = {
  id: string;
  pointerId: number;
  startY: number;
  lastY: number;
  /** Accumulated layout correction: when the list reorders under the
      dragged row, the layout jump is folded in here so the row stays
      glued to the pointer instead of teleporting. */
  base: number;
  active: boolean;
  didReorder: boolean;
  el: HTMLLIElement;
  /** Recent pointer positions, used to measure release velocity. Only
      the last handful matter: sampling the whole gesture would average a
      flick away against however long you spent holding still first. */
  samples: { t: number; y: number }[];
};

/** Total settle time for a released row. This is --b-pop, the baked
    spring's full duration, and like the other spring totals it is
    deliberately not a drawer slider: the perceived speed is the ~110ms
    visual duration, and printing 320 next to it would be a lie. */
const RELEASE_MS = 320;
/** Pointer samples older than this are ignored when measuring velocity:
    it is the speed you let go at that matters, not the average. */
const VELOCITY_WINDOW_MS = 90;
/** px of overshoot per px/ms of release velocity, and the ceiling. A
    hard cap matters more than the slope — without it, a fast flick on a
    trackpad throws the row far enough to read as a glitch. */
const OVERSHOOT_PER_VELOCITY = 11;
const MAX_OVERSHOOT_PX = 14;

/* The movement curve offered by the select. Only curves that make sense
   for something travelling between two layout positions: no ease-in,
   because a row arriving at speed reads like a mistake. */
const MOVE_EASES = {
  swap: {
    label: "Overshoot",
    value: "cubic-bezier(0.2, 1.15, 0.35, 1)",
  },
  expo: { label: "Expo out", value: "cubic-bezier(0.16, 1, 0.3, 1)" },
  soft: { label: "Soft out", value: "cubic-bezier(0.22, 1, 0.36, 1)" },
  inout: { label: "In-out", value: "cubic-bezier(0.65, 0, 0.35, 1)" },
  linear: { label: "Linear", value: "linear" },
} as const;

type MoveKey = keyof typeof MOVE_EASES;

type Params = {
  timeScale: number;
  draw: number;
  complete: number;
  mark: number;
  leave: number;
  reorder: number;
  settle: number;
  enter: number;
  hide: number;
  move: MoveKey;
};

/* Defaults mirror the .rows-study block in globals.css, which is what
   renders before this component hydrates. */
/* Tuned by frequency, not by taste applied evenly: the more often an
   action happens, the faster it has to be. Completing and reordering
   are things you do dozens of times in a sitting and they now get out
   of the way; the add sweep is once per row and is a signature moment,
   so it keeps its length. The net is roughly 0.8x on the functional
   half and unchanged on the two moments worth watching. */
const DEFAULTS: Params = {
  timeScale: 1,
  draw: 210, // signature: the rule sweeping in. Left long.
  complete: 120, // the most repeated action in the app. Crisp.
  mark: 140,
  leave: 150, // the shrink into the bin; see --b-leave in globals.css.
  reorder: 130, // fires repeatedly mid-drag, has to keep up with the pointer.
  settle: 170,
  enter: 170, // matches settle: an arriving row is a quiet moment, not a signature one.
  hide: 170, // matches settle too, so the status line's glide and the fade finish together.
  move: "swap",
};

type DurationKey = Exclude<keyof Params, "timeScale" | "move">;

const SLIDERS: { key: DurationKey; label: string }[] = [
  { key: "draw", label: "Add" },
  { key: "complete", label: "Complete" },
  { key: "mark", label: "Highlight" },
  { key: "leave", label: "Delete" },
  { key: "reorder", label: "Reorder" },
  { key: "settle", label: "Settle" },
  { key: "enter", label: "Enter" },
  { key: "hide", label: "Hide" },
];

const STORE_KEY = "gp-lab-rows-v1";
const PARAMS_KEY = "gp-lab-rows-params-v1";

/* Per-row delay when a whole list arrives at once. Mirrors --b-stagger
   in globals.css, and is only used here to work out when the sequence
   has finished. Kept short: long stagger delays make an interface feel
   slow rather than considered. */
const STAGGER_MS = 40;

/* First-visit seed: each sample row teaches one control. An empty list
   teaches nothing. */
const SEED = [
  "Drag me somewhere else",
  "Complete me with space",
  "Rename me: focus, then enter",
  "Delete me, then press cmd z",
  "Press s for slow motion",
];

let uidCounter = 0;
const uid = () => `r${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

/** Clear an element's inline transition once its transform has settled.
    transitionend is the fast path; the timeout is the guarantee, because
    the event is swallowed if the tab is hidden mid-glide or the
    transition is retargeted away. */
function clearTransitionAfter(el: HTMLElement, ms: number) {
  let timer = 0;
  const clear = () => {
    el.style.transition = "";
    el.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
  };
  const onEnd = (e: TransitionEvent) => {
    if (e.target === el && e.propertyName === "transform") clear();
  };
  el.addEventListener("transitionend", onEnd);
  timer = window.setTimeout(clear, ms + 100);
}

/** Where in a row's text did this click land? Read against the *display*
    text (a real, possibly-wrapped text node) before it gets swapped for
    the single-line edit input, so a click on a later wrapped line still
    resolves to the right character — the input itself never wraps, but a
    character index is wrap-independent, so the same number is valid on
    both sides of the swap. Returns null if the point didn't resolve to
    real text (e.g. a click that lands in the row's padding), and the
    caller falls back to placing the caret at the end. */
function caretOffsetFromPoint(x: number, y: number): number | null {
  const withLegacy = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range?.startContainer.nodeType === Node.TEXT_NODE) {
      return range.startOffset;
    }
    return null;
  }
  if (withLegacy.caretPositionFromPoint) {
    const pos = withLegacy.caretPositionFromPoint(x, y);
    if (pos?.offsetNode.nodeType === Node.TEXT_NODE) return pos.offset;
  }
  return null;
}

const KEYS: [string, string][] = [
  ["n", "Add new task"],
  ["↑ ↓", "Move focus"],
  ["⏎", "Edit row"],
  ["esc", "Cancel edit"],
  ["space", "Complete"],
  ["h", "Highlight"],
  ["⌥ ↑↓", "Reorder"],
  ["⌫", "Delete"],
  ["⌘z", "Undo"],
  ["s", "Slow motion"],
];

const GripDots = () => (
  <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
    {[2, 7, 12].map((y) => (
      <g key={y} fill="currentColor">
        <circle cx="1.5" cy={y} r="1.2" />
        <circle cx="6.5" cy={y} r="1.2" />
      </g>
    ))}
  </svg>
);

/* pathLength=1 normalises the path so the dash draw is 1 → 0 regardless
   of geometry; the CSS transitions stroke-dashoffset. */
const CheckMark = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path
      d="M2.5 6.5 5 9l4.5-5.5"
      fill="none"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
    />
  </svg>
);

/* The add composer's icon: a plus in the same hand-drawn box as the row
   checkboxes, so the control reads as "a row waiting to exist" rather
   than a stock button. Always fully drawn — nothing to toggle here. */
const PlusMark = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path
      d="M6 2.2v7.6M2.2 6h7.6"
      fill="none"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/* A bin, drawn in two parts so the lid can hinge. The lid group is
   lifted and tilted on hover by the stylesheet — the control opens
   before you commit to it, which is the same idea the old rotating
   cross was after, minus the jitter (that came from scaling the button
   itself, so the hit area grew out from under the pointer and
   oscillated; every transform now lives on the svg instead). */
const TrashCan = () => (
  <svg
    viewBox="0 0 16 16"
    width="15"
    height="15"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <g className="rows-del-lid">
      <path d="M2.6 4.3h10.8" />
      <path d="M6.3 4.3l.35-1.7h2.7l.35 1.7" />
    </g>
    <path d="M4 5.8h8l-.62 7.1a1.2 1.2 0 0 1-1.2 1.1H5.82a1.2 1.2 0 0 1-1.2-1.1Z" />
  </svg>
);

/* A chisel-tip marker, held at the angle you would hold one. Filled nib
   in the highlighter colour so the control names its own effect.
   Once the row IS marked the nib gains a small cross: the button has
   become "take the highlight off", and a toggle that looks identical in
   both states makes you click it to find out which one you are in.

   Stateless on purpose. Both states are always in the DOM and the
   stylesheet crossfades them off the row's data-marked, rather than
   React swapping one for the other — an icon that pops in on a state
   change is exactly the jarring switch a transition exists to prevent.
   It also means the leaving ghost renders correctly for free, which it
   did not when the fill was driven by a prop. */
const MarkerNib = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <g transform="rotate(-38 8 8)">
      <rect
        x="6"
        y="1.5"
        width="4"
        height="6.5"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        className="rows-mark-ink"
        d="M6 8.2h4l-.7 3.2a1 1 0 0 1-1 .8h-.6a1 1 0 0 1-1-.8Z"
        fill="var(--hilite)"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </g>
    <g className="rows-mark-x">
      {/* The disc is the page colour, not transparent: the cross sits
          over the nib and has to stay legible against it. */}
      <circle cx="12.2" cy="12.2" r="3.5" fill="var(--bg)" stroke="none" />
      <path
        d="M10.9 10.9l2.6 2.6M13.5 10.9l-2.6 2.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </g>
  </svg>
);

/* One face of a row, minus behaviour: used by the leaving ghost so a
   deleted row looks exactly like the row it was — including the mark
   control, or the ghost would be a column narrower than the row it is
   standing in for and the exit would visibly jump. */
const GhostFace = ({ row }: { row: Row }) => (
  <>
    <span className="rows-grip" aria-hidden="true">
      <GripDots />
    </span>
    <span className="rows-check">
      <span className="rows-check-box">
        <CheckMark />
      </span>
    </span>
    <span className="rows-title">
      <span className="rows-title-text">{row.text}</span>
    </span>
    <span className="rows-mark">
      <MarkerNib />
    </span>
    <span className="rows-del">
      <TrashCan />
    </span>
  </>
);

/** Mount-fade wrapper: renders hidden, flips data-in after two frames so
    the opacity transition has a painted "from" state to leave. */
function FadeIn({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  return (
    <div className={className} data-in={ready || undefined}>
      {children}
    </div>
  );
}

/* Three switchable looks: two organic hands over the same rough-stroke skin,
   and one clean modern UI. The value is written to <html data-variant> so it
   also reaches the title, which lives outside this component. */
type Variant = "organic" | "clean";
const VARIANTS: { value: Variant; label: string }[] = [
  { value: "organic", label: "Organic" },
  { value: "clean", label: "Clean" },
];

/* Heading-font options for the organic title, compared via their own toggle.
   Each preview renders in its own face. */
type Heading = "kalam" | "playpen" | "architects";
const HEADINGS: { value: Heading; label: string; cssVar: string }[] = [
  { value: "kalam", label: "Kalam", cssVar: "--font-head-kalam" },
  { value: "playpen", label: "Playpen", cssVar: "--font-head-playpen" },
  { value: "architects", label: "Architects", cssVar: "--font-head-architects" },
];

export default function RowsStudy() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [entering, setEntering] = useState<ReadonlySet<string>>(new Set());
  /* Rows born through the add input: they draw their rule in. Undo and
     reseed keep the plain enter, because drawing a fresh line is a claim
     about newness and a restored row is not new. */
  const [drawing, setDrawing] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<
    { id: string; draft: string; caret?: number } | null
  >(null);
  /* Single-slot undo: the last destructive action, whichever it was.
     Delete restores the row at its old index; edit restores the text a
     click-to-rename silently overwrote — clicking a row's title selects
     its whole text, so a stray keystroke (including this app's own
     single-letter shortcuts) can wipe a title with no other recovery
     path. Not a stack: only the most recent destructive action is ever
     undoable, matching how the status line has only room to name one. */
  const [undoable, setUndoable] = useState<
    | { kind: "delete"; row: Row; index: number }
    | { kind: "edit"; id: string; text: string }
    | null
  >(null);
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [drawer, setDrawer] = useState<null | "timings" | "keys">(null);
  const [staggering, setStaggering] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState("");
  /* Two skins, switchable at runtime for comparison. The attribute lives on
     <html> so it also reaches the title, which renders outside this tree. */
  const [variant, setVariant] = useState<Variant>("organic");
  const [heading, setHeading] = useState<Heading>("kalam");
  /* Completed rows sink to the bottom (see toggleDone) and can be hidden
     entirely once there. Both are quiet utility behaviour, not signature
     moments, so neither gets a bespoke transition beyond what already
     exists: sinking rides the ordinary FLIP glide, hiding is a plain
     filter. */
  const [hideDone, setHideDone] = useState(false);
  /* A row that was just completed while hideDone is on stays rendered
     for one more beat so its own tick-draw and strike can play, rather
     than vanishing mid-animation the instant it becomes `done`. */
  const [justCompleted, setJustCompleted] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    const stored = localStorage.getItem("gp-lab-variant");
    if (stored === "clean") setVariant("clean");
    const h = localStorage.getItem("gp-lab-heading");
    if (h === "playpen" || h === "architects") setHeading(h);
    const hd = localStorage.getItem("gp-lab-hide-done");
    if (hd === "true") setHideDone(true);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.variant = variant;
    localStorage.setItem("gp-lab-variant", variant);
  }, [variant]);
  useEffect(() => {
    document.documentElement.dataset.heading = heading;
    localStorage.setItem("gp-lab-heading", heading);
  }, [heading]);
  useEffect(() => {
    localStorage.setItem("gp-lab-hide-done", String(hideDone));
  }, [hideDone]);

  const studyRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowEls = useRef(new Map<string, HTMLLIElement>());
  const drawTimers = useRef(new Map<string, number>());
  const staggerTimer = useRef(0);
  const ghostTimers = useRef(new Map<string, number>());
  const justCompletedTimers = useRef(new Map<string, number>());
  const prevTops = useRef<Map<string, number> | null>(null);
  const mutationKind = useRef<"settle" | "reorder">("settle");
  const reduced = useRef(false);
  const drag = useRef<DragState | null>(null);
  /* The WAAPI animation that carries a released row back into its slot.
     Held so it can be cancelled: by grabbing the same row again, or by
     a FLIP glide that needs the inline transform back (a running WAAPI
     animation outranks inline styles, so FLIP cannot simply overwrite
     it). */
  const releaseAnim = useRef<Animation | null>(null);
  /* Guards commit-on-blur after Enter or Escape already closed the edit;
     without it the stale blur handler would commit a cancelled edit. */
  const editClosed = useRef(false);
  const liveFlip = useRef(false);
  /* The timers below need the current params without re-registering on
     every slider drag. */
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /* ---- reduced motion, read in JS as well as CSS ---- */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => {
      reduced.current = mq.matches;
    };
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  /* ---- persistence ----
     Rows are React-owned state and localStorage is only a mirror. The
     one post-hydration setState is the price of a static export, where
     the server render cannot know what the browser has stored. */
  useEffect(() => {
    let initial: Row[] | null = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          initial = parsed
            .filter(
              (r): r is Row =>
                !!r &&
                typeof r === "object" &&
                typeof (r as Row).id === "string" &&
                typeof (r as Row).text === "string" &&
                typeof (r as Row).done === "boolean",
            )
            /* `marked` arrived after rows were already in people's
               storage, so it is read defensively rather than required by
               the filter above — an older row simply comes back
               unmarked instead of being discarded. */
            .map((r) => ({
              id: r.id,
              text: r.text,
              done: r.done,
              marked: r.marked === true,
            }));
        }
      }
    } catch {
      /* corrupt storage reads as a first visit */
    }
    // A stored empty list is respected: the user emptied it on purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(
      initial ??
        SEED.map((text) => ({ id: uid(), text, done: false, marked: false })),
    );

    /* Timings persist too: a tuning you liked should survive a reload.
       Every field is validated individually so a partial or edited blob
       degrades to the defaults rather than injecting NaN into a CSS
       custom property, which would silently break the transitions. */
    try {
      const raw = localStorage.getItem(PARAMS_KEY);
      if (raw) {
        const p: unknown = JSON.parse(raw);
        if (p && typeof p === "object") {
          const src = p as Record<string, unknown>;
          const next: Params = { ...DEFAULTS };
          for (const { key } of SLIDERS) {
            const v = src[key];
            if (typeof v === "number" && Number.isFinite(v) && v >= 20 && v <= 900) {
              next[key] = v;
            }
          }
          /* `speed` is the legacy key. It held the same number under a
             name that claimed the opposite of what it did, so it is read
             for continuity but never written again. */
          const s = src.timeScale ?? src.speed;
          if (typeof s === "number" && Number.isFinite(s) && s >= 0.25 && s <= 3) {
            next.timeScale = s;
          }
          if (typeof src.move === "string" && src.move in MOVE_EASES) {
            next.move = src.move as MoveKey;
          }
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setParams(next);
        }
      }
    } catch {
      /* corrupt params read as defaults */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(rows));
    } catch {
      /* private mode: the app still works, it just forgets */
    }
  }, [rows, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
    } catch {
      /* as above */
    }
  }, [params, loaded]);

  /* ---- announcements ---- */
  const announce = useCallback((msg: string) => {
    // Live regions skip identical repeats; alternate an invisible suffix
    // so "row deleted" announces every time.
    liveFlip.current = !liveFlip.current;
    setLive(liveFlip.current ? msg : `${msg} `);
  }, []);

  /* ---- FLIP, step one: measure before mutating ----
     Called synchronously by every mutating handler, while the DOM still
     has the old layout. */
  const snap = useCallback((kind: "settle" | "reorder" = "settle") => {
    const m = new Map<string, number>();
    document.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      m.set(el.dataset.flip as string, el.getBoundingClientRect().top);
    });
    prevTops.current = m;
    mutationKind.current = kind;
  }, []);

  /* ---- drag helpers ---- */
  const dragY = useCallback((d: DragState) => {
    const list = listRef.current;
    let y = d.lastY - d.startY + d.base;
    if (list) {
      // Clamp so the row cannot be carried out of the list.
      const min = -d.el.offsetTop;
      const max = list.clientHeight - d.el.offsetTop - d.el.offsetHeight;
      y = Math.min(max, Math.max(min, y));
    }
    return y;
  }, []);

  const applyDragTransform = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    d.el.style.transform = reduced.current
      ? `translateY(${dragY(d)}px)`
      : `translateY(${dragY(d)}px) scale(1.01)`;
  }, [dragY]);

  /* ---- FLIP, steps two to four: invert, commit, play ----
     Measuring getBoundingClientRect mid-glide reads the visual position,
     so an interrupted glide retargets smoothly instead of jumping. The
     released transitions are written in terms of the custom properties,
     which is what lets the sliders retime a glide already running. */
  useLayoutEffect(() => {
    const prev = prevTops.current;
    prevTops.current = null;
    if (!prev || prev.size === 0) return;
    const scope = studyRef.current;
    if (!scope) return;
    const kind = mutationKind.current;

    /* A running release animation outranks inline styles, so FLIP could
       not move that row at all while it settled. Cancel it here, after
       snap() has already photographed the row mid-settle: "before" is
       therefore its true visual position and "after" its natural one, so
       the glide picks up exactly where the settle left off rather than
       snapping. */
    releaseAnim.current?.cancel();
    releaseAnim.current = null;

    const moved: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const key = el.dataset.flip as string;
      const before = prev.get(key);
      if (before == null) return;
      const d = drag.current;
      if (d && d.active && key === d.id) {
        // The dragged row follows the pointer, not the layout. Fold the
        // layout jump into its base so it does not visually move when
        // the list reorders underneath it.
        d.base += before - el.getBoundingClientRect().top;
        applyDragTransform();
        return;
      }
      // Reduced motion, or a hidden tab (rAF is suspended there, which
      // would leave rows pinned): take the new place instantly.
      if (reduced.current || document.hidden) return;
      const delta = before - el.getBoundingClientRect().top;
      if (Math.abs(delta) < 0.5) return;
      // Invert: pin to the old position with no transition...
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      moved.push(el);
    });
    if (moved.length === 0) return;

    // ...force one reflow so the pinned frame is committed...
    void scope.offsetHeight;

    // ...then release on the next frame.
    requestAnimationFrame(() => {
      const p = paramsRef.current;
      const [base, move] =
        kind === "reorder"
          ? [p.reorder, "transform var(--d-reorder) var(--ease-move)"]
          : [p.settle, "transform var(--d-settle) var(--ease-move)"];
      for (const el of moved) {
        el.style.transition = `${move}, opacity var(--d-hover) ease`;
        el.style.transform = "";
        clearTransitionAfter(el, base * p.timeScale);
      }
    });
    /* hideDone is a dependency in its own right: it changes visibleRows
       without changing rows itself, and the status line (data-flip
       ="status") still has to glide to its new spot when the list grows
       or shrinks under it. */
  }, [rows, hideDone, applyDragTransform]);

  /* ---- entering rows: two frames at their "from" state, then idle,
     so the transition has a painted start to leave ---- */
  useLayoutEffect(() => {
    if (entering.size === 0) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntering(new Set()));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [entering]);

  const retireGhost = useCallback((id: string) => {
    setGhosts((gs) => gs.filter((g) => g.row.id !== id));
  }, []);

  const endDraw = useCallback((id: string) => {
    setDrawing((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  const endJustCompleted = useCallback((id: string) => {
    setJustCompleted((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  /* ---- ghosts: two-frame flip to their "out" state so the exit has a
     painted start to leave from ---- */
  useLayoutEffect(() => {
    if (!ghosts.some((g) => !g.out)) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() =>
        setGhosts((gs) => gs.map((g) => (g.out ? g : { ...g, out: true }))),
      );
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [ghosts]);

  /* ---- retirement is event-driven (transitionend on the ghost
     itself); these timers are only the safety net, so a hidden tab or a
     swallowed event can never leave a ghost behind ---- */
  useEffect(() => {
    const p = paramsRef.current;
    ghosts.forEach((g) => {
      if (ghostTimers.current.has(g.row.id)) return;
      const base = g.kind === "hide" ? p.hide : p.leave;
      ghostTimers.current.set(
        g.row.id,
        window.setTimeout(() => retireGhost(g.row.id), base * p.timeScale + 500),
      );
    });
    for (const [id, timer] of ghostTimers.current) {
      if (!ghosts.some((g) => g.row.id === id)) {
        clearTimeout(timer);
        ghostTimers.current.delete(id);
      }
    }
  }, [ghosts, retireGhost]);

  /* ---- draw lifecycle: ended by the rule's animationend, with the
     same kind of safety net ---- */
  useEffect(() => {
    const p = paramsRef.current;
    drawing.forEach((id) => {
      if (drawTimers.current.has(id)) return;
      drawTimers.current.set(
        id,
        window.setTimeout(() => endDraw(id), p.draw * p.timeScale + 300),
      );
    });
    for (const [id, timer] of drawTimers.current) {
      if (!drawing.has(id)) {
        clearTimeout(timer);
        drawTimers.current.delete(id);
      }
    }
  }, [drawing, endDraw]);

  /* ---- justCompleted lifecycle: a fixed grace window (the complete
     transition plus a buffer), since there is no DOM event to hang it off
     the way draw/ghost retire off their own animations ---- */
  useEffect(() => {
    const p = paramsRef.current;
    justCompleted.forEach((id) => {
      if (justCompletedTimers.current.has(id)) return;
      justCompletedTimers.current.set(
        id,
        window.setTimeout(
          () => endJustCompleted(id),
          p.complete * p.timeScale + 200,
        ),
      );
    });
    for (const [id, timer] of justCompletedTimers.current) {
      if (!justCompleted.has(id)) {
        clearTimeout(timer);
        justCompletedTimers.current.delete(id);
      }
    }
  }, [justCompleted, endJustCompleted]);

  useEffect(() => {
    const dTimers = drawTimers.current;
    const gTimers = ghostTimers.current;
    const jTimers = justCompletedTimers.current;
    return () => {
      dTimers.forEach((t) => clearTimeout(t));
      gTimers.forEach((t) => clearTimeout(t));
      jTimers.forEach((t) => clearTimeout(t));
      clearTimeout(staggerTimer.current);
    };
  }, []);

  /* ---- mutations ---- */
  const addRow = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      snap();
      const id = uid();
      setRows((r) => [{ id, text: t, done: false, marked: false }, ...r]);
      if (reduced.current) {
        // Reduced motion: the plain enter, opacity-only under the media
        // query. No rule sweep.
        setEntering((s) => new Set(s).add(id));
      } else {
        setDrawing((s) => new Set(s).add(id));
      }
      announce("row added");
    },
    [snap, announce],
  );

  /* Completing a row sinks it to the bottom of the list, below every row
     still open; reopening it surfaces it again just above the done block.
     Neither hunts for "its" original slot — that would need remembering a
     position nothing else in this app tracks — so a reopened row rejoins
     at the top of the open group rather than wherever it started. */
  const toggleDone = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      const nowDone = !row.done;
      snap("reorder");
      setRows((r) => {
        const updated = r.map((x) =>
          x.id === id ? { ...x, done: nowDone } : x,
        );
        const me = updated.find((x) => x.id === id) as Row;
        const rest = updated.filter((x) => x.id !== id);
        if (nowDone) return [...rest, me];
        const at = rest.findIndex((x) => x.done);
        const insertAt = at === -1 ? rest.length : at;
        return [...rest.slice(0, insertAt), me, ...rest.slice(insertAt)];
      });
      if (nowDone && hideDone) {
        setJustCompleted((s) => new Set(s).add(id));
      } else if (!nowDone) {
        setJustCompleted((s) => {
          if (!s.has(id)) return s;
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
      announce(nowDone ? "row completed" : "row reopened");
    },
    [rows, snap, announce, hideDone],
  );

  /* Emphasis. No snap() needed: nothing changes size or position, the
     highlighter just wipes across in place. */
  const toggleMark = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      // Done outranks emphasis: a finished task stops being the thing that
      // matters, so it cannot be highlighted (and its control is hidden).
      if (!row || row.done) return;
      const next = !row.marked;
      setRows((r) => r.map((x) => (x.id === id ? { ...x, marked: next } : x)));
      announce(next ? "row highlighted" : "highlight removed");
    },
    [rows, announce],
  );

  const deleteRow = useCallback(
    (id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index === -1) return;
      const row = rows[index];
      const el = rowEls.current.get(id);
      const list = listRef.current;
      const hadFocus = !!el && el.contains(document.activeElement);
      snap();
      if (el && list) {
        // Pin the ghost at the row's visual position (mid-glide included).
        const rect = el.getBoundingClientRect();
        const top = rect.top - list.getBoundingClientRect().top;
        setGhosts((gs) => [...gs, { row, top, out: false, kind: "delete" }]);
      }
      setRows((r) => r.filter((x) => x.id !== id));
      setUndoable({ kind: "delete", row, index });
      announce("row deleted, press command z to undo");
      // Focus must not die with the row.
      if (hadFocus) {
        const next = rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
        if (next) setFocusId(next);
        requestAnimationFrame(() => {
          if (next) rowEls.current.get(next)?.focus();
          else inputRef.current?.focus();
        });
      }
    },
    [rows, snap, announce],
  );

  const undo = useCallback(() => {
    if (!undoable) return;
    snap();
    if (undoable.kind === "delete") {
      const { row, index } = undoable;
      // If the ghost of this row is still leaving, retire it now: two
      // copies of the same row on screen would be a lie.
      setGhosts((gs) => gs.filter((g) => g.row.id !== row.id));
      setRows((r) => {
        const at = Math.min(index, r.length);
        return [...r.slice(0, at), row, ...r.slice(at)];
      });
      setEntering((s) => new Set(s).add(row.id));
      announce("row restored");
    } else {
      const { id, text } = undoable;
      setRows((r) => r.map((x) => (x.id === id ? { ...x, text } : x)));
      announce("edit undone");
    }
    setUndoable(null);
  }, [undoable, snap, announce]);

  /* ---- hide/reveal done rows ----
     A row hidden by the toggle is not deleted — it should read as an
     accordion closing over it, not as the bin. Hiding ghosts each row at
     its own last position (a plain fade, see "hiding" below) while the
     status line glides up over the FLIP effect below; revealing gives
     the same rows the ordinary row-arrival fade, not the add sweep, since
     nothing new was created. justCompleted rows are already on screen
     (see visibleRows), so neither direction touches them. */
  const toggleHideDone = useCallback(() => {
    const list = listRef.current;
    const listRect = list?.getBoundingClientRect();
    const affected = rows.filter((r) => r.done && !justCompleted.has(r.id));
    const affectedIds = new Set(affected.map((r) => r.id));
    const count = affected.length;
    const noun = `${count} done row${count === 1 ? "" : "s"}`;
    if (!hideDone) {
      const newGhosts: Ghost[] = [];
      if (listRect) {
        for (const row of affected) {
          const el = rowEls.current.get(row.id);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          newGhosts.push({
            row,
            top: rect.top - listRect.top,
            out: false,
            kind: "hide",
          });
        }
      }
      snap();
      setHideDone(true);
      // A stale ghost from a hide/show toggled faster than its own fade
      // is a second copy of a row that is once again live — see undo()
      // for the same guard against the same lie.
      setGhosts((gs) => [
        ...gs.filter((g) => !affectedIds.has(g.row.id)),
        ...newGhosts,
      ]);
      announce(`${noun} hidden`);
    } else {
      snap();
      setHideDone(false);
      setGhosts((gs) => gs.filter((g) => !affectedIds.has(g.row.id)));
      if (count > 0) {
        setEntering((s) => new Set([...s, ...affected.map((r) => r.id)]));
      }
      announce(`${noun} shown`);
    }
  }, [hideDone, rows, justCompleted, snap, announce]);

  const moveRow = useCallback(
    (id: string, dir: -1 | 1) => {
      const i = rows.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= rows.length) return;
      snap("reorder");
      setRows((r) => {
        const next = [...r];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      });
      announce(dir === -1 ? "row moved up" : "row moved down");
    },
    [rows, snap, announce],
  );

  const reseed = useCallback(() => {
    snap();
    const fresh = SEED.map((text) => ({
      id: uid(),
      text,
      done: false,
      marked: false,
    }));
    setRows(fresh);
    setEntering(new Set(fresh.map((r) => r.id)));
    /* Stagger the arrival. Five rows landing on the same frame reads as
       a repaint rather than as a list arriving. This is the one place it
       is worth doing — restoring the samples is rare, and rare is what
       buys an animation the right to be decorative. Rows added one at a
       time are never staggered: there is nothing to stagger against. */
    setStaggering(true);
    window.clearTimeout(staggerTimer.current);
    const p = paramsRef.current;
    staggerTimer.current = window.setTimeout(
      () => setStaggering(false),
      (fresh.length * STAGGER_MS + p.enter) * p.timeScale + 100,
    );
    announce("sample rows restored");
  }, [snap, announce]);

  /* ---- editing ----
     caret is undefined for the keyboard path (Enter has no click point to
     read) and for anything that didn't resolve to real text; the input's
     own onFocus falls back to end-of-text in that case. */
  const startEdit = useCallback(
    (id: string, caret?: number) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      editClosed.current = false;
      setEditing({ id, draft: row.text, caret });
    },
    [rows],
  );

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const t = editing.draft.trim();
    const id = editing.id;
    const prev = rows.find((r) => r.id === id)?.text;
    if (t && prev !== undefined && t !== prev) {
      setRows((r) => r.map((x) => (x.id === id ? { ...x, text: t } : x)));
      setUndoable({ kind: "edit", id, text: prev });
      announce("row renamed, press command z to undo");
    }
    setEditing(null);
    requestAnimationFrame(() => rowEls.current.get(id)?.focus());
  }, [editing, rows, announce]);

  const cancelEdit = useCallback(() => {
    if (!editing) return;
    const id = editing.id;
    setEditing(null);
    announce("edit cancelled");
    requestAnimationFrame(() => rowEls.current.get(id)?.focus());
  }, [editing, announce]);

  /* ---- controls ---- */
  const setParam = useCallback(<K extends keyof Params>(k: K, v: Params[K]) => {
    setParams((p) => ({ ...p, [k]: v }));
  }, []);

  const toggleSlow = useCallback(() => {
    /* The "s" shortcut, kept from the study: stretch time so a flourish
       can be watched, without opening the drawer.

       This used to set 0.25 and announce "slow motion on", which did the
       exact opposite — --t multiplies durations, so 0.25 ran everything
       four times FASTER. 3x rather than 2x because at 2x the short
       springs are still too quick to read. */
    setParams((p) => ({ ...p, timeScale: p.timeScale === 1 ? 3 : 1 }));
    announce(params.timeScale === 1 ? "slow motion on" : "slow motion off");
  }, [params.timeScale, announce]);

  /* ---- app-wide shortcuts ---- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable);
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "z"
      ) {
        if (typing) return; // native undo in the inputs stays native
        if (undoable) {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "s") {
        e.preventDefault();
        toggleSlow();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoable, undo, toggleSlow]);

  /* ---- roving focus + keyboard operation of the list ----
     visibleRows drives both: a row hidden by hideDone must be unreachable
     by arrow navigation, and cannot hold the roving tabIndex, or the list
     loses its only focusable row. */
  const visibleRows = hideDone
    ? rows.filter((r) => !r.done || justCompleted.has(r.id))
    : rows;
  const rovingId = visibleRows.some((r) => r.id === focusId)
    ? focusId
    : (visibleRows[0]?.id ?? null);

  function onListKeyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const li = (e.target as HTMLElement).closest(
      "li[data-row-id]",
    ) as HTMLLIElement | null;
    if (!li) return;
    const id = li.dataset.rowId as string;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir: -1 | 1 = e.key === "ArrowDown" ? 1 : -1;
      if (e.altKey) {
        moveRow(id, dir);
        return;
      }
      const idx = visibleRows.findIndex((r) => r.id === id);
      const next = visibleRows[idx + dir];
      if (next) {
        setFocusId(next.id);
        rowEls.current.get(next.id)?.focus();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      startEdit(id);
    } else if (e.key === " ") {
      e.preventDefault();
      toggleDone(id);
    } else if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      toggleMark(id);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      deleteRow(id);
    }
  }

  /* ---- pointer reorder ---- */
  function onRowPointerDown(e: React.PointerEvent<HTMLLIElement>, id: string) {
    if (e.button !== 0 || editing) return;
    const target = e.target as HTMLElement;
    const fromGrip = !!target.closest("[data-grip]");
    if (!fromGrip) {
      if (target.closest("button, input, a")) return;
      // On touch, the row body must keep scrolling the page; the grip
      // (touch-action: none) is the drag surface there.
      if (e.pointerType !== "mouse") return;
    }
    // Grabbing a row that is still settling takes it over cleanly: the
    // animation is cancelled so the inline transform is authoritative
    // again, and the row is picked up from wherever it currently is.
    releaseAnim.current?.cancel();
    releaseAnim.current = null;
    drag.current = {
      id,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      base: 0,
      active: false,
      didReorder: false,
      el: e.currentTarget,
      samples: [{ t: e.timeStamp, y: e.clientY }],
    };
    // Track the rest of the gesture on window, not on this <li>. Pointer
    // capture can quietly drop mid-drag — a reorder moves this node in the
    // DOM, or a fast flick carries the pointer off the element — and after
    // that a pointerup delivered elsewhere would never reach the row, leaving
    // it stuck lifted. window always sees the release, so the drag always ends.
    window.addEventListener("pointermove", onRowPointerMove);
    window.addEventListener("pointerup", onRowPointerEnd);
    window.addEventListener("pointercancel", onRowPointerEnd);
  }

  function onRowPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    if (d.samples.length > 8) d.samples.shift();
    if (!d.active) {
      // A 3px threshold keeps plain clicks from becoming half-drags.
      if (Math.abs(d.lastY - d.startY) < 3) return;
      d.active = true;
      d.el.setPointerCapture(e.pointerId);
      d.el.style.transition = "none";
      setDraggingId(d.id);
    }
    applyDragTransform();
    maybeReorder();
  }

  /** Decide where the dragged row belongs. offsetTop ignores transforms,
      so rows mid-glide still report their true slot rather than their
      visual position, which is what keeps this from thrashing. */
  function maybeReorder() {
    const d = drag.current;
    if (!d || !d.active) return;
    const centre = d.el.offsetTop + dragY(d) + d.el.offsetHeight / 2;
    let target = 0;
    for (const r of rows) {
      if (r.id === d.id) continue;
      const el = rowEls.current.get(r.id);
      if (el && el.offsetTop + el.offsetHeight / 2 < centre) target += 1;
    }
    const current = rows.findIndex((r) => r.id === d.id);
    if (current === -1 || target === current) return;
    d.didReorder = true;
    snap("reorder");
    // maybeReorder fires many times per drag, so several calls can run
    // against this one stale `rows` closure before React re-renders. Resolve
    // the dragged row by id inside the updater — indexing the fresh array `r`
    // with `current` (an index into the stale snapshot) would splice out the
    // wrong row, dropping the dragged one and duplicating another. Clamp the
    // insertion point for the same reason: `target` is measured against the
    // snapshot, not `r`.
    setRows((r) => {
      const me = r.find((x) => x.id === d.id);
      if (!me) return r;
      const without = r.filter((x) => x.id !== d.id);
      const at = Math.max(0, Math.min(target, without.length));
      return [...without.slice(0, at), me, ...without.slice(at)];
    });
  }

  function onRowPointerEnd(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    window.removeEventListener("pointermove", onRowPointerMove);
    window.removeEventListener("pointerup", onRowPointerEnd);
    window.removeEventListener("pointercancel", onRowPointerEnd);
    drag.current = null;
    if (!d.active) return;
    setDraggingId(null);
    const el = d.el;
    if (reduced.current) {
      el.style.transition = "";
      el.style.transform = "";
      if (d.didReorder) announce("row moved");
      return;
    }

    /* Release velocity, in px/ms, measured over the last stretch of the
       gesture rather than the whole thing. This is the one interaction
       in the app with real input velocity, so it is the one place
       "responds like a physical object" is a true statement rather than
       a decorative one: let go while still moving and the row carries
       past its slot before settling; let go still and it just settles. */
    const s = d.samples;
    let velocity = 0;
    if (s.length >= 2) {
      const last = s[s.length - 1];
      const first =
        s.find((x) => last.t - x.t <= VELOCITY_WINDOW_MS) ?? s[0];
      const dt = last.t - first.t;
      if (dt > 0) velocity = (last.y - first.y) / dt;
    }
    const overshoot = Math.max(
      -MAX_OVERSHOOT_PX,
      Math.min(MAX_OVERSHOOT_PX, velocity * OVERSHOOT_PER_VELOCITY),
    );

    const from = dragY(d);
    releaseAnim.current?.cancel();
    // Hand the visual over to the animation before clearing the inline
    // transform, so there is no frame where the row is untransformed.
    const spring =
      getComputedStyle(el).getPropertyValue("--ease-spring").trim() ||
      "ease-out";
    const anim = el.animate(
      [
        { transform: `translateY(${from}px) scale(1.01)` },
        {
          transform: `translateY(${overshoot}px) scale(1)`,
          offset: 0.45,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
        { transform: "translateY(0px) scale(1)" },
      ],
      { duration: RELEASE_MS, easing: spring, fill: "both" },
    );
    /* --t multiplies durations, so the equivalent time-scale here is its
       reciprocal. Unlike a spring's stiffness, playbackRate scales time
       exactly: what you inspect slowed down is the same motion. */
    anim.playbackRate = 1 / (params.timeScale || 1);
    el.style.transform = "";
    el.style.transition = "";
    releaseAnim.current = anim;
    anim.finished
      .then(() => {
        if (releaseAnim.current === anim) {
          anim.cancel();
          releaseAnim.current = null;
        }
      })
      .catch(() => {
        /* cancelled by a new grab or a FLIP glide; nothing to undo */
      });

    if (d.didReorder) announce("row moved");
  }

  /* ---- render ---- */
  const showEmpty = loaded && rows.length === 0 && ghosts.length === 0;
  /* Distinct from showEmpty: the list is not empty, hideDone is just
     hiding all of it. Saying "nothing left" here would be a lie. */
  const showAllHidden =
    loaded &&
    rows.length > 0 &&
    visibleRows.length === 0 &&
    ghosts.length === 0;

  /* The footer reads as progress, not inventory: how much is off the list,
     not how much is on it. When the last one lands it earns a single quiet
     beat — a drawn check, not confetti. */
  const total = rows.length;
  const doneCount = rows.reduce((n, r) => n + (r.done ? 1 : 0), 0);
  const allDone = total > 0 && doneCount === total;

  /* Both halves of the timing system, handed to CSS as custom
     properties. Everything downstream is calc(--b-x * --t). */
  const vars = {
    "--t": params.timeScale,
    "--b-enter": `${params.enter}ms`,
    "--b-leave": `${params.leave}ms`,
    "--b-settle": `${params.settle}ms`,
    "--b-reorder": `${params.reorder}ms`,
    "--b-draw": `${params.draw}ms`,
    "--b-complete": `${params.complete}ms`,
    "--b-mark": `${params.mark}ms`,
    "--b-hide": `${params.hide}ms`,
    "--ease-move": MOVE_EASES[params.move].value,
  } as React.CSSProperties;

  return (
    <section
      ref={studyRef}
      className="rows-study"
      style={vars}
      aria-label="to-do list"
    >
      <div className="variant-toggle" role="group" aria-label="visual style">
        {VARIANTS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="variant-opt"
            data-active={variant === value ? "true" : undefined}
            aria-pressed={variant === value}
            onClick={() => setVariant(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {variant === "organic" && (
        <div
          className="variant-toggle heading-toggle"
          role="group"
          aria-label="heading font"
        >
          {HEADINGS.map(({ value, label, cssVar }) => (
            <button
              key={value}
              type="button"
              className="variant-opt"
              data-active={heading === value ? "true" : undefined}
              aria-pressed={heading === value}
              style={{ fontFamily: `var(${cssVar})` }}
              onClick={() => setHeading(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <form
        className="rows-add"
        onSubmit={(e) => {
          e.preventDefault();
          addRow(draft);
          setDraft("");
        }}
      >
        {/* A label, not a button: clicking anywhere in it — icon or
            placeholder text — focuses the input natively, no click
            handler needed. Enter submits on its own, since a form with a
            single text field implicitly submits on Enter with no button
            present. */}
        <label className="rows-add-composer">
          <span className="rows-add-icon" aria-hidden="true">
            <PlusMark />
          </span>
          <span className="rows-input-wrap">
            <input
              ref={inputRef}
              className="rows-input"
              type="text"
              value={draft}
              placeholder="Add New Task"
              aria-label="Add new task"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
              }}
            />
            <kbd className="rows-input-kbd" aria-hidden="true">
              n
            </kbd>
          </span>
        </label>
      </form>

      <div className="rows-listbox">
        <ul
          ref={listRef}
          className="rows-list"
          data-drag-active={draggingId ? "true" : undefined}
          onKeyDown={onListKeyDown}
        >
          {visibleRows.map((row, i) => {
            const isDrawing = drawing.has(row.id);
            const state =
              isDrawing || entering.has(row.id)
                ? "entering"
                : row.done
                  ? "done"
                  : "idle";
            const isEditing = editing?.id === row.id;
            return (
              <li
                key={row.id}
                ref={(el) => {
                  if (el) rowEls.current.set(row.id, el);
                  else rowEls.current.delete(row.id);
                }}
                className="rows-row"
                data-row-id={row.id}
                data-flip={row.id}
                data-state={state}
                data-enter={isDrawing ? "draw" : undefined}
                data-marked={row.marked ? "true" : undefined}
                data-dragging={draggingId === row.id ? "true" : undefined}
                data-stagger={staggering ? "true" : undefined}
                /* Read by the stylesheet as the stagger multiplier. It is
                   set on every row, but only consumed while data-stagger
                   is present, so a delay never leaks into a FLIP glide or
                   a hover. */
                style={{ "--row-i": i } as React.CSSProperties}
                tabIndex={row.id === rovingId ? 0 : -1}
                aria-label={`${row.text}${row.marked ? ", highlighted" : ""}${
                  row.done ? ", done" : ""
                }`}
                onFocus={() => setFocusId(row.id)}
                onAnimationEnd={(e) => {
                  // The rule's own sweep ends the draw. The contents
                  // animate too and bubble through here, so the name
                  // check matters.
                  if (e.animationName === "rows-rule-draw") endDraw(row.id);
                }}
                onPointerDown={(e) => onRowPointerDown(e, row.id)}
              >
                <span className="rows-grip" data-grip aria-hidden="true">
                  <GripDots />
                </span>
                <button
                  type="button"
                  className="rows-check"
                  tabIndex={-1}
                  aria-pressed={row.done}
                  aria-label={row.done ? "mark not done" : "mark done"}
                  onClick={() => toggleDone(row.id)}
                >
                  <span className="rows-check-box">
                    <CheckMark />
                  </span>
                </button>
                {isEditing ? (
                  <input
                    className="rows-edit"
                    type="text"
                    value={editing.draft}
                    aria-label="edit row text"
                    autoFocus
                    /* Caret where you clicked, not select-all: this app's
                       single-letter shortcuts (h, space, backspace...)
                       fire on a bare focused row with no modifier key, so
                       select-all-on-edit meant the first keystroke after
                       a click silently replaced the entire title. Landing
                       the caret at the click point instead means a stray
                       shortcut key only inserts a character where you
                       clicked — obviously wrong and trivially fixed, not
                       a silent full wipe. (⌘Z still recovers either way.)
                       The offset was read from the display text at click
                       time, before it swapped for this input — see
                       caretOffsetFromPoint and the button below. Enter
                       (no click point) and anything that missed real text
                       fall back to the end. */
                    onFocus={(e) => {
                      const len = e.currentTarget.value.length;
                      const at =
                        editing.caret === undefined
                          ? len
                          : Math.max(0, Math.min(editing.caret, len));
                      e.currentTarget.setSelectionRange(at, at);
                    }}
                    onChange={(e) =>
                      setEditing((ed) => ed && { ...ed, draft: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        editClosed.current = true;
                        commitEdit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        editClosed.current = true;
                        cancelEdit();
                      }
                    }}
                    onBlur={() => {
                      if (editClosed.current) {
                        editClosed.current = false;
                        return;
                      }
                      commitEdit();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="rows-title"
                    tabIndex={-1}
                    onClick={(e) =>
                      startEdit(
                        row.id,
                        caretOffsetFromPoint(e.clientX, e.clientY) ??
                          undefined,
                      )
                    }
                  >
                    <span className="rows-title-text">{row.text}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="rows-mark"
                  tabIndex={-1}
                  aria-pressed={row.marked}
                  aria-label={
                    row.marked ? "remove highlight" : "highlight row"
                  }
                  onClick={() => toggleMark(row.id)}
                >
                  <MarkerNib />
                </button>
                <button
                  type="button"
                  className="rows-del"
                  tabIndex={-1}
                  aria-label="delete row"
                  onClick={() => deleteRow(row.id)}
                >
                  <TrashCan />
                </button>
              </li>
            );
          })}

          {/* Leaving rows: out of flow immediately (position: absolute,
              pinned to their last box) so siblings close the gap via
              FLIP while the ghost flicks away where it stood. It sits
              below the live rows, which are opaque, so the closing list
              wipes over it cleanly. A hidden (not deleted) row gets the
              plain "hiding" fade instead of the bin convergence — hiding
              isn't destructive, so it shouldn't borrow that metaphor. */}
          {ghosts.map((g) => (
            <li
              key={`ghost-${g.row.id}`}
              className="rows-row"
              data-state={g.kind === "hide" ? "hiding" : "leaving"}
              data-out={g.out ? "true" : undefined}
              data-done={g.row.done ? "true" : undefined}
              /* Without this a highlighted row lost its swipe the instant
                 you deleted it: the ghost is a different element and the
                 highlight is driven off data-marked, so the exit started
                 from a state the row was never in. */
              data-marked={g.row.marked ? "true" : undefined}
              style={{ top: g.top }}
              aria-hidden="true"
              onTransitionEnd={(e) => {
                if (e.propertyName === "opacity" && g.out)
                  retireGhost(g.row.id);
              }}
            >
              <GhostFace row={g.row} />
            </li>
          ))}
        </ul>

        {showEmpty && (
          <FadeIn className="rows-empty">
            <span>
              Nothing left · press <kbd>n</kbd> to add a row, or{" "}
              <button type="button" onClick={reseed}>
                restore the samples
              </button>
            </span>
          </FadeIn>
        )}
        {showAllHidden && (
          <FadeIn className="rows-empty">
            <span>
              All done · {doneCount} hidden ·{" "}
              <button type="button" onClick={toggleHideDone}>
                show done
              </button>
            </span>
          </FadeIn>
        )}
      </div>

      <p
        className="rows-status"
        data-flip="status"
        data-complete={allDone ? "true" : undefined}
      >
        <span className="rows-count">
          {total === 0 ? (
            ""
          ) : allDone ? (
            <>
              <svg
                className="rows-count-check"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 13 C 7 15, 9 18, 10 20 C 13 12, 17 6, 21 3"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              All done
            </>
          ) : (
            `${doneCount} of ${total} done`
          )}
        </span>
        {doneCount > 0 && (
          <button
            type="button"
            className="rows-hide-toggle"
            aria-pressed={hideDone}
            onClick={toggleHideDone}
          >
            {hideDone ? "Show done" : "Hide done"}
          </button>
        )}
        <button
          type="button"
          className="rows-undo"
          aria-hidden={!undoable}
          tabIndex={undoable ? 0 : -1}
          onClick={undo}
        >
          {undoable?.kind === "edit" ? "Undo edit" : "Undo delete"}{" "}
          <kbd>⌘z</kbd>
        </button>
      </p>

      {/* ---- the bottom bar ---- */}
      <div className="bar">
        {drawer === "timings" && (
          <FadeIn className="bar-drawer">
            <div className="ctrls">
              {SLIDERS.map(({ key, label }) => (
                <label className="ctrl" key={key}>
                  <span>{label}</span>
                  <output>{params[key]}ms</output>
                  <input
                    type="range"
                    min={40}
                    max={600}
                    step={10}
                    value={params[key]}
                    onChange={(e) => setParam(key, Number(e.target.value))}
                  />
                </label>
              ))}
              <label className="ctrl">
                <span>Movement curve</span>
                <output aria-hidden="true" />
                <select
                  value={params.move}
                  onChange={(e) => setParam("move", e.target.value as MoveKey)}
                >
                  {(Object.keys(MOVE_EASES) as MoveKey[]).map((k) => (
                    <option key={k} value={k}>
                      {MOVE_EASES[k].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="bar-reset"
              onClick={() => setParams(DEFAULTS)}
            >
              Reset to defaults
            </button>
          </FadeIn>
        )}

        {drawer === "keys" && (
          <FadeIn className="bar-drawer">
            <dl className="keys">
              {KEYS.map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </FadeIn>
        )}

        <div className="bar-strip">
          {/* "time", not "speed". The number multiplies every duration,
              so 0.25× is a quarter of the time (faster) and 3× is triple
              (slower). Labelling that "speed" inverted its meaning, and
              a control in the bottom bar that says the opposite of what
              it does undoes the reason the bar exists. */}
          <label className="bar-speed">
            <span>Time</span>
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={params.timeScale}
              aria-label="time scale: multiplies every duration"
              onChange={(e) => setParam("timeScale", Number(e.target.value))}
            />
            <output>{params.timeScale.toFixed(2)}×</output>
          </label>

          <div className="bar-tabs">
            <button
              type="button"
              className="bar-tab"
              aria-expanded={drawer === "timings"}
              onClick={() => setDrawer((d) => (d === "timings" ? null : "timings"))}
            >
              Timings
            </button>
            <button
              type="button"
              className="bar-tab"
              aria-expanded={drawer === "keys"}
              onClick={() => setDrawer((d) => (d === "keys" ? null : "keys"))}
            >
              Keys
            </button>
          </div>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </section>
  );
}
