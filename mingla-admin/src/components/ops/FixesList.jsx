// Issue #3980 — the server's list of what to fix before a card is added.
import { Check, X } from "lucide-react";

export function FixesList({ title, fixes = [], passed = [] }) {
  return (
    <div role="alert" className="rounded-xl border border-[var(--color-error-100)] bg-[var(--color-error-50)] p-3">
      <p className="text-[13px] font-semibold text-[var(--color-error-700)]">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {passed.map((line) => (
          <li key={`ok-${line}`} className="flex items-start gap-2 text-[13px] text-[var(--color-success-700)]">
            <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words"><span className="sr-only">Passed: </span>{line}</span>
          </li>
        ))}
        {fixes.map((f, i) => (
          <li key={`${f.field}-${i}`} className="flex items-start gap-2 text-[13px] text-[var(--color-error-700)]">
            <X aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words"><span className="sr-only">To fix: </span>{f.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
