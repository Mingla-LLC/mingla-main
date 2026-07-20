/**
 * ISSUE-864 WP4 — Step: Budget & schedule (SPEC A4.0(4) + A4.e, blueprint
 * §1.4). ONE total daily budget (dollars-in / cents-at-rest), the client-side
 * split preview (the budget-plan-preview endpoint doesn't exist — flags.js),
 * per-channel floors from the CONNECTION row (Meta per-category — $5/day for
 * link clicks, never $1), honest pacing badges (Meta 175% weekly-averaged,
 * Google 2× daily) and the learning-limited warning.
 *
 * Daily only: the deployed create endpoint rejects lifetime budgets
 * (budget_type_unsupported_wp1) — Lifetime renders disabled with the reason,
 * never a dead control that 422s at create.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { AlertCard } from "../ui/Card";
import { CurrencyInput } from "../ui/CurrencyInput";
import { MultiSelect } from "../ui/MultiSelect";
import {
  PACING_DISCLOSURES,
  learningLimitedWarning,
  validateBudget,
} from "../../lib/adBuilder/budgetRules";
import { PLATFORM_LABELS, splitBudget, unfundedEligibleChannels } from "../../lib/adBuilder/channelPlan";

const STRATEGIES = [
  { id: "auto", label: "Auto" },
  { id: "concentrate", label: "Concentrate" },
  { id: "diversify", label: "Diversify" },
];

export function StepBudget({ budget, onBudgetChange, channelRows }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = (patch) => onBudgetChange({ ...budget, ...patch });
  const errors = validateBudget({ totalDailyCents: budget.totalDailyCents, channelRows });
  // ISSUE-986: `channelRows` here is already the PICKED set (plannedRows) — the
  // split preview runs across exactly the platforms the operator chose.
  const allocations = splitBudget({
    totalDailyCents: budget.totalDailyCents,
    channelRows,
    strategy: budget.strategy,
  });
  const excluded = channelRows.filter((r) => !r.eligible);
  // ISSUE-979 Bug 4: channels that are ELIGIBLE but got $0 from the split (the
  // total can't jointly fund them, or Concentrate put everything on the top
  // channel). Surface them WITH a reason instead of letting them fall silently
  // to $0 while Next stays enabled.
  const unfunded = unfundedEligibleChannels({
    channelRows,
    allocations,
    totalDailyCents: budget.totalDailyCents,
    strategy: budget.strategy,
  });
  const eligibleOptions = channelRows
    .filter((r) => r.eligible || (budget.allowlist ?? []).includes(r.platform))
    .map((r) => ({ value: r.platform, label: r.label }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">How much, and when?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          One total daily number — the plan splits it across the channels that can actually use it.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        <CurrencyInput
          label="Total daily budget (USD)"
          id="total-daily-budget"
          cents={budget.totalDailyCents}
          onCentsChange={(totalDailyCents) => set({ totalDailyCents })}
          error={budget.totalDailyCents > 0 ? undefined : undefined}
          helper="Dollars in, cents at rest — each platform's unit conversion happens server-side."
        />
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Budget type</span>
          <div className="inline-flex rounded-lg border border-[var(--gray-300)] p-0.5" role="radiogroup" aria-label="Budget type">
            <button
              type="button"
              role="radio"
              aria-checked="true"
              className="h-8 px-3 text-xs font-medium rounded-md bg-[var(--color-brand-500)] text-white"
            >
              Daily
            </button>
            <button
              type="button"
              role="radio"
              aria-checked="false"
              disabled
              title="Lifetime budgets aren't supported by the create endpoint yet."
              className="h-8 px-3 text-xs font-medium rounded-md text-[var(--color-text-tertiary)] cursor-not-allowed"
            >
              Lifetime (soon)
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            The campaign starts paused; spending begins only when you launch it from the
            campaign page.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm font-medium">Split strategy</span>
        <div className="inline-flex rounded-lg border border-[var(--gray-300)] p-0.5" role="radiogroup" aria-label="Split strategy">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={budget.strategy === s.id}
              onClick={() => set({ strategy: s.id })}
              className={[
                "h-8 px-3 text-xs font-medium rounded-md transition-colors",
                budget.strategy === s.id
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* The split preview (client-side estimate — endpoint doesn't exist yet). */}
      {budget.totalDailyCents > 0 && allocations.length > 0 && (
        <div className="p-3 rounded-lg border border-[var(--gray-200)] space-y-2">
          <p className="text-xs font-semibold">Proposed split (local estimate)</p>
          {allocations.map((a) => {
            const learning = learningLimitedWarning(a.dailyCents);
            return (
              <div key={a.platform} className="text-xs">
                <span className="font-medium">{PLATFORM_LABELS[a.platform]}</span>{" "}
                — ${(a.dailyCents / 100).toFixed(2)}/day
                {learning && (
                  <p className="text-[var(--color-warning-700)] mt-0.5">{learning}</p>
                )}
              </div>
            );
          })}
          {excluded.filter((r) => r.excludedReason).map((r) => (
            <p key={r.platform} className="text-xs text-[var(--color-text-tertiary)]">
              {r.label}: {r.excludedReason}
            </p>
          ))}
        </div>
      )}

      {/* ISSUE-979 Bug 4 — eligible channels the split funded at $0. Never silent. */}
      {unfunded.length > 0 && (
        <AlertCard
          variant="warning"
          title={`${unfunded.length} eligible ${unfunded.length === 1 ? "channel gets" : "channels get"} $0/day`}
        >
          <ul className="space-y-1 mt-1">
            {unfunded.map((u) => (
              <li key={u.platform} className="text-xs">
                <span className="font-medium">{u.label}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </AlertCard>
      )}

      {/* Honest pacing truths — a day can cost more than your daily budget. */}
      <AlertCard variant="info" title="A day can cost more than your daily budget">
        {PACING_DISCLOSURES.meta} {PACING_DISCLOSURES.google} The plan total never moves.
      </AlertCard>

      {errors.map((message) => (
        <p key={message} className="text-xs text-[#ef4444]">{message}</p>
      ))}

      <div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced — channel allowlist
        </button>
        {advancedOpen && (
          <div className="mt-2 space-y-2">
            <MultiSelect
              label="Channels allowed to receive budget"
              options={eligibleOptions}
              values={budget.allowlist ?? eligibleOptions.map((o) => o.value)}
              onChange={(allowlist) => set({ allowlist })}
              helper="Narrow-only: a channel with a hard blocker can't be forced in."
            />
          </div>
        )}
      </div>
    </div>
  );
}
