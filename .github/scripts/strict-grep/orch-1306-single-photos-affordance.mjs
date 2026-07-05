#!/usr/bin/env node
/**
 * ORCH-1306 [single-photos-affordance] — strict-grep gate.
 *
 * WHY: the venue-settings "Photos & vibes & AI" section shipped TWO buttons that
 * BOTH called `goToDeckReadiness` (identical navigation) — `venue-settings-edit-
 * photos` ("Edit photos & vibes", secondary) and `venue-settings-rerun-recommend`
 * ("Edit photos & details", primary). The second was a redundant duplicate left
 * over from ORCH-1304's refactor: two buttons, one destination, visual clutter.
 *
 * FIX (ORCH-1306): consolidate to a SINGLE primary CTA — label "Edit photos &
 * details", testID `venue-settings-edit-photos`, `onPress={goToDeckReadiness}`.
 * The duplicate `venue-settings-rerun-recommend` button is deleted.
 *
 * RULE (structural anti-recurrence) — all must hold against VenueSettingsModule,
 * else exit non-zero:
 *   A. VenueSettingsModule.tsx contains `venue-settings-edit-photos` (the single
 *      retained edit affordance for the Photos & vibes & AI section).
 *   B. VenueSettingsModule.tsx does NOT contain `venue-settings-rerun-recommend`
 *      (the removed duplicate must not creep back).
 *   C. The retained affordance still navigates via `onPress={goToDeckReadiness}`
 *      (the section's edit entry point stays wired to the deck-readiness surface).
 *
 * Comment-stripped before scanning (this file's rationale names the very tokens
 * the gate asserts). Self-test: `--self-test` proves the GOOD shape passes and
 * each reverted BAD shape fails. Invariant I-PROPOSED-1306-SINGLE-PHOTOS-AFFORDANCE.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const MODULE_REL =
  "mingla-business/src/components/venue/VenueSettingsModule.tsx";

/** Strip block comments + whole-line `//` comments so prose can't satisfy/trip. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Collapse whitespace so multi-line exprs match on a single normalized line. */
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** Scan VenueSettingsModule (rules A–C). */
function scanModule(src) {
  const failures = [];
  const s = normalize(src);
  if (!/venue-settings-edit-photos/.test(s)) {
    failures.push(
      "A: VenueSettingsModule.tsx no longer contains the venue-settings-edit-photos " +
        "affordance — the single Photos & vibes & AI edit button is gone (ORCH-1306).",
    );
  }
  if (/venue-settings-rerun-recommend/.test(s)) {
    failures.push(
      "B: VenueSettingsModule.tsx contains venue-settings-rerun-recommend again — " +
        "the duplicate photos/details button (same goToDeckReadiness target) is " +
        "back; consolidate to the single venue-settings-edit-photos CTA (ORCH-1306).",
    );
  }
  if (!/onPress=\{goToDeckReadiness\}/.test(s)) {
    failures.push(
      "C: VenueSettingsModule.tsx no longer wires an edit affordance to " +
        "onPress={goToDeckReadiness} — the Photos section lost its deck-readiness " +
        "entry point (ORCH-1306).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    {canMutate ? (
      <Button
        label="Edit photos & details"
        onPress={goToDeckReadiness}
        variant="primary"
        size="md"
        style={styles.inlineBtn}
        testID="venue-settings-edit-photos"
      />
    ) : null}`;
  const BAD_DUPLICATE_BACK = `
    {canMutate ? (
      <Button label="Edit photos & vibes" onPress={goToDeckReadiness}
        variant="secondary" testID="venue-settings-edit-photos" />
    ) : null}
    {canMutate ? (
      <Button label="Edit photos & details" onPress={goToDeckReadiness}
        variant="primary" testID="venue-settings-rerun-recommend" />
    ) : null}`;
  const BAD_AFFORDANCE_GONE = `
    {canMutate ? (
      <Button label="Edit photos & details" onPress={goToDeckReadiness}
        variant="primary" testID="venue-settings-something-else" />
    ) : null}`;
  const BAD_NAV_DROPPED = `
    {canMutate ? (
      <Button label="Edit photos & details" onPress={goToVenueEdit}
        variant="primary" testID="venue-settings-edit-photos" />
    ) : null}`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1306 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1306 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("module GOOD (single affordance)", scanModule(GOOD), false);
  check("module BAD (duplicate rerun-recommend back)", scanModule(BAD_DUPLICATE_BACK), true);
  check("module BAD (edit-photos affordance removed)", scanModule(BAD_AFFORDANCE_GONE), true);
  check("module BAD (deck-readiness nav dropped)", scanModule(BAD_NAV_DROPPED), true);

  console.log(
    "ORCH-1306 gate self-test PASS (4/4: fixed shape passes; 3 reverts fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1306 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = scanModule(read(MODULE_REL));

if (failures.length > 0) {
  console.error(
    "ORCH-1306 gate FAIL — the venue-settings Photos & vibes & AI section " +
      "regressed:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe section MUST expose exactly ONE edit affordance " +
      "(venue-settings-edit-photos, onPress={goToDeckReadiness}); the duplicate " +
      "venue-settings-rerun-recommend button was removed. See ORCH-1306.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1306 gate PASS — Photos & vibes & AI exposes one edit affordance " +
    "(venue-settings-edit-photos → goToDeckReadiness); no duplicate button.",
);
