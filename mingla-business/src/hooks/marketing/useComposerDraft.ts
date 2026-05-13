/**
 * useComposerDraft — debounced auto-save for composer state.
 *
 * Strategy: when caller toggles `isDirty=true`, the hook waits
 * `DEBOUNCE_MS` (default 800ms — SPEC §5.1) after the last keystroke
 * before calling `flush`. Caller passes the latest state via the
 * `state` argument; the hook captures it via a ref so the timer
 * always saves the freshest values.
 *
 * Callers `flush` typically calls `createDraft` (on first save) or
 * `updateDraft` (subsequent saves) — this hook does not own that
 * decision, it just orchestrates the timing.
 */

import { useCallback, useEffect, useRef } from "react";

const DEFAULT_DEBOUNCE_MS = 800;

export interface UseComposerDraftOptions<TState> {
  state: TState;
  isDirty: boolean;
  flush: (state: TState) => Promise<void>;
  debounceMs?: number;
  onError?: (err: unknown) => void;
}

export function useComposerDraft<TState>(
  options: UseComposerDraftOptions<TState>,
): { flushNow: () => Promise<void> } {
  const stateRef = useRef(options.state);
  stateRef.current = options.state;
  const flushRef = useRef(options.flush);
  flushRef.current = options.flush;
  const errorRef = useRef(options.onError);
  errorRef.current = options.onError;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushNow = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      await flushRef.current(stateRef.current);
    } catch (err) {
      if (errorRef.current !== undefined) errorRef.current(err);
      else console.error("[useComposerDraft] flush failed", err);
    }
  }, []);

  useEffect(() => {
    if (!options.isDirty) return;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const delay = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushNow();
    }, delay);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: re-trigger on every dirty state change
  }, [options.state, options.isDirty, options.debounceMs, flushNow]);

  return { flushNow };
}
