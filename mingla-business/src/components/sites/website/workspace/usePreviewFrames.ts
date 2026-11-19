import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  EMPTY_SWAP,
  parsePreviewMessage,
  PREVIEW_MARKS,
  PREVIEW_MODE,
  PREVIEW_READY,
  PREVIEW_RECTS,
  PREVIEW_RESTORE_SCROLL,
  PREVIEW_SCROLL_TO,
  PREVIEW_SELECT,
  SWAP_FALLBACK_MS,
  swapReducer,
  type FrameRect,
  type FrameSection,
  type PreviewMarks,
  type PreviewOutbound,
  type SwapState,
} from "../../../../sites/previewBridge";
import { PREVIEW_TOKENS_MESSAGE } from "../../../../sites/previewFrame";

/*
 * #4453 — what both preview renderers (iframe on web, WebView on native)
 * share: the two-frame swap, what the visible frame has told us about its
 * sections, and keeping the frame in step with the workspace (edit mode,
 * marks, unsaved colours). The renderer only supplies `send`.
 */
export type FrameMessage = PreviewOutbound | { type: typeof PREVIEW_TOKENS_MESSAGE; declarations: string[] };
export type PreviewGeometry = { sections: FrameSection[]; scrollY: number };
export type PreviewCommands = { post: (message: PreviewOutbound) => void };

const AFTER_LOAD_MS = 1_200;
const TOKENS_DEBOUNCE_MS = 150;
/** A frame that has loaded but not spoken is spoken to again this often (see `onLoaded`). */
const NUDGE_MS = 500;
/** A page that has loaded and said nothing for this long is treated as one with no sections to pick. */
const SILENT_AFTER_MS = 4_000;
/** The plain line shown over the page when its sections cannot be picked there. */
export const NO_PICK_LINE = "Sections can’t be picked on the page right now. Choose Edit to change them from the list.";
/** How long a "show this section" waits for the page that holds it to load. */
const WANTED_SCROLL_MS = 15_000;

