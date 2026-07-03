#!/usr/bin/env node
/**
 * ORCH-1263 [claim-adoption] — G-2: claimed-state front-load + overnight hours.
 * Invariants: I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED (DRAFT) +
 *             I-PROPOSED-1263-OVERNIGHT-HOURS-VALID (DRAFT).
 *
 * Fails when:
 *   (a) mingla-business/src/components/brand/ClaimMatchCard.tsx exists but
 *       lacks the claimState handling tokens (`claimState`, `"claimed"`,
 *       `"pending"`) — the blocked-at-the-gate variants were removed
 *       (missing file = skipped: Leg B not landed yet);
 *   (b) the NEWEST migration defining biz_search_place_pool_for_claim lacks
 *       the `claim_state` output — the search RPC was reverted to the
 *       12-column pre-1263 shape;
 *   (c) mingla-business/src/components/venue/venueWizardValidation.ts or
 *       .../VenueSettingsModule.tsx contains the reverted overnight-rejecting
 *       predicate `(o >= c)` — D-D says ONLY equality (`o === c`) is invalid;
 *       `close < open` (e.g. 22:00→02:00) is a VALID overnight day
 *       (missing file = skipped).
 *
 * Behavioral complements: T-D1 (SQL claim_state), T-B3/T-B5 (jest, Leg B).
 * Mirrors the modular self-testing gate pattern
 * (sibling: orch-1255-no-hidden-brand-on-venue-create.mjs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const MIGRATIONS_DIR = join(root, "supabase", "migrations");

// Strip SQL comments so notes never trip the migration arm.
const stripSql = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^-])--.*$/gm, "$1");
// Strip JS comments (protects `https://` URLs).
const stripJs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// (a) ClaimMatchCard must render the blocked variants off claimState.
export const runClaimCard = (code) => {
  if (code === null) return []; // Leg B file not present yet — skipped.
  const failures = [];
  for (const token of ["claimState", '"claimed"', '"pending"']) {
    if (!code.includes(token)) {
      failures.push(
        `ClaimMatchCard.tsx lacks the ${token} token — the claimed/pending blocked-at-the-gate variants (DESIGN §4.3/§4.4) were removed (I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED).`,
      );
    }
  }
  return failures;
};

// (b) the newest CREATE of the search RPC must carry claim_state.
export const runSearchRpc = (files) => {
  // files: [{ name, read: () => string }] — migration filenames.
  const defining = files
    .filter((f) => /^\d{14}/.test(basename(f.name)))
    .map((f) => ({ name: basename(f.name), code: stripSql(f.read()) }))
    .filter((f) =>
      /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.biz_search_place_pool_for_claim\b/i
        .test(f.code)
    )
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  if (defining.length === 0) {
    return ["no migration defines biz_search_place_pool_for_claim — shape changed; update this gate."];
  }
  const newest = defining[defining.length - 1];
  if (!/claim_state/.test(newest.code)) {
    return [
      `${newest.name}: the newest biz_search_place_pool_for_claim CREATE lacks claim_state — the search RPC was reverted to the pre-1263 shape (blocked places would surface as claimable again).`,
    ];
  }
  return [];
};

// (c) neither validator may carry the reverted overnight-rejecting predicate.
export const runOvernight = (clientFiles) => {
  const failures = [];
  for (const cf of clientFiles) {
    const code = cf.read();
    if (code === null) continue; // Leg B file not present yet — skipped.
    if (/\(\s*o\s*>=\s*c\s*\)/.test(stripJs(code))) {
      failures.push(
        `${cf.name}: contains the reverted overnight-rejecting predicate (o >= c) — D-D: only equality (o === c) is invalid; close < open is a valid overnight day (I-PROPOSED-1263-OVERNIGHT-HOURS-VALID).`,
      );
    }
  }
  return failures;
};

if (SELF_TEST) {
  // (a)
  const cardGood = runClaimCard(
    'if (match.claimState === "claimed") return blocked; if (match.claimState === "pending") return pendingCard;',
  );
  if (cardGood.length !== 0) {
    console.error("SELF-TEST FAIL: good ClaimMatchCard should pass:", cardGood);
    process.exit(1);
  }
  const cardBad = runClaimCard("return <YesCard />;");
  if (cardBad.length === 0) {
    console.error("SELF-TEST FAIL: claimState-less ClaimMatchCard should fail");
    process.exit(1);
  }
  const cardSkipped = runClaimCard(null);
  if (cardSkipped.length !== 0) {
    console.error("SELF-TEST FAIL: missing ClaimMatchCard should be skipped");
    process.exit(1);
  }
  // (b)
  const rpcGood = runSearchRpc([
    {
      name: "20260809000000_old.sql",
      read: () => "CREATE FUNCTION public.biz_search_place_pool_for_claim (p text) RETURNS TABLE (id uuid) AS $$ SELECT 1 $$;",
    },
    {
      name: "20261202000000_new.sql",
      read: () =>
        "CREATE FUNCTION public.biz_search_place_pool_for_claim (p text) RETURNS TABLE (id uuid, claim_state text) AS $$ SELECT 1 $$;",
    },
  ]);
  if (rpcGood.length !== 0) {
    console.error("SELF-TEST FAIL: claim_state RPC fixture should pass:", rpcGood);
    process.exit(1);
  }
  const rpcBad = runSearchRpc([
    {
      name: "20261203000000_revert.sql",
      read: () => "CREATE OR REPLACE FUNCTION public.biz_search_place_pool_for_claim (p text) RETURNS TABLE (id uuid) AS $$ SELECT 1 $$;",
    },
  ]);
  if (rpcBad.length === 0) {
    console.error("SELF-TEST FAIL: claim_state-less newest CREATE should fail");
    process.exit(1);
  }
  // (c)
  const overnightBad = runOvernight([
    { name: "venueWizardValidation.ts", read: () => "if (o >= c) { return err; }" },
  ]);
  if (overnightBad.length === 0) {
    console.error("SELF-TEST FAIL: (o >= c) predicate should fail");
    process.exit(1);
  }
  const overnightGood = runOvernight([
    { name: "venueWizardValidation.ts", read: () => "if (o === c) { return err; }" },
    { name: "VenueSettingsModule.tsx", read: () => null },
  ]);
  if (overnightGood.length !== 0) {
    console.error("SELF-TEST FAIL: (o === c) predicate should pass:", overnightGood);
    process.exit(1);
  }
  console.log("ORCH-1263 claim-front-load-and-overnight gate self-test passed.");
  process.exit(0);
}

const sqlFiles = existsSync(MIGRATIONS_DIR)
  ? readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({
      name: f,
      read: () => readFileSync(join(MIGRATIONS_DIR, f), "utf8"),
    }))
  : [];

const claimCardPath = join(
  root,
  "mingla-business",
  "src",
  "components",
  "brand",
  "ClaimMatchCard.tsx",
);
const validatorPaths = [
  join(root, "mingla-business", "src", "components", "venue", "venueWizardValidation.ts"),
  join(root, "mingla-business", "src", "components", "venue", "VenueSettingsModule.tsx"),
];

const failures = [
  ...runClaimCard(existsSync(claimCardPath) ? readFileSync(claimCardPath, "utf8") : null),
  ...runSearchRpc(sqlFiles),
  ...runOvernight(
    validatorPaths.map((p) => ({
      name: p.slice(root.length + 1),
      read: () => (existsSync(p) ? readFileSync(p, "utf8") : null),
    })),
  ),
];

if (failures.length > 0) {
  console.error("ORCH-1263 claim-front-load-and-overnight gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1263 claim-front-load-and-overnight gate passed.");
