/**
 * toward #4238 W3 T-5 — Admin's browser copy checker (policyLinter.js) and
 * the shared server checker (_shared/adCopyPolicy.ts) run the same fixture
 * table. This side proves Admin gives exactly the fixture findings; the Deno
 * twin (_shared/__tests__/issue_4238_copy_policy_parity.test.ts) proves the
 * shared copy does, and that the two agree. Either copy drifting fails one.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runPolicyPrecheck, DATING_GUIDANCE, ALCOHOL_WARNING } from "../lib/adBuilder/policyLinter.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = path.join(ROOT, "supabase/functions/_shared/__tests__/fixtures/ad_copy_policy_cases.json");
const SHARED = path.join(ROOT, "supabase/functions/_shared/adCopyPolicy.ts");

test("Admin policyLinter gives the shared fixture findings on every case", () => {
  const { cases } = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  assert.ok(cases.length >= 10);
  for (const item of cases) {
    assert.deepEqual(
      runPolicyPrecheck({ copyText: item.copyText, channelSet: item.channelSet }),
      item.expected,
      item.copyText,
    );
  }
});

test("the shared server copy carries Admin's exact guidance strings", () => {
  // Quote style may differ after deno fmt; compare without escapes.
  const shared = fs.readFileSync(SHARED, "utf8").replace(/\\/g, "");
  assert.ok(shared.includes(DATING_GUIDANCE));
  assert.ok(shared.includes(ALCOHOL_WARNING));
});
