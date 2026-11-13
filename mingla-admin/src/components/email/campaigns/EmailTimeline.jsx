// Issue #4419 — an email's life in four steps, from the campaign row.
import { AlertTriangle, Ban, Check, Clock, X } from "lucide-react";
import { timelineSteps } from "./campaignModel";

const DOT = {
  done: "bg-[#22c55e] border-[#22c55e] text-white",
  now: "bg-[var(--color-warning-50)] border-[#f59e0b] text-[var(--color-warning-700)]",
  half: "bg-[#f59e0b] border-[#f59e0b] text-white",
  bad: "bg-[#ef4444] border-[#ef4444] text-white",
  off: "bg-[var(--gray-500)] border-[var(--gray-500)] text-white",
  todo: "bg-[var(--color-background-primary)] border-[var(--gray-300)] text-transparent",
};
const ICON = { done: Check, now: Clock, half: AlertTriangle, bad: X, off: Ban, todo: null };

export function EmailTimeline({ detail }) {
  const steps = timelineSteps(detail);
  return (
    <ol aria-label="Timeline" className="grid grid-cols-4 gap-3 rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-6 py-5 max-[720px]:grid-cols-1 max-[720px]:px-5">
      {steps.map((step, index) => {
        const Icon = ICON[step.tone];
        return (
          <li key={`${step.label}-${index}`} data-step={step.tone} className="relative flex min-w-0 flex-col gap-1.5 max-[720px]:flex-row max-[720px]:items-start max-[720px]:gap-2.5">
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className={`absolute left-[22px] right-[-12px] top-[10px] h-0.5 max-[720px]:hidden ${step.tone === "done" ? "bg-[#22c55e]" : "bg-[var(--gray-200)]"}`} />
            ) : null}
            <span aria-hidden="true" className={`relative z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${DOT[step.tone] || DOT.todo}`}>
              {Icon ? <Icon className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={`text-xs font-semibold ${step.tone === "todo" ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-secondary)]"}`}>{step.label}</span>
              <span className={`text-[13px] tabular-nums ${step.tone === "todo" ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]"}`}>{step.value}</span>
              {step.who ? <span className="text-xs text-[var(--color-text-tertiary)]">{step.who}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
