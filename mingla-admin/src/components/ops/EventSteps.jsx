// Issue #3980 (R2, R6) — the eight launch steps of an event, made by
// themselves: done, skipped (went live too late) or still to come, with the
// date and who does each. The two key steps are bold.
import { Check } from "lucide-react";
import { dayLabel } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function EventSteps({ steps = [], doneCount = 0 }) {
  const total = steps.length || 8;
  const pct = Math.round((Math.min(doneCount, total) / total) * 100);
  return (
    <section aria-labelledby="event-steps-heading" className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
      <h3 id="event-steps-heading" className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
        <span>Steps (made by themselves)</span>
        <span className="text-[12.5px] font-normal tabular-nums text-[var(--color-text-tertiary)]">{doneCount} of {total}</span>
      </h3>
      <div role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--gray-100)]">
        <div className="h-full rounded-full bg-[var(--color-success-600)]" style={{ width: `${pct}%` }} />
      </div>
      <details className="min-w-0">
        <summary className={`min-h-11 cursor-pointer rounded-lg py-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] ${FOCUS}`}>Show all {total} steps</summary>
        <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
          {steps.map((s) => (
            <li key={s.step} className={`grid min-w-0 grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 py-2 ${s.state === "skip" ? "opacity-60" : ""}`}>
              <span aria-hidden="true" className={`mt-0.5 inline-grid h-[18px] w-[18px] place-items-center rounded-full ${s.state === "done" ? "bg-[var(--color-success-600)] text-white" : "border border-[var(--gray-300)]"}`}>
                {s.state === "done" && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className={`block break-normal [overflow-wrap:normal] text-[13px] text-[var(--color-text-primary)] ${s.key ? "font-semibold" : ""} ${s.state === "skip" ? "line-through" : ""}`}>{s.title}</span>
                <span className="block break-normal [overflow-wrap:normal] text-[12px] text-[var(--color-text-tertiary)]">
                  {s.state === "skip" ? "Skipped: went live too late" : s.who}
                  {s.card ? <> · <a href={`#/work-board?card=${s.card.id}`} className={`rounded font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Card {s.card.number}</a></> : null}
                </span>
                <span className="sr-only">{s.state === "done" ? "Done" : s.state === "skip" ? "Skipped" : "To come"}</span>
              </span>
              <span className="whitespace-nowrap text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{dayLabel(s.date)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
