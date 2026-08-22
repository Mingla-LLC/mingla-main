#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  loadSources,
  validate,
} from "./issue-2443-explorer-native-identity.mjs";

const GATE = new URL("./issue-2443-explorer-native-identity.mjs", import.meta.url);
const OWN_SCRIPT =
  ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs";
const IMPLEMENTOR_COMMAND =
  "npx jest --runInBand src/services/__tests__/issue_2443_explorer_native_identity.implementor.test.ts";
const TESTER_COMMAND =
  "npx jest --runInBand src/services/__tests__/issue_2443_explorer_native_identity.tester_adversarial.test.ts";

const live = loadSources();

function mutateManifest(transform) {
  const manifest = JSON.parse(live.manifest);
  transform(manifest);
  return { ...live, manifest: JSON.stringify(manifest) };
}

function ownEntry(manifest) {
  return manifest.gates.find((entry) => entry.script === OWN_SCRIPT);
}

function expectRed(label, sources, pattern) {
  test(label, () => {
    const failures = validate(sources);
    assert.notDeepEqual(failures, [], `${label} falsely passed the #2443 gate`);
    if (pattern) assert.match(failures.join("\n"), pattern);
  });
}

test("live repository sources, not a synthetic baseline, satisfy the durable contract", () => {
  assert.deepEqual(validate(live), []);
  assert.match(fs.readFileSync(GATE, "utf8"), /export function validate/);
});

test("a realistic unrelated downstream PR may grow valid Class A metadata and unrelated scope", () => {
  const manifest = JSON.parse(live.manifest);
  manifest.expectedStrictGrepMjsFiles += 7;
  manifest.selfTestWiredFloor += 3;
  manifest.gates.push({
    script: ".github/scripts/strict-grep/issue-9999-unrelated-downstream-fixture.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["self-test", "plain"],
    selfTest: "wired",
    jobKeys: [],
  });
  assert.deepEqual(
    validate({
      ...live,
      manifest: JSON.stringify(manifest),
      guardedRepositoryPaths: [
        ...live.guardedRepositoryPaths,
        ".github/scripts/strict-grep/issue-9999-unrelated-downstream-fixture.mjs",
        "docs/UNRELATED_CANONICAL_REFERENCE.md",
      ],
    }),
    [],
  );
});

test("the permanent gate has no Git diff or exact global-counter enforcement", () => {
  const source = fs.readFileSync(GATE, "utf8");
  assert.doesNotMatch(source, /node:child_process|merge-base|changedFiles|ISSUE_SCOPE/);
  assert.doesNotMatch(
    source,
    /manifest\?*\.expectedStrictGrepMjsFiles\s*!==|manifest\?*\.selfTestWiredFloor\s*!==/,
  );
});

expectRed(
  "malformed manifest fails closed",
  { ...live, manifest: "{" },
  /strict-grep manifest must remain valid JSON|#2443 guard must run/,
);
expectRed(
  "omitting the owned Class A entry fails",
  mutateManifest((manifest) => {
    manifest.gates = manifest.gates.filter((entry) => entry.script !== OWN_SCRIPT);
  }),
  /must run self-test then plain in Class A/,
);
expectRed(
  "duplicating the owned Class A entry fails",
  mutateManifest((manifest) => {
    manifest.gates.push({ ...ownEntry(manifest) });
  }),
  /must run self-test then plain in Class A/,
);
for (const [label, mutate] of [
  ["owned enforcement drift", (entry) => { entry.enforcement = "batch:B"; }],
  ["owned invocation drift", (entry) => { entry.invocation = "node --test"; }],
  ["owned mode omission", (entry) => { entry.modes = ["plain"]; }],
  ["owned mode reordering", (entry) => { entry.modes = ["plain", "self-test"]; }],
  ["owned self-test identity drift", (entry) => { entry.selfTest = "none"; }],
]) {
  expectRed(
    label,
    mutateManifest((manifest) => mutate(ownEntry(manifest))),
    /must run self-test then plain in Class A/,
  );
}

