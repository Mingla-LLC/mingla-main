/**
 * ISSUE-864 WP4 — Step: Audience (SPEC A4.f, blueprint §1.3). Countries are
 * first-class (prefilled US/GB/NG — OD-5); age + gender with per-channel
 * honesty (Reddit has NO age field — the verbatim passthrough note). The
 * city+radius picker needs the admin-ad-targeting-search proxy, which does
 * not exist yet — it renders as a labeled "coming" block behind
 * flags.TARGETING_SEARCH_PROXY_ENABLED (fail-soft, per dispatch).
 */

import { AlertCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { MultiSelect } from "../ui/MultiSelect";
import { TARGETING_SEARCH_PROXY_ENABLED } from "../../lib/adBuilder/flags";
import {
  COUNTRY_OPTIONS,
  GENDER_OPTIONS,
  REDDIT_AGE_PASSTHROUGH_NOTE,
  validateAudience,
} from "../../lib/adBuilder/audienceRules";

export function StepAudience({ audience, onAudienceChange, channelRows }) {
  const errors = validateAudience(audience);
  const set = (patch) => onAudienceChange({ ...audience, ...patch });
  const redditEligible = channelRows.some((r) => r.platform === "reddit" && r.eligible);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Who should see this?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Broad targeting beats slicing: geo + age is the recommended shape — the algorithms
          resolve audiences faster than manual interest stacking.
        </p>
      </div>

      <MultiSelect
        label="Countries"
        options={COUNTRY_OPTIONS}
        values={audience.countries}
        onChange={(countries) => set({ countries })}
        helper="Prefilled with the live markets — edit freely."
      />

      {/* A4.f city+radius — flag-gated on the missing targeting-search proxy. */}
      {!TARGETING_SEARCH_PROXY_ENABLED && (
        <div className="p-3 rounded-lg border border-dashed border-[var(--gray-300)] text-xs text-[var(--color-text-tertiary)]">
          City + radius targeting (the highest-leverage field for a venue campaign) arrives
          with the targeting-search proxy — the city keys must come from a server-side
          disambiguated search (Meta's own search puts London, Canada first). Until then,
          campaigns target whole countries.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 max-w-xs">
        <Input
          label="Age min"
          type="number"
          min={13}
          max={65}
          value={audience.ageMin}
          onChange={(e) => set({ ageMin: e.target.value === "" ? "" : Number(e.target.value) })}
        />
        <Input
          label="Age max"
          type="number"
          min={13}
          max={65}
          value={audience.ageMax}
          onChange={(e) => set({ ageMax: e.target.value === "" ? "" : Number(e.target.value) })}
          helper="65 means 65 and over."
        />
      </div>

      <div role="radiogroup" aria-label="Gender" className="space-y-1.5">
        <span className="block text-sm font-medium">Gender</span>
        <div className="inline-flex rounded-lg border border-[var(--gray-300)] p-0.5">
          {GENDER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={audience.gender === option.value}
              onClick={() => set({ gender: option.value })}
              className={[
                "h-8 px-3 text-xs font-medium rounded-md transition-colors",
                audience.gender === option.value
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {redditEligible && (
        <AlertCard variant="info" title="Reddit note">
          {REDDIT_AGE_PASSTHROUGH_NOTE}
        </AlertCard>
      )}

      {errors.map((message) => (
        <p key={message} className="text-xs text-[#ef4444]">{message}</p>
      ))}
    </div>
  );
}
