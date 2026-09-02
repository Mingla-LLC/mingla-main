// Issue #2851 implementor regression proof.
//
// This suite protects the real repository, not a retyped policy replica: the
// current workflow inventory must remain correctly partitioned, the production
// scan must pass, and six distinct true policy reversions must turn the semantic
// guard red. It deliberately does not inspect git history: #2871 proved that a
// historical PR diff is not a durable invariant on main or on later branches.

import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  auditWorkflowSources,
  expectedGroup,
  LOAD_GROUP,
  NORMAL_CANCEL,
  readWorkflowSources,
  REPO_ROOT,
} from "./issue-2851-pr-concurrency-policy.mjs";

// Construct live workflow names at runtime. The CI-batch provider scanner reads
// tracked source and must not treat this regression suite as provider evidence.
const liveWorkflow = (...stemParts) => `${stemParts.join("-")}.${["y", "ml"].join("")}`;
const DENIED = [
  liveWorkflow("android", "applinks", "health", "probe"),
  liveWorkflow("bundle", "baseline", "ratchet"),
  liveWorkflow("deploy", "functions"),
  liveWorkflow("onelink", "health", "probe"),
  liveWorkflow("rotate", "apple", "jwt"),
  liveWorkflow("sprint", "rollover"),
  liveWorkflow("stripe", "connect", "smoke"),
];
const PR_FAMILY_COUNT = 124;
const PR_FAMILY_IDENTITY_SHA256 =
  "9356c4252e3a521e57c039ed765ff1f05f434516010df09c8937cd73bdab3f04";
