/**
 * ISSUE-864 WP4 — the wizard stepper (SPEC §4.1): back-navigable, NO forward
 * skip; aria-current on the active step (SC-9).
 *
 * ISSUE-980 [Campaign Builder clarity] finding #1(a): the 10-step run needs
 * ~1,070-1,100px at full size and silently overflowed (via bare
 * `overflow-x-auto`, no visible affordance) on ≤1440px laptops once the
 * sidebar + AppShell padding are subtracted (ISSUE-977 Lane A F-6). Below
 * COMPACT_BREAKPOINT_PX this now renders in a tighter "compact" density —
 * smaller pill padding/connector/icon chip + two abbreviated labels — so all
 * 10 steps are legible without hidden scroll at ordinary laptop widths.
 * `overflow-x-auto` remains as a last-resort safety net only.
 */

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { isCompactStepper, stepLabel } from "./stepperResponsive";

function useIsCompactStepper() {
  const [compact, setCompact] = useState(() =>
    isCompactStepper(typeof window === "undefined" ? NaN : window.innerWidth),
  );
  useEffect(() => {
    const applyWidth = () => setCompact(isCompactStepper(window.innerWidth));
    applyWidth();
    window.addEventListener("resize", applyWidth);
    return () => window.removeEventListener("resize", applyWidth);
  }, []);
  return compact;
}

export function Stepper({ steps, activeIndex, maxVisitedIndex, onJump }) {
  const compact = useIsCompactStepper();

  return (
    <nav aria-label="Campaign builder steps" className="overflow-x-auto">
      <ol className={["flex items-center min-w-max pb-1", compact ? "gap-0.5" : "gap-1"].join(" ")}>
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isDone = index < activeIndex;
          const reachable = index <= maxVisitedIndex;
          return (
            <li key={step.id} className="flex items-center">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={
                    compact
                      ? "w-2 h-px bg-[var(--gray-300)]"
                      : "w-4 h-px bg-[var(--gray-300)] mx-0.5"
                  }
                />
              )}
              <button
                type="button"
                aria-current={isActive ? "step" : undefined}
                disabled={!reachable}
                onClick={() => reachable && onJump(index)}
                title={compact ? step.label : undefined}
                className={[
                  "flex items-center rounded-lg font-medium whitespace-nowrap",
                  compact ? "gap-1 h-7 px-1.5 text-[11px]" : "gap-1.5 h-8 px-2.5 text-xs",
                  "transition-colors focus-visible:outline-none focus-visible:ring-2",
                  "focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                  isActive
                    ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] ring-1 ring-[var(--color-brand-500)]"
                    : isDone
                    ? "text-[var(--color-text-primary)] hover:bg-[var(--gray-100)]"
                    : reachable
                    ? "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"
                    : "text-[var(--color-text-tertiary)] cursor-not-allowed",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "inline-flex items-center justify-center rounded-full",
                    compact ? "w-3.5 h-3.5 text-[9px]" : "w-4 h-4 text-[10px]",
                    isDone
                      ? "bg-[var(--color-brand-500)] text-white"
                      : isActive
                      ? "border border-[var(--color-brand-500)] text-[var(--color-brand-700)]"
                      : "border border-[var(--gray-300)]",
                  ].join(" ")}
                >
                  {isDone ? <Check size={compact ? 8 : 10} /> : index + 1}
                </span>
                {stepLabel(step, { compact })}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
