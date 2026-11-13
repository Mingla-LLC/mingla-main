// Issue #4130 (Wave 0) — the one way a page says a load failed.
//
// A failed load is never shown as 0, an empty table or "No data": it is this
// card, which says what did not load, why (when the server said), and offers
// Retry. Later waves reuse it on every page they rebuild.
//
//   title     what did not load, in plain words ("Couldn't load this list")
//   message   the reason, when there is one (optional)
//   onRetry   loads again; the button is hidden only when there is no retry
//   retrying  shows the button as busy while the retry runs (optional)
//
// #4423 rework 2 (P3-A): while the tab's request ceiling pause holds, the card
// says so (lib/pollGate loadErrorView) instead of "tell an admin", and onRetry
// runs once by itself just after the pause ends.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import { AlertCard } from "./Card";
import { Button } from "./Button";
import { tabCeiling } from "../../lib/requestCeiling";
import { ceilingPaused, loadErrorView, whenCeilingLifts } from "../../lib/pollGate";

export const LOAD_ERROR_FALLBACK = "Something went wrong on our side. Check your connection and try again.";

// The pause ends silently (no event), so re-render once just after it ends.
// Admin renders only in the browser; the server snapshot reads the same
// ceiling so a static render (the P3-A test) shows what the tab would show.
const readPaused = () => ceilingPaused();
function useCeilingPaused() {
  const paused = useSyncExternalStore(tabCeiling.subscribe, readPaused, readPaused);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!paused) return undefined;
    return whenCeilingLifts(() => setTick((n) => n + 1));
  }, [paused]);
  return paused;
}

export function LoadError({ title = "Couldn't load this", message, onRetry, retrying = false, className = "" }) {
  const paused = useCeilingPaused();
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  useEffect(() => {
    if (!paused) return undefined;
    return whenCeilingLifts(() => retryRef.current?.());
  }, [paused]);
  const view = loadErrorView({ title, message }, paused);
  return (
    <div role="alert" className={className} data-load-paused={view.paused ? "" : undefined}>
      <AlertCard
        variant={view.variant}
        title={view.title}
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" icon={RotateCcw} loading={retrying} onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {view.message || LOAD_ERROR_FALLBACK}
      </AlertCard>
    </div>
  );
}
