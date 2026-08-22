#!/usr/bin/env node
// #2435 implementor-owned happy-path regression. This is intentionally separate
// from the adversarial governance self-test so deleting either proof is visible.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROOT,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  validateRegistry,
} from "../ci-batch/validate-manifest-v2.mjs";

test("#2435 registry v2 proves the complete current topology", () => {
  const manifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
  const errors = validateRegistry(manifest, { root: DEFAULT_ROOT });
  assert.deepEqual(errors, []);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.suites.length, 22);
  assert.equal(manifest.legacyOrigins.length, 198);
  assert.equal(manifest.workflowProviders.length, 89);
  assert.equal(discoverLiveOrigins(DEFAULT_ROOT).length, 176);
  assert.equal(discoverWorkflowProviders(DEFAULT_ROOT).length, 89);
  assert.equal(new Set(manifest.legacyOrigins.map((item) => `${item.stem}.${item.extension}`)).size, 198);
  assert.equal(new Set(manifest.workflowProviders.map((item) => item.workflow)).size, 89);
});
