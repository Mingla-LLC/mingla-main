import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  EMPTY_SWAP,
  parsePreviewMessage,
  PREVIEW_MARKS,
  PREVIEW_MODE,
  PREVIEW_READY,
  PREVIEW_RECTS,
  PREVIEW_RESTORE_SCROLL,
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

export function usePreviewFrames(options: {
  url: string | null;
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
  onMessage: (key: number, raw: unknown) => void;
  onLoaded: (key: number) => void;
  commands: PreviewCommands;
} {
  const [swap, dispatch] = useReducer(swapReducer, EMPTY_SWAP);
  const [geometry, setGeometry] = useState<PreviewGeometry>({ sections: [], scrollY: 0 });
  const [bridged, setBridged] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  const swapRef = useRef(swap);
  swapRef.current = swap;
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    dispatch({ type: "url", url: options.url });
  }, [options.url]);

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
  }, []);

  // The new frame took over: hand it the scroll it replaces, then the state.
  const shownKey = swap.shown?.key ?? null;
  const previousShown = useRef<number | null>(null);
  useEffect(() => {
    if (shownKey === null) {
      previousShown.current = null;
      setBridged(false);
      setGeometry({ sections: [], scrollY: 0 });
      return;
    }
    if (previousShown.current !== null && previousShown.current !== shownKey) {
      latest.current.send(shownKey, { type: PREVIEW_RESTORE_SCROLL, scroll_y: swapRef.current.scrollY });
    }
    previousShown.current = shownKey;
    sync(shownKey);
  }, [shownKey, sync]);

  const marksKey = useMemo(() => JSON.stringify(options.marks), [options.marks]);
  useEffect(() => {
    if (shownKey === null) return;
    latest.current.send(shownKey, { type: PREVIEW_MODE, edit: latest.current.editMode });
    latest.current.send(shownKey, { type: PREVIEW_MARKS, ...latest.current.marks });
  }, [marksKey, options.editMode, shownKey]);

  useEffect(() => {
    if (shownKey === null || !options.tokenDeclarations) return undefined;
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
      setGeometry({ sections: message.sections, scrollY: fromLoading ? state.scrollY : message.scrollY });
      setBridged(true);
      if (fromLoading) dispatch({ type: "ready", key });
      else sync(key);
      latest.current.onReady?.(message.pagePath);
      return;
    }
    if (!fromShown) return;
    if (message.type === PREVIEW_RECTS) {
      setGeometry({ sections: message.sections, scrollY: message.scrollY });
      dispatch({ type: "scroll", key, scrollY: message.scrollY });
      return;
    }
    if (message.type === PREVIEW_SELECT) latest.current.onSelect(message.sectionId, message.rect);
  }, [sync]);

  const onLoaded = useCallback((key: number) => {
    const state = swapRef.current;
    if (state.shown?.key === key) {
      sync(key);
      return;
    }
    if (state.loading?.key !== key || timers.current.has(key)) return;
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      dispatch({ type: "timeout", key });
    }, AFTER_LOAD_MS));
  }, [sync]);

  const commands = useMemo<PreviewCommands>(() => ({
    post: (message) => {
      const key = swapRef.current.shown?.key;
      if (key !== undefined) latest.current.send(key, message);
    },
  }), []);

  return { swap, geometry, bridged, onMessage, onLoaded, commands };
}
