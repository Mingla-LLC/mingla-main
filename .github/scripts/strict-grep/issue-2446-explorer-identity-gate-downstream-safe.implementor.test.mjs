#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  loadSources,
  validate,
} from "./issue-2443-explorer-native-identity.mjs";

const GATE = new URL("./issue-2443-explorer-native-identity.mjs", import.meta.url);

test("#2446 keeps the Explorer identity guard green for valid downstream Class A growth", () => {
  const gateSource = fs.readFileSync(GATE, "utf8");
  assert.doesNotMatch(gateSource, /merge-base|changedFiles|ISSUE_SCOPE/);
  assert.doesNotMatch(gateSource, /expectedStrictGrepMjsFiles\s*!==|selfTestWiredFloor\s*!==/);

  const sources = loadSources();
  const manifest = JSON.parse(sources.manifest);
  manifest.expectedStrictGrepMjsFiles += 1;
  manifest.selfTestWiredFloor += 1;
  manifest.gates.push({
    script: ".github/scripts/strict-grep/issue-9999-unrelated-downstream-fixture.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["self-test", "plain"],
    selfTest: "wired",
    jobKeys: [],
  });

  assert.deepEqual(validate({ ...sources, manifest: JSON.stringify(manifest) }), []);

  const ownEntry = manifest.gates.find(
    (entry) => entry.script === ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs",
  );
  ownEntry.enforcement = "batch:B";
  ownEntry.modes = ["plain"];
  ownEntry.selfTest = "none";
  assert.match(
    validate({ ...sources, manifest: JSON.stringify(manifest) }).join("\n"),
    /#2443 guard must run self-test then plain in Class A/,
  );
});
