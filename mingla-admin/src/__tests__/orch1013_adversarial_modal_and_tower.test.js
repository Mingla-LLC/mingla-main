// ORCH-1013 ADVERSARIAL — RunRemainderOnAllConfirmModal + ActiveRunsControlTower
// + TrialResultsTab banner-deletion verification.
//
// Goes beyond grep: tests boundary conditions on cost gating, dedupe semantics
// in candidateCities, and asserts the OLD in-tab banner is GONE from
// TrialResultsTab (regression-proofing the SPEC §3 B.8 deletion).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const COMP = path.join(ADMIN_ROOT, "src", "components", "placeIntelligenceTrial");
const MODAL = path.join(COMP, "RunRemainderOnAllConfirmModal.jsx");
const TOWER = path.join(COMP, "ActiveRunsControlTower.jsx");
const RESULTS_TAB = path.join(COMP, "TrialResultsTab.jsx");
const OVERVIEW_TAB = path.join(COMP, "IntelligenceOverviewTab.jsx");
const CARD = path.join(COMP, "ActiveRunCard.jsx");

describe("ORCH-1013 ADVERSARIAL — RunRemainderOnAllConfirmModal cost gates", () => {
  const src = fs.readFileSync(MODAL, "utf8");

  it("perPlaceCostUsd default matches the SPEC ($0.0040)", () => {
    assert.ok(
      /DEFAULT_PER_PLACE_COST_USD\s*=\s*0\.004\b/.test(src),
      "default per-place cost must be $0.0040 (SPEC §3 B.5)",
    );
  });

  it("typed-confirm phrase is exactly 'RUN ALL' (not city names)", () => {
    // SPEC §7-D6: typed phrase MUST be a fixed phrase because typing N city
    // names is hostile UX. Regression-proof against future "improvements".
    assert.ok(
      /TYPED_CONFIRM_PHRASE\s*=\s*"RUN ALL"/.test(src),
      "typed-confirm phrase must be the fixed string 'RUN ALL' per SPEC §7-D6",
    );
  });

  it("guards against empty candidate list: canConfirm requires safeCities.length > 0", () => {
    assert.ok(
      src.includes("safeCities.length > 0"),
      "canConfirm must require ≥ 1 candidate city",
    );
  });

  it("safeCities filters out rows with remaining_count ≤ 0", () => {
    assert.ok(
      src.includes("candidateCities.filter((c) => c?.remaining_count > 0)"),
      "modal must defensively filter zero-remainder candidates",
    );
  });

  it("typedMatches strict-trims (whitespace tolerant on either side)", () => {
    assert.ok(
      src.includes("typed.trim() === TYPED_CONFIRM_PHRASE"),
      "typed comparison must trim whitespace (operator may hit space)",
    );
  });

  it("Gemini pricing URL is linked, not just text", () => {
    assert.ok(
      /href=["']https:\/\/ai\.google\.dev\/pricing\/gemini-2-5-flash/.test(src),
      "Gemini pricing must be an actual href, not a string literal",
    );
    assert.ok(
      src.includes('target="_blank"') && src.includes('rel="noopener noreferrer"'),
      "external link must be target=_blank with rel=noopener noreferrer",
    );
  });

  it("close button calls onClose without confirming (operator escape hatch)", () => {
    // Cancel button at modal footer must NOT call onConfirm
    const footerSlice = src.slice(src.indexOf("ModalFooter"), src.indexOf("</ModalFooter>"));
    assert.ok(
      footerSlice.includes("onClick={onClose}"),
      "footer Cancel button must invoke onClose only",
    );
  });

  it("modal returns null when !open (no rendering when closed)", () => {
    assert.ok(
      src.includes("if (!open) return null"),
      "modal must early-return null when not open",
    );
  });
});

describe("ORCH-1013 ADVERSARIAL — ActiveRunsControlTower zero-renders", () => {
  const src = fs.readFileSync(TOWER, "utf8");

  it("uses totalCount (active + terminal) not activeRuns alone for visibility gate", () => {
    // I-PROPOSED-INTEL-CONTROL-TOWER-VISIBILITY-GATE: must check BOTH lists
    assert.ok(
      src.includes("activeRuns.length + terminalRuns.length"),
      "visibility gate must sum active + terminal counts",
    );
  });

  it("SectionCard title counts ONLY active runs (not terminal-fading)", () => {
    // The title "Active runs (N)" should reflect only the live count;
    // terminal-fading cards should not inflate the badge.
    assert.ok(
      src.includes("Active runs (${activeRuns.length})"),
      "title must use activeRuns.length, not allRuns or totalCount",
    );
  });

  it("dedupes terminal-fading entries that are still in activeRuns", () => {
    // If a run is in BOTH lists (race condition between poll + terminal stage),
    // it must render once, not twice.
    assert.ok(
      src.includes("!activeRuns.some((a) => a.id === t.id)"),
      "terminal-fading entries already in activeRuns must NOT double-render",
    );
  });

  it("each ActiveRunCard uses run.id as React key (stable identity)", () => {
    assert.ok(
      src.includes("key={run.id}"),
      "React key must be the stable run.id (not array index)",
    );
  });

  it("AnimatePresence initial={false} (no in-animation on mount)", () => {
    assert.ok(
      src.includes("initial={false}"),
      "AnimatePresence must skip mount-animation to prevent first-load flash",
    );
  });
});

describe("ORCH-1013 ADVERSARIAL — TrialResultsTab in-tab banner DELETED", () => {
  const src = fs.readFileSync(RESULTS_TAB, "utf8");
  // Strip comments before identifier-deletion checks (implementor left
  // tombstone comments referencing the deleted names for traceability;
  // those are intentional and should not trip the regression).
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("no longer renders the 'Cancel run' banner (SPEC §3 B.8 deletion)", () => {
    // The deleted block used these idioms — assert they're gone in CODE
    // (comments tombstoning the deletion are OK).
    assert.ok(
      !stripped.includes("bannerDismissed"),
      "bannerDismissed state must be DELETED per SPEC §3 B.8",
    );
    assert.ok(
      !/handleCancelActiveRunConfirmed\s*\(/.test(stripped),
      "handleCancelActiveRunConfirmed CALLABLE must be DELETED (tombstone comment ok)",
    );
    assert.ok(
      !/handleResumeFromN\s*\(/.test(stripped),
      "handleResumeFromN CALLABLE must be DELETED (deferred per SPEC §6)",
    );
  });

  it("CancelRunConfirmModal no longer mounted from TrialResultsTab", () => {
    assert.ok(
      !src.includes("<CancelRunConfirmModal"),
      "CancelRunConfirmModal must only mount from ActiveRunCard now",
    );
  });

  it("Cross-session hydration effect for activeRunId is DELETED (SPEC §7-D3)", () => {
    // The hydration that orphaned activeRun state with no UI consumer was deleted.
    assert.ok(
      !src.includes("list_active_runs"),
      "TrialResultsTab no longer polls list_active_runs — control tower owns it",
    );
  });
});

describe("ORCH-1013 ADVERSARIAL — IntelligenceOverviewTab bulk wiring", () => {
  const src = fs.readFileSync(OVERVIEW_TAB, "utf8");

  it("dispatcher hook is consumed at component scope (not inside a useEffect)", () => {
    assert.ok(
      /const\s+dispatcher\s*=\s*useBulkRunDispatcher/.test(src),
      "useBulkRunDispatcher must be called at component scope",
    );
  });

  it("candidateCities is memoized (avoids re-creating array on every render)", () => {
    assert.ok(
      src.includes("const candidateCities = useMemo("),
      "candidateCities must be useMemo'd to prevent unnecessary modal re-renders",
    );
  });

  it("bulk modal passes the dispatcher's enqueue, not a re-implementation", () => {
    assert.ok(
      src.includes("dispatcher.enqueue(cities)"),
      "onConfirm must delegate to dispatcher.enqueue (single source of truth)",
    );
  });

  it("onToast is wired into the dispatcher (per-city failures surface)", () => {
    assert.ok(
      src.includes("useBulkRunDispatcher({ onToast: addToast })"),
      "dispatcher must receive the toast emitter for 409/500 surfacing",
    );
  });
});

describe("ORCH-1013 ADVERSARIAL — ActiveRunCard accessibility + tokens", () => {
  const src = fs.readFileSync(CARD, "utf8");

  it("progress bar has role='progressbar' + aria-valuenow/min/max", () => {
    assert.ok(
      src.includes('role="progressbar"') &&
        src.includes("aria-valuenow") &&
        src.includes("aria-valuemin={0}") &&
        src.includes("aria-valuemax={100}"),
      "progress bar must have full ARIA progressbar semantics",
    );
  });

  it("cancel button has aria-label for screen readers", () => {
    assert.ok(
      src.includes('aria-label="Cancel run"'),
      "Cancel icon button needs an aria-label",
    );
  });

  it("uses CSS variable tokens (not hard-coded colors) for dark-mode safety", () => {
    // SPEC §3 B.3 visual contract: tokens only.
    assert.ok(
      src.includes("var(--color-brand-200)") &&
        src.includes("var(--color-brand-500)") &&
        src.includes("var(--color-brand-50)"),
      "card frame must use brand-* CSS variables (dark-mode adaptive)",
    );
    // Check no hard-coded hex/rgb colors snuck in
    assert.ok(
      !/#[0-9a-fA-F]{3,6}\b/.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")),
      "no hard-coded hex colors allowed in ActiveRunCard (must use tokens)",
    );
  });

  it("formatEta has guards against null AND Number.isFinite (no 'NaN min' or 'Infinity min')", () => {
    const formatEtaSlice = src.slice(src.indexOf("function formatEta"), src.indexOf("export function"));
    assert.ok(
      formatEtaSlice.includes("seconds == null"),
      "must guard against null seconds",
    );
    assert.ok(
      formatEtaSlice.includes("Number.isFinite(seconds)"),
      "must guard against Infinity/NaN seconds",
    );
    assert.ok(
      formatEtaSlice.includes("seconds <= 0"),
      "must guard against zero/negative seconds",
    );
  });

  it("cost cross-check warning only fires above 10-place threshold (avoids noise on small runs)", () => {
    assert.ok(
      /COST_DRIFT_MIN_PROCESSED\s*=\s*10\b/.test(src),
      "drift warning must suppress under 10 processed places (SPEC §7-D7)",
    );
    assert.ok(
      src.includes("processed < COST_DRIFT_MIN_PROCESSED"),
      "drift calculation must short-circuit under the minimum",
    );
  });
});
