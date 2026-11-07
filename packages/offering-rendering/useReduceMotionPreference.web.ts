// issue #1023 — web `prefers-reduced-motion`, live.
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const read = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;

export function useReduceMotionPreference(): boolean {
  const [reduce, setReduce] = useState<boolean>(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(QUERY);
    const onChange = (): void => setReduce(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}
