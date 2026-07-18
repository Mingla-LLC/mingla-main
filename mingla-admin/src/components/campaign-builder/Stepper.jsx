/**
 * ISSUE-864 WP4 — the wizard stepper (SPEC §4.1): back-navigable, NO forward
 * skip; aria-current on the active step (SC-9).
 */

import { Check } from "lucide-react";

export function Stepper({ steps, activeIndex, maxVisitedIndex, onJump }) {
  return (
    <nav aria-label="Campaign builder steps" className="overflow-x-auto">
      <ol className="flex items-center gap-1 min-w-max pb-1">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isDone = index < activeIndex;
          const reachable = index <= maxVisitedIndex;
          return (
            <li key={step.id} className="flex items-center">
              {index > 0 && (
                <span aria-hidden="true" className="w-4 h-px bg-[var(--gray-300)] mx-0.5" />
              )}
              <button
                type="button"
                aria-current={isActive ? "step" : undefined}
                disabled={!reachable}
                onClick={() => reachable && onJump(index)}
                className={[
                  "flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap",
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
                    "inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px]",
                    isDone
                      ? "bg-[var(--color-brand-500)] text-white"
                      : isActive
                      ? "border border-[var(--color-brand-500)] text-[var(--color-brand-700)]"
                      : "border border-[var(--gray-300)]",
                  ].join(" ")}
                >
                  {isDone ? <Check size={10} /> : index + 1}
                </span>
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
