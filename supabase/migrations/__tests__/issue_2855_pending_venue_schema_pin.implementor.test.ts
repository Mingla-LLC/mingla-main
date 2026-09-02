/**
 * Issue #2855 implementor guard.
 *
 * A reviewed schema hash approves only the existence of the six proven lanes.
 * It never permits a nonzero row in any of them: the #2099 helper must continue
 * to classify every lane outside the exact four-table baseline as disallowed.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// [TEST-MOD-APPROVED #2648] The #2855 provider declaration is now judged against
// the registry the validator ACTUALLY exports, not against a substring of its
// source text. Text and semantics can diverge — a declaration can be present in
// the bytes and shadowed, duplicated, or filtered out of the exported array —
// and only the exported value decides what provider discovery subtracts.
import {
  PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL,
  PROVIDERS_ADDED_SINCE_SEAL,
} from "../../../.github/scripts/ci-batch/validate-manifest-v2.mjs";

interface SealDeclaration {
  readonly issue: number;
  readonly workflow: string;
  readonly referenceFiles: readonly string[];
}

const ORIGINAL_PATH =
  "supabase/migrations/20270418002099_issue_2099_pending_venue_identity_correction.sql";
const FORWARD_PATH =
  "supabase/migrations/20270610002855_issue_2855_pending_venue_schema_pin.sql";
const COVER_VIDEO_PATH =
  "supabase/migrations/20270604002715_issue_2715_deterministic_cover_video_jobs.sql";
const COMPETITOR_PATH =
  "supabase/migrations/20270606002725_issue_2725_competitor_intelligence.sql";
const BUDGET_PATH =
  "supabase/migrations/20270606002726_issue_2725_amendment_8_budget.sql";
const SQL_TEST_PATH =
  "supabase/migrations/__tests__/issue_2099_pending_venue_identity_correction.test.sql";
const TESTER_PATH =
  "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.tester_adversarial.test.sql";
const WORKFLOW_PATH =
  ".github/workflows/issue-2099-pending-venue-identity-correction-tests.yml";
const VALIDATOR_PATH = ".github/scripts/ci-batch/validate-manifest-v2.mjs";

const OLD_PIN =
  "('9a8c2a743af413f17f3b3e75e4f656f3' || 'e9cf3867cda091eb204bb9d5460f1ba0')";
const NEW_PIN =
  "('52f4624c994529d2e63b8f70b79a3fcf' || 'e28f3ff90dafe300bc45439e37cd2921')";
const NEW_HASH =
  "52f4624c994529d2e63b8f70b79a3fcfe28f3ff90dafe300bc45439e37cd2921";
const ORIGINAL_SHA256 =
  "8d35452b0237115640d4fcbc9dbc05c12b25ffa1b57a706c85cfc698df0c2bbe";
// [TEST-MOD-APPROVED #2648] RE-DERIVED, NOT RE-PINNED. This pin is the sha256 of
// the ONE declaration #2855 owns, canonicalised from the validator's exported
// value. It replaces two sha256 digests of the WHOLE of
// .github/scripts/ci-batch/validate-manifest-v2.mjs — a shared CI file #2099 and
// #2855 do not own — which could not survive contact with the repository:
//
//   93d2f49 #2860  0d800e89…   (the value that was VALIDATOR_BEFORE_AMENDMENT_SHA256)
//   13dd625 #2850  e867484e…   hand-re-banked here; the last green run of this lane
//   016a513 #1772  ff053ce4…
//   d7eabd8 #2241  89958478…
//   8995ad6 #2948  11c3f3b9…
//   057dc2f #2898  775fcfb3…   the value CI reported on 2026-09-02
//   2537af8 #3014  edd1b397…
//
// Six values in three days, from five unrelated issues, each legitimately
// declaring itself into the registries this file exists to carry. #2855's own
// declaration count was exactly 1 at every one of those commits — nothing this
// assertion guards ever moved. A whole-file digest over an actively-edited shared
// file is not a control; it is a merge tax that had already been hand-re-banked
// once (#2850) and is indistinguishable from a silencing paste (#2648).
//
// NOT WEAKER. Everything the old digest protected FOR #2855 is retained and
// tightened below: exact-once ownership is now asserted across the validator's
// whole exported surface rather than by one substring count; the reference-file
// set is deep-equalled rather than matched as text; the frozen provider seal is
// still pinned; the #2582 Phase 3B fragments are still exact-once. The single
// property given up is detection of INERT byte drift in a file this issue does
// not own. Its semantic half is enforced repo-wide and on every pull request by
// validate-manifest-v2.mjs itself, which reconstructs provider discovery by
// subtracting declared additions BY EXACT CONTENT, NEVER BY NAME, against
// LOCKED_PROVIDER_DISCOVERY_SHA256 (validate-manifest-v2.mjs:2404). A deleted,
// widened, or narrowed #2855 declaration still reds there as well as here.
const ISSUE_2855_DECLARATION_SHA256 =
  "d23d2eece82ff8554bd1459e44c0e4144970f4712d5e0626790eb1d5c14a2212";
const FROZEN_PROVIDER_SEAL =
  "c0813be9c105418cd60697b22be5ae5dbc2055b03895c2e5c77f68606a498a7f";
const PROVIDER_DELTA = `  Object.freeze({
    issue: 2855,
    workflow: "issue-2099-pending-venue-identity-correction-tests.yml",
    referenceFiles: Object.freeze([
      "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
      "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.tester_adversarial.test.sql",
    ]),
  }),
`;
const PHASE3B_LEAF_REGISTRY_CURRENT =
  `      || leafRegistry?.currentExecutedLeaves !== 40 || leafRegistry?.currentAbsentLeaves !== 0
      || crypto.createHash("sha256").update(JSON.stringify(leaves)).digest("hex") !== leafRegistry?.registrySha256) {
    fail(errors, "Phase 3B leaf registry must equal 40 maximum / current 40 executed + 0 absent");`;
const PHASE3B_LEAF_REGISTRY_RETIRED =
  `      || leafRegistry?.currentExecutedLeaves !== 37 || leafRegistry?.currentAbsentLeaves !== 3
      || crypto.createHash("sha256").update(JSON.stringify(leaves)).digest("hex") !== leafRegistry?.registrySha256) {
    fail(errors, "Phase 3B leaf registry must equal 40 maximum / current 37 executed + 3 absent");`;
const PHASE3B_WAVE_HEADER_CURRENT =
  `  const expectedWaveContract = { suiteCount: 12, outerCommandCount: 36, maximumLeafCount: 40, currentExecutedLeaves: 40,
    currentAbsentLeaves: 0, lifecycle: phase3bTerminal ? PHASE3B_TERMINAL_LIFECYCLE : PHASE3B_SHADOW_LIFECYCLE };`;
const PHASE3B_WAVE_HEADER_RETIRED =
  `  const expectedWaveContract = { suiteCount: 12, outerCommandCount: 36, maximumLeafCount: 40, currentExecutedLeaves: 37,
    currentAbsentLeaves: 3, lifecycle: phase3bTerminal ? PHASE3B_TERMINAL_LIFECYCLE : PHASE3B_SHADOW_LIFECYCLE };`;
const PHASE3B_CURRENT_TO_BASE_REWRITES = [
  {
    label: "Phase 3B leaf-registry contract",
    current: PHASE3B_LEAF_REGISTRY_CURRENT,
    retired: PHASE3B_LEAF_REGISTRY_RETIRED,
  },
  {
    label: "Phase 3B wave-header contract",
    current: PHASE3B_WAVE_HEADER_CURRENT,
    retired: PHASE3B_WAVE_HEADER_RETIRED,
  },
] as const;
const EXPECTED_SC4_PRODUCT_PATHS = [
  "mingla-business/app/venue/[venueId]/index.tsx",
  "mingla-business/src/services/venueListingsService.ts",
  "mingla-business/src/components/venue/PendingVenueIdentityCorrectionLauncher.web.tsx",
  "mingla-business/src/components/venue/PendingVenueIdentityCorrectionDialog.web.tsx",
  "mingla-business/src/services/pendingVenueIdentityCorrectionService.web.ts",
  "mingla-business/src/components/venue/VenueListingContent.tsx",
];
const ISSUE_2855_CURRENT_DIFF = [
  ".github/ci-batch/MANIFEST.json",
  ".github/scripts/ci-batch/validate-manifest-v2.mjs",
  ".github/scripts/strict-grep/issue-2148-ci-postgres-wave-shadow.tester.test.mjs",
  ".github/workflows/issue-2099-pending-venue-identity-correction-tests.yml",
  "REPORTS.md",
  "docs/INVARIANT_REGISTRY.md",
  "supabase/migrations/20270610002855_issue_2855_pending_venue_schema_pin.sql",
  "supabase/migrations/__tests__/issue_2099_pending_venue_identity_correction.test.sql",
  "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
  "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.tester_adversarial.test.sql",
];

const [
  original,
  forward,
  coverVideo,
  competitor,
  budget,
  sqlTest,
  tester,
  workflow,
  validator,
] = await Promise.all([
  Deno.readTextFile(ORIGINAL_PATH),
  Deno.readTextFile(FORWARD_PATH),
  Deno.readTextFile(COVER_VIDEO_PATH),
  Deno.readTextFile(COMPETITOR_PATH),
  Deno.readTextFile(BUDGET_PATH),
  Deno.readTextFile(SQL_TEST_PATH),
  Deno.readTextFile(TESTER_PATH),
  Deno.readTextFile(WORKFLOW_PATH),
  Deno.readTextFile(VALIDATOR_PATH),
]);

function count(source: string, token: string): number {
  return source.split(token).length - 1;
}

function reconstructValidatorBeforeAmendments(source: string): string {
  assert.equal(
    count(source, PROVIDER_DELTA),
    1,
    "the exact #2855 provider-reference declaration must appear once",
  );
  let reconstructed = source.replace(PROVIDER_DELTA, "");
  for (const rewrite of PHASE3B_CURRENT_TO_BASE_REWRITES) {
    assert.equal(
      count(reconstructed, rewrite.current),
      1,
      `${rewrite.label} current 40/0 fragment must appear once`,
    );
    assert.equal(
      count(reconstructed, rewrite.retired),
      0,
      `${rewrite.label} retired 37/3 fragment must be absent`,
    );
    reconstructed = reconstructed.replace(rewrite.current, rewrite.retired);
  }
  return reconstructed;
}

// [TEST-MOD-APPROVED #2648] The whole-file digest is gone; every remaining clause
// is intrinsic to what #2855 owns, so a foreign issue declaring itself into this
// shared file can no longer red this lane while #2855's own declaration is intact.
function assertComposedValidatorProvenance(source: string): void {
  // Structural: the exact nine-line #2855 block appears exactly once, and the
  // #2582 Phase 3B 40/0 fragments are present exactly once with the retired 37/3
  // pair absent. Unchanged from the form this replaces.
  reconstructValidatorBeforeAmendments(source);
  const seal = source.match(
    /const LOCKED_PROVIDER_DISCOVERY_SHA256 = "([0-9a-f]{64})";/,
  );
  assert.ok(seal, "frozen provider seal declaration missing");
  assert.equal(
    seal[1],
    FROZEN_PROVIDER_SEAL,
    "#2855 must not re-pin the provider seal",
  );
  assert.equal(
    count(source, "issue: 2855,"),
    1,
    "#2855 may add only one validator declaration",
  );
  // Exact-once ownership across the WHOLE file, not just the declaration blocks:
  // no other line anywhere may name a #2855 reference file. The two that may are
  // the two inside #2855's own block.
  assert.equal(
    count(source, "issue_2855_pending_venue_schema_pin."),
    2,
    "a #2855 reference file is named outside #2855's own validator declaration",
  );
}

// The semantic half, and the reason the source-text digest is not missed: this
// reads the value provider discovery actually subtracts, which a substring match
// cannot see.
function issue2855Declaration(): SealDeclaration {
  const declarations: readonly SealDeclaration[] = [
    ...(PROVIDERS_ADDED_SINCE_SEAL as readonly SealDeclaration[]),
    ...(PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL as readonly SealDeclaration[]),
  ];
  const owned = declarations.filter((entry) => entry.issue === 2855);
  assert.equal(
    owned.length,
    1,
    "#2855 must own exactly one declaration across the validator's exported registries",
  );
  const foreign = declarations.filter((entry) =>
    entry.issue !== 2855 &&
    entry.referenceFiles.some((file) =>
      file.includes("issue_2855_pending_venue_schema_pin.")
    )
  );
  assert.deepEqual(
    foreign,
    [],
    "no declaration other than #2855's may name a #2855 reference file",
  );
  return owned[0];
}

// Canonicalised so the pin moves ONLY when #2855's own record moves — never when
// a sibling declaration is added, reordered, or reworded elsewhere in the file.
function canonicalDeclaration(declaration: SealDeclaration): string {
  return JSON.stringify({
    issue: declaration.issue,
    workflow: declaration.workflow,
    referenceFiles: [...declaration.referenceFiles].sort(),
  });
}

function functionBlock(
  source: string,
  name:
    | "preview_pending_venue_identity_correction"
    | "correct_pending_venue_identity",
): string {
  const startToken = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `${name} definition missing`);
  const grantToken = name === "preview_pending_venue_identity_correction"
    ? "GRANT EXECUTE ON FUNCTION public.preview_pending_venue_identity_correction(uuid) TO authenticated;"
    : "GRANT EXECUTE ON FUNCTION public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid) TO authenticated;";
  const grant = source.indexOf(grantToken, start);
  assert.notEqual(grant, -1, `${name} authenticated grant missing`);
  return source.slice(start, grant + grantToken.length);
}

function normalizedApprovedPin(source: string): string {
  return source.replaceAll(OLD_PIN, "<REVIEWED_SCHEMA_PIN>")
    .replaceAll(NEW_PIN, "<REVIEWED_SCHEMA_PIN>");
}

function requireVenueFk(
  source: string,
  table: string,
  column: "venue_id" | "venue_listing_id",
): string {
  const tableMention = new RegExp(
    `(?:ALTER\\s+TABLE|CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?)\\s+public\\.${table}`,
    "i",
  );
  assert.match(source, tableMention, `${table} DDL is missing`);
  const fk = new RegExp(
    `${column}\\s+uuid(?:\\s+NOT\\s+NULL)?\\s+REFERENCES\\s+public\\.venue_listings\\s*\\(id\\)`,
    "i",
  );
  assert.match(source, fk, `${table}.${column} is not the proven venue FK`);
  const sources = column === "venue_id" ? "fk,semantic" : "fk";
  return `${table}|${column}|venue|${sources}`;
}

Deno.test("#2855 derives exactly the six reviewed post-2099 schema lanes", () => {
  const derived = [
    requireVenueFk(coverVideo, "event_cover_video_jobs", "venue_id"),
    requireVenueFk(competitor, "tool_competitor_sources", "venue_listing_id"),
    requireVenueFk(
      competitor,
      "tool_competitor_refresh_jobs",
      "venue_listing_id",
    ),
    requireVenueFk(budget, "tool_competitor_budget_ledger", "venue_listing_id"),
    requireVenueFk(
      budget,
      "tool_competitor_venue_week_budget_boundaries",
      "venue_listing_id",
    ),
    requireVenueFk(
      budget,
      "tool_competitor_model_usage_receipts",
      "venue_listing_id",
    ),
  ].sort();

  assert.deepEqual(derived, [
    "event_cover_video_jobs|venue_id|venue|fk,semantic",
    "tool_competitor_budget_ledger|venue_listing_id|venue|fk",
    "tool_competitor_model_usage_receipts|venue_listing_id|venue|fk",
    "tool_competitor_refresh_jobs|venue_listing_id|venue|fk",
    "tool_competitor_sources|venue_listing_id|venue|fk",
    "tool_competitor_venue_week_budget_boundaries|venue_listing_id|venue|fk",
  ]);
  assert.equal(
    new Set(derived).size,
    6,
    "the reviewed provenance set must have six unique lanes",
  );
});

Deno.test("#2855 leaves the historical migration byte-exact and moves pin ownership forward", () => {
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    ORIGINAL_SHA256,
    "the applied #2099 migration changed",
  );
  assert.equal(count(original, OLD_PIN), 2);
  assert.equal(count(original, NEW_PIN), 0);
  assert.equal(count(forward, OLD_PIN), 0);
  assert.equal(count(forward, NEW_PIN), 2);
  assert.equal(
    count(forward, "CREATE OR REPLACE FUNCTION public."),
    2,
    "the forward migration may replace only the two public correction RPCs",
  );
  assert.doesNotMatch(forward, /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
  assert.doesNotMatch(
    forward,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.issue_2099_pending_venue_dependency_inventory/i,
  );
});

Deno.test("#2855 forward RPCs are equivalent except the reviewed hash pin", () => {
  for (
    const name of [
      "preview_pending_venue_identity_correction",
      "correct_pending_venue_identity",
    ] as const
  ) {
    assert.equal(
      normalizedApprovedPin(functionBlock(forward, name)),
      normalizedApprovedPin(functionBlock(original, name)),
      `${name} drifted outside the approved hash expression`,
    );
  }

  for (
    const token of [
      "LANGUAGE plpgsql",
      "SECURITY DEFINER",
      "SET search_path TO 'public','pg_temp'",
      "OWNER TO postgres",
      "FROM PUBLIC, anon, service_role",
      "TO authenticated",
      "issue_2855_schema_pin_definition_mismatch",
      "issue_2855_rpc_owner_security_or_config_mismatch",
      "issue_2855_rpc_application_grant_mismatch",
    ]
  ) {
    assert.ok(forward.includes(token), `forward migration missing: ${token}`);
  }
  assert.equal(count(forward, "STABLE"), 1, "only preview remains STABLE");
});

Deno.test("#2855 preserves the exact baseline and default-disallowed classifier", () => {
  const helper = original.slice(
    original.indexOf(
      "CREATE OR REPLACE FUNCTION public.issue_2099_pending_venue_dependency_inventory",
    ),
    original.indexOf(
      "CREATE OR REPLACE FUNCTION public.preview_pending_venue_identity_correction",
    ),
  );
  const baseline = helper.match(
    /WHEN r\.relname IN \(([^)]+)\) THEN 'allowed_baseline'/,
  );
  assert.ok(baseline, "allowed baseline classifier missing");
  const relations = [...baseline[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(relations, [
    "brand_hours",
    "brand_place_pipeline_state",
    "venue_availability_config",
    "venue_reservation_settings",
  ]);
  assert.match(
    helper,
    /WHEN r\.relname='venue_listings' THEN 'identity_self'\s+ELSE 'disallowed' END;/,
  );
  for (
    const forbidden of [
      "event_cover_video_jobs",
      "tool_competitor_sources",
      "tool_competitor_refresh_jobs",
      "tool_competitor_budget_ledger",
      "tool_competitor_venue_week_budget_boundaries",
      "tool_competitor_model_usage_receipts",
    ]
  ) {
    assert.ok(
      !baseline[1].includes(forbidden),
      `${forbidden} entered the baseline`,
    );
  }
});

Deno.test("#2855 workflow runs the forward owner and ordered D4 replay twice", () => {
  for (
    const path of [
      FORWARD_PATH,
      "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
      TESTER_PATH,
    ]
  ) {
    assert.ok(workflow.includes(path), `workflow does not own ${path}`);
  }
  assert.ok(
    workflow.includes(
      "deno test --allow-read supabase/migrations/__tests__/issue_2099_pending_venue_identity_correction.test.ts supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
    ),
    "implementor guard is not executed beside the #2099 static seal",
  );

  const d4 = workflow.slice(
    workflow.indexOf(
      '- name: "D4 — migration replay safety (second and third apply)"',
    ),
    workflow.indexOf(
      '- name: "D5 — authenticated two-connection RPC race harness"',
    ),
  );
  const originalName =
    "20270418002099_issue_2099_pending_venue_identity_correction.sql";
  const forwardName = "20270610002855_issue_2855_pending_venue_schema_pin.sql";
  assert.equal(count(d4, originalName), 2, "D4 must replay the original twice");
  assert.equal(
    count(d4, forwardName),
    2,
    "D4 must replay the forward owner twice",
  );
  const tokens = [...d4.matchAll(/2027\d+_issue_(?:2099|2855)[^\s"]+\.sql/g)]
    .map((match) => match[0]);
  assert.deepEqual(tokens, [
    originalName,
    forwardName,
    originalName,
    forwardName,
  ]);
});

Deno.test("#2855 SC-4 classifier is exact-path product scope", () => {
  const sc4Step = workflow.slice(
    workflow.indexOf(
      '- name: "SC-4 scope — did this change touch #2099 product code?"',
    ),
    workflow.indexOf("- if: steps.sc4scope.outputs.run == 'true'"),
  );
  const allowlistBlock = sc4Step.match(
    /sc4_product_paths=\(\n([\s\S]*?)\n\s*\)/,
  );
  assert.ok(allowlistBlock, "SC-4 exact product-path allowlist is missing");
  const productPaths = allowlistBlock[1].trim().split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^'([^']+)'$/);
    assert.ok(match, `SC-4 allowlist entry is not one exact literal: ${line}`);
    return match[1];
  });
  assert.deepEqual(
    productPaths,
    EXPECTED_SC4_PRODUCT_PATHS,
    "SC-4 product allowlist drifted",
  );
  assert.match(
    sc4Step,
    /if \[ "\$path" = "\$product_path" \]; then/,
    "SC-4 must classify by exact path equality",
  );
  for (
    const token of [
      "run_sc4=false",
      "while IFS= read -r path; do",
      'for product_path in "${sc4_product_paths[@]}"; do',
      "run_sc4=true",
      "break 2",
      'done <<< "$changed"',
      'if [ "$run_sc4" = true ]; then',
    ]
  ) {
    assert.ok(
      sc4Step.includes(token),
      `SC-4 classifier is not wired: ${token}`,
    );
  }
  assert.doesNotMatch(
    sc4Step,
    /grep[^\n]*(?:2099|PendingVenueIdentityCorrection|pending_venue)/,
    "SC-4 must not classify by a filename fragment",
  );
  assert.match(
    sc4Step,
    /if \[ "\$\{\{ github\.event_name \}\}" != "pull_request" \]; then[\s\S]*?echo "run=true"/,
    "push/main must continue to run SC-4",
  );

  const shouldRunOnPullRequest = (changedPaths: string[]): boolean =>
    changedPaths.some((changedPath) => productPaths.includes(changedPath));
  for (const productPath of EXPECTED_SC4_PRODUCT_PATHS) {
    assert.equal(
      shouldRunOnPullRequest([productPath]),
      true,
      `exact product path must run SC-4: ${productPath}`,
    );
  }
  assert.equal(
    shouldRunOnPullRequest([
      "docs/unrelated.md",
      EXPECTED_SC4_PRODUCT_PATHS[3],
      "supabase/migrations/unrelated.sql",
    ]),
    true,
    "one exact product path in a mixed PR must run SC-4",
  );

  assert.equal(
    shouldRunOnPullRequest(ISSUE_2855_CURRENT_DIFF),
    false,
    "the exact #2855 diff must not run the Mingla Business bundle measurement",
  );
  const excludedPaths = [
    "supabase/migrations/20270418002099_issue_2099_pending_venue_identity_correction.sql",
    "supabase/migrations/__tests__/issue_2099_pending_venue_identity_correction.test.sql",
    "supabase/migrations/__tests__/issue_2099_pending_venue_identity_correction.test.ts",
    "mingla-business/src/components/venue/__tests__/issue2099PendingIdentityCorrection.test.tsx",
    "mingla-business/playwright.issue2099.config.ts",
    "mingla-business/jest.issue2099.web.render.cjs",
    "mingla-business/src/components/venue/PendingVenueIdentityCorrectionLauncher.native.tsx",
    "mingla-business/src/components/venue/PendingVenueIdentityCorrectionLauncher.d.ts",
    "mingla-admin/src/services/adminClaimsService.js",
    ".github/workflows/issue-2099-pending-venue-identity-correction-tests.yml",
    ".github/ci-batch/MANIFEST.json",
    "docs/INVARIANT_REGISTRY.md",
    "REPORTS.md",
    "mingla-business/app/venue/[venueId]/index.tsx.test",
    "other/PendingVenueIdentityCorrectionDialog.web.tsx",
  ];
  for (const excludedPath of excludedPaths) {
    assert.equal(
      shouldRunOnPullRequest([excludedPath]),
      false,
      `non-product or near-match path must skip SC-4: ${excludedPath}`,
    );
  }
});

Deno.test("#2855 records only its reviewed provider-reference delta", () => {
  // [TEST-MOD-APPROVED #2648] The two whole-file digests of
  // validate-manifest-v2.mjs are replaced by a pin on the ONE record #2855 owns,
  // read from the validator's exported registry. Rationale and the six-values-in-
  // three-days evidence are on ISSUE_2855_DECLARATION_SHA256 above.
  const declaration = issue2855Declaration();
  assert.equal(
    declaration.workflow,
    "issue-2099-pending-venue-identity-correction-tests.yml",
    "#2855's declaration must be attached to the #2099 lane",
  );
  assert.deepEqual(
    [...declaration.referenceFiles].sort(),
    [
      "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
      "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.tester_adversarial.test.sql",
    ],
    "#2855's reviewed reference-file set drifted",
  );
  assert.equal(
    createHash("sha256").update(canonicalDeclaration(declaration)).digest(
      "hex",
    ),
    ISSUE_2855_DECLARATION_SHA256,
    "#2855's reviewed provider-reference delta drifted from the approved record",
  );
  assertComposedValidatorProvenance(validator);

  // The whole-file digest could see a #2855 declaration deleted outright. So can
  // this, on both the text and the semantic side.
  assert.throws(
    () =>
      assertComposedValidatorProvenance(validator.replace(PROVIDER_DELTA, "")),
    "deleting the #2855 declaration must fail exact-once ownership",
  );
  assert.throws(
    () =>
      assertComposedValidatorProvenance(
        validator.replace(PROVIDER_DELTA, `${PROVIDER_DELTA}${PROVIDER_DELTA}`),
      ),
    "a duplicated #2855 declaration must fail exact-once ownership",
  );

  const missingProviderDelta = validator.replace(
    "issue_2855_pending_venue_schema_pin.tester_adversarial.test.sql",
    "issue_2855_pending_venue_schema_pin.tester_adversarial.test.sql.missing",
  );
  assert.throws(
    () => assertComposedValidatorProvenance(missingProviderDelta),
    "an altered #2855 provider path must fail exact-once ownership",
  );

  const alteredCurrentFragment = validator.replace(
    PHASE3B_LEAF_REGISTRY_CURRENT,
    PHASE3B_LEAF_REGISTRY_CURRENT.replace(
      "current 40 executed + 0 absent",
      "current forty executed + 0 absent",
    ),
  );
  assert.throws(
    () => assertComposedValidatorProvenance(alteredCurrentFragment),
    "an altered #2582 current fragment must fail closed",
  );

  const duplicateCurrentFragment = validator.replace(
    PHASE3B_WAVE_HEADER_CURRENT,
    `${PHASE3B_WAVE_HEADER_CURRENT}\n${PHASE3B_WAVE_HEADER_CURRENT}`,
  );
  assert.throws(
    () => assertComposedValidatorProvenance(duplicateCurrentFragment),
    "a duplicate #2582 current fragment must fail exact-once cardinality",
  );
  assert.throws(
    () =>
      assertComposedValidatorProvenance(
        `${validator}\n${PHASE3B_LEAF_REGISTRY_RETIRED}`,
      ),
    "a retired 37/3 fragment in live validator bytes must fail",
  );
  // [TEST-MOD-APPROVED #2648] The former `// foreign drift` control asserted that
  // ANY appended byte reds this lane. That is precisely the property being
  // retired: five unrelated issues exercised it in three days and it blocked
  // merges rather than catching anything. Replaced with the drift that IS #2855's
  // to catch — a foreign declaration reaching for a #2855 reference file.
  assert.throws(
    () =>
      assertComposedValidatorProvenance(
        `${validator}\n// "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts"`,
      ),
    "a #2855 reference file named outside #2855's own declaration must fail",
  );
  assert.throws(
    () =>
      assertComposedValidatorProvenance(
        validator.replace(FROZEN_PROVIDER_SEAL, "0".repeat(64)),
      ),
    "re-pinning the frozen provider seal must remain red",
  );
});

Deno.test("#2855 host-composes the tester fragment into the real outer SQL fixture", () => {
  const marker = "-- #2855_TESTER_ADVERSARIAL_INCLUDE";
  assert.equal(
    sqlTest.split(/\r?\n/).filter((line) => line === marker).length,
    1,
    "tester SQL marker must be one exact standalone line",
  );
  assert.equal(count(sqlTest, marker), 1, "tester SQL marker must be unique");
  assert.ok(
    sqlTest.indexOf(marker) > sqlTest.indexOf("BEGIN;"),
    "tester marker must be inside the #2099 outer fixture transaction",
  );
  assert.ok(
    sqlTest.indexOf(marker) < sqlTest.lastIndexOf("ROLLBACK;"),
    "tester marker must remain before the outer fixture rollback",
  );
  assert.doesNotMatch(sqlTest, /^\s*\\i(?:\s|$)/m);
  assert.doesNotMatch(
    tester,
    /^\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\s*;/im,
    "tester SQL must remain a fragment of the existing transaction",
  );

  const postgresStep = workflow.slice(
    workflow.indexOf("- name: PostgreSQL 17 full-chain correction contract"),
    workflow.indexOf('- name: "D4 — migration replay safety'),
  );
  for (
    const token of [
      `main_sql="${SQL_TEST_PATH}"`,
      `tester_sql="${TESTER_PATH}"`,
      'test -r "$main_sql"',
      'test -r "$tester_sql"',
      "main_path.read_bytes()",
      "tester_path.read_bytes()",
      "main.splitlines().count(marker) != 1",
      "main.count(marker) != 1",
      "combined = main.replace(marker, tester)",
      "combined == main or marker in combined",
      "sys.stdout.buffer.write(combined)",
    ]
  ) {
    assert.ok(
      postgresStep.includes(token),
      `PostgreSQL step does not fail-closed on or compose: ${token}`,
    );
  }
  assert.ok(
    postgresStep.includes(
      `python3 - "$main_sql" "$tester_sql" <<'PY' | docker exec -i -e PGPASSWORD="$db_password" "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -`,
    ),
    "host-composed bytes are not streamed into the real containerized psql",
  );
  assert.ok(
    postgresStep.includes(
      're.search(rb"(?m)^\\s*\\\\i(?:\\s|$)", combined)',
    ),
    "the combiner does not reject an unresolved psql include",
  );
  assert.ok(
    postgresStep.includes(
      're.search(rb"(?mi)^\\s*(?:BEGIN|START\\s+TRANSACTION|COMMIT|END|ROLLBACK)\\s*;", tester)',
    ),
    "the combiner does not enforce the tester transaction-fragment contract",
  );
  assert.match(
    tester,
    /schema hash review approves only the lane's existence, never nonzero use/i,
    "reserved tester file must state the safety boundary",
  );
  assert.ok(
    tester.includes("issue-2099-pending-venue-identity-correction-tests.yml"),
    "tester guard must truthfully name its CI provider",
  );
  assert.ok(
    sqlTest.includes(NEW_HASH),
    "main SQL fixture still expects the stale hash",
  );
});

// [#2648] The invisibility half of the 2026-09-02 red.
//
// This lane is paths-gated. On 2026-08-30 it consumed nine files and its `paths:`
// filter listed only three of them, so the file that decided whether it passed —
// .github/scripts/ci-batch/validate-manifest-v2.mjs — could not fire it. Five
// merges broke this job; none of them ran it; it sat red on main for three days
// and was carried past on #2887 as a proven-inherited failure.
//
// A digest can be re-derived. A gate nobody runs cannot be. So the coupling is
// made self-enforcing: every file this guard READS must be a file that TRIGGERS
// the lane. Adding a new Deno.readTextFile above without adding its path to the
// workflow fails here, in the same commit, instead of years later on main.
//
// Deliberately intrinsic — it compares two files in the checkout and consults no
// merge base, because CI checks this repository out shallow elsewhere and a
// base-dependent assertion fails there for the wrong reason.
const FILES_THIS_GUARD_READS = [
  ORIGINAL_PATH,
  FORWARD_PATH,
  COVER_VIDEO_PATH,
  COMPETITOR_PATH,
  BUDGET_PATH,
  SQL_TEST_PATH,
  TESTER_PATH,
  WORKFLOW_PATH,
  VALIDATOR_PATH,
] as const;

Deno.test("#2648 every file this guard reads can also fire the lane that runs it", () => {
  const anchor = "paths: &issue2099Paths";
  const start = workflow.indexOf(anchor);
  assert.notEqual(start, -1, "the shared #2099 paths anchor is missing");
  const end = workflow.indexOf("\n  push:", start);
  assert.notEqual(
    end,
    -1,
    "the push trigger that reuses the anchor is missing",
  );
  const declared = [
    ...workflow.slice(start, end).matchAll(/^\s+- "([^"]+)"$/gm),
  ]
    .map((match) => match[1]);
  assert.ok(declared.length > 0, "the #2099 paths anchor declares nothing");

  const missing = FILES_THIS_GUARD_READS.filter((file) =>
    !declared.includes(file)
  );
  assert.deepEqual(
    missing,
    [],
    "this guard reads a file that cannot trigger the lane, so a change to it can red main invisibly",
  );

  // The push trigger must reuse the SAME anchor. A second, hand-maintained copy
  // of the list is how the two halves drift apart while both look present.
  assert.match(
    workflow.slice(end),
    /push:\n\s+branches: \[main\]\n\s+paths: \*issue2099Paths/,
    "push to main must reuse the pull_request paths anchor, never a second copy",
  );
});