expectRed(
  "strict Explorer version drift fails",
  {
    ...live,
    appJson: live.appJson.replace('"version": "1.1.6"', '"version": "v1.1.6"'),
  },
  /strict SemVer/,
);
expectRed(
  "Explorer runtime policy drift fails",
  {
    ...live,
    appJson: live.appJson.replace('"policy": "appVersion"', '"policy": "nativeVersion"'),
  },
  /runtimeVersion\.policy/,
);

expectRed(
  "primary identity cannot be disabled while its proof token survives in a comment",
  {
    ...live,
    identity: live.identity.replace(
      "if (isStrictSemver(Constants.nativeAppVersion)) {",
      "// isStrictSemver(Constants.nativeAppVersion)\n  if (false) {",
    ),
  },
);
expectRed(
  "Release fallback cannot be disabled while its proof token survives in a comment",
  {
    ...live,
    identity: live.identity.replace(
      "if (isStrictSemver(expoConfigVersion)) {",
      "// if (isStrictSemver(expoConfigVersion)) {\n  if (false) {",
    ),
  },
);
expectRed(
  "development-only Release fallback fails",
  {
    ...live,
    identity: live.identity.replace(
      "if (isStrictSemver(expoConfigVersion)) {",
      "if (__DEV__ && isStrictSemver(expoConfigVersion)) {",
    ),
  },
  /must not be development-only/,
);
expectRed(
  "web exclusion cannot be commented out",
  {
    ...live,
    identity: live.identity.replace(
      "if (platform === null) return null;",
      "// if (platform === null) return null;",
    ),
  },
);
expectRed(
  "fallback diagnostic cannot be commented out",
  {
    ...live,
    identity: live.identity.replace(
      'reportIdentityOutcome(platform, "expo_config_fallback");',
      '// reportIdentityOutcome(platform, "expo_config_fallback");',
    ),
  },
);
expectRed(
  "fallback once-only guard cannot be commented out",
  {
    ...live,
    identity: live.identity.replace(
      "if (reportedFallback) return;",
      "// if (reportedFallback) return;",
    ),
  },
);
expectRed(
  "unavailable diagnostic cannot be commented out",
  {
    ...live,
    identity: live.identity.replace(
      'reportIdentityOutcome(platform, "unavailable");',
      '// reportIdentityOutcome(platform, "unavailable");',
    ),
  },
);
expectRed(
  "diagnostic transport cannot be commented out",
  {
    ...live,
    identity: live.identity.replace(
      'console.warn("[app-version-identity]", {',
      '// console.warn("[app-version-identity]", {',
    ),
  },
);
expectRed(
  "native version header cannot be commented out",
  {
    ...live,
    identity: live.identity.replace(
      '"X-Mingla-App-Version": getInstalledNativeVersion() ?? "",',
      '// "X-Mingla-App-Version": getInstalledNativeVersion() ?? "",',
    ),
  },
);
expectRed(
  "global Supabase header owner cannot be commented out",
  {
    ...live,
    supabase: live.supabase.replace(
      "headers: getNativeAppVersionHeaders()",
      "// headers: getNativeAppVersionHeaders()",
    ),
  },
);
expectRed(
  "implementor Class D command cannot be commented out",
  {
    ...live,
    workflow: live.workflow.replace(IMPLEMENTOR_COMMAND, `# ${IMPLEMENTOR_COMMAND}`),
  },
);
expectRed(
  "tester Class D command cannot be commented out",
  {
    ...live,
    workflow: live.workflow.replace(TESTER_COMMAND, `# ${TESTER_COMMAND}`),
  },
);
expectRed(
  "Class D wildcard wiring fails",
  {
    ...live,
    workflow: live.workflow.replace(
      "issue_2443_explorer_native_identity.implementor.test.ts",
      "issue_2443_explorer_native_identity*.test.ts",
    ),
  },
  /must not rely on a wildcard/,
);
expectRed(
  "an issue-specific workflow fails",
  { ...live, issueWorkflowExists: true },
  /must not add an issue-specific workflow/,
);
expectRed(
  "Host ownership attribution fails",
  {
    ...live,
    guardedRepositoryPaths: [
      ...live.guardedRepositoryPaths,
      "mingla-business/src/services/appVersionIdentity.ts",
    ],
  },
  /must exclude every Host file/,
);
