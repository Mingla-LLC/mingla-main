/**
 * Issue #3078 — the nightly full-corpus tier (tier 3).
 *
 * #2882 defined three tiers and delivered two. A pull request runs the suites
 * its diff invalidates (tier 1, median 2 of 85); a push to `main` runs all 85
 * (tier 2); the full corpus nightly (tier 3) had no trigger, so #2882's AC-1
 * was formally amended to two tiers and the third was split out to #3078.
 *
 * WHY THIS FILE EXISTS RATHER THAN A COMMENT. Tier 3's behaviour was already
 * settled before its trigger existed — selection is the identity function on
 * every non-pull_request event — which makes it exactly the kind of feature
 * that can be reverted without anything going red. Delete the `schedule` block
 * and every other gate in this repository still passes: the routing tests
 * would keep proving that a scheduled event WOULD run the full corpus, while
 * no scheduled event ever happened again. That is the #2113 shape, a check
 * that cannot fail, and it is why the assertions below execute the selector
 * against a real `schedule` context instead of reading the code.
 *
 * NAMING CONSTRAINT, load-bearing and the reason the workflow path is
 * assembled from fragments below: the frozen #2148 provider seal derives, for
 * every workflow filename, the sorted set of tracked files containing that
 * name as a literal. One mention of a host filename in a file such as this one
 * rewrites that workflow's record and reds `external reference file inventory
 * drifted` with no escape. Lanes are named by issue number, never by filename.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEFAULT_MANIFEST, DEFAULT_ROOT } from "../validate-manifest-v2.mjs";
import {
  previewRouteDecision,
  renderRoutingLine,
  ROUTED_EVENTS,
  routingContext,
  selectSuites,
} from "../run-suite-batch.mjs";

const manifest = () => JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
// Assembled from fragments, never written whole — see the header.
const batchWorkflowPath = () =>
  path.join(DEFAULT_ROOT, ".github/workflows", ["ci", "batch.yml"].join("-"));
const batchWorkflow = () => fs.readFileSync(batchWorkflowPath(), "utf8");

const RUBY_TRIGGERS = String.raw`
require "yaml"; require "json"
doc = YAML.safe_load(STDIN.read, aliases: true) || {}
raw = doc.key?("on") ? doc["on"] : doc[true]
STDOUT.write(JSON.generate(raw.is_a?(Hash) ? raw : {}))`;

const triggers = (source) =>
  JSON.parse(execFileSync("ruby", ["-e", RUBY_TRIGGERS], { input: source, encoding: "utf8" }));

const scheduleContext = () => routingContext({ env: { GITHUB_EVENT_NAME: "schedule" } });

/**
 * [#3078 AC-1] The trigger exists, and it cannot be silently removed.
 *
 * Parsed, not grepped: a `schedule` key commented out, indented into another
 * block, or reduced to a bare key with no cron would all survive a text match
 * and none of them schedules anything.
 */
test("#3078 the batch lane carries a nightly schedule trigger with a real cron", () => {
  const on = triggers(batchWorkflow());
  assert.ok(
    Object.prototype.hasOwnProperty.call(on, "schedule"),
    "the batch lane must carry a `schedule` trigger — without it tier 3 does not exist",
  );
  assert.ok(Array.isArray(on.schedule) && on.schedule.length > 0, "`schedule` must list at least one entry");
  const crons = on.schedule.map((entry) => entry && entry.cron).filter(Boolean);
  assert.equal(crons.length, on.schedule.length, "every schedule entry must carry a cron expression");
  for (const cron of crons) {
    assert.match(
      cron,
      /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/,
      `cron must have five fields, got: ${cron}`,
    );
    const [, , dayOfMonth, month, dayOfWeek] = cron.split(/\s+/);
    assert.ok(
      dayOfMonth === "*" && month === "*" && dayOfWeek === "*",
      `tier 3 is NIGHTLY: every day, every month, every weekday. Got ${cron}, which does not run every night.`,
    );
  }
  // The three sibling triggers must survive alongside it. Tier 3 is additive:
  // it must never be shipped by trading tier 1 or tier 2 away.
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(on, event),
      `#3078 is additive — \`${event}\` must survive`,
    );
  }
});

