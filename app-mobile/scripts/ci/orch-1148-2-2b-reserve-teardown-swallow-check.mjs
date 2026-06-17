#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1148 sub-ORCH 2.2b [consumer reserve] FREEZE-fix regression check.
 *
 * THE BUG (INVESTIGATE_ORCH-1148_RESERVE_FREEZE.md): tapping "Reserve a table"
 * flips `isReserveSheetOpen=true`, which (correctly) suppresses the root
 * BaseBottomSheet via `anyChildModalOpen` → the sheet emits a synthetic close.
 * But `handleRootSheetClose` did NOT swallow that close for `isReserveSheetOpen`
 * (it was omitted from BOTH the swallow condition and the deps array), so the
 * close propagated to the parent `onClose` → the card was torn down at the exact
 * instant the reserve sheet was mid-open → orphaned full-screen gorhom backdrop
 * captured all touches → FREEZE (the ORCH-1064 signature).
 *
 * THE INVARIANT this gate locks (the one silently broken by 2.2b):
 *   EVERY child-overlay open flag that participates in `anyChildModalOpen` MUST
 *   ALSO be handled by `handleRootSheetClose`'s swallow condition (so opening a
 *   child overlay suppresses the root sheet WITHOUT tearing the card down) AND
 *   be present in that callback's deps array (no stale closure). Specifically,
 *   `isReserveSheetOpen` must be in ALL THREE: anyChildModalOpen, the swallow
 *   condition, and the deps array.
 *
 * Source-structure check (the established ExpandedCardModal invariant pattern —
 * see orch-1022-expanded-card-modal-gating-check.mjs). Fails-on-revert: remove
 * `|| isReserveSheetOpen` from the swallow condition (or from anyChildModalOpen,
 * or the deps) and this gate goes red.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const source = read("app-mobile/src/components/ExpandedCardModal.tsx");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// ── Extract the three load-bearing fragments. ──────────────────────────────
const anyChildMatch = source.match(
  /const anyChildModalOpen\s*=\s*([\s\S]*?);/,
);
const handleCloseMatch = source.match(
  /const handleRootSheetClose = useCallback\(\(\) => \{([\s\S]*?)\}, \[([\s\S]*?)\]\);/,
);

const anyChildBody = anyChildMatch ? anyChildMatch[1] : "";
const swallowBody = handleCloseMatch ? handleCloseMatch[1] : "";
const depsBody = handleCloseMatch ? handleCloseMatch[2] : "";

check(
  "structure: anyChildModalOpen + handleRootSheetClose both parsed",
  Boolean(anyChildMatch) && Boolean(handleCloseMatch),
  "Could not locate `anyChildModalOpen` and/or `handleRootSheetClose` in ExpandedCardModal.tsx — the freeze-fix invariant cannot be verified.",
);

// The known child-overlay open flags (each maps to a child surface that owns
// the screen while open). Each must be in anyChildModalOpen, the swallow
// condition, AND the deps array. The canonical "flag token" is the substring
// that appears in all three (e.g. `isReserveSheetOpen`, `browserUrl`,
// `curatedLightbox.visible`).
const CHILD_OVERLAY_FLAGS = [
  "browserUrl",
  "ticketBrowserUrl",
  "isNightOutShareOpen",
  "isSchedulePickerOpen",
  "curatedLightbox.visible",
  "selectedVenueExperience",
  "isReserveSheetOpen",
];

// INVARIANT: every flag that gates anyChildModalOpen must also gate the swallow
// condition + appear in the deps array.
for (const flag of CHILD_OVERLAY_FLAGS) {
  const inAggregate = anyChildBody.includes(flag);
  if (!inAggregate) continue; // only assert for flags actually in the aggregate
  check(
    `INVARIANT: \`${flag}\` in anyChildModalOpen ⇒ also in handleRootSheetClose swallow condition`,
    swallowBody.includes(flag),
    `\`${flag}\` suppresses the root sheet via anyChildModalOpen but is NOT in the swallow condition — the synthetic root close will tear down the expanded card while the child overlay is mid-open (the ORCH-1148 reserve-freeze signature).`,
  );
  // deps token: for member-access flags (curatedLightbox.visible) the dep is
  // the same expression; for plain identifiers it's the bare name.
  check(
    `INVARIANT: \`${flag}\` present in handleRootSheetClose deps array (no stale closure)`,
    depsBody.includes(flag),
    `\`${flag}\` is read inside handleRootSheetClose but missing from its useCallback deps — latent stale-closure bug.`,
  );
}

// Explicit, named assertion for the exact 2.2b regression (belt + braces).
check(
  "ORCH-1148: isReserveSheetOpen is in anyChildModalOpen",
  anyChildBody.includes("isReserveSheetOpen"),
  "The reserve sheet must suppress the root sheet (anyChildModalOpen) while open.",
);
check(
  "ORCH-1148: isReserveSheetOpen is in the handleRootSheetClose swallow condition",
  /if \([\s\S]*?isReserveSheetOpen[\s\S]*?\)\s*\{[\s\S]*?return;/.test(
    swallowBody.length ? `if (${swallowBody}` : source,
  ) || swallowBody.includes("isReserveSheetOpen"),
  "THE FIX: opening the reserve sheet must swallow the root sheet's synthetic close so the card is not torn down mid-open (else: FREEZE).",
);
check(
  "ORCH-1148: isReserveSheetOpen is in the handleRootSheetClose deps array",
  depsBody.includes("isReserveSheetOpen"),
  "THE FIX (latent half): isReserveSheetOpen must be in the useCallback deps so the swallow reads the live value.",
);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.pass) console.log(`  ${item.detail}`);
}

if (failures.length > 0) {
  console.error(
    `ORCH-1148 reserve-teardown-swallow regression failed: ${failures.length}/${checks.length}`,
  );
  process.exit(1);
}

console.log("ORCH-1148 reserve-teardown-swallow regression passed.");
