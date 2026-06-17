#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1148 sub-ORCH 2.2b [consumer venue reserve] structural regression.
 *
 * The "Reserve a table" sheet would not visibly open: tapping the CTA flipped
 * `isReserveSheetOpen` true → `anyChildModalOpen` true → the root card sheet was
 * gated off (`visible={visible && !anyChildModalOpen}`) and animated closed (the
 * card collapsed), while the ALWAYS-MOUNTED VenueReserveSheet only toggled its
 * `visible` prop. Because both share the inline (non-RN-Modal) presentation slot
 * and the root was closing in the same render, the sub-sheet's open never
 * presented. Nothing opened → onClose never fired → `isReserveSheetOpen` stayed
 * true → the root stayed suppressed → the card could not be re-expanded.
 *
 * FIX (2026-06-17): mount-on-open, mirroring the proven ConsumerExperienceDetail
 * sibling (`{selectedVenueExperience !== null && <…>}`). VenueReserveSheet is
 * rendered ONLY while `isReserveSheetOpen` is true (still behind the reservable
 * gate), so a freshly mounted BaseBottomSheet performs a clean open animation in
 * the freed slot; closing it (CTA / pan-down / backdrop → resetAndClose →
 * onClose) unmounts AND resets the flag, ungating the root so the card restores.
 *
 * This check fails-on-revert of commit that introduced the `&& isReserveSheetOpen`
 * mount-on-open guard on the VenueReserveSheet render block.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const source = read("app-mobile/src/components/ExpandedCardModal.tsx");
const reserveSheetSource = read(
  "app-mobile/src/components/expandedCard/VenueReserveSheet.tsx",
);
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const mainStart = source.indexOf("export default function ExpandedCardModal");
const mainBody = mainStart >= 0 ? source.slice(mainStart) : "";

// Locate the VenueReserveSheet render block (gate condition → element).
const reserveRenderStart = mainBody.indexOf("venueReservable?.reservable === true");
const reserveRenderEnd = mainBody.indexOf(
  "/>",
  mainBody.indexOf("<VenueReserveSheet", reserveRenderStart),
);
const reserveRenderBlock =
  reserveRenderStart >= 0 && reserveRenderEnd > reserveRenderStart
    ? mainBody.slice(reserveRenderStart, reserveRenderEnd)
    : "";

check(
  "G-01 reserve sheet is MOUNT-ON-OPEN (mirrors the experience-detail sibling)",
  reserveRenderBlock.includes("isReserveSheetOpen && (") &&
    reserveRenderBlock.includes("<VenueReserveSheet"),
  "VenueReserveSheet must be rendered only while isReserveSheetOpen is true (mount==open), so a fresh BaseBottomSheet opens in the freed slot instead of toggling visibility on an always-mounted sheet that races the root sheet's close.",
);

check(
  "G-02 experience-detail sibling stays mount-on-open (the proven pattern)",
  /\{selectedVenueExperience !== null && \(/.test(mainBody) &&
    mainBody.includes("<ConsumerExperienceDetailScreen"),
  "The reference sibling ConsumerExperienceDetailScreen must remain mount-on-open; the reserve sheet matches it.",
);

check(
  "G-03 reserve flag participates in the child-overlay gate and the swallow",
  /const anyChildModalOpen\s*=\s*[\s\S]*?isReserveSheetOpen;/s.test(mainBody) &&
    /const handleRootSheetClose = useCallback[\s\S]*?isReserveSheetOpen\) \{[\s\S]*?return;/s.test(
      mainBody,
    ),
  "isReserveSheetOpen must gate the root sheet (anyChildModalOpen) AND be swallowed by handleRootSheetClose so the synthetic root close does not tear the card down while the reserve sheet is open.",
);

check(
  "G-04 closing the reserve sheet resets isReserveSheetOpen to false",
  mainBody.includes("onClose={() => setIsReserveSheetOpen(false)}"),
  "The reserve sheet's onClose must set isReserveSheetOpen=false so the root ungates and the card restores / can re-expand.",
);

check(
  "G-05 VenueReserveSheet dismissal paths all route through onClose",
  reserveSheetSource.includes("const resetAndClose = (): void => {") &&
    /const resetAndClose = \(\): void => \{[\s\S]*?onClose\(\);/s.test(
      reserveSheetSource,
    ) &&
    reserveSheetSource.includes("onClose={resetAndClose}"),
  "BaseBottomSheet pan-down/backdrop dismissal and the close icon must funnel through resetAndClose → onClose so the parent flag always resets on dismissal.",
);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.pass) console.log(`  ${item.detail}`);
}

if (failures.length > 0) {
  console.error(
    `ORCH-1148 reserve-sheet mount-on-open regression failed: ${failures.length}/${checks.length}`,
  );
  process.exit(1);
}

console.log("ORCH-1148 reserve-sheet mount-on-open regression passed.");
