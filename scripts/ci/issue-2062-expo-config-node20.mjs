#!/usr/bin/env node
/**
 * #2062 — keep both Expo root configs readable by the exact SDK 54 EAS Node.
 *
 * This is intentionally outside Expo's TypeScript-aware loader. It first
 * proves that each root is ordinary CommonJS JavaScript, then drives the same
 * project Expo CLI boundary used by READ_APP_CONFIG with non-secret sentinels.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_NODE_VERSION = "v20.19.4";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW_REL = ".github/ci-batch/MANIFEST.json";
const GATE_REL = "scripts/ci/issue-2062-expo-config-node20.mjs";
const REQUIRED_WORKFLOW_PATHS = [
  GATE_REL,
  "app-mobile/app.config.js",
  "app-mobile/app.config.ts",
  "mingla-business/app.config.js",
  "mingla-business/app.config.ts",
];
const SELF_TEST_COMMAND = `node ${GATE_REL} --self-test`;
const REAL_RUN_COMMAND = `node ${GATE_REL} --app \${{ matrix.app }}`;

function canonicalWorkflowSource() {
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, WORKFLOW_REL), "utf8"));
  const suites = registry.suites.filter((suite) => suite.id.startsWith("issue-994-ota-env-resolution-"));
  assert.equal(suites.length, 2, "typed #994 provider must contain exactly two variants");
  const decode = (value) => value && typeof value === "object" && value.encoding === "concat-v1" ? value.parts.join("") : value;
  const paths = [...new Set(suites.flatMap((suite) => suite.originPaths.map(decode)))];
  const commands = [...new Set(suites.flatMap((suite) => suite.steps.map((step) => step.run)))];
  assert.ok(commands.includes(`node ${GATE_REL} --app app-mobile`) && commands.includes(`node ${GATE_REL} --app mingla-business`));
  return `on:\n  pull_request:\n    paths:\n${paths.map((item) => `      - "${item}"`).join("\n")}\n  push:\n    paths:\n${paths.map((item) => `      - "${item}"`).join("\n")}\njobs:\n  gate:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "20.19.4"\n      - name: self-test\n        run: ${SELF_TEST_COMMAND}\n      - name: real-run\n        run: ${REAL_RUN_COMMAND}\n`;
}

const APP_CONTRACTS = {
  "app-mobile": {
    name: "Mingla",
    slug: "mingla",
    scheme: "com.mingla.app.v2",
    bundleIdentifier: "com.mingla.app.v2",
    package: "com.mingla.app.v2",
    associatedDomains: [
      "applinks:usemingla.com",
      "applinks:host.usemingla.com",
      "applinks:go.usemingla.com",
    ],
    customPlugins: [
      "./plugins/withoutSystemAlertWindow",
      "./plugins/withGooglePodsModularHeaders",
    ],
    sentinelExtra: {
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_issue2062_placeholder",
      EXPO_PUBLIC_APPSFLYER_DEV_KEY: "issue2062_af_placeholder",
      EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "0000000000",
      EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.issue2062.placeholder",
    },
  },
  "mingla-business": {
    name: "Mingla Host",
    slug: "mingla-business",
    scheme: "mingla-business",
    bundleIdentifier: "com.sethogieva.minglabusiness",
    package: "com.sethogieva.minglabusiness",
    associatedDomains: [
      "applinks:host.usemingla.com",
      "applinks:biz.usemingla.com",
    ],
    customPlugins: [
      "./plugins/withAdiRegistration",
      "./plugins/withAndroidBracketSafeCmake",
      "./plugins/withIosFmtConsteval",
      "./plugins/withGooglePodsModularHeaders",
    ],
    sentinelExtra: {
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:
        "pk_live_000000000000000000000000",
      EXPO_PUBLIC_GIPHY_API_KEY: "issue2062_giphy_placeholder",
    },
  },
};

function fail(message) {
  throw new Error(message);
}

function assertSupportedNodeVersion(actualVersion) {
  if (actualVersion !== EXPECTED_NODE_VERSION) {
    fail(
      `#2062 requires Node ${EXPECTED_NODE_VERSION}; actual process is ${actualVersion}.`,
    );
  }
}

function assertRealRuntime() {
  assertSupportedNodeVersion(process.version);
}

function indentation(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function eventBlock(lines, eventName) {
  const header = `  ${eventName}:`;
  const start = lines.findIndex((line) => line === header);
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (indentation(lines[i]) <= 2) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function eventPaths(workflowSource, eventName) {
  const block = eventBlock(workflowSource.split(/\r?\n/), eventName);
  const pathsStart = block.findIndex((line) => line === "    paths:");
  if (pathsStart < 0) return [];
  const paths = [];
  for (let i = pathsStart + 1; i < block.length; i += 1) {
    const line = block[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (indentation(line) <= 4) break;
    const match = line.match(/^\s{6}-\s+["']([^"']+)["']\s*$/);
    if (match) paths.push(match[1]);
  }
  return paths;
}

function setupNodeVersion(workflowSource) {
  const lines = workflowSource.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim() === "- uses: actions/setup-node@v4",
  );
  if (start < 0) return null;
  const stepIndent = indentation(lines[start]);
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (indentation(lines[i]) <= stepIndent && trimmed.startsWith("- ")) break;
    const match = lines[i].match(/^\s+node-version:\s*["']([^"']+)["']\s*$/);
    if (match) return match[1];
  }
  return null;
}

function runCommands(workflowSource) {
  return workflowSource
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => line.match(/^\s+run:\s*(.+?)\s*$/)?.[1] ?? null)
    .filter(Boolean);
}

function auditWorkflow(workflowSource) {
  const problems = [];
  for (const eventName of ["pull_request", "push"]) {
    const paths = eventPaths(workflowSource, eventName);
    for (const requiredPath of REQUIRED_WORKFLOW_PATHS) {
      if (!paths.includes(requiredPath)) {
        problems.push(`${eventName}.paths missing ${requiredPath}`);
      }
    }
  }
  const nodeVersion = setupNodeVersion(workflowSource);
  if (nodeVersion !== EXPECTED_NODE_VERSION.slice(1)) {
    problems.push(
      `actions/setup-node must pin ${EXPECTED_NODE_VERSION.slice(1)}; found ${nodeVersion ?? "none"}`,
    );
  }
  const commands = runCommands(workflowSource);
  if (!commands.includes(SELF_TEST_COMMAND)) {
    problems.push(
      `workflow missing executable command: ${SELF_TEST_COMMAND}; found ${JSON.stringify(commands)}`,
    );
  }
  if (!commands.includes(REAL_RUN_COMMAND)) {
    problems.push(
      `workflow missing executable command: ${REAL_RUN_COMMAND}; found ${JSON.stringify(commands)}`,
    );
  }
  return problems;
}

function assertWorkflow(workflowSource) {
  const problems = auditWorkflow(workflowSource);
  if (problems.length > 0) fail(problems.join("; "));
}

function validatePlatformUrlSource(source) {
  const extraRead = source.indexOf("Constants.expoConfig?.extra");
  const envRead = source.indexOf(
    "process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL",
  );
  const selection = "const CONFIGURED = FROM_EXTRA ?? FROM_PROCESS_ENV;";
  const selectionIndex = source.indexOf(selection);
  if (
    extraRead < 0 ||
    envRead < 0 ||
    selectionIndex < 0 ||
    extraRead > envRead ||
    envRead > selectionIndex
  ) {
    fail("platformUrl.ts must read Expo extra before process.env");
  }
  if (source.split(/\r?\n/).filter((line) => line === selection).length !== 1) {
    fail("platformUrl.ts fallback precedence drifted");
  }
  const hostOwner = 'const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";';
  if (source.split(/\r?\n/).filter((line) => line === hostOwner).length !== 1) {
    fail("platformUrl.ts Host replacement drifted");
  }
  const retiredMatcher =
    "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com\\/?$/i;";
  if (source.split(/\r?\n/).filter((line) => line === retiredMatcher).length !== 1) {
    fail("platformUrl.ts retired-origin matcher must remain exact");
  }
  const normalization = [
    "const RESOLVED = CONFIGURED && RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())",
    "  ? HOST_PUBLIC_ORIGIN",
    "  : CONFIGURED;",
  ].join("\n");
  const normalizationIndex = source.indexOf(normalization);
  if (normalizationIndex <= selectionIndex) {
    fail("platformUrl.ts must normalize the selected exact retired origin to Host");
  }
  if (!source.includes("if (!RESOLVED || RESOLVED.length === 0) {")) {
    fail("platformUrl.ts must fail loudly when configuration is missing or empty");
  }
  if (
    !source.includes(
      "EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL is not set. Configure in mingla-business/app.config.js extra block or .env.local for dev.",
    )
  ) {
    fail("platformUrl.ts operator diagnostic does not name app.config.js");
  }
  if (
    !source.includes(
      "export const MINGLA_BUSINESS_WEB_URL: string = RESOLVED;",
    )
  ) {
    fail("platformUrl.ts exported URL contract drifted");
  }
  if (source.includes("mingla-business/app.config.ts")) {
    fail("platformUrl.ts still points operators to the deleted TypeScript config");
  }
}

function moduleExportStatus(configPath) {
  return spawnSync(
    process.execPath,
    [
      "-e",
      "const value=require(process.argv[1]);if(typeof value!=='function')process.exit(3)",
      configPath,
    ],
    { encoding: "utf8" },
  ).status;
}

function validateConfigRoot(appRoot) {
  const jsConfig = join(appRoot, "app.config.js");
  const tsConfig = join(appRoot, "app.config.ts");
  if (!existsSync(jsConfig)) fail(`${jsConfig} is missing`);
  if (existsSync(tsConfig)) fail(`${tsConfig} must be absent`);
  const syntax = spawnSync(process.execPath, ["--check", jsConfig], {
    encoding: "utf8",
  });
  if (syntax.status !== 0) fail(`${jsConfig} is not plain JavaScript`);
  if (moduleExportStatus(jsConfig) !== 0) {
    fail(`${jsConfig} must export its config function via module.exports`);
  }
}

function pluginName(plugin) {
  if (typeof plugin === "string") return plugin;
  if (Array.isArray(plugin) && typeof plugin[0] === "string") return plugin[0];
  return null;
}

function assertJsonEqual(actual, expected, label) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    fail(`${label} drifted`);
  }
}

function validateResolvedConfig(appName, exp, appJson) {
  const contract = APP_CONTRACTS[appName];
  if (!contract) fail(`unsupported app ${appName}`);
  if (exp.name !== contract.name) fail(`${appName} name drifted`);
  if (exp.slug !== contract.slug) fail(`${appName} slug drifted`);
  if (exp.version !== appJson.expo.version) fail(`${appName} version drifted`);
  if (exp.scheme !== contract.scheme) fail(`${appName} scheme drifted`);
  if (exp.ios?.bundleIdentifier !== contract.bundleIdentifier) {
    fail(`${appName} iOS bundle identifier drifted`);
  }
  if (exp.android?.package !== contract.package) {
    fail(`${appName} Android package drifted`);
  }
  assertJsonEqual(
    exp.ios?.associatedDomains,
    contract.associatedDomains,
    `${appName} associated domains`,
  );
  assertJsonEqual(
    exp.android?.intentFilters,
    appJson.expo.android?.intentFilters,
    `${appName} Android intent filters`,
  );
  assertJsonEqual(
    exp.ios?.entitlements,
    appJson.expo.ios?.entitlements,
    `${appName} iOS entitlements`,
  );
  assertJsonEqual(
    exp.updates,
    appJson.expo.updates,
    `${appName} update policy`,
  );
  assertJsonEqual(
    exp.runtimeVersion,
    appJson.expo.runtimeVersion,
    `${appName} runtime-version policy`,
  );
  const pluginNames = (exp.plugins ?? []).map(pluginName).filter(Boolean);
  for (const requiredPlugin of contract.customPlugins) {
    if (!pluginNames.includes(requiredPlugin)) {
      fail(`${appName} custom plugin missing: ${requiredPlugin}`);
    }
  }
  for (const [key, sentinel] of Object.entries(contract.sentinelExtra)) {
    if (exp.extra?.[key] !== sentinel) {
      fail(`${appName} did not carry controlled ${key} sentinel to extra`);
    }
  }
}

function controlledEnvironment(appName) {
  const contract = APP_CONTRACTS[appName];
  const env = {
    ...process.env,
    EAS_BUILD_PROFILE: "preview",
    MINGLA_STRIPE_MODE: "live",
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      contract.sentinelExtra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_APPSFLYER_DEV_KEY: "issue2062_af_placeholder",
    EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "0000000000",
    EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.issue2062.placeholder",
    EXPO_PUBLIC_GIPHY_API_KEY:
      contract.sentinelExtra.EXPO_PUBLIC_GIPHY_API_KEY ?? "",
  };
  delete env.VERCEL_ENV;
  delete env.EXPO_PUBLIC_GIPHY_KEY;
  return env;
}

function runExpoConfig(appName) {
  const appRoot = join(REPO_ROOT, appName);
  const expoCli = join(appRoot, "node_modules/expo/bin/cli");
  if (!existsSync(expoCli)) fail(`${appName} dependencies are not installed`);
  const result = spawnSync(
    process.execPath,
    [expoCli, "config", "--json", "--full", "--type", "public"],
    {
      cwd: appRoot,
      env: controlledEnvironment(appName),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(`${appName} Expo config exited ${result.status ?? "without status"}`);
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    fail(`${appName} Expo config did not return valid JSON`);
  }
  if (!payload?.exp || typeof payload.exp !== "object") {
    fail(`${appName} Expo config response has no exp object`);
  }
  const appJson = JSON.parse(readFileSync(join(appRoot, "app.json"), "utf8"));
  validateResolvedConfig(appName, payload.exp, appJson);
}

function writeFixture(root, relativePath, contents) {
  const destination = join(root, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function workflowFixture() {
  const paths = REQUIRED_WORKFLOW_PATHS.map((path) => `      - "${path}"`).join(
    "\n",
  );
  return `on:\n  pull_request:\n    paths:\n${paths}\n  push:\n    paths:\n${paths}\n  workflow_dispatch:\n    paths:\n      - "wrong/block"\njobs:\n  gate:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "${EXPECTED_NODE_VERSION.slice(1)}"\n      - name: self-test\n        run: ${SELF_TEST_COMMAND}\n      - name: real-run\n        run: ${REAL_RUN_COMMAND}\n`;
}

function expectFailure(label, action) {
  let failed = false;
  try {
    action();
  } catch {
    failed = true;
  }
  if (!failed) fail(`self-test expected failure: ${label}`);
}

function runSelfTest() {
  assertSupportedNodeVersion(EXPECTED_NODE_VERSION);
  expectFailure("close Node mismatch", () =>
    assertSupportedNodeVersion("v20.20.0"),
  );
  expectFailure("Node 22 native stripping is not the contract", () =>
    assertSupportedNodeVersion("v22.6.0"),
  );
  if (!assertRealRuntime.toString().includes("process.version")) {
    fail("real runtime assertion is not bound to process.version");
  }

  const canonicalWorkflow = canonicalWorkflowSource();
  assertWorkflow(canonicalWorkflow);
  const platformUrlSource = readFileSync(
    join(REPO_ROOT, "mingla-business/src/constants/platformUrl.ts"),
    "utf8",
  );
  validatePlatformUrlSource(platformUrlSource);
  expectFailure("platformUrl stale TypeScript diagnostic", () =>
    validatePlatformUrlSource(
      platformUrlSource.replaceAll("app.config.js", "app.config.ts"),
    ),
  );
  expectFailure("platformUrl precedence drift", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        "const CONFIGURED = FROM_EXTRA ?? FROM_PROCESS_ENV;",
        "const CONFIGURED = FROM_PROCESS_ENV ?? FROM_EXTRA;",
      ),
    ),
  );
  expectFailure("platformUrl retired-origin normalization removed", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        "const RESOLVED = CONFIGURED && RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())\n  ? HOST_PUBLIC_ORIGIN\n  : CONFIGURED;",
        "const RESOLVED = CONFIGURED;",
      ),
    ),
  );
  expectFailure("platformUrl retired-origin matcher broadened", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com\\/?$/i;",
        "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com/i;",
      ),
    ),
  );
  expectFailure("platformUrl retired-origin matcher removed", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com\\/?$/i;\n",
        "",
      ),
    ),
  );
  expectFailure("platformUrl Host replacement changed", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        'const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";',
        'const HOST_PUBLIC_ORIGIN = "https://business.usemingla.com";',
      ),
    ),
  );
  expectFailure("platformUrl unconditional Host fallback", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        "const RESOLVED = CONFIGURED && RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())\n  ? HOST_PUBLIC_ORIGIN\n  : CONFIGURED;",
        "const RESOLVED = CONFIGURED ?? HOST_PUBLIC_ORIGIN;",
      ),
    ),
  );
  expectFailure("platformUrl fail-loud behavior removed", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        "if (!RESOLVED || RESOLVED.length === 0) {",
        "if (false) {",
      ),
    ),
  );
  expectFailure("platformUrl export drift", () =>
    validatePlatformUrlSource(
      platformUrlSource.replace(
        "export const MINGLA_BUSINESS_WEB_URL: string = RESOLVED;",
        "export const MINGLA_BUSINESS_WEB_URL: string = HOST_PUBLIC_ORIGIN;",
      ),
    ),
  );
  const goodWorkflow = workflowFixture();
  assertWorkflow(goodWorkflow);
  for (const eventName of ["pull_request", "push"]) {
    for (const requiredPath of REQUIRED_WORKFLOW_PATHS) {
      const bad = goodWorkflow.replace(
        `  ${eventName}:\n    paths:\n${REQUIRED_WORKFLOW_PATHS.map((path) => `      - "${path}"`).join("\n")}`,
        `  ${eventName}:\n    paths:\n${REQUIRED_WORKFLOW_PATHS.filter((path) => path !== requiredPath)
          .map((path) => `      - "${path}"`)
          .join("\n")}\n    # removed ${requiredPath}`,
      );
      expectFailure(`${eventName} missing ${requiredPath}`, () =>
        assertWorkflow(bad),
      );
    }
  }
  expectFailure("required path in comment only", () =>
    assertWorkflow(
      goodWorkflow.replace(
        '      - "app-mobile/app.config.js"',
        '      # - "app-mobile/app.config.js"',
      ),
    ),
  );
  expectFailure("required path moved into wrong YAML block", () =>
    assertWorkflow(
      goodWorkflow
        .replace('      - "app-mobile/app.config.js"\n', "")
        .replace(
          '      - "wrong/block"',
          '      - "wrong/block"\n      - "app-mobile/app.config.js"',
        ),
    ),
  );
  expectFailure("near-match path", () =>
    assertWorkflow(
      goodWorkflow.replace(
        '      - "mingla-business/app.config.js"',
        '      - "mingla-business/app.config.jsx"',
      ),
    ),
  );
  expectFailure("floating Node pin", () =>
    assertWorkflow(
      goodWorkflow.replace(
        `node-version: "${EXPECTED_NODE_VERSION.slice(1)}"`,
        'node-version: "20.x"',
      ),
    ),
  );
  expectFailure("Node pin outside setup-node", () =>
    assertWorkflow(
      goodWorkflow
        .replace(
          `          node-version: "${EXPECTED_NODE_VERSION.slice(1)}"`,
          '          node-version: "20.x"',
        )
        .concat(`\n# node-version: "${EXPECTED_NODE_VERSION.slice(1)}"\n`),
    ),
  );
  expectFailure("missing self-test command", () =>
    assertWorkflow(goodWorkflow.replace(`      - name: self-test\n        run: ${SELF_TEST_COMMAND}\n`, "")),
  );
  expectFailure("missing matrix real-run command", () =>
    assertWorkflow(goodWorkflow.replace(`      - name: real-run\n        run: ${REAL_RUN_COMMAND}\n`, "")),
  );

  const tempRoot = mkdtempSync(join(tmpdir(), "issue-2062-config-"));
  try {
    const goodRoot = join(tempRoot, "good");
    writeFixture(goodRoot, "app.config.js", "module.exports = ({ config }) => ({ ...config });\n");
    validateConfigRoot(goodRoot);

    const tsOnly = join(tempRoot, "ts-only");
    writeFixture(tsOnly, "app.config.ts", "export default ({ config }) => config;\n");
    expectFailure("TypeScript-only root", () => validateConfigRoot(tsOnly));

    const typedJs = join(tempRoot, "typed-js");
    writeFixture(typedJs, "app.config.js", "const value: string = 'x'; module.exports = () => value;\n");
    expectFailure("TypeScript syntax inside JavaScript", () => validateConfigRoot(typedJs));

    const missingCommonJs = join(tempRoot, "missing-commonjs");
    writeFixture(missingCommonJs, "app.config.js", "const config = {};\n");
    expectFailure("missing CommonJS export", () => validateConfigRoot(missingCommonJs));

    const baseJson = {
      expo: {
        version: "1.1.5",
        updates: { enabled: true },
        runtimeVersion: { policy: "appVersion" },
        ios: { entitlements: null },
        android: { intentFilters: [] },
      },
    };
    const projection = {
      name: "Mingla",
      slug: "mingla",
      version: "1.1.5",
      scheme: "com.mingla.app.v2",
      updates: { enabled: true },
      runtimeVersion: { policy: "appVersion" },
      ios: {
        bundleIdentifier: "com.mingla.app.v2",
        associatedDomains: APP_CONTRACTS["app-mobile"].associatedDomains,
        entitlements: null,
      },
      android: { package: "com.mingla.app.v2", intentFilters: [] },
      plugins: APP_CONTRACTS["app-mobile"].customPlugins,
      extra: APP_CONTRACTS["app-mobile"].sentinelExtra,
    };
    validateResolvedConfig("app-mobile", projection, baseJson);
    expectFailure("identity drift", () =>
      validateResolvedConfig(
        "app-mobile",
        { ...projection, scheme: "wrong" },
        baseJson,
      ),
    );
    expectFailure("domain drift", () =>
      validateResolvedConfig(
        "app-mobile",
        { ...projection, ios: { ...projection.ios, associatedDomains: [] } },
        baseJson,
      ),
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const bypass = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "--app", "app-mobile", "--node-version", EXPECTED_NODE_VERSION],
    { encoding: "utf8" },
  );
  if (bypass.status === 0) fail("production CLI accepted a Node-version override");

  console.log(
    "#2062 self-test PASS: exact runtime, workflow scope, CommonJS roots, and identity/domain drift are fail-closed",
  );
}

function parseAppArgument(argv) {
  if (argv.length !== 2 || argv[0] !== "--app" || !(argv[1] in APP_CONTRACTS)) {
    fail("usage: issue-2062-expo-config-node20.mjs --app app-mobile|mingla-business");
  }
  return argv[1];
}

function realMain(argv) {
  assertRealRuntime();
  const appName = parseAppArgument(argv);
  assertWorkflow(canonicalWorkflowSource());
  validatePlatformUrlSource(
    readFileSync(
      join(REPO_ROOT, "mingla-business/src/constants/platformUrl.ts"),
      "utf8",
    ),
  );
  validateConfigRoot(join(REPO_ROOT, appName));
  runExpoConfig(appName);
  console.log(
    `#2062 Expo config Node ${EXPECTED_NODE_VERSION.slice(1)} PASS: ${appName}`,
  );
}

try {
  if (process.argv.length === 3 && process.argv[2] === "--self-test") {
    runSelfTest();
  } else {
    realMain(process.argv.slice(2));
  }
} catch (error) {
  console.error(`FAIL #2062: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
