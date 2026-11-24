/**
 * Issue #3493 — fails-on-revert proof for PR/main boot-payload parity.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_MOVEMENT_THRESHOLD_BYTES,
  ONE_TIME_PR_ALLOWANCE,
  assessCommonBaselineMovement,
  gitSubjectsSince,
  resolveOneTimeAllowance,
} from "../bundle-budget-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUSINESS = resolve(HERE, "../../../");
const ROOT = resolve(BUSINESS, "../");
const readBusiness = (path) => readFileSync(join(BUSINESS, path), "utf8");

const WORKFLOW = readFileSync(
  join(
    ROOT,
    ".github/workflows",
    ["issue-2099-pending-venue-identity-correction-tests", "yml"].join("."),
  ),
  "utf8",
);
const WEB_BUILD_WORKFLOW = readFileSync(
  join(ROOT, ".github/workflows", ["web-build-check", "yml"].join(".")),
  "utf8",
);
const RATCHET_WORKFLOW = readFileSync(
  join(
    ROOT,
    ".github/workflows",
    ["bundle-baseline-ratchet", "yml"].join("."),
  ),
  "utf8",
);

describe("#3493 one PR/main movement verdict", () => {
  test("+1,560 B fails before and after merge under the shared 1,024 B authority", () => {
    assert.equal(BASELINE_MOVEMENT_THRESHOLD_BYTES, 1_024);
    const baseline = 2_770_676;
    const pullRequestVerdict = assessCommonBaselineMovement(
      baseline,
      baseline + 1_560,
    );
    const mainVerdict = assessCommonBaselineMovement(
      baseline,
      baseline + 1_560,
    );
    assert.deepEqual(pullRequestVerdict, mainVerdict);
    assert.equal(pullRequestVerdict.ok, false);
    assert.equal(
      assessCommonBaselineMovement(baseline, baseline + 1_024).ok,
      true,
    );
  });

  test("malformed or absent measurements fail closed", () => {
    for (const value of [undefined, null, 0, -1, 1.5, Number.NaN]) {
      assert.throws(
        () => assessCommonBaselineMovement(value, 2_770_676),
        /positive safe integer/,
      );
      assert.throws(
        () => assessCommonBaselineMovement(2_770_676, value),
        /positive safe integer/,
      );
    }
  });
});

describe("#3493 every Business bundle input is measured identically", () => {
  test("the universal PR and main lanes cannot path-skip application changes", () => {
    const webTrigger = WEB_BUILD_WORKFLOW.slice(
      WEB_BUILD_WORKFLOW.indexOf("on:"),
      WEB_BUILD_WORKFLOW.indexOf("concurrency:"),
    );
    assert.match(webTrigger, /pull_request:/);
    assert.doesNotMatch(webTrigger, /\n\s+paths:/);
    assert.match(
      webTrigger,
      /paths-ignore:\n\s+- "mingla-business\/scripts\/ci\/bundle-baseline\.json"/,
      "only the machine baseline may skip the PR build",
    );
    const ratchetTrigger = RATCHET_WORKFLOW.slice(
      RATCHET_WORKFLOW.indexOf("on:"),
      RATCHET_WORKFLOW.indexOf("concurrency:"),
    );
    assert.match(
      ratchetTrigger,
      /push:\n\s+branches: \[main\]/,
    );
    assert.doesNotMatch(ratchetTrigger, /paths:|paths-ignore:/);
  });

  test("PR and main run the same regression suite and movement command", () => {
    for (const source of [WEB_BUILD_WORKFLOW, RATCHET_WORKFLOW]) {
      assert.match(
        source,
        /node --test scripts\/ci\/__tests__\/issue3493_boot_payload_parity\.happy\.test\.mjs/,
      );
      assert.match(source, /node scripts\/ci\/bundle-baseline-movement\.mjs/);
    }
    assert.match(WEB_BUILD_WORKFLOW, /run: npm run web:export/);
    assert.match(
      RATCHET_WORKFLOW,
      /npx expo export -p web --output-dir \/tmp\/ratchet-web-build/,
    );
  });

  test("the issue-specific lane reuses the verdict without its old scope skip", () => {
    const start = WORKFLOW.indexOf("  issue-2099-boot-payload-ceiling:");
    const end = WORKFLOW.indexOf("  issue-2099-postgres-contract:", start);
    assert.ok(start >= 0 && end > start, "boot-payload job is missing");
    const job = WORKFLOW.slice(start, end);
    assert.doesNotMatch(job, /sc4scope|steps\.sc4scope|github\.event_name/);
    assert.doesNotMatch(job, /SC-4 skipped|run=false/);
    assert.match(
      job,
      /npm run web:export\n\s+node scripts\/ci\/bundle-baseline-movement\.mjs/,
    );
  });

  test("the ratchet imports the same threshold instead of restating 2,048 B", () => {
    const budget = readBusiness(
      "scripts/ci/orch-1083-initial-bundle-budget.mjs",
    );
    assert.match(budget, /BASELINE_MOVEMENT_THRESHOLD_BYTES/);
    assert.match(
      budget,
      /const RATCHET_NOTICE_THRESHOLD = BASELINE_MOVEMENT_THRESHOLD_BYTES;/,
    );
    assert.doesNotMatch(budget, /RATCHET_NOTICE_THRESHOLD = 2_048/);
  });

  test("the ratchet records any movement the pull-request gate would count (#4270)", async () => {
    const lib = await import("../bundle-budget-lib.mjs");
    assert.ok(Number.isSafeInteger(lib.BASELINE_RECORD_FLOOR_BYTES));
    assert.ok(lib.BASELINE_RECORD_FLOOR_BYTES > 150, "floor stays above Linux measurement noise");
    assert.ok(
      lib.BASELINE_RECORD_FLOOR_BYTES < lib.BASELINE_MOVEMENT_THRESHOLD_BYTES,
      "unrecorded main drift must leave room for the next pull request",
    );
    const update = readBusiness("scripts/ci/bundle-baseline-update.mjs");
    assert.match(update, /const NOISE_FLOOR = BASELINE_RECORD_FLOOR_BYTES;/);
    assert.doesNotMatch(update, /NOISE_FLOOR = \d/);
  });
});

describe("#3493 VAT/pricing UI stays out of the eager shared chunk", () => {
  test("all four authoring consumers use the lazy host", () => {
    const consumers = [
      "src/components/event/CreatorStep5Tickets.tsx",
      "src/components/experience/ExperiencePricingStep.tsx",
      "src/components/brand/BrandPricingDefaultsView.tsx",
      "src/components/trip/TripCreatorStep4Pricing.tsx",
    ];
    for (const path of consumers) {
      const source = readBusiness(path);
      assert.match(
        source,
        /from "\.\.\/pricing\/LazyWhoCoversCostsSection";/,
        path,
      );
      assert.doesNotMatch(
        source,
        /from "\.\.\/pricing\/WhoCoversCostsSection";/,
        path,
      );
    }
  });

  test("the host keeps props type-only and loads the implementation on demand", () => {
    const host = readBusiness(
      "src/components/pricing/LazyWhoCoversCostsSection.tsx",
    );
    assert.match(
      host,
      /import type \{ WhoCoversCostsSectionProps \} from "\.\/WhoCoversCostsSection";/,
    );
    // #4522: the implementation may load through `WhoCoversCostsChunk`, the one
    // lazy chunk shared with the trip builder's earnings card, as long as that
    // module is only ever reached by a dynamic import (asserted below).
    assert.match(
      host,
      /React\.lazy\(async \(\) => \{[\s\S]*await import\("\.\/(WhoCoversCostsSection|WhoCoversCostsChunk)"\)/,
    );
    assert.match(host, /<React\.Suspense fallback=\{null\}>/);
  });

  test("the shared pricing chunk re-exports the section and is never imported eagerly", () => {
    const chunk = readBusiness("src/components/pricing/WhoCoversCostsChunk.tsx");
    assert.match(
      chunk,
      /export \{ WhoCoversCostsSection \} from "\.\/WhoCoversCostsSection";/,
    );
    const files = execFileSync(
      "git",
      ["grep", "-l", "WhoCoversCostsChunk", "--", "src", "app"],
      { cwd: BUSINESS, encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => f && !f.includes("__tests__"));
    for (const file of files) {
      const source = readBusiness(file);
      assert.doesNotMatch(
        source,
        /(^|\n)\s*(import|export)[^\n]*from\s+"[^"]*WhoCoversCostsChunk"/,
        file,
      );
    }
  });
});

// Issue #4596 — Seth approved in chat 2026-11-24 a one-time allowance for PR
// #4601 (recorded on #4596); it replaced the merged #4601 entry. These tests
// prove the entry reaches the movement gate for that one pull request only,
// and that the 1,024 B threshold stands for everyone else.
describe("#4596 the one-time #4601 entry, as the movement gate reads it", () => {
  const SHA = "a".repeat(40);
  const HEAD = "4596-rsvp-event-blast-audience";
  const none = () => [];
  const merged = () => ["Unrelated (#3900)", "toward #4596: RSVP guests in event blasts (#4601)"];
  const prEnv = (headRef, ref) => ({ GITHUB_EVENT_NAME: "pull_request", GITHUB_HEAD_REF: headRef, GITHUB_REF: ref });
  const mainPush = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };
  const decide = (env, subjects = none, today = "2026-11-24") =>
    resolveOneTimeAllowance({
      env,
      today,
      baselineCommit: SHA,
      subjectsSinceBaseline: subjects,
      normalLimit: BASELINE_MOVEMENT_THRESHOLD_BYTES,
    }).entry;
  const verdictFor = (entry, delta) =>
    assessCommonBaselineMovement(2_744_094, 2_744_094 + delta, entry ? { oneTimeCap: entry.common } : {});

  test("one table: exactly the #4601 entry, frozen, capped at 3,300 B and dated", () => {
    assert.equal(ONE_TIME_PR_ALLOWANCE.length, 1);
    const [only] = ONE_TIME_PR_ALLOWANCE;
    assert.deepEqual(
      { issue: only.issue, pr: only.pr, headRef: only.headRef, common: only.common, expiresAfter: only.expiresAfter, approvedBy: only.approvedBy },
      { issue: 4596, pr: 4601, headRef: HEAD, common: 3_300, expiresAfter: "2026-12-08", approvedBy: "Seth, 2026-11-24" },
    );
    assert.ok(Object.isFrozen(ONE_TIME_PR_ALLOWANCE) && Object.isFrozen(only));
    const budget = readBusiness("scripts/ci/orch-1083-initial-bundle-budget.mjs");
    assert.doesNotMatch(budget, /const ONE_TIME_PR_ALLOWANCE\s*=/, "orch-1083 must not keep a second table");
    assert.doesNotMatch(budget, /function resolveOneTimeAllowance/, "orch-1083 must not keep a second resolver");
    const movement = readBusiness("scripts/ci/bundle-baseline-movement.mjs");
    assert.match(movement, /normalLimit: BASELINE_MOVEMENT_THRESHOLD_BYTES/);
  });

  test("PR #4601 on its branch gets the 3,300 B cap; the measured +3,048 B passes only there", () => {
    const entry = decide(prEnv(HEAD, "refs/pull/4601/merge"));
    assert.equal(entry, ONE_TIME_PR_ALLOWANCE[0]);
    const granted = verdictFor(entry, 3_048);
    assert.equal(granted.ok, true);
    assert.equal(granted.normalOk, false);
    assert.equal(granted.normalThreshold, 1_024);
    assert.equal(verdictFor(entry, 3_301).ok, false, "the cap is a cap, not an exemption");
    assert.equal(verdictFor(null, 3_048).ok, false);
  });

  test("every other branch, pull request or missing value keeps 1,024 B", () => {
    const strangers = [
      prEnv("3697-host-ads", "refs/pull/4600/merge"),
      prEnv(HEAD, "refs/pull/4600/merge"),
      prEnv("3697-host-ads", "refs/pull/4601/merge"),
      prEnv(`${HEAD}-2`, "refs/pull/4601/merge"),
      prEnv("", "refs/pull/4601/merge"),
      prEnv(HEAD, "refs/pull/46010/merge"),
      {},
      { GITHUB_HEAD_REF: HEAD, GITHUB_REF: "refs/pull/4601/merge" },
      { GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/heads/${HEAD}` },
      { GITHUB_EVENT_NAME: "merge_group", GITHUB_HEAD_REF: HEAD, GITHUB_REF: "refs/pull/4601/merge" },
    ];
    for (const env of strangers) {
      const entry = decide(env, merged);
      assert.equal(entry, null, JSON.stringify(env));
      const verdict = verdictFor(entry, 1_025);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.threshold, 1_024);
    }
  });

  test("on main it lives only until the baseline includes the merge", () => {
    assert.equal(decide(mainPush, merged), ONE_TIME_PR_ALLOWANCE[0]);
    assert.equal(decide(mainPush, none), null);
    assert.equal(decide(mainPush, () => ["Mentions (#4601) mid-subject (#3901)", "x (#46011)"]), null);
    assert.equal(decide(mainPush, () => { throw new Error("not a git repository"); }), null);
  });

  test("dead after its end date and inside a test harness", () => {
    assert.equal(decide(prEnv(HEAD, "refs/pull/4601/merge"), none, "2026-12-08"), ONE_TIME_PR_ALLOWANCE[0]);
    assert.equal(decide(prEnv(HEAD, "refs/pull/4601/merge"), none, "2026-12-09"), null);
    assert.equal(decide(mainPush, merged, "2026-12-09"), null);
    assert.equal(decide({ ...prEnv(HEAD, "refs/pull/4601/merge"), NODE_TEST_CONTEXT: "child-v8" }), null);
    assert.equal(decide({ ...mainPush, NODE_TEST_CONTEXT: "child-v8" }, merged), null);
  });

  test("a cap that is not above the threshold is an error, never a silent widening", () => {
    for (const cap of [1_024, 0, -1, 1.5, Number.NaN, Infinity, null]) {
      assert.throws(() => assessCommonBaselineMovement(2_744_094, 2_744_095, { oneTimeCap: cap }), /oneTimeCap/);
    }
  });

  test("a shallow main checkout reads only HEAD's subject, and a full clone never falls back", () => {
    const fakeGit = ({ hasCommit, shallow, head, subject }) => (args) => {
      if (args[0] === "cat-file") {
        if (!hasCommit) throw new Error("missing");
        return "";
      }
      if (args[0] === "log" && args[1] === "--format=%s") return "older (#1)\nnewer (#2)\n";
      if (args[1] === "--is-shallow-repository") return `${shallow}\n`;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${head}\n`;
      if (args[0] === "log" && args[1] === "-1") return `${subject}\n`;
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    const squash = "RSVP guests in event blasts (#4601)";
    assert.deepEqual(gitSubjectsSince(SHA, { git: fakeGit({ hasCommit: true }) }), ["older (#1)", "newer (#2)"]);
    assert.deepEqual(
      gitSubjectsSince(SHA, { git: fakeGit({ hasCommit: false, shallow: true, head: "b".repeat(40), subject: squash }) }),
      [squash],
    );
    assert.deepEqual(gitSubjectsSince(SHA, { git: fakeGit({ hasCommit: false, shallow: true, head: SHA, subject: squash }) }), []);
    assert.throws(
      () => gitSubjectsSince(SHA, { git: fakeGit({ hasCommit: false, shallow: false, head: "b".repeat(40), subject: squash }) }),
      /not in this full clone/,
    );
  });

  test("the movement gate itself prints the refusal in one line and keeps 1,024 B (harness and stranger)", () => {
    const baseline = JSON.parse(readBusiness("scripts/ci/bundle-baseline.json"));
    const dir = mkdtempSync(join(tmpdir(), "issue4596-movement-"));
    const js = join(dir, "_expo/static/js/web");
    mkdirSync(js, { recursive: true });
    const common = `__common-${"a".repeat(32)}.js`;
    const entry = `index-${"b".repeat(32)}.js`;
    writeFileSync(join(js, common), "x".repeat(baseline.common.raw + 3_048));
    writeFileSync(join(js, entry), "y".repeat(1_000));
    writeFileSync(
      join(dir, "index.html"),
      `<script src="/_expo/static/js/web/${common}"></script><script src="/_expo/static/js/web/${entry}"></script>`,
    );
    const run = (env) =>
      spawnSync(process.execPath, [join(BUSINESS, "scripts/ci/bundle-baseline-movement.mjs")], {
        encoding: "utf8",
        env: { ...process.env, ORCH_1083_WEB_BUILD: dir, ...env },
      });
    // Inside node --test the harness guard refuses even PR #4601 on its branch.
    const harness = run(prEnv(HEAD, "refs/pull/4601/merge"));
    assert.equal(harness.status, 1);
    assert.match(harness.stdout, /one-time allowance not applied \(normal \+1,024 B threshold stands\) .*test harness/);
    assert.match(harness.stderr, /above the shared 1,024 B movement threshold/);
    const stranger = run({ ...prEnv("3697-host-ads", "refs/pull/4600/merge"), NODE_TEST_CONTEXT: "" });
    assert.equal(stranger.status, 1);
    assert.match(stranger.stdout, /not applied .*this is not that pull request/);
    assert.equal(stranger.stdout.match(/one-time allowance not applied/g)?.length, 1);
  });
});