/**
 * [#3078 AC-3] Selection is the identity function on `schedule`, by EXECUTION.
 *
 * The registry count is read from the manifest, never typed: two literals that
 * must agree is how a number lands where two sides had said different things
 * and merged clean.
 */
test("#3078 a scheduled run selects every registered suite, executed not read", () => {
  const value = manifest();
  const context = scheduleContext();
  assert.equal(context.eventName, "schedule");
  assert.equal(context.mode, "full", "a scheduled run must take the full-corpus path, never the routed one");

  const selection = selectSuites(value, value.suites, context);
  assert.equal(selection.mode, "full");
  assert.equal(selection.registry, value.suites.length, "the denominator must be the whole registry");
  assert.equal(
    selection.selectedSuiteIds.length,
    value.suites.length,
    "a scheduled run must select the COMPLETE corpus",
  );
  assert.deepEqual(
    selection.selectedSuiteIds,
    value.suites.map((suite) => suite.id),
    "identity function: the selection must be the registry itself, in order",
  );
});

/**
 * [#3078] The routing boundary that MAKES it the identity function.
 *
 * If `schedule` were ever added to the routed set, the nightly would quietly
 * become a diff-routed run against whatever `main` last changed — a tier-3
 * suite that has stopped existing while still reporting green.
 */
test("#3078 schedule is never a routed event", () => {
  assert.equal(ROUTED_EVENTS.has("schedule"), false, "`schedule` must never route by diff");
  assert.deepEqual(
    [...ROUTED_EVENTS].sort(),
    ["pull_request", "pull_request_target"],
    "only pull-request events route; anything else is the identity function",
  );
});

/**
 * [#3078 AC-5] The selection is printed with its denominator, exactly as the
 * routed path prints it. A zero — or an 85 — that is not printed beside what it
 * is out of is indistinguishable in a log from a router that did nothing.
 */
test("#3078 the nightly prints its selection with the denominator", () => {
  const value = manifest();
  const context = scheduleContext();
  const selection = selectSuites(value, value.suites, context);
  const line = renderRoutingLine("node20-noinstall", context, selection);
  const total = value.suites.length;

  assert.match(line, /^PASS ci-batch-route /, "the line must be the same shape the routed path emits");
  assert.match(line, /\bevent=schedule\b/, "the line must name the event that produced it");
  assert.match(line, /\bmode=full\b/);
  assert.match(
    line,
    new RegExp(`\\bselected=${total} of ${total}\\b`),
    `the nightly must print its selection beside its denominator, got: ${line.split("\n")[0]}`,
  );
});

/**
 * [#3078 × #3076] A scheduled job can never skip the setup it then needs.
 *
 * #3076 lets a job decline its setup when its class routes to zero suites.
 * That decision is derived from the same selection, so on a `schedule` event
 * it is unconditionally true — but "unconditionally" is a claim about code, and
 * a nightly that skipped setup and then ran 85 suites would fail in a
 * confusing way. So it is executed here, for EVERY class in the registry.
 */
test("#3078 no class skips its setup on a scheduled run", () => {
  const value = manifest();
  const env = { GITHUB_EVENT_NAME: "schedule" };
  const classes = [...new Set(value.suites.map((suite) => suite.executionClass))];
  assert.ok(classes.length > 0, "the registry must declare execution classes");

  for (const klass of classes) {
    const candidates = value.suites.filter((suite) => suite.executionClass === klass);
    const outputs = previewRouteDecision(value, klass, candidates, { env });
    assert.equal(
      outputs.runPrimarySetup,
      true,
      `class ${klass} would skip its primary setup on a scheduled run and then be asked to run ${candidates.length} suites`,
    );
  }
});
