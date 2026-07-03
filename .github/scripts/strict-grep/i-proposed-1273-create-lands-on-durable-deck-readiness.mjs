#!/usr/bin/env node
/**
 * ORCH-1273 [venue deck-readiness AI step flashes/closes on web create] —
 * I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS.
 *
 * RULE: after a CREATE-path "Submit for review" (tier-1 success) the venue
 * wizard must navigate to the DURABLE, server-state-reloading deck-readiness
 * route (`router.replace(routeForDeckReadinessFix({ ... }))` → the SAME
 * `/venue/deck-readiness?brand_id&place_pool_id&venue_id&focus=review` route the
 * Hub "Edit listing" recovery path uses). It must NEVER render an EPHEMERAL
 * inline `<VenueDeckReadinessSetup>` mount driven by transient component state
 * (`createdVenue`) — that mount unmounted on any one-frame /venue/create
 * re-resolution on web (auth/hydration/chunk reflow) and stranded the venue at
 * `business_authoring_status='processing'`.
 *
 * Enforcement (over mingla-business/src/components/venue/VenueCreatorWizard.tsx,
 * comment-stripped so a doc comment mentioning the retired tokens never counts):
 *   (a) PRESENT: a `router.replace( routeForDeckReadinessFix(` call (the durable
 *       create-success navigation seam).
 *   (b) ABSENT: any `<VenueDeckReadinessSetup` JSX element (the ephemeral inline
 *       deck-readiness mount).
 *   (c) ABSENT: any `createdVenue` / `setCreatedVenue` transient-state token
 *       (the throw-away state the ephemeral mount depended on).
 *
 * Reverting the fix (restore `setCreatedVenue({...})` + the inline
 * `<VenueDeckReadinessSetup>` and drop the `router.replace`) → (a) fails and
 * (b)/(c) fire → this gate FAILS. `--self-test` proves FAIL-on-revert with
 * GOOD/BAD fixtures.
 *
 * DRAFT until CLOSE (orchestrator flips
 * I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const WIZARD_FILE = path.join(
  process.cwd(),
  "mingla-business/src/components/venue/VenueCreatorWizard.tsx",
);

// The durable create-success navigation seam: router.replace(routeForDeckReadinessFix(...)).
const DURABLE_NAV_RE = /router\.replace\(\s*routeForDeckReadinessFix\(/;
// The retired ephemeral inline deck-readiness mount.
const INLINE_MOUNT_RE = /<VenueDeckReadinessSetup\b/;
// The retired throw-away state that fed the inline mount.
const EPHEMERAL_STATE_RE = /\b(?:set)?[cC]reatedVenue\b/;

function stripComments(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

function check(wizardSrc, failures) {
  const src = stripComments(wizardSrc);
  if (!DURABLE_NAV_RE.test(src)) {
    failures.push(
      "create-success navigation seam missing — expected " +
        "`router.replace(routeForDeckReadinessFix({ ... }))` after tier-1 success " +
        "(the venue must land on the DURABLE /venue/deck-readiness route).",
    );
  }
  if (INLINE_MOUNT_RE.test(src)) {
    failures.push(
      "ephemeral inline <VenueDeckReadinessSetup> mount re-introduced in the wizard — " +
        "the create leg must navigate to the durable route, not render deck-readiness " +
        "from transient component state.",
    );
  }
  if (EPHEMERAL_STATE_RE.test(src)) {
    failures.push(
      "throw-away `createdVenue`/`setCreatedVenue` state re-introduced — the create " +
        "leg must not hold the just-created venue in volatile component state.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const goodMount =
    "useDraftVenueStore.getState().reset(currentBrand.id);\n" +
    "router.replace(\n" +
    "  routeForDeckReadinessFix({\n" +
    "    brandId: currentBrand.id,\n" +
    "    placePoolId: tier1.place_pool_id,\n" +
    "    venueId,\n" +
    '    fix: "review_pipeline",\n' +
    "  }) as never,\n" +
    ");\n" +
    "return;\n";

  // GOOD: durable nav present, no ephemeral mount/state.
  let f = [];
  check(goodMount, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD1: reverted to ephemeral setCreatedVenue + inline mount → all three fire.
  const reverted =
    "setCreatedVenue({ venueId, placePoolId: tier1.place_pool_id });\n" +
    "useDraftVenueStore.getState().reset(currentBrand.id);\n" +
    "// later:\n" +
    "return (\n" +
    "  <VenueDeckReadinessSetup venueId={createdVenue.venueId} />\n" +
    ");\n";
  f = [];
  check(reverted, f);
  if (f.length === 0) self.push("reverted ephemeral create leg not flagged");

  // BAD2: durable nav deleted but no ephemeral tokens → (a) still fires.
  const navDeleted = "useDraftVenueStore.getState().reset(currentBrand.id);\nreturn;\n";
  f = [];
  check(navDeleted, f);
  if (f.length === 0) self.push("missing durable nav seam not flagged");

  // BAD3: inline mount re-added even alongside the durable nav → (b) fires.
  const bothPresent = goodMount + "<VenueDeckReadinessSetup venueId={x} />\n";
  f = [];
  check(bothPresent, f);
  if (f.length === 0) self.push("re-introduced inline mount not flagged");

  // GUARD: comment mentioning the retired tokens must NOT count (comment-stripped).
  const commentOnly =
    goodMount +
    "// ORCH-1273 — no longer mounts <VenueDeckReadinessSetup> from createdVenue.\n";
  f = [];
  check(commentOnly, f);
  if (f.length) self.push("comment mention wrongly flagged: " + f.join("; "));

  if (self.length) {
    console.error("I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS self-test PASS (5/5 cases).",
  );
  process.exit(0);
}

if (!fs.existsSync(WIZARD_FILE)) {
  console.error(
    `I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS FAIL — wizard not found at ${WIZARD_FILE}.`,
  );
  process.exit(1);
}

const failures = [];
check(fs.readFileSync(WIZARD_FILE, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS PASS — create tier-1 " +
    "success routes to the durable /venue/deck-readiness route via router.replace + " +
    "routeForDeckReadinessFix; no ephemeral inline mount or createdVenue state remains.",
);