// [TEST-MOD-APPROVED #2241] Mechanically re-derived after the exact approved
// #1930 shared-resolver trigger addition, #2241 secret-readiness lanes,
// #2893/#2899 Sites workflow authority, and #2885's reviewed baseline-only path
// exclusions. The seven exclusions and their authorities remain unchanged.
//
// [TEST-MOD-APPROVED #2879] Re-derived again after #2879 registered its
// migration in the #1931 and #2117 filtered-replay skip lists. Those two lanes
// replay the chain WITHOUT a specific migration, and #2879 re-emits
// `pg_direct_event_checkout_bundle`, whose body reaches objects each phase
// deliberately excludes — PostgreSQL validates a LANGUAGE sql body at CREATE
// time, so the replay aborts on it. The #2492 closure gate named the exact
// filename to add to each list.
//
// This is a REAL semantic delta, not a comment: each lane gains a `case`
// branch that changes what it applies. Both new branches are added to the
// revert-sensitivity loop below, so this digest cannot be re-pinned without
// each individual change being independently proven to move it.
//
// [TEST-MOD-APPROVED #2905] Re-derived again after #2905 extended the #1719
// unified-sharing lane — the sole live provider for the event-cover-video
// suites — with the Bunny status-enum seam. The CI origin registry is locked
// (I-2148-CI-TOPOLOGY-BOUNDED bans a new issue-*.yml lane), so the proofs for
// the shared `bunnyStream.ts` module attach to the lane that already owns the
// cover-video functions: two `paths` triggers and one `deno test` step.
//
// The concurrency policy itself is UNTOUCHED — `auditWorkflowSources` reports
// zero errors and the 124/7 partition is unchanged. Only the non-concurrency
// semantic content of one existing PR-family workflow moved. Five of the added
// lines are in the revert-sensitivity loop below, so this re-pin is proven
// line-by-line rather than accepted on assertion.
// [TEST-MOD-APPROVED #2948] Re-derived once more. #2948 added one step and three
// trigger paths to the #1456 edge-deploy idempotency lane (named by issue, not
// by filename — a workflow filename in this file becomes a provider reference
// and moves the frozen #2148 seal) so the lane that proves the deploy wrapper
// still REFUSES a deploy-all also proves its caller complies. That lane is
// PR-family, so its document is inside this digest.
// Round 2 moved it once more: the Sites recovery lane's `contracts` job gained
// the readback-wiring suite, and that lane is also PR-family. Same reasoning,
// same untouched counts, same revert-sensitivity loop below.
// PR_FAMILY_COUNT and PR_FAMILY_IDENTITY_SHA256 are deliberately UNCHANGED: no
// workflow was added, removed or renamed, and this delta is one existing
// workflow's non-concurrency document. Every revert-sensitivity assertion below
// is untouched and still red on reversion.
// [TEST-MOD-APPROVED #3009] Re-derived after #3009 made the existing Business
// web-build lane compile with the production Sites pilot switch and inspect the
// resulting bundle for static substitution. The PR-family inventory, identity,
// and concurrency policy remain unchanged. Both semantic units are independently
// reverted in the loop below before this new digest is trusted. The value was
// re-derived from fresh origin/main at 3835b60d3 so #2948's concurrently landed
// workflow proofs remain part of the combined authority.
// [TEST-MOD-APPROVED #2947] Re-derived after #2947 registered its two
// reconcile-stuck-checkouts sweep suites on the existing #2079 Paystack
// late-refund lane (named by issue, not by filename — a workflow filename in
// this file becomes a provider reference and moves the frozen #2148 seal).
// The suites were previously inert: they sat on no lane that wakes, so nothing
// ever ran them. I-2148-CI-TOPOLOGY-BOUNDED bans a new issue-*.yml lane, so the
// proofs attach to the lane that already owns `reconcile-stuck-checkouts`, as
// two additional `deno test` targets on a step that already exists. No `paths`
// trigger was widened and no lane was added. That lane is PR-family, so its
// document is inside this digest.
// PR_FAMILY_COUNT and PR_FAMILY_IDENTITY_SHA256 are deliberately UNCHANGED: no
// workflow was added, removed or renamed, and this delta is one existing
// workflow's non-concurrency document. Reverting BOTH added lines reproduces
// e39b5a9f… — the value origin/main pins at 4dc1d9f72 — proving this delta is
// exactly those two lines and nothing else drifted. Each line is also
// independently reverted in the loop below, so this re-pin is proven
// line-by-line rather than accepted on assertion. The value was re-derived
// against the tree AFTER merging origin/main at 4dc1d9f72, so #3009's
// concurrently landed web-build proofs remain part of the combined authority.
// [TEST-MOD-APPROVED #3016] Re-derived after #3016 wired its new tester-owned
// malformed authenticated-request CORS guard into the existing Supabase secret
// budget lane on top of fresh origin/main at 2fa4dbb51, preserving #2947's two
// independently guarded #2079 targets. The 124/7 workflow partition, identities,
// concurrency policy, and every unrelated workflow semantic are unchanged. The
// exact added Deno test target is independently removed in the revert-sensitivity
// loop below, so this digest cannot be re-pinned without proving that one-line CI
// contract.
//
// [TEST-MOD-APPROVED #2981] Mechanically re-derived from the combined current
// workflow tree after #2981 added its typecheck/build/runtime search-foundation
// step and independent host-owner test to that same web-build lane. The
// PR-family identity/count and concurrency policy remain unchanged; only the
// lane's non-concurrency document moved. The #3009 and #2981 semantic units are
// each independently removed in the mutation table below, so this re-pin cannot
// outlive a silent reversion of either authorized workflow change. The value
// below was re-derived from disk after rebasing onto origin/main at ccfadd28c,
// so #2947 and #3016 remain part of the combined authority as well.
// [TEST-MOD-APPROVED #2881] Re-derived after #2881 draft-gated the PR-family lanes:
// each gated workflow gained `types: [opened, synchronize, reopened,
// ready_for_review]` and a draft condition on every job. Both are NON-CONCURRENCY
// document changes, which is exactly what this digest absorbs. Named by issue, not
// by filename, per the rule above. PR_FAMILY_COUNT and PR_FAMILY_IDENTITY_SHA256 are
// deliberately UNCHANGED: no workflow was added, removed or renamed. Concurrency is
// untouched BY CONSTRUCTION -- #2881 never edits a `concurrency:` block. The
// revert-sensitivity loop below is untouched and still red on reversion; the Sites
// recovery lane stays exempt and byte-identical so that loop keeps its target.
// [TEST-MOD-APPROVED #2967] The #1719 unified-sharing lane gained two `paths`
// entries and two test steps for the bounded cover-video acknowledgement. That
// lane is PR-family, so its non-concurrency document is inside this digest.
// Every earlier re-derivation above is preserved, not replaced.
// PR_FAMILY_COUNT and PR_FAMILY_IDENTITY_SHA256 are UNCHANGED.
const PR_FAMILY_WITHOUT_CONCURRENCY_SHA256 =
  // [TEST-MOD-APPROVED #2986] The two approved search-validation commands
  // advance non-concurrency semantics; the 124-workflow policy is unchanged.
  // [TEST-MOD-APPROVED #2060] #2637 added `paths:` filters and test steps to
  // the Ari reliability and Ari brand-management lanes. Both are PR-family, so
  // their non-concurrency documents live inside this digest, exactly as the
  // #2967 re-derivation above.
  //
  // WHAT WAS VERIFIED BEFORE RE-DERIVING, because that is the review this
  // digest exists to force:
  //   - no `concurrency:` block, `group:` or `cancel-in-progress:` value is
  //     touched by e924a01b7 -- the change is additive path filters and steps;
  //   - PR_FAMILY_COUNT and PR_FAMILY_IDENTITY_SHA256 are UNCHANGED, so no
  //     workflow was added, removed or renamed;
  //   - the policy audit itself still reports zero errors at 124 PR-family
  //     workflows, which is the sibling test above.
  //
  // [TEST-MOD-APPROVED #3040] Re-derived again. #3040 added TWO test steps to
  // the #1719 unified-sharing lane (the deterministic cover-video umbrella).
  // That lane is PR-family, so its non-concurrency document is inside this
  // digest, exactly as the #2967 and #2060 re-derivations above.
  //
  // WHAT WAS VERIFIED BEFORE RE-DERIVING:
  //   - the change is PURELY ADDITIVE steps. Grepping that lane's branch diff
  //     for `concurrency`, `group:` and `cancel-in-progress` across added AND
  //     removed lines returns ZERO — no concurrency block, group expression or
  //     cancellation value is touched. Unlike #2967 this change adds no
  //     `paths:` entries either; the lane already scopes the cover-video edge
  //     functions and `mingla-business/**`. (The lane is named here the way
  //     every note above names it — as "the #1719 unified-sharing lane", never
  //     by its `.yml` path. A workflow FILENAME written in this file is counted
  //     by `discoverWorkflowProviders()` as an external provider reference and
  //     moves the frozen #2148 provider seal, exactly as the #2948 note on
  //     DENIED_FULL_SHA256 below warns.);
  //   - PR_FAMILY_COUNT and PR_FAMILY_IDENTITY_SHA256 are UNCHANGED, so no
  //     workflow was added, removed or renamed (I-2148-CI-TOPOLOGY-BOUNDED is
  //     green: "0 added workflow(s) in origin/main..HEAD");
  //   - the policy audit itself still reports zero errors at 124 PR-family
  //     workflows — the sibling test above, which passes.
  // Every earlier re-derivation is preserved, not replaced.
  // [TEST-MOD-APPROVED #2979] The existing attendance lane gained only its
  // reviewed #2979 paths and executable proofs; identity and policy are intact.
  "cffa7931d2a74a4b8ccd884941f7d187ec97800a449722587b6836de6993336f";
