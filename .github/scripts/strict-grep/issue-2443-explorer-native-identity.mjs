#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const FILES = {
  appJson: "app-mobile/app.json",
  identity: "app-mobile/src/services/appVersionIdentity.ts",
  implementorTest:
    "app-mobile/src/services/__tests__/issue_2443_explorer_native_identity.implementor.test.ts",
  supabase: "app-mobile/src/services/supabase.ts",
  workflow: ".github/workflows/strict-grep-mingla-business.yml",
  manifest: ".github/scripts/strict-grep/MANIFEST.json",
};

const GUARDED_REPOSITORY_PATHS = [
  ...Object.values(FILES),
  "app-mobile/src/services/__tests__/issue_2443_explorer_native_identity.tester_adversarial.test.ts",
  ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs",
];

export function loadSources() {
  return {
    ...Object.fromEntries(
      Object.entries(FILES).map(([key, relative]) => [key, read(relative)]),
    ),
    testerExists: fs.existsSync(
      path.join(
        ROOT,
        "app-mobile/src/services/__tests__/issue_2443_explorer_native_identity.tester_adversarial.test.ts",
      ),
    ),
    issueWorkflowExists: fs.existsSync(
      path.join(
        ROOT,
        ".github/workflows/issue-2443-explorer-native-identity.yml",
      ),
    ),
    guardedRepositoryPaths: [...GUARDED_REPOSITORY_PATHS],
  };
}

export function validate(sources) {
  const failures = [];
  const requireText = (key, needle, label) => {
    if (!sources[key].includes(needle)) failures.push(label);
  };

  let appJson;
  try {
    appJson = JSON.parse(sources.appJson);
  } catch {
    failures.push("Explorer app.json must remain valid JSON");
  }
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
      appJson?.expo?.version ?? "",
    )
  ) {
    failures.push("Explorer expo.version must remain strict SemVer");
  }
  if (appJson?.expo?.runtimeVersion?.policy !== "appVersion") {
    failures.push("Explorer runtimeVersion.policy must remain appVersion");
  }

  requireText(
    "identity",
    "isStrictSemver(Constants.nativeAppVersion)",
    "nativeAppVersion must remain the primary strict identity",
  );
  requireText(
    "identity",
    "const expoConfigVersion = Constants.expoConfig?.version",
    "Release identity must retain the Expo config fallback",
  );
  requireText(
    "identity",
    "if (isStrictSemver(expoConfigVersion)) {",
    "Expo config fallback must require exact strict SemVer in Release",
  );
  requireText(
    "identity",
    'reportIdentityOutcome(platform, "expo_config_fallback")',
    "strict Expo config fallback must retain its bounded diagnostic",
  );
  if (
    /__DEV__\s*&&[\s\S]{0,100}isStrictSemver\(expoConfigVersion\)/.test(
      sources.identity,
    )
  ) {
    failures.push("Expo config fallback must not be development-only");
  }
  const platformRead = sources.identity.indexOf(
    "const platform = getNativeAppPlatform();",
    sources.identity.indexOf("getInstalledNativeVersion"),
  );
  const webReturn = sources.identity.indexOf(
    "if (platform === null) return null;",
    platformRead,
  );
  const primaryRead = sources.identity.indexOf(
    "isStrictSemver(Constants.nativeAppVersion)",
    platformRead,
  );
  if (
    platformRead < 0 ||
    webReturn < platformRead ||
    primaryRead < webReturn
  ) {
    failures.push("web must exit before either native identity source is read");
  }
  for (const text of [
    "let reportedFallback = false",
    "let reportedUnavailable = false",
    "if (reportedFallback) return",
    "if (reportedUnavailable) return",
    'outcome: "expo_config_fallback"',
    'reportIdentityOutcome(platform, "unavailable")',
    'console.warn("[app-version-identity]", {',
    "appId: APP_VERSION_APP_ID",
    "severity: outcome === \"unavailable\" ? \"error\" : \"warning\"",
  ]) {
    requireText("identity", text, `identity diagnostic contract lost: ${text}`);
  }
  if (/from\s+["']\.\.?\//.test(sources.identity)) {
    failures.push("identity resolver must not add a relative import");
  }
  requireText(
    "identity",
    '"X-Mingla-App-Version": getInstalledNativeVersion() ?? ""',
    "native header must use the single installed-version resolver",
  );
  requireText(
    "supabase",
    "headers: getNativeAppVersionHeaders()",
    "shared Explorer Supabase client must remain the sole global header owner",
  );

  const implementorCommand =
    "npx jest --runInBand src/services/__tests__/issue_2443_explorer_native_identity.implementor.test.ts";
  requireText(
    "workflow",
    implementorCommand,
    "Class D must invoke the implementor test by exact filename",
  );
  if (/issue_2443_explorer_native_identity[^\n]*\*/.test(sources.workflow)) {
    failures.push("#2443 Class D wiring must not rely on a wildcard");
  }
  if (sources.testerExists) {
    requireText(
      "workflow",
      "npx jest --runInBand src/services/__tests__/issue_2443_explorer_native_identity.tester_adversarial.test.ts",
      "Class D must invoke the tester test by exact filename once it exists",
    );
  }
  if (sources.issueWorkflowExists) {
    failures.push("#2443 must not add an issue-specific workflow");
  }

  let manifest;
  try {
    manifest = JSON.parse(sources.manifest);
  } catch {
    failures.push("strict-grep manifest must remain valid JSON");
  }
  const entries =
    manifest?.gates?.filter(
      (entry) =>
        entry.script ===
        ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs",
    ) ?? [];
  if (
    entries.length !== 1 ||
    entries[0]?.enforcement !== "batch:A" ||
    entries[0]?.invocation !== "node" ||
    JSON.stringify(entries[0]?.modes) !== JSON.stringify(["self-test", "plain"]) ||
    entries[0]?.selfTest !== "wired"
  ) {
    failures.push("#2443 guard must run self-test then plain in Class A");
  }
  if (
    !Array.isArray(sources.guardedRepositoryPaths) ||
    sources.guardedRepositoryPaths.some((file) => file.startsWith("mingla-business/"))
  ) {
    failures.push("the #2443 guard ownership must exclude every Host file");
  }
  return failures;
}

