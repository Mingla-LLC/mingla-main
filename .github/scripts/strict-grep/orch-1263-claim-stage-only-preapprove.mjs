#!/usr/bin/env node
/**
 * ORCH-1263 [claim-adoption] — G-1: stage-only pre-approval write model (D-A/D-E).
 * Invariants: I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE (DRAFT) +
 *             I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO (DRAFT).
 *
 * Target: supabase/functions/run-business-place-authoring-pipeline/index.ts
 *
 * Fails when (comments stripped first):
 *   (a) `opening_hours: normalizeBusinessHoursForPool` appears MORE THAN ONCE —
 *       the create-new place INSERT is the only legal call site; a second one
 *       is the tier-1 live-deck-hours overwrite coming back;
 *   (b) any one-element stored_photo_urls write from mediaUrl exists
 *       (`stored_photo_urls: … [mediaUrl] …`) — the pre-1263 gallery wipe;
 *   (c) handleSyncHeroMedia lacks the `nextStoredPhotosForHero(` call token —
 *       the non-destructive hero merge was removed;
 *   (d) the tier-1 claim branch (between the `selectedPlacePoolId !== null`
 *       guard and `claim_path: "existing"`) contains a `claimed_by:` or
 *       `is_claimed:` write — pre-approval ownership marking coming back.
 *
 * Behavioral complements: __tests__/orch_1263_stage_only_claim.test.ts (exact
 * payload key-sets) + _shared/__tests__/authoredApply.test.ts (approve patch).
 * Mirrors the modular self-testing gate pattern
 * (sibling: orch-1255-no-hidden-brand-on-venue-create.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const PIPELINE_PATH = join(
  root,
  "supabase",
  "functions",
  "run-business-place-authoring-pipeline",
  "index.ts",
);

// Strip JS comments so explanatory notes never trip the gate.
const stripJs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

export const run = (source) => {
  const failures = [];
  const code = stripJs(source);

  // (a) exactly ONE legal normalizeBusinessHoursForPool WRITE site.
  const hoursWrites = code.match(/opening_hours:\s*normalizeBusinessHoursForPool/g) ?? [];
  if (hoursWrites.length > 1) {
    failures.push(
      `opening_hours: normalizeBusinessHoursForPool appears ${hoursWrites.length}x — the create-new INSERT is the ONLY legal site; the claim path stages hours in brand_hours and applies them at admin approve (authoredApply.ts).`,
    );
  }
  if (hoursWrites.length === 0) {
    failures.push(
      "opening_hours: normalizeBusinessHoursForPool write missing entirely — the create-new INSERT must still normalize wizard hours (ORCH-1068).",
    );
  }

  // (b) the one-element hero wipe must never return.
  if (/stored_photo_urls:[^\n]*\[\s*mediaUrl\s*\]/.test(code)) {
    failures.push(
      "one-element stored_photo_urls write from mediaUrl found — the pre-1263 hero pick wiped the live gallery to [hero]; use nextStoredPhotosForHero (I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO).",
    );
  }

  // (c) the non-destructive merge must be called inside handleSyncHeroMedia.
  const heroStart = code.indexOf("function handleSyncHeroMedia");
  const heroEnd = code.indexOf("function handleSyncGallery");
  const heroBlock = heroStart >= 0
    ? code.slice(heroStart, heroEnd > heroStart ? heroEnd : undefined)
    : "";
  if (heroStart < 0) {
    failures.push("handleSyncHeroMedia not found — pipeline shape changed; update this gate.");
  } else if (!heroBlock.includes("nextStoredPhotosForHero(")) {
    failures.push(
      "handleSyncHeroMedia lacks the nextStoredPhotosForHero( call — apply-mode hero writes must merge, never replace.",
    );
  }

  // (d) the tier-1 claim branch never writes ownership pre-approve.
  const claimStart = code.indexOf("selectedPlacePoolId !== null");
  const claimEnd = code.indexOf('claim_path: "existing"');
  if (claimStart < 0 || claimEnd < claimStart) {
    failures.push("tier-1 claim branch markers not found — pipeline shape changed; update this gate.");
  } else {
    const claimBlock = code.slice(claimStart, claimEnd);
    if (/\bclaimed_by\s*:/.test(claimBlock) || /\bis_claimed\s*:/.test(claimBlock)) {
      failures.push(
        "tier-1 claim branch writes claimed_by/is_claimed — ownership marks the live place at ADMIN APPROVE only (I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE).",
      );
    }
  }

  return failures;
};

const GOOD_FIXTURE = `
async function handleTier1() {
  if (selectedPlacePoolId !== null) {
    const patch = {
      business_authoring_status: "processing",
      business_authoring_inputs: { tier1: draft },
    };
    return jsonResponse(200, { claim_path: "existing" });
  }
  await client.from("place_pool").insert({
    is_claimed: true,
    claimed_by: userId,
    opening_hours: normalizeBusinessHoursForPool(draft.hours),
  });
}
async function handleSyncHeroMedia() {
  const heroPatch = {
    stored_photo_urls: nextStoredPhotosForHero(prior, gallery, hero),
  };
}
async function handleSyncGallery() {}
`;

const BAD_FIXTURE_REVERTED = `
async function handleTier1() {
  if (selectedPlacePoolId !== null) {
    const patch = {
      is_claimed: true,
      claimed_by: userId,
      opening_hours: normalizeBusinessHoursForPool(draft.hours),
    };
    return jsonResponse(200, { claim_path: "existing" });
  }
  await client.from("place_pool").insert({
    opening_hours: normalizeBusinessHoursForPool(draft.hours),
  });
}
async function handleSyncHeroMedia() {
  const heroPatch = {
    stored_photo_urls: mediaUrl.length > 0 ? [mediaUrl] : [],
  };
}
async function handleSyncGallery() {}
`;

if (SELF_TEST) {
  const good = run(GOOD_FIXTURE);
  if (good.length !== 0) {
    console.error("SELF-TEST FAIL: fixed fixture should pass:", good);
    process.exit(1);
  }
  const bad = run(BAD_FIXTURE_REVERTED);
  // The reverted fixture must trip ALL FOUR arms.
  const expectArms = [
    "appears 2x",
    "one-element stored_photo_urls",
    "nextStoredPhotosForHero",
    "claimed_by/is_claimed",
  ];
  for (const arm of expectArms) {
    if (!bad.some((f) => f.includes(arm))) {
      console.error(`SELF-TEST FAIL: reverted fixture should trip arm "${arm}":`, bad);
      process.exit(1);
    }
  }
  console.log("ORCH-1263 claim-stage-only-preapprove gate self-test passed.");
  process.exit(0);
}

if (!existsSync(PIPELINE_PATH)) {
  console.error(`ORCH-1263 stage-only gate: ${PIPELINE_PATH} not found.`);
  process.exit(1);
}
const failures = run(readFileSync(PIPELINE_PATH, "utf8"));
if (failures.length > 0) {
  console.error("ORCH-1263 claim-stage-only-preapprove gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1263 claim-stage-only-preapprove gate passed.");