const DENIED_FULL_SHA256 = [
  "9ca2a41b615930e24419623c052caf0b81c3be272e06a66f0db8762405ac713b",
  "50e7093bc2f3b46037a885b7c295faad747c2eaa377760e2ea1ad151545c88eb",
  // [TEST-MOD-APPROVED #2948] Index 2 is the edge-function deploy workflow —
  // named through DENIED's `liveWorkflow` helper above, never as a literal,
  // because a workflow filename in this file becomes a provider reference and
  // moves the frozen #2148 seal. Re-pinned after #2948 replaced that workflow's
  // bare `scripts/deploy-supabase-functions.sh` invocation — the deploy-all
  // entry point until #2886 changed the wrapper's contract and left this caller
  // behind — with a computed, explicitly named selection, and added a
  // failure-alert job. This digest is the workflow's BYTES; the assertion that
  // it is denied PR cancellation is unchanged, still runs, and still fails on
  // the reversions proven in tests 5-10. Only the pinned value moves, and only
  // because the file genuinely changed. Round 2 moved it again: the deploy
  // step's `if:` now spells out its own success() precondition.
  "662c833b4fd222a4d708d64a5ac0f7ff9f8b6b972522a671645d182619973c18",
  "0ca059b1118b93b455ee539ff31c28b2fe6ad53c61c5f61faee5c5eccb9cb7f5",
  "ae053d47c1cea32c1889cc00eba1ed11b5bbec30dd726c3d078af92f3dfdf76a",
  "c6056ea23b01ad1e38e2cfe94891872dbed9dba94c9d7e5464c354f1563fc132",
  "9c1acd54bfa35a2eb6f67aea9c7c097ea1bcfe80a67865a1b2b8f62f8ef462b5",
];

