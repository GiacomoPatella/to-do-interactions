"use client";

/**
 * /lab/rows · the working specimen (Stage 1) plus the two signature
 * moments (Stage 2): add is a seed that falls and sprouts, delete is a
 * crumple that drops into a transient bin. Exactly two metaphors, by
 * decision: complete, edit, reorder and focus stay plain, because
 * restraint is what makes the two flourishes land.
 *
 * The signature moments use @keyframes where the base study uses
 * transitions. That is deliberate, not a drift: the Stage 1 rule bans
 * keyframes on elements the user can retrigger (they restart instead of
 * retargeting), but a sprout overlay and a crumple ghost are one-shot
 * elements that mount, play once and unmount. A burst of five deletes is
 * five independent ghosts, each with its own animation and its own
 * retirement, so nothing queues and nothing restarts.
 *
 * The list is a pretext; the transitions are the work. Three structural
 * decisions everything else hangs off:
 *
 * 1. No layout-shifting animation, ever. Height is never animated. Every
 *    glide is FLIP: snap() records where everything sits before a mutation,
 *    the browser lays the new list out instantly, and the layout effect
 *    below pins each element to its old position with a transform and
 *    releases it a frame later. Rows, the status line and the readout
 *    entries all participate (anything carrying data-flip), so the whole
 *    study obeys the rule, not just the list.
 *
 * 2. Every duration is a base value times --t. The 0.25x toggle sets
 *    --t: 4 on the study root; slow motion is one custom property, not a
 *    second set of timings. The JS timers below multiply by the same
 *    factor so ghosts retire in step with their CSS.
 *
 * 3. Each row is driven by data-state (idle / entering / leaving / done).
 *    Stage 2 restyles those states; it should not need new hooks.
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

type Row = { id: string; text: string; done: boolean };
/* kind "crumple" is the signature exit; "fade" is the reduced-motion
   fallback, a plain opacity crossfade (the Stage 1 leaving state). */
type Ghost = {
  row: Row;
  top: number;
  height: number;
  kind: "crumple" | "fade";
  out: boolean;
};
type LogEntry = { id: number; text: string; fresh: boolean };

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

/* Base durations and curves, mirrored by the custom properties on
   .rows-study in globals.css. The JS copies exist for the readout lines
   and for the timers that retire finished ghosts. */
const D = { enter: 220, leave: 180, settle: 260, reorder: 200, hover: 150 };
/* The two signature moments. Both under ~400ms at 1x, non-negotiable:
   delight has to survive repetition. */
const D2 = { sprout: 380, crumple: 400 };
const EASE = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  expo: "cubic-bezier(0.16, 1, 0.3, 1)",
  spring: "cubic-bezier(0.22, 1.4, 0.36, 1)",
  inout: "cubic-bezier(0.65, 0, 0.35, 1)",
  gravity: "cubic-bezier(0.4, 0, 0.7, 0.2)",
};

const STORE_KEY = "gp-lab-rows-v1";

/* First-visit seed: each sample row teaches one control. An empty
   specimen teaches nothing. */
const SEED = [
  "drag me somewhere else",
  "complete me with space",
  "rename me: focus, then enter",
  "delete me, then press cmd z",
  "press s, then add a row",
];

