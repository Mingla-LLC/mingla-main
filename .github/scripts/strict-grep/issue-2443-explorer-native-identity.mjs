#!/usr/bin/env node
import { execFileSync } from "node:child_process";
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

const ISSUE_SCOPE = [
  FILES.identity,
  FILES.implementorTest,
  "app-mobile/src/services/__tests__/issue_2443_explorer_native_identity.tester_adversarial.test.ts",
  ".github/scripts/strict-grep/issue-2443-explorer-native-identity.mjs",
  FILES.manifest,
  FILES.workflow,
];

function changedFiles() {
  try {
    const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function loadSources() {
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
    changedFiles: changedFiles(),
  };
}

function validate(sources) {
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
  if (manifest?.expectedStrictGrepMjsFiles !== 587) {
    failures.push("strict-grep file ratchet must advance 586 to 587");
  }
  if (manifest?.selfTestWiredFloor !== 378) {
    failures.push("self-test wired floor must advance 377 to 378");
  }

  if (ISSUE_SCOPE.some((file) => file.startsWith("mingla-business/"))) {
    failures.push("the declared #2443 scope must exclude every Host file");
  }
  const outOfScope = sources.changedFiles.filter(
    (file) => !ISSUE_SCOPE.includes(file),
  );
  if (outOfScope.length > 0) {
    failures.push(`changed-file scope widened: ${outOfScope.join(",")}`);
  }
  return failures;
}

const sources = loadSources();

if (process.argv.includes("--self-test")) {
  const baseline = validate(sources);
  if (baseline.length > 0) {
    throw new Error(`baseline invalid: ${baseline.join("; ")}`);
  }
  const mutations = [
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
      "Host scope exclusion",
      {
        ...sources,
        changedFiles: [...sources.changedFiles, "mingla-business/src/services/appVersionIdentity.ts"],
      },
    ],
  ];
  for (const [label, mutated] of mutations) {
    if (validate(mutated).length === 0) {
      throw new Error(`self-test failed: ${label} mutation passed`);
    }
  }
  console.log("#2443 Explorer native-identity strict gate self-test: 9/9 PASS");
  process.exit(0);
}

const failures = validate(sources);
if (failures.length > 0) {
  for (const failure of failures) console.error(`#2443: ${failure}`);
  process.exit(1);
}
console.log("#2443 Explorer native-identity structural contract: PASS");