const RUBY_CANONICAL = String.raw`
require "yaml"
require "json"
payload = JSON.parse(STDIN.read)
result = {}
payload.each do |file, source|
  document = YAML.safe_load(source, aliases: true) || {}
  on_value = document.key?("on") ? document["on"] : document[true]
  events = case on_value
           when Hash then on_value.keys.map(&:to_s)
           when Array then on_value.map(&:to_s)
           when String then [on_value]
           else []
           end
  document.delete("concurrency")
  result[file] = {"events" => events.sort, "withoutConcurrency" => document}
end
STDOUT.write(JSON.generate(result))
`;

function canonicalize(sources) {
  return JSON.parse(execFileSync("ruby", ["-e", RUBY_CANONICAL], {
    input: JSON.stringify(sources),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function currentTreeAuthority(sources) {
  const canonical = canonicalize(sources);
  const names = Object.keys(canonical).filter((name) => {
    const events = canonical[name].events;
    return events.includes("pull_request") || events.includes("pull_request_target");
  }).sort();
  const withoutConcurrency = Object.fromEntries(
    names.map((name) => [name, canonical[name]]),
  );
  return {
    names,
    identitySha256: sha256(JSON.stringify(names)),
    withoutConcurrencySha256: sha256(JSON.stringify(withoutConcurrency)),
  };
}

function assertCurrentTreeAuthority(sources) {
  const authority = currentTreeAuthority(sources);
  assert.equal(authority.names.length, PR_FAMILY_COUNT, "PR-family identity count drifted");
  assert.equal(authority.identitySha256, PR_FAMILY_IDENTITY_SHA256, "PR-family identity digest drifted");
  assert.equal(
    authority.withoutConcurrencySha256,
    PR_FAMILY_WITHOUT_CONCURRENCY_SHA256,
    "PR-family non-concurrency semantic digest drifted",
  );
  return authority;
}

function assertDeniedAuthorities(sources, identities = DENIED, hashes = DENIED_FULL_SHA256) {
  assert.deepEqual(identities, DENIED, "denied workflow identity ordering/correspondence drifted");
  assert.equal(identities.length, 7, "denied workflow identity count drifted");
  assert.equal(new Set(identities).size, 7, "denied workflow identities must be unique");
  assert.equal(hashes.length, 7, "denied workflow authority count drifted");
  assert.equal(new Set(hashes).size, 7, "denied workflow authorities must be unique");
  for (const [index, name] of identities.entries()) {
    assert.equal(typeof sources[name], "string", `${name}: denied workflow is missing or renamed`);
    assert.equal(sha256(sources[name]), hashes[index], `${name}: denied workflow bytes changed`);
  }
}
function replacePolicy(source, group, cancel) {
  const replacement = `concurrency:\n  group: ${group}\n  cancel-in-progress: ${cancel}\n`;
  const updated = source.replace(/^concurrency:\n(?: {2}[^\n]*\n){2}/m, replacement);
  assert.notEqual(updated, source, "fixture mutation must replace a real top-level policy");
  return updated;
}

function removePolicy(source) {
  const updated = source.replace(/^concurrency:\n(?: {2}[^\n]*\n){2}\n?/m, "");
  assert.notEqual(updated, source, "fixture mutation must delete a real top-level policy");
  return updated;
}

function removeExactLine(source, line, label) {
  const occurrences = source.split(line).length - 1;
  assert.equal(occurrences, 1, `${label}: expected exactly one mutation target`);
  const updated = source.replace(line, "");
  assert.notEqual(updated, source, `${label}: mutation must change workflow semantics`);
  return updated;
}

function expectMutationFailure(name, mutate, diagnostic) {
  const sources = readWorkflowSources();
  mutate(sources);
  const result = auditWorkflowSources(sources);
  assert.ok(
    result.errors.some((error) => error.includes(diagnostic)),
    `${name}: expected diagnostic ${diagnostic}; got ${result.errors.join(" | ")}`,
  );
}

// [TEST-MOD-APPROVED #2241] #2899's Sites recovery workflow is a mixed
// PR/schedule/dispatch workflow and therefore joins the exact PR-family set.
test("the real tree has 124 canonical PR-family policies and the sole load exception", () => {
  const result = auditWorkflowSources(readWorkflowSources());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.counts, {
    totalWorkflows: 131,
    prFamily: 124,
    standardPullRequest: 123,
    pullRequestTarget: 1,
    normalPolicies: 123,
    exceptions: 1,
  });
});

// [TEST-MOD-APPROVED #2582] The origin/main diff was valid before #2851
// merged, then became an empty moving-base comparison downstream. Preserve the
// same exact 124 identities and non-concurrency semantics with current-tree
// digests, and preserve the seven exclusions with durable full-byte hashes.
test("the real tree independently classifies 124 PR-family and seven non-PR workflows", () => {
  const sources = readWorkflowSources();
  const authority = assertCurrentTreeAuthority(sources);
  const audit = auditWorkflowSources(sources);
  const sitesRecoveryName = liveWorkflow("sites", "backup", "restore");
  assert.deepEqual(
    canonicalize(sources)[sitesRecoveryName].events,
    ["pull_request", "schedule", "workflow_dispatch"],
    "Sites recovery must remain an exact mixed PR/production-event workflow",
  );
  assert.ok(authority.names.includes(sitesRecoveryName), "Sites recovery must remain in the PR-family authority");
  assert.deepEqual(audit.errors, []);
  assert.deepEqual(audit.counts, {
    totalWorkflows: 131,
    prFamily: 124,
    standardPullRequest: 123,
    pullRequestTarget: 1,
    normalPolicies: 123,
    exceptions: 1,
  });

  const noHistoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mingla-2851-no-git-"));
  try {
    const noHistoryWorkflows = path.join(noHistoryRoot, ".github/workflows");
    fs.mkdirSync(noHistoryWorkflows, { recursive: true });
    for (const [name, source] of Object.entries(sources)) {
      fs.writeFileSync(path.join(noHistoryWorkflows, name), source);
    }
    assert.deepEqual(
      assertCurrentTreeAuthority(readWorkflowSources(noHistoryRoot)),
      authority,
      "current-tree authority must not require Git metadata or history",
    );
  } finally {
    fs.rmSync(noHistoryRoot, { recursive: true, force: true });
  }

  const removed = { ...sources };
  delete removed[authority.names[0]];
  assert.throws(() => assertCurrentTreeAuthority(removed), /identity count drifted/);

  const renamed = { ...sources };
  const renamedFrom = authority.names[0];
  renamed[liveWorkflow("renamed", "pr", "family", "fixture")] = renamed[renamedFrom];
  delete renamed[renamedFrom];
  assert.throws(() => assertCurrentTreeAuthority(renamed), /identity digest drifted/);

  const added = { ...sources };
  added[liveWorkflow("added", "pr", "family", "fixture")] = sources[authority.names[0]];
  assert.throws(() => assertCurrentTreeAuthority(added), /identity count drifted/);

  const semanticDrift = { ...sources };
  const semanticName = authority.names[0];
  semanticDrift[semanticName] = `${semanticDrift[semanticName]}\nx-amendment-13-probe: true\n`;
  const semanticAuthority = currentTreeAuthority(semanticDrift);
  assert.equal(semanticAuthority.identitySha256, authority.identitySha256);
  assert.notEqual(semanticAuthority.withoutConcurrencySha256, authority.withoutConcurrencySha256);
  assert.throws(() => assertCurrentTreeAuthority(semanticDrift), /non-concurrency semantic digest drifted/);

  // [TEST-MOD-APPROVED #2241] Each workflow delta that legitimately moved the
  // digest is independently revert-sensitive; the unrelated semantic mutation
  // above remains a separate widening tripwire.
  for (const [name, line] of [
    [liveWorkflow("issue", "1930", "checkout", "current", "truth"), '      - "supabase/functions/_shared/secretBundle.ts"\n'],
    [liveWorkflow("supabase", "secret", "budget"), '      - "supabase/function-env.contract.json"\n'],
    [liveWorkflow("supabase", "secret", "budget"), "          supabase/functions/_shared/__tests__/issue_2893_sites_live_readiness.test.ts\n"],
    // [TEST-MOD-APPROVED #3016] The tester-owned malformed request guard must
    // remain executable in the existing pull-request Deno lane. Removing this
    // exact target must invalidate the non-concurrency authority digest.
    [liveWorkflow("supabase", "secret", "budget"),
      "          supabase/functions/_shared/__tests__/issue_3016_brand_site_control_cors_adversarial.test.ts\n"],
    [liveWorkflow("web", "build", "check"), '      SITES_DATABASE_POOL_MAX: "3"\n'],
    [liveWorkflow("web", "build", "check"), '      - "mingla-business/scripts/ci/bundle-baseline.json"\n'],
    // [TEST-MOD-APPROVED #2981] The complete CI step and both runtime proof
    // commands are individually revert-sensitive. Comments do not enter the
    // YAML semantic document and therefore require no digest exception.
    [liveWorkflow("web", "build", "check"),
      `      - name: "#2981 marketing search foundation"\n        working-directory: mingla-marketing\n        run: |\n          npm run typecheck\n          npm run build\n          npm run test:search-foundation\n          node --test scripts/issue-2981-host-owner-isolation.tester.test.mjs\n`],
    [liveWorkflow("web", "build", "check"),
      "          npm run test:search-foundation\n"],
    [liveWorkflow("web", "build", "check"),
      "          node --test scripts/issue-2981-host-owner-isolation.tester.test.mjs\n"],
    [liveWorkflow("bundle", "baseline", "automerge"), '      - ".github/workflows/**"\n'],
    // [TEST-MOD-APPROVED #2979] One trigger and one executable guard from the
    // attendance continuity delta must each remain part of this authority.
    [liveWorkflow("issue", "871", "attendance", "entitlement", "tests"),
      '      - "supabase/functions/_shared/governedAdSecret.ts"\n'],
    [liveWorkflow("issue", "871", "attendance", "entitlement", "tests"),
      "          node .github/scripts/strict-grep/issue-2979-attendance-claim-continuity.mjs\n"],
    // [TEST-MOD-APPROVED #2879] The two filtered-replay skip entries this work
    // added. Each must independently move the digest, or the re-pin above
    // would be accepting a change nothing proves.
    [liveWorkflow("issue", "1931", "private", "event", "access"),
      "              *20270609002879_issue_2879_redirect_window_counts_as_held.sql) continue ;;\n"],
    [liveWorkflow("issue", "2117", "offering", "visibility", "gate", "tests"),
      "              *20270609002879_issue_2879_redirect_window_counts_as_held.sql) continue ;;\n"],
    // [TEST-MOD-APPROVED #2905] The #1719 lane's two new `paths` triggers and
    // three new `deno test` targets. Each must independently move the digest.
    [liveWorkflow("issue", "1719", "unified", "sharing"),
      '      - "supabase/functions/_shared/bunnyStream.ts"\n'],
    [liveWorkflow("issue", "1719", "unified", "sharing"),
      '      - "supabase/functions/_shared/bunnyStream.issue2905.*.test.ts"\n'],
    [liveWorkflow("issue", "1719", "unified", "sharing"),
      "          supabase/functions/_shared/bunnyStream.issue2905.enum-seam.test.ts\n"],
    [liveWorkflow("issue", "1719", "unified", "sharing"),
      "          supabase/functions/event-cover-video-webhook/index.issue2905.silent200.test.ts\n"],
    [liveWorkflow("issue", "1719", "unified", "sharing"),
      "          supabase/functions/event-cover-video-reaper/__tests__/\n"],
    // [TEST-MOD-APPROVED #3009] The compile-time pilot switch and the
    // post-export bundle verifier are distinct semantic units. Removing either
    // must invalidate the authority digest, so the re-pin above cannot accept
    // the workflow change without proving both exact reversions stay visible.
    [liveWorkflow("web", "build", "check"),
      "EXPO_PUBLIC_FF_SITES_ENABLED=true "],
    [liveWorkflow("web", "build", "check"), [
      '      - name: "#3009 Sites feature switch is static in the exported bundle"',
      "        working-directory: mingla-business",
      "        run: node scripts/ci/issue-3009-sites-feature-flag-export.mjs",
      "",
    ].join("\n")],
    // [TEST-MOD-APPROVED #2947] The #2079 lane's two new `deno test` targets.
    // The implementor's expiry-filter suite and the tester's adversarial
    // limit-boundary suite are distinct semantic units — each is what makes one
    // of the two suites actually run — so each must independently move the
    // digest, or the re-pin above would be accepting a change nothing proves.
    [liveWorkflow("issue", "2079", "paystack", "late", "refund", "identity", "tests"),
      "          supabase/functions/reconcile-stuck-checkouts/__tests__/issue_2947_sweep_expiry_filter.test.ts\n"],
    [liveWorkflow("issue", "2079", "paystack", "late", "refund", "identity", "tests"),
      "          supabase/functions/reconcile-stuck-checkouts/__tests__/issue_2947_sweep_limit_boundary.tester_adversarial.test.ts\n"],
  ]) {
    const reverted = { ...sources };
    reverted[name] = removeExactLine(reverted[name], line, name);
    assert.throws(() => assertCurrentTreeAuthority(reverted), /non-concurrency semantic digest drifted/);
  }

  const sitesWithoutPullRequest = { ...sources };
  sitesWithoutPullRequest[sitesRecoveryName] = removeExactLine(
    sitesWithoutPullRequest[sitesRecoveryName],
    `  pull_request:\n    paths:\n      - ".github/workflows/${sitesRecoveryName}"\n      - "scripts/sites/**"\n`,
    "Sites recovery pull_request authority",
  );
  assert.throws(() => assertCurrentTreeAuthority(sitesWithoutPullRequest), /identity count drifted/);

  const concurrencyDrift = { ...sources };
  const concurrencyName = liveWorkflow("framework", "major", "guard");
  concurrencyDrift[concurrencyName] = removePolicy(concurrencyDrift[concurrencyName]);
  const concurrencyAuthority = assertCurrentTreeAuthority(concurrencyDrift);
  assert.deepEqual(concurrencyAuthority, authority);
  assert.ok(
    auditWorkflowSources(concurrencyDrift).errors.some((error) =>
      error.includes(`${concurrencyName}: missing or non-object top-level concurrency policy`)),
  );

  assert.throws(() => assertCurrentTreeAuthority({}), /identity count drifted/);
  assert.throws(
    () => assertCurrentTreeAuthority({ [liveWorkflow("malformed", "fixture")]: "on: [pull_request\n" }),
    /Command failed/,
  );
});

// [TEST-MOD-APPROVED #2241] The #2899 recovery workflow mixes PR contracts
// with irreversible production backup/restore events. Its canonical policy
// must cancel only same-PR superseded runs and isolate every production run.
test("Sites recovery mixed events use the exact event-safe concurrency policy", () => {
  const sources = readWorkflowSources();
  const name = liveWorkflow("sites", "backup", "restore");
  assert.deepEqual(auditWorkflowSources(sources).errors, []);

  const reverted = { ...sources };
  reverted[name] = replacePolicy(reverted[name], "mingla-sites-production-backup-restore", false);
  const errors = auditWorkflowSources(reverted).errors;
  assert.ok(errors.some((error) => error.includes(`${name}: same-workflow cross-PR identity collision`)));
  assert.ok(errors.some((error) => error.includes(`${name}: cancellation is not exactly PR-family scoped`)));
});

test("the seven non-PR workflows remain outside the PR cancellation mandate", () => {
  const sources = readWorkflowSources();
  assertDeniedAuthorities(sources);

  const missing = { ...sources };
  delete missing[DENIED[0]];
  assert.throws(() => assertDeniedAuthorities(missing), /missing or renamed/);

  const renamed = { ...sources };
  renamed[liveWorkflow("renamed", "denied", "fixture")] = renamed[DENIED[0]];
  delete renamed[DENIED[0]];
  assert.throws(() => assertDeniedAuthorities(renamed), /missing or renamed/);

  const duplicated = [...DENIED];
  duplicated[1] = duplicated[0];
  assert.throws(() => assertDeniedAuthorities(sources, duplicated), /ordering\/correspondence drifted/);

  assert.throws(
    () => assertDeniedAuthorities(sources, [...DENIED].reverse()),
    /ordering\/correspondence drifted/,
  );

  const byteDrift = { ...sources };
  byteDrift[DENIED[0]] = `${byteDrift[DENIED[0]]}\n`;
  assert.throws(() => assertDeniedAuthorities(byteDrift), /denied workflow bytes changed/);
});

test("missing concurrency reversion turns the real repository scan red", () => {
  expectMutationFailure("missing", (sources) => {
    const name = liveWorkflow("framework", "major", "guard");
    sources[name] = removePolicy(sources[name]);
  }, "missing or non-object top-level concurrency policy");
});

test("github.workflow identity reversion turns the real repository scan red", () => {
  expectMutationFailure("workflow-name", (sources) => {
    const name = liveWorkflow("issue", "1423", "stay", "discovery", "tests");
    sources[name] = replacePolicy(sources[name], "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}", NORMAL_CANCEL);
  }, "github.workflow is collision-prone");
});

test("github.ref non-PR fallback reversion turns the real repository scan red", () => {
  expectMutationFailure("ref-fallback", (sources) => {
    const name = liveWorkflow("ci", "batch");
    sources[name] = replacePolicy(sources[name], "ci-ci-batch-${{ github.event.pull_request.number || github.ref }}", NORMAL_CANCEL);
  }, "github.ref/head_ref can pending-displace non-PR runs");
});

test("unconditional cancellation reversion turns the real repository scan red", () => {
  expectMutationFailure("unconditional", (sources) => {
    const name = liveWorkflow("mingla", "business", "jest", "suite");
    sources[name] = replacePolicy(sources[name], expectedGroup(name), true);
  }, "unconditional cancellation reaches non-PR events");
});

test("pull_request_target mis-scope reversion turns the real repository scan red", () => {
  expectMutationFailure("target", (sources) => {
    const name = liveWorkflow("bundle", "baseline", "provenance", "guard");
    sources[name] = replacePolicy(sources[name], expectedGroup(name), "${{ github.event_name == 'pull_request' }}");
  }, "wrong pull_request_target cancellation scope");
});

test("load-smoke cancellation reversion turns the real repository scan red", () => {
  expectMutationFailure("load", (sources) => {
    const name = liveWorkflow("load", "smoke");
    sources[name] = replacePolicy(sources[name], LOAD_GROUP, true);
  }, "external-POST exception must be run-unique and non-cancellable");
});

test("strict-grep manifest wires the guard in both modes and this suite in class A", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".github/scripts/strict-grep/MANIFEST.json"), "utf8"));
  const byScript = new Map(manifest.gates.map((entry) => [entry.script, entry]));
  assert.deepEqual(byScript.get(".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs"), {
    script: ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["plain", "self-test"],
    selfTest: "wired",
    jobKeys: ["issue-2851-pr-concurrency-policy"],
  });
  assert.deepEqual(byScript.get(".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs"), {
    script: ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node --test",
    modes: ["plain"],
    selfTest: "none",
    jobKeys: ["issue-2851-pr-concurrency-policy-implementor"],
  });
});