let uidCounter = 0;
const uid = () => `r${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

/** Accumulate an element's layout position by walking the offsetParent
    chain. Trap this exists for: a transformed element becomes the
    offsetParent of its descendants, so a single offsetTop read from
    inside a mid-FLIP-glide status line resolves against the wrong box.
    Summing the whole chain stays in layout coordinates (each link's
    offset ignores its own transform), which is the final resting
    geometry the crumple should aim at. */
function layoutOffset(el: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

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

const Cross = () => (
  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
    <path
      d="M1 1l8 8M9 1l-8 8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

/* The sprout overlay: a seed dot that falls out of the input with
   gravity easing and lands with one small bounce, then a stem and a
   single leaf draw via stroke-dashoffset. Spare marks at hairline
   weight, ink and accent only, not an illustration. The whole overlay
   is one 380ms timeline; each piece keys off its own percentages. */
const SproutMark = ({
  onDone,
}: {
  onDone: (e: React.AnimationEvent) => void;
}) => (
  <span className="rows-sprout" aria-hidden="true" onAnimationEnd={onDone}>
    <span className="rows-seed" />
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path className="rows-stem" d="M12 18c.4-3-.5-6 0-9.5" pathLength={1} />
      <path
        className="rows-leaf"
        d="M11.9 12.5c-1.5-.3-2.6-1.3-3-2.9"
        pathLength={1}
      />
    </svg>
  </span>
);

/* The bin: a transient mark at the end of the status line. Its slot is
   always reserved (no layout shift); it only becomes visible while a
   crumple is in flight, and the lid tips as the ball lands. */
const BinIcon = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <path className="rows-bin-lid" d="M5.2 7h9.6M8.6 7V5.9h2.8V7" />
    <path
      className="rows-bin-body"
      d="M6.4 8.6l.75 8.1c.05.5.48.9 1 .9h3.7c.52 0 .95-.4 1-.9l.75-8.1"
    />
  </svg>
);

/* One face of a row, minus behaviour: used by the leaving ghosts (both
   the crumple halves and the reduced-motion fade) so a deleted row
   looks exactly like the row it was. */
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
    <span className="rows-del">
      <Cross />
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
  /* Rows born through the add input: they carry the sprout for 380ms.
     Undo and reseed keep the plain Stage 1 enter, the seed metaphor is
     for new things only. */
  const [sprouting, setSprouting] = useState<ReadonlySet<string>>(new Set());
  /* lidTip > 0 while the bin lid is tipping (a landing just happened);
     binHold keeps the bin visible briefly after the last ghost lands. */
  const [lidTip, setLidTip] = useState(0);
  const [binHold, setBinHold] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(
    null,
  );
  const [undoable, setUndoable] = useState<{ row: Row; index: number } | null>(
    null,
  );
  const [log, setLog] = useState<LogEntry[]>([]);
  const [slow, setSlow] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState("");

  const studyRef = useRef<HTMLElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const binRef = useRef<HTMLSpanElement>(null);
  const rowEls = useRef(new Map<string, HTMLLIElement>());
  const ghostEls = useRef(new Map<string, HTMLLIElement>());
  const sproutTimers = useRef(new Map<string, number>());
  const ghostTimers = useRef(new Map<string, number>());
  const prevTops = useRef<Map<string, number> | null>(null);
  const mutationKind = useRef<"settle" | "reorder">("settle");
  const reduced = useRef(false);
  const drag = useRef<DragState | null>(null);
  /* Guards commit-on-blur after Enter or Escape already closed the edit;
     without it the stale blur handler would commit a cancelled edit. */
  const editClosed = useRef(false);
  const liveFlip = useRef(false);
  const logId = useRef(0);

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
     The rows are React-owned state and localStorage is only a mirror, so
     unlike AccentPicker this is not a useSyncExternalStore case: the one
     post-hydration setState below is the price of a static export, where
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
            .map(({ id, text, done }) => ({ id, text, done }));
        }
      }
    } catch {
      /* corrupt storage reads as a first visit */
    }
    // A stored empty list is respected: the user emptied it on purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(initial ?? SEED.map((text) => ({ id: uid(), text, done: false })));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(rows));
    } catch {
      /* private mode: the study still works, it just forgets */
    }
  }, [rows, loaded]);

  /* ---- announcements and the readout ---- */
  const announce = useCallback((msg: string) => {
    // Live regions skip identical repeats; alternate an invisible suffix
    // so "row deleted" announces every time.
    liveFlip.current = !liveFlip.current;
    setLive(liveFlip.current ? msg : `${msg} `);
  }, []);

  const printRaw = useCallback((text: string) => {
    logId.current += 1;
    setLog((l) => [{ id: logId.current, text, fresh: true }, ...l].slice(0, 5));
  }, []);

  const print = useCallback(
    (action: string, name: string, ms: number, ease: string) => {
      printRaw(
        reduced.current
          ? `${action} · reduced motion · opacity only`
          : `${action} · ${name} · ${ms}ms · ${ease}`,
      );
    },
    [printRaw],
  );

  /* ---- FLIP, step one: measure before mutating ----
     Called synchronously by every mutating handler, while the DOM still
     has the old layout. Scoped to the document, not the study: the page
     opts its own elements in with data-flip (the prose section under
     the study carries one), so nothing below the list snaps when the
     list changes height. That is the answer to the bottom edge: there
     is no bottom edge, everything below glides. */
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
     Keyed on rows and log because both can shift layout. Measuring
     getBoundingClientRect mid-glide reads the visual position, so an
     interrupted glide retargets smoothly instead of jumping. */
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

    // ...then release on the next frame. Opacity rides along so the
    // readout's depth fade is not frozen by the inline transition.
    requestAnimationFrame(() => {
      const t =
        parseFloat(getComputedStyle(scope).getPropertyValue("--t")) || 1;
      const [base, move] =
        kind === "reorder"
          ? [D.reorder, `transform calc(200ms * var(--t)) ${EASE.inout}`]
          : [D.settle, `transform calc(260ms * var(--t)) ${EASE.expo}`];
      for (const el of moved) {
        el.style.transition = `${move}, opacity calc(150ms * var(--t)) ease`;
        el.style.transform = "";
        clearTransitionAfter(el, base * t);
      }
    });
  }, [rows, log, applyDragTransform]);

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

  const endSprout = useCallback((id: string) => {
    setSprouting((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  /* ---- fade ghosts (reduced motion): two-frame flip to their "out"
     state so the opacity crossfade has a painted start. Crumple ghosts
     skip this entirely: their keyframes autoplay on mount. ---- */
  useLayoutEffect(() => {
    if (!ghosts.some((g) => g.kind === "fade" && !g.out)) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() =>
        setGhosts((gs) =>
          gs.map((g) =>
            g.kind === "fade" && !g.out ? { ...g, out: true } : g,
          ),
        ),
      );
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [ghosts]);

  /* ---- aim each fresh crumple at the bin ----
     Post-mutation, pre-paint. layoutOffset() walks each offsetParent
     chain, so the aim is the final resting geometry even while the
     status line (which carries the bin) is mid-FLIP-glide. */
  useLayoutEffect(() => {
    const listbox = listboxRef.current;
    const list = listRef.current;
    const bin = binRef.current;
    if (!listbox || !list || !bin) return;
    ghosts.forEach((g) => {
      if (g.kind !== "crumple") return;
      const el = ghostEls.current.get(g.row.id);
      if (!el || el.dataset.aimed) return;
      el.dataset.aimed = "1";
      const binAt = layoutOffset(bin);
      const listboxAt = layoutOffset(listbox);
      const dx =
        binAt.x + bin.offsetWidth / 2 - (listboxAt.x + list.offsetWidth / 2);
      const dy =
        binAt.y + bin.offsetHeight / 2 - (listboxAt.y + g.top + g.height / 2);
      el.style.setProperty("--fall-x", `${dx}px`);
      el.style.setProperty("--fall-y", `${dy}px`);
    });
  }, [ghosts]);

  /* ---- retirement is event-driven (animationend / transitionend on
     the ghost itself); these timers are only the safety net, so a
     hidden tab or a swallowed event can never leave a ghost behind ---- */
  useEffect(() => {
    const t = slow ? 4 : 1;
    ghosts.forEach((g) => {
      if (ghostTimers.current.has(g.row.id)) return;
      const ms = (g.kind === "crumple" ? D2.crumple : D.leave) * t + 500;
      ghostTimers.current.set(
        g.row.id,
        window.setTimeout(() => retireGhost(g.row.id), ms),
      );
    });
    for (const [id, timer] of ghostTimers.current) {
      if (!ghosts.some((g) => g.row.id === id)) {
        clearTimeout(timer);
        ghostTimers.current.delete(id);
      }
    }
  }, [ghosts, slow, retireGhost]);

  /* ---- sprout lifecycle: ended by the overlay's animationend, with
     the same kind of safety net ---- */
  useEffect(() => {
    const t = slow ? 4 : 1;
    sprouting.forEach((id) => {
      if (sproutTimers.current.has(id)) return;
      sproutTimers.current.set(
        id,
        window.setTimeout(() => endSprout(id), D2.sprout * t + 300),
      );
    });
    for (const [id, timer] of sproutTimers.current) {
      if (!sprouting.has(id)) {
        clearTimeout(timer);
        sproutTimers.current.delete(id);
      }
    }
  }, [sprouting, slow, endSprout]);

  useEffect(() => {
    const sTimers = sproutTimers.current;
    const gTimers = ghostTimers.current;
    return () => {
      sTimers.forEach((t) => clearTimeout(t));
      gTimers.forEach((t) => clearTimeout(t));
    };
  }, []);

  /* ---- the bin: visible while a crumple is in flight, held briefly
     after a landing (binHold is set by the landing event itself), lid
     tipping while lidTip > 0 ---- */
  const crumpleCount = ghosts.filter((g) => g.kind === "crumple").length;
  useEffect(() => {
    if (crumpleCount > 0 || !binHold) return;
    const timer = setTimeout(() => setBinHold(false), 350);
    return () => clearTimeout(timer);
  }, [crumpleCount, binHold]);

  useEffect(() => {
    if (!lidTip) return;
    const timer = setTimeout(() => setLidTip(0), 160 * (slow ? 4 : 1) + 80);
    return () => clearTimeout(timer);
  }, [lidTip, slow]);

  /* A crumple has landed: retire the ghost, tip the lid, keep the bin
     up for a beat. Each ghost reports its own landing, so bursts stay
     independent. */
  const onCrumpleLand = useCallback(
    (id: string) => {
      setLidTip((n) => n + 1);
      setBinHold(true);
      retireGhost(id);
    },
    [retireGhost],
  );

  /* ---- fresh readout entries settle the same way ---- */
  useLayoutEffect(() => {
    if (!log.some((e) => e.fresh)) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() =>
        setLog((l) => l.map((e) => (e.fresh ? { ...e, fresh: false } : e))),
      );
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [log]);

  /* ---- mutations ---- */
  const addRow = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      snap();
      const id = uid();
      setRows((r) => [{ id, text: t, done: false }, ...r]);
      if (reduced.current) {
        // Reduced motion: the plain Stage 1 enter, which is opacity-only
        // under the media query. No seed, no fall.
        setEntering((s) => new Set(s).add(id));
      } else {
        setSprouting((s) => new Set(s).add(id));
      }
      print("add", "sprout", D2.sprout, EASE.spring);
      announce("row added");
    },
    [snap, print, announce],
  );

  const toggleDone = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      const nowDone = !row.done;
      snap(); // rows stay put, but the readout entries shift down
      setRows((r) => r.map((x) => (x.id === id ? { ...x, done: nowDone } : x)));
      if (nowDone) {
        print("complete", "check", D.enter, EASE.out);
        announce("row completed");
      } else {
        print("reopen", "uncheck", 120, EASE.out);
        announce("row reopened");
      }
    },
    [rows, snap, print, announce],
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
        const kind = reduced.current ? "fade" : "crumple";
        setGhosts((gs) => [
          ...gs,
          { row, top, height: rect.height, kind, out: false },
        ]);
      }
      setRows((r) => r.filter((x) => x.id !== id));
      setUndoable({ row, index });
      print("delete", "crumple", D2.crumple, EASE.gravity);
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
    [rows, snap, print, announce],
  );

  const undo = useCallback(() => {
    if (!undoable) return;
    const { row, index } = undoable;
    snap();
    // If the ghost of this row is still fading, retire it now: two copies
    // of the same row on screen would be a lie.
    setGhosts((gs) => gs.filter((g) => g.row.id !== row.id));
    setRows((r) => {
      const at = Math.min(index, r.length);
      return [...r.slice(0, at), row, ...r.slice(at)];
    });
    setEntering((s) => new Set(s).add(row.id));
    setUndoable(null);
    print("undo", "return", D.enter, EASE.spring);
    announce("row restored");
  }, [undoable, snap, print, announce]);

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
      print("reorder", "shift", D.reorder, EASE.inout);
      announce(dir === -1 ? "row moved up" : "row moved down");
    },
    [rows, snap, print, announce],
  );

  const reseed = useCallback(() => {
    snap();
    const fresh = SEED.map((text) => ({ id: uid(), text, done: false }));
    setRows(fresh);
    setEntering(new Set(fresh.map((r) => r.id)));
    print("reseed", "enter", D.enter, EASE.spring);
    announce("sample rows restored");
  }, [snap, print, announce]);

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

  /* ---- slow motion ---- */
  const toggleSlow = useCallback(() => {
    const next = !slow;
    snap(); // the readout shifts; it glides like everything else
    setSlow(next);
    printRaw(next ? "speed · 0.25x · every duration × 4" : "speed · 1x");
    announce(next ? "slow motion on" : "slow motion off");
  }, [slow, snap, printRaw, announce]);

  /* ---- study-wide shortcuts ---- */
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
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      deleteRow(id);
    }
  }

  /* ---- pointer reorder ---- */
  function onRowPointerDown(
    e: React.PointerEvent<HTMLLIElement>,
    id: string,
  ) {
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
      el.style.transition = `transform calc(200ms * var(--t)) ${EASE.inout}`;
      el.style.transform = "";
      clearTransitionAfter(el, D.reorder * (slow ? 4 : 1));
    }
    if (d.didReorder) {
      print("reorder", "shift", D.reorder, EASE.inout);
      announce("row moved");
    }
  }

  /* ---- render ---- */
  const showEmpty = loaded && rows.length === 0 && ghosts.length === 0;

  return (
    <section
      ref={studyRef}
      className="rows-study"
      data-slow={slow ? "true" : undefined}
      aria-label="interaction study: the list"
    >
      <div className="rows-bench">
        <div className="rows-specimen">
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

          <div className="rows-listbox" ref={listboxRef}>
            <ul
              ref={listRef}
              className="rows-list"
              data-drag-active={draggingId ? "true" : undefined}
              onKeyDown={onListKeyDown}
            >
              {rows.map((row) => {
                const isSprouting = sprouting.has(row.id);
                const state =
                  isSprouting || entering.has(row.id)
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
                    data-enter={isSprouting ? "sprout" : undefined}
                    data-dragging={draggingId === row.id ? "true" : undefined}
                    tabIndex={row.id === rovingId ? 0 : -1}
                    aria-label={`${row.text}${row.done ? ", done" : ""}`}
                    onFocus={() => setFocusId(row.id)}
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
                          setEditing(
                            (ed) => ed && { ...ed, draft: e.target.value },
                          )
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
                      className="rows-del"
                      tabIndex={-1}
                      aria-label="delete row"
                      onClick={() => deleteRow(row.id)}
                    >
                      <Cross />
                    </button>
                    {isSprouting && (
                      <SproutMark
                        onDone={(e) => {
                          // Only the overlay's own life animation ends
                          // the sprout; the seed and stem end earlier
                          // and bubble through here too.
                          if (e.animationName === "rows-sprout-life")
                            endSprout(row.id);
                        }}
                      />
                    )}
                  </li>
                );
              })}

              {/* Leaving rows: out of flow immediately (position: absolute,
                  pinned to their last box) so siblings close the gap via
                  FLIP while the ghost plays out where it stood. A crumple
                  ghost is two clipped copies of the row face folding
                  toward each other in 3D, then the folded ball falls to
                  the bin; a fade ghost (reduced motion) is the plain
                  Stage 1 opacity crossfade. */}
              {ghosts.map((g) =>
                g.kind === "crumple" ? (
                  <li
                    key={`ghost-${g.row.id}`}
                    ref={(el) => {
                      if (el) ghostEls.current.set(g.row.id, el);
                      else ghostEls.current.delete(g.row.id);
                    }}
                    className="rows-ghost"
                    data-state="leaving"
                    data-kind="crumple"
                    style={{ top: g.top, height: g.height }}
                    aria-hidden="true"
                    onAnimationEnd={(e) => {
                      if (e.animationName === "rows-crumple")
                        onCrumpleLand(g.row.id);
                    }}
                  >
                    <span className="rows-fold">
                      <span className="rows-fold-half" data-half="l">
                        <span
                          className="rows-row rows-fold-face"
                          data-done={g.row.done ? "true" : undefined}
                        >
                          <GhostFace row={g.row} />
                        </span>
                      </span>
                      <span className="rows-fold-half" data-half="r">
                        <span
                          className="rows-row rows-fold-face"
                          data-done={g.row.done ? "true" : undefined}
                        >
                          <GhostFace row={g.row} />
                        </span>
                      </span>
                    </span>
                  </li>
                ) : (
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
                ),
              )}
            </ul>

            {showEmpty && (
              <FadeIn className="rows-empty">
                <span>
                  empty specimen · press <kbd>n</kbd> to add a row, or{" "}
                  <button type="button" onClick={reseed}>
                    restore the samples
                  </button>
                </span>
              </FadeIn>
            )}
          </div>

          <p className="rows-status" data-flip="status">
            <span>
              {rows.length} {rows.length === 1 ? "row" : "rows"} · saved to
              localStorage
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
            {/* The bin's slot is always reserved so its arrival never
                shifts layout; it is only visible mid-delete. */}
            <span
              ref={binRef}
              className="rows-bin"
              data-shown={crumpleCount > 0 || binHold ? "true" : undefined}
              data-lid={lidTip ? "true" : undefined}
              aria-hidden="true"
            >
              <BinIcon />
            </span>
          </p>
        </div>

        <aside className="rows-readout" aria-label="motion readout">
          <div className="rows-readout-head">
            <span className="mono-label">readout</span>
            <button
              type="button"
              className="rows-slow"
              aria-pressed={slow}
              onClick={toggleSlow}
            >
              0.25× <kbd aria-hidden="true">s</kbd>
            </button>
          </div>
          <div className="rows-log-wrap">
            {log.length === 0 ? (
              <p className="rows-log-empty">
                waiting for a mutation: every transition that plays is named
                here, with its duration and curve
              </p>
            ) : (
              <ol className="rows-log">
                {log.map((e) => (
                  <li
                    key={e.id}
                    data-flip={`log-${e.id}`}
                    data-fresh={e.fresh ? "true" : undefined}
                  >
                    {e.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="rows-keys">
            <span className="mono-label">keys</span>
            <dl>
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
        </aside>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </section>
  );
}
