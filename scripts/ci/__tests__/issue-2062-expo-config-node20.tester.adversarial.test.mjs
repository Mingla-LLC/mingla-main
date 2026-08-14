import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const GATE_PATH = resolve(
  REPO_ROOT,
  "scripts/ci/issue-2062-expo-config-node20.mjs",
);
const WORKFLOW_PATH = resolve(
  REPO_ROOT,
  ".github/workflows/issue-994-ota-env-resolution.yml",
);
const TEST_REL =
  "scripts/ci/__tests__/issue-2062-expo-config-node20.tester.adversarial.test.mjs";
const REQUIRED_PATHS = [
  "scripts/ci/issue-2062-expo-config-node20.mjs",
  TEST_REL,
  "app-mobile/app.config.js",
  "app-mobile/app.config.ts",
  "mingla-business/app.config.js",
  "mingla-business/app.config.ts",
];
const EXPECTED_NODE = "20.19.4";
const TEST_COMMAND = `node --test ${TEST_REL}`;
const SELF_TEST_COMMAND =
  "node scripts/ci/issue-2062-expo-config-node20.mjs --self-test";
const REAL_COMMAND =
  "node scripts/ci/issue-2062-expo-config-node20.mjs --app ${{ matrix.app }}";
const LIVE_OPERATIONAL_REFERENCES = [
  "app-mobile/src/services/appsFlyerService.ts",
  "packages/payments-native/StripeNativeProvider.tsx",
  "mingla-business/src/services/giphyEventCoverService.ts",
  "mingla-business/src/services/coverProviderBrowseService.ts",
  "scripts/ota/verify-published-manifest.mjs",
  "supabase/functions/ticket-checkout-create/index.ts",
];

function indentation(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function eventBlock(source, eventName) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${eventName}:`);
  assert.notEqual(start, -1, `${eventName} event is missing`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (indentation(lines[index]) <= 2) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function eventPaths(source, eventName) {
  const block = eventBlock(source, eventName);
  const start = block.findIndex((line) => line === "    paths:");
  assert.notEqual(start, -1, `${eventName}.paths is missing`);
  const paths = [];
  for (let index = start + 1; index < block.length; index += 1) {
    const line = block[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (indentation(line) <= 4) break;
    const match = line.match(/^\s{6}-\s+["']([^"']+)["']\s*$/);
    if (match) paths.push(match[1]);
  }
  return paths;
}

function setupNodeVersion(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim() === "- uses: actions/setup-node@v4",
  );
  assert.notEqual(start, -1, "actions/setup-node@v4 step is missing");
  const stepIndent = indentation(lines[start]);
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (indentation(lines[index]) <= stepIndent && trimmed.startsWith("- ")) {
      break;
    }
    const match = lines[index].match(
      /^\s+node-version:\s*["']([^"']+)["']\s*$/,
    );
    if (match) return match[1];
  }
  return null;
}

function runCommands(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => line.match(/^\s+run:\s*(.+?)\s*$/)?.[1] ?? null)
    .filter(Boolean);
}

function auditWorkflow(source) {
  for (const eventName of ["pull_request", "push"]) {
    const paths = eventPaths(source, eventName);
    for (const requiredPath of REQUIRED_PATHS) {
      assert.ok(
        paths.includes(requiredPath),
        `${eventName}.paths missing ${requiredPath}`,
      );
    }
  }
  assert.equal(setupNodeVersion(source), EXPECTED_NODE);
  const commands = runCommands(source);
  assert.ok(commands.includes(SELF_TEST_COMMAND), "self-test run is missing");
  assert.ok(commands.includes(TEST_COMMAND), "independent tester run is missing");
  assert.ok(commands.includes(REAL_COMMAND), "matrix real run is missing");
}

function functionBody(source, functionName) {
  const signature = `function ${functionName}(`;
  const signatureStart = source.indexOf(signature);
  assert.notEqual(signatureStart, -1, `${functionName} is missing`);
  const bodyStart = source.indexOf("{", signatureStart);
  assert.notEqual(bodyStart, -1, `${functionName} body is missing`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`${functionName} body is unterminated`);
}

function auditProductionRuntimeBinding(source) {
  assert.match(
    source,
    /const EXPECTED_NODE_VERSION = ["']v20\.19\.4["'];/,
  );
  const runtimeBody = functionBody(source, "assertRealRuntime")
    .replace(/\s+/g, " ")
    .trim();
  assert.equal(
    runtimeBody,
    "assertSupportedNodeVersion(process.version);",
    "production runtime must pass the unoverrideable real process.version directly",
  );
  const realMainBody = functionBody(source, "realMain");
  const runtimeIndex = realMainBody.indexOf("assertRealRuntime();");
  const argumentIndex = realMainBody.indexOf("parseAppArgument(argv)");
  assert.ok(runtimeIndex >= 0, "realMain does not enforce the real runtime");
  assert.ok(
    argumentIndex >= 0 && runtimeIndex < argumentIndex,
    "real runtime enforcement must precede production argument parsing",
  );
}

function expectAuditFailure(label, action) {
  assert.throws(action, undefined, label);
}

test("#2062 tester: canonical workflow and real process-version binding pass", () => {
  auditWorkflow(readFileSync(WORKFLOW_PATH, "utf8"));
  auditProductionRuntimeBinding(readFileSync(GATE_PATH, "utf8"));
});

test("#2062 tester: every event-specific path deletion fails and restoration passes", () => {
  const canonical = readFileSync(WORKFLOW_PATH, "utf8");
  for (const eventName of ["pull_request", "push"]) {
    const block = eventBlock(canonical, eventName).join("\n");
    for (const requiredPath of REQUIRED_PATHS) {
      const mutatedBlock = block.replace(`      - "${requiredPath}"`, "");
      const mutated = canonical.replace(block, mutatedBlock);
      expectAuditFailure(`${eventName} accepted removal of ${requiredPath}`, () =>
        auditWorkflow(mutated),
      );
      auditWorkflow(canonical);
    }
  }
});

test("#2062 tester: comment, wrong-block, near-path, floating pin, and missing runs fail", () => {
  const canonical = readFileSync(WORKFLOW_PATH, "utf8");
  expectAuditFailure("comment-only path passed", () =>
    auditWorkflow(
      canonical.replace(
        '      - "app-mobile/app.config.js"',
        '      # - "app-mobile/app.config.js"',
      ),
    ),
  );
  expectAuditFailure("nearby path passed", () =>
    auditWorkflow(
      canonical.replace(
        '      - "mingla-business/app.config.js"',
        '      - "mingla-business/app.config.jsx"',
      ),
    ),
  );
  expectAuditFailure("wrong YAML block passed", () =>
    auditWorkflow(
      canonical
        .replace(`      - "${TEST_REL}"\n`, "")
        .replace(
          "  workflow_dispatch:\n",
          `  workflow_dispatch:\n    # ${TEST_REL}\n`,
        ),
    ),
  );
  expectAuditFailure("floating Node pin passed", () =>
    auditWorkflow(canonical.replace('node-version: "20.19.4"', 'node-version: "20.x"')),
  );
  expectAuditFailure("missing tester run passed", () =>
    auditWorkflow(canonical.replace(`        run: ${TEST_COMMAND}`, "")),
  );
  expectAuditFailure("missing self-test run passed", () =>
    auditWorkflow(canonical.replace(`        run: ${SELF_TEST_COMMAND}`, "")),
  );
  expectAuditFailure("missing real run passed", () =>
    auditWorkflow(canonical.replace(`        run: ${REAL_COMMAND}`, "")),
  );
  auditWorkflow(canonical);
});

