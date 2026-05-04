/**
 * PHOTO LABELING PAGE — ORCH-0708 Phase 0
 *
 * Operator labels real-world places with expected photo-aesthetic JSON outputs.
 * Anchors (6 fixed categories) feed into Claude's system prompt as calibration
 * examples. Fixtures (30, 10 per Raleigh/Cary/Durham) serve as regression-test
 * golden answers for the Compare-with-Claude diff view.
 *
 * Three tabs:
 *   1. Anchors (6 slots)        — see ANCHOR_CATEGORIES in constants/photoLabeling.js
 *   2. Fixtures (30 slots)      — 10 per city, broader candidate picker
 *   3. Compare with Claude      — side-by-side diff (activates after photo-aesthetic backfill)
 *
 * Spec:     Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md (§24)
 * Dispatch: Mingla_Artifacts/prompts/IMPL_ORCH-0708_PHASE_0_LABELING_TOOL.md
 */

import { useState } from "react";
import { Camera, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { useToast } from "../context/ToastContext";
import { AnchorsTab } from "../components/photoLabeling/AnchorsTab";
import { FixturesTab } from "../components/photoLabeling/FixturesTab";
import { CompareWithClaudeTab } from "../components/photoLabeling/CompareWithClaudeTab";
import { exportAnchorsJson, exportFixturesJson } from "../components/photoLabeling/exporters";

const TABS = [
  { id: "anchors", label: "Anchors (6)" },
  { id: "fixtures", label: "Fixtures (30)" },
  { id: "compare", label: "Compare with Claude" },
];

const TAB_TRANSITION = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: "easeOut" },
};

export function PhotoLabelingPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState("anchors");
  const [exportingAnchors, setExportingAnchors] = useState(false);
  const [exportingFixtures, setExportingFixtures] = useState(false);

  async function handleExportAnchors() {
    setExportingAnchors(true);
    try {
      const count = await exportAnchorsJson();
      addToast({
        variant: "success",
        title: `Exported ${count} anchor${count === 1 ? "" : "s"}`,
        description: "Saved as a system-prompt-injection text block.",
      });
    } catch (err) {
      console.error("[PhotoLabelingPage] export anchors failed:", err);
      addToast({
        variant: "error",
        title: "Couldn't export anchors",
        description: err?.message || "Unknown error.",
      });
    } finally {
      setExportingAnchors(false);
    }
  }

  async function handleExportFixtures() {
    setExportingFixtures(true);
    try {
      const count = await exportFixturesJson();
      addToast({
        variant: "success",
        title: `Exported ${count} fixture${count === 1 ? "" : "s"}`,
        description: "Saved as JSON matching photo_aesthetic_golden_fixtures.v1.",
      });
    } catch (err) {
      console.error("[PhotoLabelingPage] export fixtures failed:", err);
      addToast({
        variant: "error",
        title: "Couldn't export fixtures",
        description: err?.message || "Unknown error.",
      });
    } finally {
      setExportingFixtures(false);
    }
  }

  return (
    <div className="max-w-[var(--content-max-width)] mx-auto px-6 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
            <Camera className="w-5 h-5 text-[var(--color-brand-500)]" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
              Photo Labeling
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              Calibration anchors (6) and golden fixtures (30) for the photo-aesthetic scorer.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={handleExportAnchors}
            loading={exportingAnchors}
          >
            Export Anchors JSON
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={handleExportFixtures}
            loading={exportingFixtures}
          >
            Export Fixtures JSON
          </Button>
        </div>
      </div>

      {/* Tabs */}
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
              {activeTab === "anchors" && <AnchorsTab />}
              {activeTab === "fixtures" && <FixturesTab />}
              {activeTab === "compare" && <CompareWithClaudeTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default PhotoLabelingPage;
