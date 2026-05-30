/**
 * ActiveRunsControlTower — ORCH-1013 Finding B
 *
 * Pinned panel mounted ABOVE the Place Intelligence tabs (in
 * PlaceIntelligenceTrialPage). Renders one <ActiveRunCard /> per in-flight
 * run; auto-hides when there are no active or terminal runs to display.
 *
 * Polling is owned by useActiveRunsPoller (5s tick, visibility-aware,
 * tab-close-durable: server retains place_intelligence_runs rows).
 *
 * Replaces the in-tab active-run banner formerly mounted at
 * TrialResultsTab L702-L769 (deleted in this same PR).
 *
 * Invariant I-PROPOSED-INTEL-CONTROL-TOWER-VISIBILITY-GATE: returns null when
 * BOTH activeRuns.length === 0 AND terminalRuns.length === 0. No empty card frame.
 *
 * Gemini pricing reference (COMMS-0003):
 * https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-30).
 *
 * SPEC §3 B.2.
 */

// `motion` is consumed via member access (`Motion.div`); the no-unused-vars
// rule doesn't track that, so import under an uppercase alias to match the
// rule's varsIgnorePattern `^[A-Z_]`.
import { AnimatePresence, motion as Motion } from "framer-motion";
import { SectionCard } from "../ui/Card";
import { ActiveRunCard } from "./ActiveRunCard";
import { useActiveRunsPoller } from "../../hooks/useActiveRunsPoller";

const CARD_TRANSITION = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 8 },
  transition: { duration: 0.2, ease: "easeOut" },
};

export function ActiveRunsControlTower({ onViewRun }) {
  const { activeRuns, terminalRuns, error } = useActiveRunsPoller();

  const totalCount = activeRuns.length + terminalRuns.length;
  if (totalCount === 0) return null;

  // Render terminal runs first (they're transient), then active runs by
  // started_at desc so the freshest run is at the bottom or top consistently.
  // Per SPEC just stack vertically with gap-2; ordering preserves identity.
  const allRuns = [
    ...activeRuns,
    ...terminalRuns.filter(
      (t) => !activeRuns.some((a) => a.id === t.id),
    ),
  ];

  return (
    <SectionCard
      title={`Active runs (${activeRuns.length})`}
      role="region"
      aria-label="Active intelligence runs"
    >
      <div className="flex flex-col gap-2" role="region" aria-label="Active intelligence runs">
        {error && (
          <p className="text-xs text-[var(--color-warning-700)] italic">
            {error}
          </p>
        )}
        <AnimatePresence initial={false}>
          {allRuns.map((run) => (
            <Motion.div
              key={run.id}
              layout
              initial={CARD_TRANSITION.initial}
              animate={CARD_TRANSITION.animate}
              exit={CARD_TRANSITION.exit}
              transition={CARD_TRANSITION.transition}
            >
              <ActiveRunCard run={run} onViewRun={onViewRun} />
            </Motion.div>
          ))}
        </AnimatePresence>
      </div>
    </SectionCard>
  );
}

export default ActiveRunsControlTower;
