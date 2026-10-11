/**
 * ISSUE-864 WP4 + toward #3697 Wave 2 — Budget & schedule.
 *
 * Daily or total (lifetime) budget, start/end dates, hard cap. D1 platform
 * minimums (#3709). Create accepts lifetime; Mingla pauses at 98% of the cap.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { AlertCard } from "../ui/Card";
import { CurrencyInput } from "../ui/CurrencyInput";
import { MultiSelect } from "../ui/MultiSelect";
import {
  PACING_DISCLOSURES,
  calendarDaysBetween,
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
  const mode = budget.mode === "lifetime" ? "lifetime" : "daily";
  const amountCents = mode === "lifetime"
    ? (budget.totalLifetimeCents ?? 0)
    : (budget.totalDailyCents ?? 0);
  const errors = validateBudget({
    totalDailyCents: mode === "daily" ? amountCents : Math.max(amountCents, 1),
    channelRows,
  });
  const platforms = channelRows.filter((r) => r.eligible).map((r) => r.platform);
  const days = calendarDaysBetween(budget.startsAt, budget.endsAt);
  // Use each eligible row's live floorCents (Meta's goal-specific connection
  // floor is already on the row) — never recompute Meta as null/0.
  const daysForMin = mode === "lifetime" ? (days ?? 1) : 1;
  const d1 = {
    minBudgetCents: platforms.reduce((sum, platform) => {
      const row = channelRows.find((r) => r.platform === platform);
      const perDay = typeof row?.floorCents === "number" && row.floorCents > 0
        ? row.floorCents
        : 0;
      return sum + perDay * daysForMin;
    }, 0),
    days: daysForMin,
  };
  const capCents = mode === "lifetime"
    ? amountCents
    : (typeof budget.capCents === "number" && budget.capCents > 0
      ? budget.capCents
      : (days != null && amountCents > 0 ? amountCents * days : amountCents));

  const allocations = splitBudget({
    totalDailyCents: mode === "daily" ? amountCents : (days != null && days > 0
      ? Math.floor(amountCents / days)
      : amountCents),
    channelRows,
    strategy: budget.strategy,
  });
  const excluded = channelRows.filter((r) => !r.eligible);
  const unfunded = unfundedEligibleChannels({
    channelRows,
    allocations,
    totalDailyCents: mode === "daily" ? amountCents : allocations.reduce((s, a) => s + a.dailyCents, 0),
    strategy: budget.strategy,
  });
  const eligibleOptions = channelRows
    .filter((r) => r.eligible || (budget.allowlist ?? []).includes(r.platform))
    .map((r) => ({ value: r.platform, label: r.label }));

  const belowMinimum = amountCents > 0 && amountCents < d1.minBudgetCents;
  const googleShort = mode === "lifetime" && platforms.includes("google") &&
    (days == null || days < 3);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">How much, and when?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Set a daily or total budget, dates, and a hard cap. Mingla pauses at 98% of the cap.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        <CurrencyInput
          label={mode === "lifetime" ? "Total budget / hard cap (USD)" : "Total daily budget (USD)"}
          id="total-budget"
          cents={amountCents}
          onCentsChange={(cents) => set(
            mode === "lifetime"
              ? { totalLifetimeCents: cents, capCents: cents }
              : { totalDailyCents: cents },
          )}
          helper="Dollars in, cents at rest — each platform's unit conversion happens server-side."
        />
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Budget type</span>
          <div className="inline-flex rounded-lg border border-[var(--gray-300)] p-0.5" role="radiogroup" aria-label="Budget type">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "daily"}
              onClick={() => set({ mode: "daily" })}
              className={[
                "h-8 px-3 text-xs font-medium rounded-md",
                mode === "daily"
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              Daily
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "lifetime"}
              onClick={() => set({
                mode: "lifetime",
                totalLifetimeCents: budget.totalLifetimeCents || budget.totalDailyCents || 0,
                capCents: budget.totalLifetimeCents || budget.totalDailyCents || 0,
              })}
              className={[
                "h-8 px-3 text-xs font-medium rounded-md",
                mode === "lifetime"
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              Total (lifetime)
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            The campaign starts paused; spending begins only when you launch it from the
            campaign page. Hard cap: ${(capCents / 100).toFixed(2)}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1.5 block">
          <span className="block text-sm font-medium">Start</span>
          <input
            type="datetime-local"
            className="w-full h-9 rounded-md border border-[var(--gray-300)] px-2 text-sm"
            value={budget.startsAtLocal ?? ""}
            onChange={(e) => {
              const local = e.target.value;
              set({
                startsAtLocal: local,
                startsAt: local ? new Date(local).toISOString() : null,
              });
            }}
          />
        </label>
        <label className="space-y-1.5 block">
          <span className="block text-sm font-medium">
            End{mode === "lifetime" ? " (required)" : ""}
          </span>
          <input
            type="datetime-local"
            className="w-full h-9 rounded-md border border-[var(--gray-300)] px-2 text-sm"
            value={budget.endsAtLocal ?? ""}
            onChange={(e) => {
              const local = e.target.value;
              set({
                endsAtLocal: local,
                endsAt: local ? new Date(local).toISOString() : null,
              });
            }}
          />
        </label>
      </div>

      {mode === "daily" && days != null && (
        <label className="space-y-1.5 block max-w-sm">
          <span className="block text-sm font-medium">Hard cap (USD)</span>
          <CurrencyInput
            id="hard-cap"
            cents={budget.capCents ?? capCents}
            onCentsChange={(capCentsNext) => set({ capCents: capCentsNext })}
            helper={`Defaults to daily × ${days} days when dates are set.`}
          />
        </label>
      )}

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

      {amountCents > 0 && allocations.length > 0 && (
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

      {belowMinimum && (
        <AlertCard variant="warning" title="Below platform minimum">
          <p className="text-xs mt-1">
            {platforms.join(", ")} for {d1.days} day{d1.days === 1 ? "" : "s"} need at least $
            {(d1.minBudgetCents / 100).toFixed(2)}. You entered ${(amountCents / 100).toFixed(2)}.
            Each platform has its own minimum.
          </p>
        </AlertCard>
      )}

      {googleShort && (
        <AlertCard variant="warning" title="Google needs at least 3 days">
          <p className="text-xs mt-1">
            Google has no money minimum, but it won&apos;t run a total budget for less than 3 days.
            Your dates cover {days ?? 0}.
          </p>
        </AlertCard>
      )}

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

      {mode === "daily" && (
        <AlertCard variant="info" title="A day can cost more than your daily budget">
          {PACING_DISCLOSURES.meta} {PACING_DISCLOSURES.google} The hard cap never moves.
        </AlertCard>
      )}

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
