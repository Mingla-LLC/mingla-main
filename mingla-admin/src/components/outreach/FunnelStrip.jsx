// Issue #4130 (Wave 4a) — the funnel on top of Hosts and creators: each stage's
// count over every card, and what share of the stage before reached it. The
// weakest step is marked: it is the biggest leak in outreach.
import { funnelSteps } from "../../lib/outreachView";

export function FunnelStrip({ def, stages, label }) {
  const steps = funnelSteps(def, stages);
  if (!steps.length) return null;
  return (
    <section aria-label={label} className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
      <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {steps.map((step) => (
          <li key={step.id} data-funnel-step={step.id} className="flex min-w-0 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">{step.label}</span>
              <span className="text-[17px] font-bold tabular-nums text-[var(--color-text-primary)]">{step.count.toLocaleString()}</span>
            </span>
            <span className="block h-2 overflow-hidden rounded-full bg-[var(--gray-100)]" aria-hidden="true">
              <span
                className={`block h-full rounded-full ${step.weakest ? "bg-[var(--color-error-500,#ef4444)]" : "bg-[var(--color-brand-500)]"}`}
                style={{ width: `${step.widthPercent}%` }}
              />
            </span>
            {step.conversion != null && (
              <span className={`text-xs ${step.weakest ? "font-semibold text-[var(--color-error-700)]" : "text-[var(--color-text-tertiary)]"}`}>
                {step.conversion}% of {step.from}{step.weakest ? " · biggest drop" : ""}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">Cards in each stage now, across every region and owner. Lost and Passed are left out.</p>
    </section>
  );
}
