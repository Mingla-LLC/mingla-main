#!/usr/bin/env node
// #2435 independent tester proof: a complete 22/22 inventory must not go green
// when two removed legacy workflows are attributed to each other's suites.

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

test("#2435 rejects a count-preserving legacy-to-suite attribution swap", () => {
  const manifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
  const discovery = {
    root: DEFAULT_ROOT,
    liveOrigins: discoverLiveOrigins(DEFAULT_ROOT),
    workflowProviders: discoverWorkflowProviders(DEFAULT_ROOT),
  };
  assert.deepEqual(validateRegistry(manifest, discovery), [], "committed registry must start valid");

  const migrated = manifest.legacyOrigins.filter((origin) => origin.disposition === "batched-active");
  assert.ok(migrated.length >= 2, "fixture requires two independently migrated origins");
  [migrated[0].replacementSuite, migrated[1].replacementSuite] = [
    migrated[1].replacementSuite,
    migrated[0].replacementSuite,
  ];

  const errors = validateRegistry(manifest, discovery);
  assert.notDeepEqual(
    errors,
    [],
    "swapping two valid replacementSuite ids preserves every count but must fail because each legacy origin now names the wrong executable owner",
  );
});
