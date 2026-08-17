/**
 * Issue #2113 — regression guard for the EMPTY-WINDOW rule.
 *
 * The gate's own self-test mode proves the DETECTOR works (21 fixtures, both
 * directions). This file proves the FIXES stay applied: it re-reads the real
 * repo files that carried the nine in-scope comment-bounded windows and asserts
 * each one still has a non-empty guard AHEAD of its negative assertion.
 *
 * Deleting any guard added under #2113 reds this file, independently of whether
 * the batch-A gate happens to run.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  violationsInFile,
  findCommentBoundedWindows,
  commentTokenIn,
  tokenize,
  inScope,
  ENFORCEMENT_MODE,
} from "../issue-2113-empty-window-negative-assertion.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Every comment-bounded window in scope, with the identifier it binds. Nine
 * carried a negative assertion with NO preceding non-empty guard and were fixed
 * under #2113; the rest already had one. Enumerated by executing the gate over
 * the whole repo, not by sampling.
 */
const IN_SCOPE_WINDOWS = [
  ["app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.adversarial.test.mjs", "behind"],
  ["app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.adversarial.test.mjs", "current"],
  ["app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.test.mjs", "deferredBusiness"],
  ["app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.test.mjs", "preview"],
  ["app-mobile/src/components/swipeDeck/__tests__/issue_1481_release_hotpath.test.mjs", "preview"],
  ["app-mobile/src/components/swipeDeck/__tests__/issue_1481_swipe_lifecycle.adversarial.test.mjs", "preview"],
  ["app-mobile/src/components/swipeDeck/__tests__/issue_1481_swipe_lifecycle.test.mjs", "preview"],
  ["mingla-admin/src/__tests__/issue1175_admin_refund_idempotency.test.js", "refundBody"],
  ["mingla-admin/src/lib/__tests__/issue1384DiscoveryPriceAdmin.test.js", "handleSave"],
  ["scripts/issue-1719/unified-sharing.implementor.happy.test.mjs", "surface"],
];

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

test("every in-scope comment-bounded window is still recognised as one", () => {
  for (const [rel, name] of IN_SCOPE_WINDOWS) {
    const windows = findCommentBoundedWindows(read(rel));
    assert.ok(
      windows.some((w) => w.name === name),
      `${rel}: window \`${name}\` is no longer detected as comment-bounded — if its boundary became structural that is an improvement, but this registry must be updated in the same commit`,
    );
  }
});

test("no in-scope file has a negative assertion over an unguarded comment-bounded window", () => {
  const offenders = [];
  for (const rel of [...new Set(IN_SCOPE_WINDOWS.map(([r]) => r))]) {
    for (const v of violationsInFile(read(rel), rel)) {
      offenders.push(`${v.file}:${v.assertionLine} window \`${v.window}\` :: ${v.assertion}`);
    }
  }
  assert.deepEqual(offenders, [], `#2113 non-empty guards were removed:\n${offenders.join("\n")}`);
});

test("the two Admin P0 windows carry a LENGTH-BANDED guard, not merely a non-empty one", () => {
  // The handleSwipe window collapsed to 122 chars, not to 0 — a bare `length > 0`
  // check passes there. Both Admin P0s use the banded form for the same reason.
  const refund = read("mingla-admin/src/__tests__/issue1175_admin_refund_idempotency.test.js");
  assert.match(refund, /refundBody\.length > \d+ && refundBody\.length < \d+/);
  const place = read("mingla-admin/src/lib/__tests__/issue1384DiscoveryPriceAdmin.test.js");
  assert.match(place, /handleSave\.length > \d+ && handleSave\.length < \d+/);
  const hotpath = read("app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.test.mjs");
  assert.match(hotpath, /deferredBusiness\.length > \d+ && deferredBusiness\.length < \d+/);
});

test("the gate is registered as blocking", () => {
  assert.equal(ENFORCEMENT_MODE, "block", "#2113 landed at zero violations; report mode would be a silent downgrade");
});

test("the tokenizer does not mistake a regex character class for a string", () => {
  // The exact shape that produced a false positive in mingla-business/__tests__/
  // issue1758NetinfoSoleOwner.test.ts during development.
  const src = 'const RX = /require\\(["\']pkg["\']\\)/;\n// a trailing comment\nconst after = 1;\n';
  const { mask } = tokenize(src);
  assert.match(mask, /const after = 1;/, "the scanner swallowed source past the regex literal");
  assert.equal(findCommentBoundedWindows(src).length, 0);
});

test("comment-token classification accepts real boundaries and rejects URLs", () => {
  assert.equal(commentTokenIn("// META-ORCH-1009 Sub-D"), "//");
  assert.equal(commentTokenIn("{/* Current Card */}"), "/*");
  assert.equal(commentTokenIn("export async function refundOrder[\\s\\S]*?\\n}\\n\\n\\/\\/ ── W2-B"), "//");
  assert.equal(commentTokenIn("-- end of function"), "--");
  assert.equal(commentTokenIn("https://cdn.example.com/a"), null);
  assert.equal(commentTokenIn("const handleSave"), null);
});

test("scope covers test suites and strict-grep gates, and nothing else", () => {
  assert.equal(inScope("mingla-admin/src/lib/__tests__/x.test.js"), true);
  assert.equal(inScope(".github/scripts/strict-grep/i-money-no-admin-rls.mjs"), true);
  assert.equal(inScope("app-mobile/src/components/SwipeableCards.tsx"), false);
  assert.equal(inScope("node_modules/pkg/__tests__/x.test.js"), false);
});
