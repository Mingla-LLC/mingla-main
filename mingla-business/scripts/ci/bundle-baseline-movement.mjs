#!/usr/bin/env node
/**
 * Issue #3493 — identical raw `__common` movement verdict on PRs and main.
 *
 * Run after `npm run web:export`. This intentionally has no event-name or
 * changed-path branch: the workflow decides when a build can affect the
 * Business bundle, and every such build is measured here the same way.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessCommonBaselineMovement,
  measureWebBuild,
} from "./bundle-budget-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_BUILD = process.env.ORCH_1083_WEB_BUILD ?? "web-build";

function fail(message) {
  console.error(`\nbundle-baseline-movement FAIL: ${message}\n`);
  process.exit(1);
}

let baseline;
try {
  baseline = JSON.parse(
    readFileSync(join(HERE, "bundle-baseline.json"), "utf8"),
  );
} catch (error) {
  fail(`baseline is unreadable: ${error.message}`);
}

let measured;
try {
  measured = measureWebBuild(WEB_BUILD);
} catch (error) {
  fail(`web export is unreadable: ${error.message}`);
}

if (measured.common === null) {
  fail("the web export has no eager __common chunk");
}

let verdict;
try {
  verdict = assessCommonBaselineMovement(
    baseline?.common?.raw,
    measured.common.raw,
  );
} catch (error) {
  fail(error.message);
}

console.log(
  `__common raw: baseline ${baseline.common.raw.toLocaleString("en-US")} B -> ` +
    `measured ${measured.common.raw.toLocaleString("en-US")} B ` +
    `(delta ${verdict.delta >= 0 ? "+" : ""}${verdict.delta.toLocaleString("en-US")} B; ` +
    `limit +${verdict.threshold.toLocaleString("en-US")} B)`,
);

if (!verdict.ok) {
  fail(
    `eager __common grew ${verdict.delta.toLocaleString("en-US")} B, above the shared ` +
      `${verdict.threshold.toLocaleString("en-US")} B movement threshold. Move host-only ` +
      "code behind an on-intent chunk. Do not edit the baseline or threshold to clear this.",
  );
}

console.log("bundle-baseline-movement PASS");
