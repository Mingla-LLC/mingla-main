/**
 * PLACE INTELLIGENCE TRIAL PAGE — ORCH-0712 → ORCH-0734 → ORCH-1008
 *
 * Research/exploratory tool. Per ORCH-0734 (2026-05-05), the 32-anchor
 * calibration scaffold is decommissioned; trial pipeline is now city-scoped
 * sampled-sync. Operator picks a city + sample size (50-500) on Trial Results;
 * edge fn loads stratified random sample of place_pool servable rows; Gemini
 * 2.5 Flash scores all 16 signals per place in one call. Per DEC-102 Gemini is
 * sole provider; per DEC-104 (logged at ORCH-0734 CLOSE) signal_anchors table
 * + Signal Anchors admin tab are dropped.
 *
 * ORCH-1008 (2026-05-29):
 *   - Outer wrapper padding fixed (Phase 2) — AppShell owns horizontal layout.
 *   - New default "Overview" tab (Phase 3a) renders per-city coverage table +
 *     "Run remainder" CTA per city. Existing "Trial Results" is the 2nd tab.
 *   - Edge fn extended with mode='remainder' (Phase 3b).
 *
 * Output stored in place_intelligence_trial_runs (city_id non-null on
 * city-runs rows; legacy 32-anchor rows preserve NULL for audit).
 * NEVER feeds card ranking (I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING).
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-1008_ADMIN_SHELL_PRUNE_INTELLIGENCE_OVERVIEW.md
 */

import { useState } from "react";
import { Microscope } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs } from "../components/ui/Tabs";
import { TrialResultsTab } from "../components/placeIntelligenceTrial/TrialResultsTab";
import { IntelligenceOverviewTab } from "../components/placeIntelligenceTrial/IntelligenceOverviewTab";

// ORCH-1008 — Overview is the operator's landing tab; Trial Results follows.
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "results", label: "Trial Results" },
];

const TAB_TRANSITION = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: "easeOut" },
};

export function PlaceIntelligenceTrialPage({ onTabChange }) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="py-6 flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Microscope className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Place Intelligence Trial
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Pick a city + sample size, score servable places with Gemini 2.5 Flash against
            Mingla's 16 signals. Research-only — output never feeds card ranking.
          </p>
        </div>
      </div>

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
              {activeTab === "overview" && (
                <IntelligenceOverviewTab
                  onSwitchToResults={() => setActiveTab("results")}
                  onTabChange={onTabChange}
                />
              )}
              {activeTab === "results" && <TrialResultsTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default PlaceIntelligenceTrialPage;