export function usePreviewFrames(options: {
  url: string | null;
  /** The page `url` shows (the workspace's page id): another page starts at its top, the same page keeps its scroll. */
  pageKey?: string | null;
  editMode: boolean;
  marks: PreviewMarks;
  tokenDeclarations: readonly string[] | null;
  send: (key: number, message: FrameMessage) => void;
  onSelect: (sectionId: string, rect: FrameRect) => void;
  onReady?: (pagePath: string) => void;
}): {
  swap: SwapState;
  geometry: PreviewGeometry;
  /** The visible frame's bridge has spoken (sections can be clicked). */
  bridged: boolean;
  /**
   * The page is on screen but has no section to pick: its bridge listed none
   * (an older preview build with no section list, a page that draws no
   * sections), or it has loaded and stayed silent. The Edit list still works.
   */
  noPick: boolean;
  onMessage: (key: number, raw: unknown) => void;
  onLoaded: (key: number) => void;
  commands: PreviewCommands;
} {
  const [swap, dispatch] = useReducer(swapReducer, EMPTY_SWAP);
  const [geometry, setGeometry] = useState<PreviewGeometry>({ sections: [], scrollY: 0 });
  const [bridged, setBridged] = useState(false);
  /** The visible frame loaded a while ago and its bridge never spoke. */
  const [silent, setSilent] = useState(false);
  const silentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const swapRef = useRef(swap);
  swapRef.current = swap;
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nudges = useRef(new Map<number, ReturnType<typeof setInterval>>());
  /** Frames whose bridge has said `ready`, with the sections each one listed. */
  const readyFrames = useRef(new Map<number, readonly FrameSection[]>());
  /** The scroll a rebuilt frame takes over, sent once its bridge is listening. */
  const pendingRestore = useRef<{ key: number; scrollY: number } | null>(null);
  /** A section the workspace asked to show while its page was not on screen yet. */
  const wanted = useRef<{ id: string; at: number } | null>(null);

  const pageKey = options.pageKey ?? null;
  useEffect(() => {
    dispatch({ type: "url", url: options.url, page: pageKey });
    // The page is part of the address, so a new page always arrives with a new url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.url]);

  const stopNudging = useCallback((key: number) => {
    const nudge = nudges.current.get(key);
    if (nudge) clearInterval(nudge);
    nudges.current.delete(key);
  }, []);

  /**
   * The visible frame is listening: put it where the owner should be. A
   * section the workspace asked for wins; otherwise a rebuilt page goes back
   * to the scroll it replaced. A frame that swapped in on a timer gets this
   * when its `ready` finally arrives, not before (a page that is not
   * listening yet would drop it).
   */
  const settle = useCallback((key: number) => {
    const sections = readyFrames.current.get(key);
    if (!sections) return;
    const want = wanted.current;
    if (want && Date.now() - want.at > WANTED_SCROLL_MS) wanted.current = null;
    else if (want && sections.some((section) => section.id === want.id)) {
      wanted.current = null;
      if (pendingRestore.current?.key === key) pendingRestore.current = null;
      latest.current.send(key, { type: PREVIEW_SCROLL_TO, section_id: want.id });
      return;
    }
    const restore = pendingRestore.current;
    if (restore?.key !== key) return;
    pendingRestore.current = null;
    if (restore.scrollY > 0) latest.current.send(key, { type: PREVIEW_RESTORE_SCROLL, scroll_y: restore.scrollY });
  }, []);

  const sync = useCallback((key: number) => {
    const current = latest.current;
    current.send(key, { type: PREVIEW_MODE, edit: current.editMode });
    current.send(key, { type: PREVIEW_MARKS, ...current.marks });
    if (current.tokenDeclarations) current.send(key, { type: PREVIEW_TOKENS_MESSAGE, declarations: [...current.tokenDeclarations] });
  }, []);

  // A frame that never speaks (an older preview build) still swaps in.
  const loadingKey = swap.loading?.key ?? null;
  useEffect(() => {
    if (loadingKey === null) return undefined;
    const timer = setTimeout(() => dispatch({ type: "timeout", key: loadingKey }), SWAP_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [loadingKey]);
  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    nudges.current.forEach((nudge) => clearInterval(nudge));
    nudges.current.clear();
    if (silentTimer.current) clearTimeout(silentTimer.current);
  }, []);

  // The new frame took over: give it the state, then the place it replaces.
  const shownKey = swap.shown?.key ?? null;
  const previousShown = useRef<number | null>(null);
  useEffect(() => {
    // Forget frames that are gone.
    for (const key of [...readyFrames.current.keys()]) {
      if (key !== shownKey && key !== loadingKey) readyFrames.current.delete(key);
    }
    for (const key of [...nudges.current.keys()]) {
      if (key !== shownKey && key !== loadingKey) stopNudging(key);
    }
    if (shownKey === null) {
      previousShown.current = null;
      pendingRestore.current = null;
      setBridged(false);
      setGeometry({ sections: [], scrollY: 0 });
      return;
    }
    const replaced = previousShown.current !== null && previousShown.current !== shownKey;
    previousShown.current = shownKey;
    if (silentTimer.current) clearTimeout(silentTimer.current);
    silentTimer.current = null;
    setSilent(false);
    if (replaced) {
      // The reducer already set this to 0 when the new frame shows another page.
      pendingRestore.current = { key: shownKey, scrollY: swapRef.current.scrollY };
      const known = readyFrames.current.get(shownKey);
      setBridged(known !== undefined);
      // Until the frame says otherwise it sits at its own top.
      if (known === undefined) setGeometry({ sections: [], scrollY: 0 });
    }
    sync(shownKey);
    settle(shownKey);
  }, [loadingKey, settle, shownKey, stopNudging, sync]);

  const marksKey = useMemo(() => JSON.stringify(options.marks), [options.marks]);
  useEffect(() => {
    if (shownKey === null) return;
    latest.current.send(shownKey, { type: PREVIEW_MODE, edit: latest.current.editMode });
    latest.current.send(shownKey, { type: PREVIEW_MARKS, ...latest.current.marks });
  }, [marksKey, options.editMode, shownKey]);

  // Each tokens message replaces the last; an empty one clears unsaved colours.
  const hadTokens = useRef(false);
  useEffect(() => {
    if (shownKey === null) return undefined;
    if (!options.tokenDeclarations) {
      if (hadTokens.current) latest.current.send(shownKey, { type: PREVIEW_TOKENS_MESSAGE, declarations: [] });
      hadTokens.current = false;
      return undefined;
    }
    hadTokens.current = true;
    const timer = setTimeout(() => {
      const declarations = latest.current.tokenDeclarations;
      if (declarations) latest.current.send(shownKey, { type: PREVIEW_TOKENS_MESSAGE, declarations: [...declarations] });
    }, TOKENS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [options.tokenDeclarations, shownKey]);

  const onMessage = useCallback((key: number, raw: unknown) => {
    const message = parsePreviewMessage(raw);
    if (!message) return;
    const state = swapRef.current;
    const fromShown = state.shown?.key === key;
    const fromLoading = state.loading?.key === key;
    if (!fromShown && !fromLoading) return;
    if (message.type === PREVIEW_READY) {
      readyFrames.current.set(key, message.sections);
      stopNudging(key);
      if (fromShown) setSilent(false);
      // Where the frame says it IS: a restored scroll is reported by the
      // frame itself (`rects`) once it has moved, never assumed here.
      setGeometry({ sections: message.sections, scrollY: message.scrollY });
      setBridged(true);
      if (fromLoading) dispatch({ type: "ready", key });
      else {
        sync(key);
        settle(key);
      }
      latest.current.onReady?.(message.pagePath);
      return;
    }
    if (!fromShown) return;
    if (message.type === PREVIEW_RECTS) {
      setGeometry({ sections: message.sections, scrollY: message.scrollY });
      dispatch({ type: "scroll", key, scrollY: message.scrollY });
      return;
    }
    if (message.type === PREVIEW_SELECT) {
      // The rect is in document pixels, measured at this scroll.
      setGeometry((current) => (current.scrollY === message.scrollY ? current : { ...current, scrollY: message.scrollY }));
      latest.current.onSelect(message.sectionId, message.rect);
    }
  }, [settle, stopNudging, sync]);

  /**
   * Some browsers (Firefox on localhost) only tell the frame who its parent
   * is once the parent speaks, and a page may load before its bridge is
   * listening: a frame that has loaded but not said `ready` is spoken to
   * again every half second until it does (or is replaced).
   */
  const nudge = useCallback((key: number) => {
    if (readyFrames.current.has(key) || nudges.current.has(key)) return;
    nudges.current.set(key, setInterval(() => {
      const state = swapRef.current;
      if (readyFrames.current.has(key) || (state.shown?.key !== key && state.loading?.key !== key)) {
        stopNudging(key);
        return;
      }
      latest.current.send(key, { type: PREVIEW_MODE, edit: latest.current.editMode });
    }, NUDGE_MS));
  }, [stopNudging]);

  const onLoaded = useCallback((key: number) => {
    const state = swapRef.current;
    if (state.shown?.key === key) {
      sync(key);
      nudge(key);
      if (!readyFrames.current.has(key) && silentTimer.current === null) {
        silentTimer.current = setTimeout(() => {
          silentTimer.current = null;
          if (swapRef.current.shown?.key === key && !readyFrames.current.has(key)) setSilent(true);
        }, SILENT_AFTER_MS);
      }
      return;
    }
    if (state.loading?.key !== key || timers.current.has(key)) return;
    latest.current.send(key, { type: PREVIEW_MODE, edit: latest.current.editMode });
    nudge(key);
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      dispatch({ type: "timeout", key });
    }, AFTER_LOAD_MS));
  }, [nudge, sync]);

  const commands = useMemo<PreviewCommands>(() => ({
    post: (message) => {
      const state = swapRef.current;
      const key = state.shown?.key;
      if (message.type === PREVIEW_SCROLL_TO) {
        // The section may be on a page that is still loading (another page,
        // or this one being rebuilt): remember it for the frame that has it.
        const onScreen = key !== undefined && state.loading === null &&
          (readyFrames.current.get(key) ?? []).some((section) => section.id === message.section_id);
        wanted.current = onScreen ? null : { id: message.section_id, at: Date.now() };
      }
      if (key !== undefined) latest.current.send(key, message);
    },
  }), []);

  const noPick = shownKey !== null && (silent || (bridged && geometry.sections.length === 0));
  return { swap, geometry, bridged, noPick, onMessage, onLoaded, commands };
}
