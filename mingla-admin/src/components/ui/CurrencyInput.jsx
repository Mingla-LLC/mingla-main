/**
 * ISSUE-864 WP4 — CurrencyInput (SPEC §4.1 new primitive).
 * Dollars-in / CENTS-AT-REST: the parent holds cents; conversion to
 * micro/dollars is the server adapter's job at the API boundary, never the
 * builder's (blueprint §1.4 Discovery 3 — the 10,000× money bug).
 */

import { useEffect, useState } from "react";

export function CurrencyInput({ label, cents, onCentsChange, error, helper, id, ...props }) {
  const [text, setText] = useState(cents > 0 ? (cents / 100).toFixed(2) : "");

  // Sync down only when the parent's cents disagree with what we'd emit —
  // never clobber in-progress typing ("5." etc.).
  useEffect(() => {
    const parsed = Math.round((parseFloat(text) || 0) * 100);
    if (parsed !== cents) {
      setText(cents > 0 ? (cents / 100).toFixed(2) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);

  const handleChange = (e) => {
    const raw = e.target.value;
    if (!/^\d*\.?\d{0,2}$/.test(raw)) return; // dollars + max 2 decimals
    setText(raw);
    onCentsChange(Math.round((parseFloat(raw) || 0) * 100));
  };

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-secondary)]">
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={handleChange}
          aria-invalid={Boolean(error)}
          className={[
            "w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
            "border rounded-lg outline-none transition-all duration-150 pl-7 pr-3",
            error
              ? "border-[#ef4444] focus:border-[#ef4444] focus:ring-2 focus:ring-[#fee2e2]"
              : "border-[var(--gray-300)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
          ].join(" ")}
          {...props}
        />
      </div>
      {error && <p className="mt-1 text-xs text-[#ef4444]">{error}</p>}
      {!error && helper && <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{helper}</p>}
    </div>
  );
}
