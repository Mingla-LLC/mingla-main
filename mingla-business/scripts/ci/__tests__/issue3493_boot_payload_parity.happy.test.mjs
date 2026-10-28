/**
 * Issue #3493 — fails-on-revert proof for PR/main boot-payload parity.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_MOVEMENT_THRESHOLD_BYTES,
  assessCommonBaselineMovement,
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
    assert.match(
      host,
      /React\.lazy\(async \(\) => \{[\s\S]*await import\("\.\/WhoCoversCostsSection"\)/,
    );
    assert.match(host, /<React\.Suspense fallback=\{null\}>/);
  });
});
