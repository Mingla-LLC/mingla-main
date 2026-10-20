// Issue #3980 — the hook behind a text box that grows with its text: the box
// is measured on every change and when its width changes.
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AUTO_GROW_CLASS, fitHeight } from "../../lib/autoGrow";

export { AUTO_GROW_CLASS };

/**
 * Returns a ref for a <textarea> that keeps it as tall as its text. Pass the
 * current value so the box is re-measured when the text changes from outside
 * (a card loads, a save comes back).
 */
export function useAutoGrow(value) {
  const node = useRef(null);
  const observer = useRef(null);
  const ref = useCallback((el) => {
    observer.current?.disconnect();
    observer.current = null;
    node.current = el;
    if (!el) return;
    fitHeight(el);
    if (typeof ResizeObserver === "function") {
      let width = el.clientWidth;
      observer.current = new ResizeObserver(() => {
        if (el.clientWidth !== width) { width = el.clientWidth; fitHeight(el); }
      });
      observer.current.observe(el);
    }
  }, []);
  useLayoutEffect(() => { fitHeight(node.current); }, [value]);
  useEffect(() => () => observer.current?.disconnect(), []);
  return ref;
}
