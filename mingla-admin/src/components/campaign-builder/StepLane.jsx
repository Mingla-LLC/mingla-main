/**
 * ISSUE-864 WP4 — Step: audience lane (SPEC A2). "Who are you advertising
 * to?" — Consumers (active) / Businesses (shown, DISABLED until the business
 * lane is provisioned — the A2 forward-compatible pattern). The lane picks
 * the ad_connections family; everything downstream keys off it.
 */

import { Check } from "lucide-react";

const LANES = [
  {
    id: "consumer",
    label: "Consumers",
    description: "Ads drive people to live public pages — events, venues, brands.",
    disabled: false,
  },
  {
    id: "business",
    label: "Businesses",
    description: "Ads drive businesses to the Mingla Host signup/claim flow.",
    disabled: true,
    disabledReason: "Business web traffic campaigns are not enabled in this builder yet.",
  },
];

export function StepLane({ lane, onLaneChange }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Who are you advertising to?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          The lane picks the ad accounts, pages and tokens everything downstream uses.
        </p>
      </div>
      <div role="radiogroup" aria-label="Audience lane" className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {LANES.map((option) => {
          const selected = lane === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={option.disabled}
              onClick={() => onLaneChange(option.id)}
              className={[
                "text-left p-4 rounded-xl border transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                selected
                  ? "border-[var(--color-brand-500)] ring-1 ring-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                  : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
                option.disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              <div className="flex items-center gap-2 mb-1">
                {selected && <Check size={14} className="text-[var(--color-brand-600)]" aria-hidden="true" />}
                <span className="text-sm font-semibold">{option.label}</span>
                {option.disabled && (
                  <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    Not provisioned
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">{option.description}</p>
              {option.disabled && option.disabledReason && (
                <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{option.disabledReason}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
