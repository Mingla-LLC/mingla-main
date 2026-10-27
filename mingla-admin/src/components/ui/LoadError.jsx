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
import { RotateCcw } from "lucide-react";
import { AlertCard } from "./Card";
import { Button } from "./Button";

export const LOAD_ERROR_FALLBACK = "Something went wrong on our side. Check your connection and try again.";

export function LoadError({ title = "Couldn't load this", message, onRetry, retrying = false, className = "" }) {
  return (
    <div role="alert" className={className}>
      <AlertCard
        variant="error"
        title={title}
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" icon={RotateCcw} loading={retrying} onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {message || LOAD_ERROR_FALLBACK}
      </AlertCard>
    </div>
  );
}
