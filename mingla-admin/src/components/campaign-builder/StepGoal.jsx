/**
 * ISSUE-864 WP4 — Step: Goal(s) (SPEC A1 + A4.0(5), blueprint §1.1).
 * Multi-select goal cards in plain language — never platform jargon.
 * Reservations/Retargeting are HIDDEN entirely until #865 (config-driven:
 * they exist in the goals array with visible:false — no dead buttons).
 */

import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { AlertCard } from "../ui/Card";
import { visibleGoals, platformsForGoals, DISJOINT_GOALS_WARNING } from "../../lib/adBuilder/goals";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";

export function StepGoal({ goalIds, onGoalsChange }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const goals = visibleGoals();
  const { disjoint } = platformsForGoals(goalIds);

  const toggle = (id) => {
    onGoalsChange(goalIds.includes(id) ? goalIds.filter((g) => g !== id) : [...goalIds, id]);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What do you want this campaign to do?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Pick one or more. The engine figures out which channels can deliver each goal.
        </p>
      </div>

      <div role="group" aria-label="Campaign goals" className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {goals.map((goal) => {
          const selected = goalIds.includes(goal.id);
          return (
            <button
              key={goal.id}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => toggle(goal.id)}
              className={[
                "text-left p-4 rounded-xl border transition-all duration-150 cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
                selected
                  ? "border-[var(--color-brand-500)] ring-1 ring-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                  : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
              ].join(" ")}
            >
              <div className="flex items-center gap-2 mb-1">
                {selected && <Check size={14} className="text-[var(--color-brand-600)]" aria-hidden="true" />}
                <span className="text-sm font-semibold">{goal.label}</span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">{goal.description}</p>
              {goal.honestyNote && (
                <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">{goal.honestyNote}</p>
              )}
              <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1.5">
                Channels: {Object.keys(goal.platforms).map((p) => PLATFORM_LABELS[p]).join(", ")}
              </p>
            </button>
          );
        })}
      </div>

      {goalIds.length === 0 && (
        <p className="text-xs text-[#ef4444]">Pick at least one goal.</p>
      )}
      {disjoint && (
        <AlertCard variant="warning" title="These goals don't share a channel">
          {DISJOINT_GOALS_WARNING}
        </AlertCard>
      )}

      <div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced
        </button>
        {advancedOpen && (
          <div className="mt-2 p-3 rounded-lg border border-[var(--gray-200)] text-xs text-[var(--color-text-secondary)] space-y-1">
            <p>
              Exact platform objectives are derived per goal and shown on Review — Meta
              traffic optimizes <span className="font-mono">LINK_CLICKS</span> (landing-page
              views need the pixel, which has never fired — that unlocks with #865);
              awareness optimizes <span className="font-mono">REACH</span>.
            </p>
            <p>
              A frequency-cap control appears here for reach campaigns once the create
              endpoint supports it — Meta only accepts frequency caps on REACH/THRUPLAY ad sets.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
