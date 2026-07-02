#!/usr/bin/env node
/**
 * META-ORCH-1255 — I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW (DRAFT),
 * strict-grep arm (enforcement). The unit of venue admin review is a
 * venue_listings row; NO code path writes brands.claim_status from any venue
 * flow.
 *
 * LEG-A rules (active):
 *   (a) in supabase/functions/admin-review-venue-claim/index.ts and the two
 *       venue-claim-*-email fns, NO `.from("brands")` access may touch a claim
 *       lifecycle column (claim_status, claim_follow_up_at,
 *       claim_decision_emailed_at, verified_at, rejection_reason,
 *       duplicate_of_brand_id) — the lifecycle lives on venue_listings.
 *   (b) admin-review-venue-claim must call biz_review_venue_claim with
 *       p_venue_id (not p_brand_id).
 *
 * LEG-B rule (added when Leg B lands — the current
 * mingla-business/src/services/venueClaimService.ts still carries the
 * pre-1255 p_brand_id call by design until Leg B re-keys it):
 *   (c) venueClaimService.ts must not call a p_brand_id-keyed review RPC.
 *       ACTIVATION: Leg B flips LEG_B_ACTIVE below to true in the same commit
 *       that re-keys the service.
 *
 * Mirrors the modular self-testing gate pattern (sibling: orch-1186-hours-single-owner.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

// Leg B flips this to true when venueClaimService.ts is re-keyed (Leg B #12).
const LEG_B_ACTIVE = false;

const EDGE_FILES = [
  "supabase/functions/admin-review-venue-claim/index.ts",
  "supabase/functions/venue-claim-submitted-email/index.ts",
  "supabase/functions/venue-claim-decision-email/index.ts",
];
const CLAIM_COLUMNS =
  /claim_status|claim_follow_up_at|claim_decision_emailed_at|verified_at|duplicate_of_brand_id|rejection_reason/;

const run = (files) => {
  // files: [{ name, code }]
  const failures = [];
  for (const f of files) {
    if (f.code === null) {
      failures.push(`${f.name}: file missing`);
      continue;
    }
    // (a) every .from("brands") access window must be claim-column-free.
    const re = /\.from\(\s*["'`]brands["'`]\s*\)/g;
    let m;
    while ((m = re.exec(f.code)) !== null) {
      // Scan window: from this brands access up to the NEXT .from( (a later
      // access to a different table must not bleed into this window).
      let windowText = f.code.slice(m.index + 1, m.index + 400);
      const nextFrom = windowText.search(/\.from\(/);
      if (nextFrom !== -1) windowText = windowText.slice(0, nextFrom);
      const col = windowText.match(CLAIM_COLUMNS);
      if (col) {
        failures.push(
          `${f.name}: .from("brands") touches claim-lifecycle column "${col[0]}" — the claim machine lives on venue_listings (D-4).`,
        );
      }
    }
    // (b) the review RPC must be venue-keyed (admin-review wrapper only).
    if (f.name.includes("admin-review-venue-claim")) {
      if (
        f.code.includes('"biz_review_venue_claim"') &&
        /biz_review_venue_claim["'`,\s\S]{0,200}?p_brand_id/.test(f.code)
      ) {
        failures.push(
          `${f.name}: calls biz_review_venue_claim with p_brand_id — the review RPC is venue-keyed (p_venue_id).`,
        );
      }
    }
  }
  return failures;
};

const runLegB = (code) => {
  const failures = [];
  if (code === null) return failures; // not shipped yet
  if (
    /rpc\(\s*["'`](biz_resubmit_venue_claim|biz_review_venue_claim)["'`][\s\S]{0,200}?p_brand_id/.test(
      code,
    )
  ) {
    failures.push(
      "mingla-business/src/services/venueClaimService.ts: calls a p_brand_id-keyed review RPC — re-key to p_venue_id (META-ORCH-1255 Leg B #12).",
    );
  }
  return failures;
};

if (SELF_TEST) {
  const clean = [
    {
      name: "supabase/functions/admin-review-venue-claim/index.ts",
      code:
        'await admin.from("brands").select("id, name, slug, account_id, contact_email");\n' +
        'await userClient.rpc("biz_review_venue_claim", { p_venue_id: parsed.venueId });\n' +
        'await admin.from("venue_listings").update({ claim_decision_emailed_at: now });',
    },
    {
      name: "supabase/functions/venue-claim-submitted-email/index.ts",
      code: 'await admin.from("venue_listings").select("id, name, claim_status");',
    },
    {
      name: "supabase/functions/venue-claim-decision-email/index.ts",
      code: 'await admin.from("brands").select("id, name, slug, account_id");',
    },
  ];
  if (run(clean).length !== 0) {
    console.error("SELF-TEST FAIL: clean fixtures should pass:", run(clean));
    process.exit(1);
  }
  const badBrandClaim = [
    {
      name: "supabase/functions/admin-review-venue-claim/index.ts",
      code: 'await admin.from("brands").update({ claim_status: "verified" });',
    },
  ];
  if (run(badBrandClaim).length === 0) {
    console.error("SELF-TEST FAIL: brands claim write should fail");
    process.exit(1);
  }
  const badBrandKey = [
    {
      name: "supabase/functions/admin-review-venue-claim/index.ts",
      code: 'await userClient.rpc("biz_review_venue_claim", { p_brand_id: id });',
    },
  ];
  if (run(badBrandKey).length === 0) {
    console.error("SELF-TEST FAIL: p_brand_id review call should fail");
    process.exit(1);
  }
  const badLegB = runLegB(
    'await supabase.rpc("biz_resubmit_venue_claim", { p_brand_id: brandId });',
  );
  if (badLegB.length === 0) {
    console.error("SELF-TEST FAIL: Leg-B p_brand_id resubmit should fail");
    process.exit(1);
  }
  console.log("ORCH-1255 venue-approval-per-venue-row gate self-test passed.");
  process.exit(0);
}

const files = EDGE_FILES.map((rel) => {
  const p = join(root, rel);
  return { name: rel, code: existsSync(p) ? readFileSync(p, "utf8") : null };
});
let failures = run(files);
if (LEG_B_ACTIVE) {
  const svcPath = join(root, "mingla-business", "src", "services", "venueClaimService.ts");
  failures = failures.concat(
    runLegB(existsSync(svcPath) ? readFileSync(svcPath, "utf8") : null),
  );
}
if (failures.length > 0) {
  console.error("ORCH-1255 venue-approval-per-venue-row gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1255 venue-approval-per-venue-row gate passed.");
