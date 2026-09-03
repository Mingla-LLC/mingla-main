// Issue #3072 implementor regression proof.
//
// Six per-issue lanes fired on effectively every human pull request, because the
// only thing their filter excluded was one machine-written JSON file. This suite
// proves they now route on registry data, and — the assertion most likely to be
// broken silently — that #2885 AC-4's baseline exclusion still holds.
//
// It asserts against the REAL registry and the REAL tracked file set, not a
// retyped replica, for the reason #2851's suite records: a policy replica proves
// the replica.
//
// No workflow filename literal appears in this file. `discoverWorkflowProviders()`
// counts a workflow filename written into a tracked non-workflow file as an
// external provider reference and moves the frozen #2148 provider seal, so lanes
// are addressed by OWNER ISSUE and wrapper paths are read from the registry.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { compileOriginPattern, parseOriginPattern } from "../select-phase3b-suites.mjs";
import {
  MANIFEST_PATH,
  ROOT,
  decideSelection,
  main,
  providerOriginPatterns,
  routedProvider,
} from "../route-live-provider.mjs";

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

/** The six lanes #3072 routed, by owner issue. */
const LANES = ["#1403", "#1421", "#1484", "#1501", "#1532", "#874"];

/** #2885 AC-4's subject: the machine-written boot-payload baseline. */
const BASELINE = "mingla-business/scripts/ci/bundle-baseline.json";

const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

const routed = (changedPaths) => ({ mode: "routed", eventName: "pull_request", changedPaths });

const selects = (ownerIssue, changedPaths) => {
  const provider = routedProvider(manifest, ownerIssue);
  return decideSelection(provider, providerOriginPatterns(provider), routed(changedPaths)).selected;
};

test("1. every one of the six lanes carries non-empty originPaths under the ONE reviewed grammar", () => {
  for (const ownerIssue of LANES) {
    const provider = routedProvider(manifest, ownerIssue);
    const patterns = providerOriginPatterns(provider);
    assert.ok(patterns.length > 0, `${ownerIssue}: originPaths must not be empty`);
    for (const pattern of patterns) {
      // Throws on anything the #2882 grammar does not accept. A pattern this
      // router cannot parse must not be silently skipped.
      parseOriginPattern(pattern);
    }
    assert.equal(provider.routing.ownerIssue, "#3072");
    assert.ok(provider.routing.rationale.trim().length > 0, `${ownerIssue}: routing needs a rationale`);
  }
});

test("2. fail-closed is preserved: a registered lane whose originPaths is absent or empty is refused", () => {
  for (const entries of [undefined, [], null, "mingla-business/src/**"]) {
    assert.throws(
      () => providerOriginPatterns({ stem: "probe", routing: { originPaths: entries } }),
      /originPaths is empty for probe/,
      `originPaths ${JSON.stringify(entries)} must be refused, not treated as "matches nothing"`,
    );
  }
  // #2882's gate fails the build on this; these six must not become the first
  // exception, so the refusal is a throw and the caller exits non-zero.
  assert.throws(() => providerOriginPatterns({ stem: "probe" }), /would never run/);
});

test("3. every routed pattern matches at least one tracked file (no dead route)", () => {
  const tracked = trackedFiles();
  for (const ownerIssue of LANES) {
    const provider = routedProvider(manifest, ownerIssue);
    for (const pattern of providerOriginPatterns(provider)) {
      const matcher = compileOriginPattern(pattern);
      assert.ok(
        tracked.some(matcher),
        `${ownerIssue}: originPaths pattern matches no tracked file: ${pattern}`,
      );
    }
  }
});

test("4. #2885 AC-4 — a pull request whose only changed file is the baseline starts none of the six", () => {
  for (const ownerIssue of LANES) {
    assert.equal(
      selects(ownerIssue, [BASELINE]),
      false,
      `${ownerIssue}: a baseline-only pull request must not select this lane`,
    );
  }
});