function main() {
  const sources = loadSources();
  if (!process.argv.includes("--self-test")) {
    const failures = validate(sources);
    if (failures.length > 0) {
      for (const failure of failures) console.error(`#2443: ${failure}`);
      process.exit(1);
    }
    console.log("#2443 Explorer native-identity structural contract: PASS");
    return;
  }
  const baseline = validate(sources);
  if (baseline.length > 0) {
    throw new Error(`baseline invalid: ${baseline.join("; ")}`);
  }
  const downstreamManifest = JSON.parse(sources.manifest);
  downstreamManifest.expectedStrictGrepMjsFiles += 1;
  downstreamManifest.selfTestWiredFloor += 1;
  downstreamManifest.gates.push({
    script: ".github/scripts/strict-grep/issue-9999-unrelated-downstream-fixture.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["self-test", "plain"],
    selfTest: "wired",
    jobKeys: [],
  });
  const downstreamFailures = validate({
    ...sources,
    manifest: JSON.stringify(downstreamManifest),
  });
  if (downstreamFailures.length > 0) {
    throw new Error(`downstream-safe fixture failed: ${downstreamFailures.join("; ")}`);
  }
  const mutations = [
    [
      "strict Explorer version",
      {
        ...sources,
        appJson: (() => {
          const appJson = JSON.parse(sources.appJson);
          appJson.expo.version = "v1.1.6";
          return JSON.stringify(appJson);
        })(),
      },
    ],
    [
      "primary native identity",
      {
        ...sources,
        identity: sources.identity.replace(
          "isStrictSemver(Constants.nativeAppVersion)",
          "false",
        ),
      },
    ],
    [
      "release fallback removal",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (isStrictSemver(expoConfigVersion)) {",
          "if (false) {",
        ),
      },
    ],
    [
      "development-only fallback",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (isStrictSemver(expoConfigVersion)) {",
          "if (__DEV__ && isStrictSemver(expoConfigVersion)) {",
        ),
      },
    ],
    [
      "runtime policy drift",
      {
        ...sources,
        appJson: sources.appJson.replace(
          '"policy": "appVersion"',
          '"policy": "nativeVersion"',
        ),
      },
    ],
    [
      "global header wiring",
      {
        ...sources,
        supabase: sources.supabase.replace(
          "headers: getNativeAppVersionHeaders()",
          "headers: {}",
        ),
      },
    ],
    [
      "web exclusion",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (platform === null) return null;",
          "if (false) return null;",
        ),
      },
    ],
    [
      "once-only fallback reporting",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (reportedFallback) return;",
          "if (false) return;",
        ),
      },
    ],
    [
      "unavailable identity reporting",
      {
        ...sources,
        identity: sources.identity.replace(
          'reportIdentityOutcome(platform, "unavailable")',
          "void platform",
        ),
      },
    ],
    [
      "exact Class D invocation",
      {
        ...sources,
        workflow: sources.workflow.replace(
          "issue_2443_explorer_native_identity.implementor.test.ts",
          "issue_2443_explorer_native_identity*.test.ts",
        ),
      },
    ],
    [
      "exact tester Class D invocation",
      {
        ...sources,
        workflow: sources.workflow.replace(
          "issue_2443_explorer_native_identity.tester_adversarial.test.ts",
          "issue_2443_explorer_native_identity*.test.ts",
        ),
      },
    ],
    [
      "no issue-specific workflow",
      {
        ...sources,
        issueWorkflowExists: true,
      },
    ],
    [
      "Class A execution modes",
      {
        ...sources,
        manifest: (() => {
          const manifest = JSON.parse(sources.manifest);
          const entry = manifest.gates.find(
            (candidate) =>
              candidate.script ===
              ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs",
          );
          entry.modes = ["plain"];
          return JSON.stringify(manifest);
        })(),
      },
    ],
    [
      "Class A enforcement identity",
      {
        ...sources,
        manifest: (() => {
          const manifest = JSON.parse(sources.manifest);
          const entry = manifest.gates.find(
            (candidate) =>
              candidate.script ===
              ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs",
          );
          entry.enforcement = "batch:B";
          return JSON.stringify(manifest);
        })(),
      },
    ],
    [
      "Class A self-test identity",
      {
        ...sources,
        manifest: (() => {
          const manifest = JSON.parse(sources.manifest);
          const entry = manifest.gates.find(
            (candidate) =>
              candidate.script ===
              ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs",
          );
          entry.selfTest = "none";
          return JSON.stringify(manifest);
        })(),
      },
    ],
    [
      "Host ownership exclusion",
      {
        ...sources,
        guardedRepositoryPaths: [
          ...sources.guardedRepositoryPaths,
          "mingla-business/src/services/appVersionIdentity.ts",
        ],
      },
    ],
  ];
  for (const [label, mutated] of mutations) {
    if (validate(mutated).length === 0) {
      throw new Error(`self-test failed: ${label} mutation passed`);
    }
  }
  console.log("#2443 Explorer native-identity strict gate self-test: 16/16 + downstream fixture PASS");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