test("#2062 tester: env, CLI, and fixture version override seams fail", () => {
  const canonical = readFileSync(GATE_PATH, "utf8");
  for (const replacement of [
    "assertSupportedNodeVersion(process.env.ISSUE_2062_NODE_VERSION ?? process.version);",
    "assertSupportedNodeVersion(process.argv[3] ?? process.version);",
    "assertSupportedNodeVersion(globalThis.__fixtureNodeVersion ?? process.version);",
  ]) {
    const mutated = canonical.replace(
      "assertSupportedNodeVersion(process.version);",
      replacement,
    );
    expectAuditFailure(`override seam passed: ${replacement}`, () =>
      auditProductionRuntimeBinding(mutated),
    );
    auditProductionRuntimeBinding(canonical);
  }
});

test("#2062 tester: both CommonJS roots and platformUrl operational path are current", () => {
  for (const appName of ["app-mobile", "mingla-business"]) {
    assert.ok(existsSync(resolve(REPO_ROOT, appName, "app.config.js")));
    assert.ok(!existsSync(resolve(REPO_ROOT, appName, "app.config.ts")));
    const source = readFileSync(
      resolve(REPO_ROOT, appName, "app.config.js"),
      "utf8",
    );
    assert.match(source, /module\.exports\s*=/);
    assert.doesNotMatch(source, /require\(["']expo\/config["']\)/);
    assert.doesNotMatch(source, /export\s+default/);
  }
  const platformSource = readFileSync(
    resolve(REPO_ROOT, "mingla-business/src/constants/platformUrl.ts"),
    "utf8",
  );
  assert.doesNotMatch(platformSource, /mingla-business\/app\.config\.ts/);
  assert.match(platformSource, /mingla-business\/app\.config\.js/);
  assert.ok(
    platformSource.indexOf("Constants.expoConfig?.extra") <
      platformSource.indexOf(
        "process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL",
      ),
  );
  assert.match(
    platformSource,
    /const RESOLVED = FROM_EXTRA \?\? FROM_PROCESS_ENV;/,
  );
  assert.match(platformSource, /export const MINGLA_BUSINESS_WEB_URL: string = RESOLVED;/);
});

test("#2062 tester: active runtime and OTA guidance has no stale TypeScript-root path", () => {
  for (const relativePath of LIVE_OPERATIONAL_REFERENCES) {
    const source = readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /(?:app-mobile\/|mingla-business\/)?app\.config\.ts/,
      `${relativePath} still points current operations at the deleted TypeScript root`,
    );
  }
});
