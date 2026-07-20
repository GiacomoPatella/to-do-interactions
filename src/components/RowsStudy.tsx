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
type Ghost = { row: Row; top: number; out: boolean };

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
};

/* The movement curve offered by the select. Only curves that make sense
   for something travelling between two layout positions: no ease-in,
   because a row arriving at speed reads like a mistake. */
const MOVE_EASES = {
  swap: {
    label: "overshoot",
    value: "cubic-bezier(0.2, 1.15, 0.35, 1)",
  },
  expo: { label: "expo out", value: "cubic-bezier(0.16, 1, 0.3, 1)" },
  soft: { label: "soft out", value: "cubic-bezier(0.22, 1, 0.36, 1)" },
  inout: { label: "in-out", value: "cubic-bezier(0.65, 0, 0.35, 1)" },
  linear: { label: "linear", value: "linear" },
} as const;

type MoveKey = keyof typeof MOVE_EASES;

type Params = {
  speed: number;
  draw: number;
  complete: number;
  mark: number;
  leave: number;
  reorder: number;
  settle: number;
  enter: number;
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
  speed: 1,
  draw: 210, // signature: the rule sweeping in. Left long.
  complete: 120, // the most repeated action in the app. Crisp.
  mark: 140,
  leave: 130, // deletes come in bursts; must not accumulate.
  reorder: 130, // fires repeatedly mid-drag, has to keep up with the pointer.
  settle: 170,
  enter: 130,
  move: "swap",
};

type DurationKey = Exclude<keyof Params, "speed" | "move">;

const SLIDERS: { key: DurationKey; label: string }[] = [
  { key: "draw", label: "add" },
  { key: "complete", label: "complete" },
  { key: "mark", label: "highlight" },
  { key: "leave", label: "delete" },
  { key: "reorder", label: "reorder" },
  { key: "settle", label: "settle" },
  { key: "enter", label: "enter" },
];

const STORE_KEY = "gp-lab-rows-v1";
const PARAMS_KEY = "gp-lab-rows-params-v1";

/* First-visit seed: each sample row teaches one control. An empty list
   teaches nothing. */
