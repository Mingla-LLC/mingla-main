#!/usr/bin/env node
/**
 * I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT strict-grep gate.
 *
 * Enforces ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer +
 * Planner Surfaces] invariant: every buyer-facing trip checkout file that
 * references the schedule data signal (`installmentSchedule`) MUST also
 * import the `InstallmentScheduleDisplay` component (or compose a
 * component that imports it). Adding a new trip-buyer route without the
 * disclosure import fails CI at PR time.
 *
 * Why: ORCH-0873 [Tr3 Installment Payments Stage 2 UI] shipped the
 * `InstallmentScheduleDisplay` component but deferred wiring it into the
 * buyer-facing checkout routes; ORCH-0876 V2 [Trip CRUD + Purchase Flow
 * Completion] then forked the buyer routes leaving the disclosure orphan
 * for over a week. ORCH-0882 closes the gap and this gate prevents the
 * same drift from recurring.
 *
 * Established by: ORCH-0882 CLOSE. Invariant flips DRAFT → ACTIVE on close.
 *
 * Files in scope (5 buyer touchpoints + 2 planner touchpoints):
 *   1. mingla-business/src/components/trip/TripCheckoutFlow.tsx
 *   2. mingla-business/app/checkout-trip/[tripEventId]/index.tsx
 *   3. mingla-business/app/checkout-trip/[tripEventId]/intake.tsx
 *   4. mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx
 *   5. mingla-business/app/checkout-trip/[tripEventId]/payment.tsx
 *   6. mingla-business/src/components/trip/EditPublishedTripScreen.tsx
 *   7. mingla-business/app/trip/[id]/index.tsx
 *
 * Detection rule: for each scoped file, verify the source contains BOTH:
 *   (a) literal substring `InstallmentScheduleDisplay` — the component
 *       import/usage marker
 *   (b) literal substring `installmentSchedule` — the data-signal marker
 *
 * If a scoped file lacks either marker, fail. The file should either:
 *   (a) be removed from this gate's scope list with an inline justification
 *       comment in the closing ORCH's PR description, OR
 *   (b) be updated to import + render the component.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one scoped file is missing a required marker
 *   2 — internal error (file system / encoding)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const SCOPED_FILES = [
  "mingla-business/src/components/trip/TripCheckoutFlow.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/index.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/intake.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/payment.tsx",
  "mingla-business/src/components/trip/EditPublishedTripScreen.tsx",
  "mingla-business/app/trip/[id]/index.tsx",
];

const REQUIRED_MARKERS = ["InstallmentScheduleDisplay", "installmentSchedule"];

let violations = 0;

for (const relPath of SCOPED_FILES) {
  const absPath = path.join(repoRoot, relPath);
  let src;
  try {
    src = fs.readFileSync(absPath, "utf8");
  } catch (err) {
    console.error(
      `[FAIL] Could not read scoped file ${relPath}: ${err.message}`,
    );
    process.exit(2);
  }
  const missing = REQUIRED_MARKERS.filter((m) => !src.includes(m));
  if (missing.length > 0) {
    console.error(
      `[FAIL] ${relPath}: missing required marker(s) ${missing
        .map((m) => `\`${m}\``)
        .join(", ")} — ORCH-0882 invariant violation (I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT)`,
    );
    violations += 1;
  }
}

if (violations > 0) {
  console.error(
    `\nI-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT: ${violations} file(s) failed. Either restore the disclosure wiring or remove the file from this gate's SCOPED_FILES list with an inline justification.`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT: ${SCOPED_FILES.length} file(s) scanned, all carry the required markers. PASS.`,
);
process.exit(0);
