// #2829 — every consumer's copy of packages/site-contracts is byte-equal to
// the package (plus the generated header). A hand edit to a copy, or a package
// edit without re-running the sync script, fails here.
import assert from "node:assert/strict";
import test from "node:test";
import { driftReport, expectedCopies } from "../sync-site-contracts.mjs";

test("#2829 site-contracts copies match the package in every consumer", () => {
  assert.ok(expectedCopies().some((copy) => copy.file === "limits.ts"));
  assert.deepEqual(driftReport(), []);
});
