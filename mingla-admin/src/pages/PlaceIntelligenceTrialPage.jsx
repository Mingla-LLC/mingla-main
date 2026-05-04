/**
 * PLACE INTELLIGENCE TRIAL PAGE — ORCH-0712
 *
 * Research/exploratory tool. Operator picks 2 anchor places per Mingla signal
 * (32 total), bundles everything per place (place_pool data + 100 Serper reviews
 * + adaptive photo collage), sends to Claude with TWO questions:
 *   Q1 — propose new vibes/signals (open exploration)
 *   Q2 — evaluate against existing 16 Mingla signals (closed structured)
 *
 * Output stored in place_intelligence_trial_runs. NEVER feeds card ranking.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md §5
 */

import { useState } from "react";
import { Microscope } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCard } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { SignalAnchorsTab } from "../components/placeIntelligenceTrial/SignalAnchorsTab";
import { TrialResultsTab } from "../components/placeIntelligenceTrial/TrialResultsTab";

const TABS = [
  { id: "anchors", label: "Signal Anchors" },
  { id: "results", label: "Trial Results" },
];

const TAB_TRANSITION = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: "easeOut" },
};

export function PlaceIntelligenceTrialPage() {
  const [activeTab, setActiveTab] = useState("anchors");

  return (
    <div className="max-w-[var(--content-max-width)] mx-auto px-6 py-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Microscope className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Place Intelligence Trial
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Bundle everything per place — photos, Google metadata, Serper reviews — and ask
            Claude to (1) propose new vibes/signals beyond our existing 16, (2) evaluate
            against the existing 16. Research-only. Output never feeds card ranking.
          </p>
        </div>
      </div>

      <AlertCard variant="info" title="How this works">
        Pick 2 anchor places per signal (32 total) → run "prepare_all" to fetch reviews + build
        collages → click "Run trial" → ~30 minutes later, read Claude's per-place analysis.
        Estimated cost ~$1.50 for the full 32-place trial.
      </AlertCard>

      <div>
        <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
        <div className="pt-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={TAB_TRANSITION.initial}
              animate={TAB_TRANSITION.animate}
              exit={TAB_TRANSITION.exit}
              transition={TAB_TRANSITION.transition}
            >
              {activeTab === "anchors" && <SignalAnchorsTab />}
              {activeTab === "results" && <TrialResultsTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default PlaceIntelligenceTrialPage;
