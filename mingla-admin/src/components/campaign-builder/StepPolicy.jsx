/**
 * ISSUE-864 WP4 — Step: Preview & policy pre-check (SPEC A4.d, blueprint
 * §1.7). Four controls: the 4-pattern personal-attributes linter (WARN-ONLY),
 * the Reddit DATING lexicon, the alcohol-adjacency warning, and the
 * special_ad_categories selector (validated, never hardcoded []) with the
 * restriction-cascade preview. Where no API preview exists (the preview
 * endpoint isn't built — flags), a safe-zone overlay is drawn on the creative
 * (Meta 9:16: top 14% / bottom 35% under UI chrome).
 */

import { AlertCard } from "../ui/Card";
import {
  PERSONAL_ATTRIBUTES_EXAMPLES,
  SPECIAL_AD_CATEGORIES,
  SPECIAL_CATEGORY_CASCADE,
  runPolicyPrecheck,
} from "../../lib/adBuilder/policyLinter";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import { complianceExcludedPlatforms, isSpecialCategoryActive } from "../../lib/adBuilder/compliance";

export function StepPolicy({ copy, creative, channelRows, specialAdCategory, onSpecialAdCategoryChange }) {
  const channelSet = channelRows.filter((r) => r.eligible).map((r) => r.platform);
  // ISSUE-986 compliance guard: only Meta can DECLARE a special ad category, so
  // picking one excludes the other four from the build (never a silent
  // undeclared special-category ad). Name them here where the category is set.
  const complianceExcluded = complianceExcludedPlatforms(specialAdCategory, channelSet);
  const copyText = [copy.primary, copy.headline, copy.description, ...(copy.googleHeadlines ?? []), ...(copy.googleDescriptions ?? [])]
    .filter(Boolean)
    .join("\n");
  const { personalAttributes, dating, alcohol } = runPolicyPrecheck({ copyText, channelSet });
  const clean = personalAttributes.length === 0 && !dating && !alcohol;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What might get this rejected?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Everything a machine can check, before a platform review cycle eats 24 hours. These
          are warnings, never blocks — false positives on a social product are guaranteed.
        </p>
      </div>

      {clean && (
        <AlertCard variant="success" title="No policy flags">
          No personal-attribute risk, no dating phrasing, no alcohol adjacency detected.
          Every platform still reviews ads by hand as well as by machine — we've checked
          everything a machine can check.
        </AlertCard>
      )}

      {personalAttributes.map((finding) => (
        <AlertCard key={finding.pattern + finding.excerpt} variant="warning" title={`Personal attributes — pattern ${finding.pattern}`}>
          <p className="mb-1">"{finding.excerpt}"</p>
          {finding.message}
        </AlertCard>
      ))}

      {dating && (
        <AlertCard variant="warning" title="Reads like a dating ad (Reddit DATING rule)">
          <p className="mb-1">"{dating.excerpt}"</p>
          {dating.message}
        </AlertCard>
      )}

      {alcohol && (
        <AlertCard variant="warning" title="Alcohol-adjacent">
          <p className="mb-1">"{alcohol.excerpt}"</p>
          {alcohol.message}
        </AlertCard>
      )}

      {/* Meta's rejected→compliant examples, inline — never a docs link. */}
      <details className="rounded-xl border border-[var(--gray-200)] p-3">
        <summary className="text-sm font-medium cursor-pointer">
          Meta's rejected → compliant examples
        </summary>
        <div className="mt-2 space-y-2">
          {PERSONAL_ATTRIBUTES_EXAMPLES.map((example) => (
            <div key={example.rejected} className="text-xs grid grid-cols-1 md:grid-cols-2 gap-1">
              <p className="text-[#ef4444]">✗ "{example.rejected}"</p>
              <p className="text-[var(--color-success-700)]">✓ "{example.compliant}"</p>
            </div>
          ))}
        </div>
      </details>

      {/* special_ad_categories — collected + validated, never hardcoded []. */}
      <div className="space-y-2">
        <label className="block text-sm max-w-sm">
          <span className="block mb-1 font-medium">Special ad category</span>
          <select
            className="w-full h-10 px-3 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-sm"
            value={specialAdCategory}
            onChange={(e) => onSpecialAdCategoryChange(e.target.value)}
          >
            {SPECIAL_AD_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          We're "None" for event/venue traffic — but a venue-hire promo can drift into Housing
          and a "we're hiring" promo into Employment. Mis-declaring is an account-integrity
          issue. (CREDIT was retired 2025-01-14 → Financial products &amp; services.)
        </p>
        {specialAdCategory !== "NONE" && (
          <AlertCard variant="warning" title="Meta will restrict this campaign's targeting">
            <ul className="list-disc pl-4 space-y-0.5">
              {SPECIAL_CATEGORY_CASCADE.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </AlertCard>
        )}

        {/* ISSUE-986: a special ad category can only be DECLARED on Meta — the
            other four platforms have no such field, so a special-category build
            there would run un-declared. They're excluded from the build, never
            silently run. */}
        {isSpecialCategoryActive(specialAdCategory) && complianceExcluded.length > 0 && (
          <AlertCard variant="warning" title="Only Meta can run this special-category campaign">
            <p>
              {complianceExcluded.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}{" "}
              {complianceExcluded.length === 1 ? "has" : "have"} no special-ad-category field, so
              building there would be an undeclared special-category ad. They're excluded from this
              build — set the category back to "None" to include them, or continue on Meta only.
            </p>
          </AlertCard>
        )}
      </div>

      {/* This remains an explicitly named local guide, including for video. */}
      {(creative.kind === "video" ? creative.posterUrl : creative.publicUrl) && (
        <div>
          <p className="text-sm font-medium mb-1.5">
            Mingla safe-zone approximation
          </p>
          <div className="relative inline-block w-48 aspect-[9/16] overflow-hidden rounded-xl border border-[var(--gray-200)]">
            <img
              src={creative.kind === "video" ? creative.posterUrl : creative.publicUrl}
              alt="Creative with Stories/Reels safe-zone overlay"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 bg-black/50 flex items-end justify-center pb-0.5"
              style={{ height: "14%" }}
            >
              <span className="text-[9px] text-white">top 14% — platform UI</span>
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 bg-black/50 flex items-start justify-center pt-0.5"
              style={{ height: "35%" }}
            >
              <span className="text-[9px] text-white">bottom 35% — platform UI</span>
            </div>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5 max-w-md">
            On Stories and Reels the shaded bands sit under the platform's own buttons. This
            guide is drawn by Mingla; it is not a render returned by Meta.
          </p>
        </div>
      )}
    </div>
  );
}