const SEED = [
  "drag me somewhere else",
  "complete me with space",
  "rename me: focus, then enter",
  "delete me, then press cmd z",
  "press s for slow motion",
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

const KEYS: [string, string][] = [
  ["n", "new row"],
  ["↑ ↓", "move focus"],
  ["⏎", "edit row"],
  ["esc", "cancel edit"],
  ["space", "complete"],
  ["h", "highlight"],
  ["⌥ ↑↓", "reorder"],
  ["⌫", "delete"],
  ["⌘z", "undo delete"],
  ["s", "slow motion"],
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
   both states makes you click it to find out which one you are in. */
const MarkerNib = ({ on }: { on: boolean }) => (
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
        d="M6 8.2h4l-.7 3.2a1 1 0 0 1-1 .8h-.6a1 1 0 0 1-1-.8Z"
        fill={on ? "var(--hilite)" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </g>
    {on && (
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
    )}
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
      <MarkerNib on={row.marked} />
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

export default function RowsStudy() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [entering, setEntering] = useState<ReadonlySet<string>>(new Set());
  /* Rows born through the add input: they draw their rule in. Undo and
     reseed keep the plain enter, because drawing a fresh line is a claim
     about newness and a restored row is not new. */
  const [drawing, setDrawing] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(
    null,
  );
  const [undoable, setUndoable] = useState<{ row: Row; index: number } | null>(
    null,
  );
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [drawer, setDrawer] = useState<null | "timings" | "keys">(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState("");

  const studyRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowEls = useRef(new Map<string, HTMLLIElement>());
  const drawTimers = useRef(new Map<string, number>());
  const ghostTimers = useRef(new Map<string, number>());
  const prevTops = useRef<Map<string, number> | null>(null);
  const mutationKind = useRef<"settle" | "reorder">("settle");
  const reduced = useRef(false);
  const drag = useRef<DragState | null>(null);
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
          const s = src.speed;
          if (typeof s === "number" && Number.isFinite(s) && s >= 0.25 && s <= 3) {
            next.speed = s;
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
        clearTransitionAfter(el, base * p.speed);
      }
    });
  }, [rows, applyDragTransform]);

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
      ghostTimers.current.set(
        g.row.id,
        window.setTimeout(
          () => retireGhost(g.row.id),
          p.leave * p.speed + 500,
        ),
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
        window.setTimeout(() => endDraw(id), p.draw * p.speed + 300),
      );
    });
    for (const [id, timer] of drawTimers.current) {
      if (!drawing.has(id)) {
        clearTimeout(timer);
        drawTimers.current.delete(id);
      }
    }
  }, [drawing, endDraw]);

  useEffect(() => {
    const dTimers = drawTimers.current;
    const gTimers = ghostTimers.current;
    return () => {
      dTimers.forEach((t) => clearTimeout(t));
      gTimers.forEach((t) => clearTimeout(t));
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

  const toggleDone = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      const nowDone = !row.done;
      setRows((r) => r.map((x) => (x.id === id ? { ...x, done: nowDone } : x)));
      announce(nowDone ? "row completed" : "row reopened");
    },
    [rows, announce],
  );

  /* Emphasis. No snap() needed: nothing changes size or position, the
     highlighter just wipes across in place. */
  const toggleMark = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
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
        setGhosts((gs) => [...gs, { row, top, out: false }]);
      }
      setRows((r) => r.filter((x) => x.id !== id));
      setUndoable({ row, index });
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
    const { row, index } = undoable;
    snap();
    // If the ghost of this row is still leaving, retire it now: two
    // copies of the same row on screen would be a lie.
    setGhosts((gs) => gs.filter((g) => g.row.id !== row.id));
    setRows((r) => {
      const at = Math.min(index, r.length);
      return [...r.slice(0, at), row, ...r.slice(at)];
    });
    setEntering((s) => new Set(s).add(row.id));
    setUndoable(null);
    announce("row restored");
  }, [undoable, snap, announce]);

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
    announce("sample rows restored");
  }, [snap, announce]);

  /* ---- editing ---- */
  const startEdit = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      editClosed.current = false;
      setEditing({ id, draft: row.text });
    },
    [rows],
  );

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const t = editing.draft.trim();
    const id = editing.id;
    if (t && t !== rows.find((r) => r.id === id)?.text) {
      setRows((r) => r.map((x) => (x.id === id ? { ...x, text: t } : x)));
      announce("row renamed");
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
    // The "s" shortcut, kept from the study: flip between full speed and
    // quarter speed without opening the drawer.
    setParams((p) => ({ ...p, speed: p.speed === 1 ? 0.25 : 1 }));
    announce(params.speed === 1 ? "slow motion on" : "slow motion off");
  }, [params.speed, announce]);

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

  /* ---- roving focus + keyboard operation of the list ---- */
  const rovingId = rows.some((r) => r.id === focusId)
    ? focusId
    : (rows[0]?.id ?? null);

  function onListKeyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const li = (e.target as HTMLElement).closest(
      "li[data-row-id]",
    ) as HTMLLIElement | null;
    if (!li) return;
    const id = li.dataset.rowId as string;
    const idx = rows.findIndex((r) => r.id === id);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir: -1 | 1 = e.key === "ArrowDown" ? 1 : -1;
      if (e.altKey) {
        moveRow(id, dir);
        return;
      }
      const next = rows[idx + dir];
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
    drag.current = {
      id,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      base: 0,
      active: false,
      didReorder: false,
      el: e.currentTarget,
    };
  }

  function onRowPointerMove(e: React.PointerEvent<HTMLLIElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
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
    setRows((r) => {
      const me = r[current];
      const without = r.filter((x) => x.id !== d.id);
      return [...without.slice(0, target), me, ...without.slice(target)];
    });
  }

  function onRowPointerEnd(e: React.PointerEvent<HTMLLIElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    setDraggingId(null);
    const el = d.el;
    if (reduced.current) {
      el.style.transition = "";
      el.style.transform = "";
    } else {
      // Release into the slot: the transition retargets from wherever
      // the row currently is.
      el.style.transition = "transform var(--d-reorder) var(--ease-move)";
      el.style.transform = "";
      clearTransitionAfter(el, params.reorder * params.speed);
    }
    if (d.didReorder) announce("row moved");
  }

  /* ---- render ---- */
  const showEmpty = loaded && rows.length === 0 && ghosts.length === 0;

  /* Both halves of the timing system, handed to CSS as custom
     properties. Everything downstream is calc(--b-x * --t). */
  const vars = {
    "--t": params.speed,
    "--b-enter": `${params.enter}ms`,
    "--b-leave": `${params.leave}ms`,
    "--b-settle": `${params.settle}ms`,
    "--b-reorder": `${params.reorder}ms`,
    "--b-draw": `${params.draw}ms`,
    "--b-complete": `${params.complete}ms`,
    "--b-mark": `${params.mark}ms`,
    "--ease-move": MOVE_EASES[params.move].value,
  } as React.CSSProperties;

  return (
    <section
      ref={studyRef}
      className="rows-study"
      style={vars}
      aria-label="to-do list"
    >
      <form
        className="rows-add"
        onSubmit={(e) => {
          e.preventDefault();
          addRow(draft);
          setDraft("");
        }}
      >
        <span className="rows-input-wrap">
          <input
            ref={inputRef}
            className="rows-input"
            type="text"
            value={draft}
            placeholder="new row"
            aria-label="new row"
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
        <button type="submit" className="rows-add-btn">
          add
        </button>
      </form>

      <div className="rows-listbox">
        <ul
          ref={listRef}
          className="rows-list"
          data-drag-active={draggingId ? "true" : undefined}
          onKeyDown={onListKeyDown}
        >
          {rows.map((row) => {
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
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerEnd}
                onPointerCancel={onRowPointerEnd}
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
                    onFocus={(e) => e.currentTarget.select()}
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
                    onClick={() => startEdit(row.id)}
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
                  <MarkerNib on={row.marked} />
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
              wipes over it cleanly. */}
          {ghosts.map((g) => (
            <li
              key={`ghost-${g.row.id}`}
              className="rows-row"
              data-state="leaving"
              data-out={g.out ? "true" : undefined}
              data-done={g.row.done ? "true" : undefined}
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
              nothing left · press <kbd>n</kbd> to add a row, or{" "}
              <button type="button" onClick={reseed}>
                restore the samples
              </button>
            </span>
          </FadeIn>
        )}
      </div>

      <p className="rows-status" data-flip="status">
        <span>
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
        <button
          type="button"
          className="rows-undo"
          aria-hidden={!undoable}
          tabIndex={undoable ? 0 : -1}
          onClick={undo}
        >
          undo delete <kbd>⌘z</kbd>
        </button>
      </p>

      {/* ---- the bottom bar ---- */}
      <div className="bar">
        {drawer === "timings" && (
          <div className="bar-drawer">
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
                <span>movement curve</span>
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
              reset to defaults
            </button>
          </div>
        )}

        {drawer === "keys" && (
          <div className="bar-drawer">
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
          </div>
        )}

        <div className="bar-strip">
          <label className="bar-speed">
            <span>speed</span>
            <input
              type="range"
              min={0.25}
              max={2}
              step={0.05}
              value={params.speed}
              aria-label="playback speed"
              onChange={(e) => setParam("speed", Number(e.target.value))}
            />
            <output>{params.speed.toFixed(2)}×</output>
          </label>

          <div className="bar-tabs">
            <button
              type="button"
              className="bar-tab"
              aria-expanded={drawer === "timings"}
              onClick={() => setDrawer((d) => (d === "timings" ? null : "timings"))}
            >
              timings
            </button>
            <button
              type="button"
              className="bar-tab"
              aria-expanded={drawer === "keys"}
              onClick={() => setDrawer((d) => (d === "keys" ? null : "keys"))}
            >
              keys
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