test("5. #2885 AC-4's OUTER filter is intact: the registry still records the baseline as each lane's path scope", () => {
  // The `paths-ignore` block itself is the thing that stops the recording PRs
  // before a runner is ever allocated. `workflowMetadata.pathScope` is
  // re-derived from the workflow on disk by validate-manifest-v2.mjs, so this
  // asserting the registry IS asserting the workflow.
  for (const ownerIssue of LANES) {
    const provider = routedProvider(manifest, ownerIssue);
    assert.deepEqual(
      provider.workflowMetadata.pathScope,
      [BASELINE],
      `${ownerIssue}: the #2885 AC-4 baseline exclusion must remain this lane's only trigger path scope`,
    );
  }
});

test("6. a documentation-only pull request starts none of the six", () => {
  for (const changed of [["REPORTS.md"], ["docs/MINGLA_ENGINEERING_HANDBOOK.md"], ["README.md", "COMMS.md"]]) {
    for (const ownerIssue of LANES) {
      assert.equal(selects(ownerIssue, changed), false, `${ownerIssue}: ${changed.join(",")} must not select`);
    }
  }
});

test("7. a change to a file a lane actually READS does select that lane, and only the lanes that read it", () => {
  // Each row is MEASURED, not guessed: every path below was observed being read
  // by the named lane's own gates, tests or edge-function checks.
  const expectations = [
    // The #1421 wiring gate and its deno check read this edge function; no other lane does.
    ["supabase/functions/venue-organic-capture/index.ts", ["#1421"]],
    // Only the two lanes that stand up PostgreSQL replay the migration history.
    ["supabase/migrations/20270202001421_issue_1421_venue_organic_engagement.sql", ["#1403", "#1421"]],
    // The #874 currency-fallback gate names this consumer file literally.
    ["app-mobile/src/components/ConnectionsPage.tsx", ["#874"]],
    // A consumer screen no lane reads.
    ["app-mobile/src/screens/Feed.tsx", []],
    // The Vite admin is not in any of these lanes' graphs.
    ["mingla-admin/src/App.tsx", []],
    // Business source is typechecked, rendered or bundled by all six.
    ["mingla-business/src/services/brandAnalyticsService.ts", LANES],
    // tsconfig maps @mingla/* into packages/, so it is inside every business graph.
    ["packages/offering-rendering/QuantityRow.tsx", LANES],
  ];
  for (const [changedPath, expected] of expectations) {
    const actual = LANES.filter((ownerIssue) => selects(ownerIssue, [changedPath]));
    assert.deepEqual(actual, [...expected], `${changedPath} selected the wrong lane set`);
  }
});

test("8. a change to a lane's own wrapper selects that lane", () => {
  for (const ownerIssue of LANES) {
    const provider = routedProvider(manifest, ownerIssue);
    assert.ok(provider.providerWorkflow, `${ownerIssue}: registry must name the live provider wrapper`);
    assert.equal(
      selects(ownerIssue, [provider.providerWorkflow]),
      true,
      `${ownerIssue}: editing this lane's own wrapper must select it`,
    );
  }
});

test("9. nothing changes on push, schedule or workflow_dispatch: selection is the identity function", () => {
  for (const eventName of ["push", "schedule", "workflow_dispatch", "local"]) {
    for (const ownerIssue of LANES) {
      const provider = routedProvider(manifest, ownerIssue);
      const decision = decideSelection(provider, providerOriginPatterns(provider), { mode: "full", eventName });
      assert.equal(decision.selected, true, `${ownerIssue}: ${eventName} must run this lane in full`);
    }
  }
});

test("10. an unobservable diff routes TO the tests, never past them", () => {
  // The repository's recorded failure mode is absence of signal reading as
  // confirmation. A router that cannot see the diff must not skip the lane.
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue-3072-")), "out.txt");
  const previous = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = output;
  try {
    const code = main(["--issue", "874"], { env: { GITHUB_EVENT_NAME: "pull_request" } });
    assert.equal(code, 0, "an unobservable diff must not fail the build");
    assert.equal(fs.readFileSync(output, "utf8").trim(), "selected=true", "it must run the lane in full");
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
  }
});

test("11. an unregistered lane is refused rather than defaulting to a route", () => {
  assert.throws(() => routedProvider(manifest, "#999999"), /expected exactly one routed live provider/);
  const duplicated = { legacyOrigins: [...manifest.legacyOrigins, routedProvider(manifest, "#874")] };
  assert.throws(() => routedProvider(duplicated, "#874"), /found 2/);
});
