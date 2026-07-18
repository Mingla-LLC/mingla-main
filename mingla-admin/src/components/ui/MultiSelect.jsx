/**
 * ISSUE-864 WP4 — MultiSelect (SPEC §4.1 new primitive).
 * Accessible checkbox-chip group: selection = ring + check, never color alone
 * (WCAG AA per UI_UX §7). Keyboard: each chip is a real button.
 */

import { Check } from "lucide-react";

export function MultiSelect({ label, options, values, onChange, disabled = false, helper }) {
  const toggle = (value) => {
    if (disabled) return;
    onChange(
      values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
    );
  };

  return (
    <div className="w-full">
      {label && (
        <span className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
          {label}
        </span>
      )}
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = values.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="checkbox"
              aria-checked={selected}
              disabled={disabled || option.disabled}
              onClick={() => toggle(option.value)}
              className={[
                "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-full border",
                "transition-all duration-150 focus-visible:outline-none focus-visible:ring-2",
                "focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                selected
                  ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] ring-1 ring-[var(--color-brand-500)]"
                  : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]",
                disabled || option.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              {selected && <Check size={12} aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}
      </div>
      {helper && <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{helper}</p>}
    </div>
  );
}
