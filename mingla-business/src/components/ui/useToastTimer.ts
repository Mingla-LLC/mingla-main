/**
 * The toast countdown: pause-able, calls `onElapsed` once. Kept free of any
 * animation import so its rules can be tested on their own (#4490 I7).
 */
import { useEffect, useMemo, useRef } from "react";

/** Pause-able countdown that calls `onElapsed` once. */
export const useToastTimer = (
  ms: number | null,
  onElapsed: () => void,
): { pause: () => void; resume: () => void } => {
  const remainingRef = useRef<number | null>(ms);
  const startedRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the running countdown ends (ms since epoch); null while paused or not running. */
  const deadlineRef = useRef<number | null>(null);
  const elapsedRef = useRef(onElapsed);
  elapsedRef.current = onElapsed;

  const clear = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const start = (): void => {
    clear();
    const remaining = remainingRef.current;
    if (remaining === null) return;
    startedRef.current = Date.now();
    deadlineRef.current = startedRef.current + Math.max(0, remaining);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      deadlineRef.current = null;
      elapsedRef.current();
    }, Math.max(0, remaining));
  };

  useEffect(() => {
    remainingRef.current = ms;
    start();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);

  // #4490 I7: a browser slows or freezes timers in a background tab, so a toast could
  // outlive its time by minutes. When the tab comes back, a countdown that has already
  // run out ends the toast at once (a paused toast, under the pointer, is left alone).
  useEffect(() => {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
    const check = (): void => {
      if (document.visibilityState === "hidden") return;
      const deadline = deadlineRef.current;
      if (timerRef.current === null || deadline === null || Date.now() < deadline) return;
      clear();
      deadlineRef.current = null;
      elapsedRef.current();
    };
    document.addEventListener("visibilitychange", check);
    if (typeof window !== "undefined") window.addEventListener("focus", check);
    return (): void => {
      document.removeEventListener("visibilitychange", check);
      if (typeof window !== "undefined") window.removeEventListener("focus", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({
      pause: (): void => {
        if (timerRef.current === null || remainingRef.current === null) return;
        clear();
        deadlineRef.current = null;
        remainingRef.current -= Date.now() - startedRef.current;
      },
      resume: (): void => {
        if (timerRef.current !== null) return;
        start();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
};
