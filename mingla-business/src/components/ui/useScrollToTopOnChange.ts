/**
 * #4490 F3 - a wizard that swaps its step inside ONE scroll view must start the
 * new step at the top: the old step's scroll offset otherwise carries over and a
 * short step opens half-way down. Give the returned ref to the step's
 * ScrollView and pass the step as `key`.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { ScrollView } from "react-native";

export function useScrollToTopOnChange(key: unknown): RefObject<ScrollView | null> {
  const ref = useRef<ScrollView | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.scrollTo?.({ x: 0, y: 0, animated: false });
  }, [key]);
  return ref;
}
