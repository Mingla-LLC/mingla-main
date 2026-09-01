import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  ".github/ci-batch/MANIFEST.json",
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
const STALE_CONFIG_ROOT = ["app.config", "ts"].join(".");
function canonicalWorkflowSource() {
  const registry = JSON.parse(readFileSync(WORKFLOW_PATH, "utf8"));
  const suites = registry.suites.filter((suite) => suite.id.startsWith("issue-994-ota-env-resolution-"));
  assert.equal(suites.length, 2);
  const decode = (value) => value && typeof value === "object" && value.encoding === "concat-v1" ? value.parts.join("") : value;
  const paths = [...new Set(suites.flatMap((suite) => suite.originPaths.map(decode)))];
  return `on:\n  pull_request:\n    paths:\n${paths.map((item) => `      - "${item}"`).join("\n")}\n  push:\n    paths:\n${paths.map((item) => `      - "${item}"`).join("\n")}\njobs:\n  gate:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "20.19.4"\n      - name: tester\n        run: ${TEST_COMMAND}\n      - name: self-test\n        run: ${SELF_TEST_COMMAND}\n      - name: real-run\n        run: ${REAL_COMMAND}\n`;
}
// #2199: was `historical: { occurrences: 5, files: 5 }` — one REPORTS.md line
// plus four `.mtmp/metro-cache/*` blobs that happened to contain this string.
// Those blobs were Metro's bundler cache, committed by 40cab4082 (#1709) and
// untracked by #2199, so only the REPORTS.md line remains. The blob-hash
// classifier they needed went with them.
const EXPECTED_INVENTORY = {
  guard: { occurrences: 10, files: 3 },
  historical: { occurrences: 1, files: 1 },
  stale: { occurrences: 0, files: 0 },
  unclassified: { occurrences: 0, files: 0 },
};
const GUARD_CONTEXTS = new Map([
  [
    ".github/ci-batch/MANIFEST.json",
    [
      `- "app-mobile/${STALE_CONFIG_ROOT}"`,
      `- "mingla-business/${STALE_CONFIG_ROOT}"`,
    ],
  ],
  [
    ".github/workflows/production-supabase-authority.yml",
    [`- "mingla-business/${STALE_CONFIG_ROOT}"`],
  ],
  [
    "scripts/ci/issue-2062-expo-config-node20.mjs",
    [
      `"app-mobile/${STALE_CONFIG_ROOT}",`,
      `"mingla-business/${STALE_CONFIG_ROOT}",`,
      `if (source.includes("mingla-business/${STALE_CONFIG_ROOT}")) {`,
      `const tsConfig = join(appRoot, "${STALE_CONFIG_ROOT}");`,
      `platformUrlSource.replaceAll("app.config.js", "${STALE_CONFIG_ROOT}"),`,
      `writeFixture(tsOnly, "${STALE_CONFIG_ROOT}", "export default ({ config }) => config;\\n");`,
    ],
  ],
  [
    TEST_REL,
    [
      `"app-mobile/${STALE_CONFIG_ROOT}",`,
      `"mingla-business/${STALE_CONFIG_ROOT}",`,
      `assert.ok(!existsSync(resolve(REPO_ROOT, appName, "${STALE_CONFIG_ROOT}")));`,
    ],
  ],
]);
const HISTORICAL_REPORT_LINE =
  `- 2026-08-10 — \`expo config --json\` hides config errors: it exits non-zero with nothing on either stream when ${STALE_CONFIG_ROOT} throws, while the same command without \`--json\` prints the real message. Documented in the handbook with the reason it bites — both apps carry guards that fire only under a release build profile, so a silent exit 1 is indistinguishable from a guard working correctly, and it briefly passed for proof that a newly-added guard worked when a different guard had thrown. (#1748, PR #1766)`;

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

function auditPlatformUrlContract(source) {
  const exactLineCount = (line) => source
    .split(/\r?\n/)
    .filter((candidate) => candidate === line)
    .length;
  const extraRead = source.indexOf("Constants.expoConfig?.extra");
  const envRead = source.indexOf(
    "process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL",
  );
  const selection = "const CONFIGURED = FROM_EXTRA ?? FROM_PROCESS_ENV;";
  const selectionIndex = source.indexOf(selection);
  assert.ok(
    extraRead >= 0 && envRead > extraRead && selectionIndex > envRead,
    "Expo extra must remain the first configuration authority",
  );
  assert.equal(exactLineCount(selection), 1);
  assert.equal(
    exactLineCount('const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";'),
    1,
    "Host replacement owner drifted",
  );
  assert.equal(
    exactLineCount(
      "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com\\/?$/i;",
    ),
    1,
    "retired-origin matcher must remain exact",
  );
  const normalization = [
    "const RESOLVED = CONFIGURED && RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())",
    "  ? HOST_PUBLIC_ORIGIN",
    "  : CONFIGURED;",
  ].join("\n");
  assert.ok(
    source.indexOf(normalization) > selectionIndex,
    "the selected value must be normalized only after precedence is resolved",
  );
  assert.match(source, /if \(!RESOLVED \|\| RESOLVED\.length === 0\) \{/);
  assert.match(
    source,
    /EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL is not set\. Configure in mingla-business\/app\.config\.js extra block or \.env\.local for dev\./,
  );
  assert.match(
    source,
    /export const MINGLA_BUSINESS_WEB_URL: string = RESOLVED;/,
  );

  const resolveLikeProduction = (extra, processEnvironment) => {
    const configured = extra ?? processEnvironment;
    return configured && /^https:\/\/business\.usemingla\.com\/?$/i.test(configured.trim())
      ? "https://host.usemingla.com"
      : configured;
  };
  assert.equal(
    resolveLikeProduction("https://business.usemingla.com/", "https://env.example"),
    "https://host.usemingla.com",
    "the exact retired Expo value must not survive to RESOLVED",
  );
  assert.equal(
    resolveLikeProduction("https://extra.example", "https://business.usemingla.com"),
    "https://extra.example",
    "Expo extra must continue to win over process.env",
  );
  assert.equal(
    resolveLikeProduction(undefined, "https://business.usemingla.com/path"),
    "https://business.usemingla.com/path",
    "normalization may not broaden beyond the exact retired origin",
  );
  assert.equal(resolveLikeProduction(undefined, undefined), undefined);
}

function expectAuditFailure(label, action) {
  assert.throws(action, undefined, label);
}

function trackedWorkingTreeFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `git ls-files failed: ${result.error?.message ?? result.stderr.toString("utf8")}`,
  );
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function classifyOccurrence(relativePath, line) {
  const trimmed = line.trim();
  const allowedGuardLines = GUARD_CONTEXTS.get(relativePath) ?? [];
  if (allowedGuardLines.includes(trimmed)) return "guard";

  if (
    relativePath === "REPORTS.md" &&
    trimmed === HISTORICAL_REPORT_LINE
  ) {
    return "historical";
  }

  // #2199: the blob-hash escape hatch here existed only to whitelist four
  // committed Metro cache files. The cache is untracked now, so every remaining
  // occurrence outside a named guard context is genuinely stale.
  return "stale";
}

function auditTrackedInventory() {
  const inventory = {
    guard: [],
    historical: [],
    stale: [],
    unclassified: [],
  };

  for (const relativePath of trackedWorkingTreeFiles()) {
    const absolutePath = resolve(REPO_ROOT, relativePath);
    if (!existsSync(absolutePath)) continue;
    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    const source = buffer.toString("utf8");
    for (const [lineIndex, line] of source.split(/\r?\n/).entries()) {
      let offset = line.indexOf(STALE_CONFIG_ROOT);
      while (offset !== -1) {
        const category = classifyOccurrence(relativePath, line);
        inventory[category].push({
          relativePath,
          line: lineIndex + 1,
          offset,
        });
        offset = line.indexOf(STALE_CONFIG_ROOT, offset + STALE_CONFIG_ROOT.length);
      }
    }
  }

  for (const [category, expected] of Object.entries(EXPECTED_INVENTORY)) {
    const records = inventory[category];
    assert.equal(
      records.length,
      expected.occurrences,
      `${category} occurrence drift: ${JSON.stringify(records)}`,
    );
    assert.equal(
      new Set(records.map(({ relativePath }) => relativePath)).size,
      expected.files,
      `${category} file-count drift: ${JSON.stringify(records)}`,
    );
  }

  return inventory;
}

test("#2062 tester: canonical workflow and real process-version binding pass", () => {
  auditWorkflow(canonicalWorkflowSource());
  auditProductionRuntimeBinding(readFileSync(GATE_PATH, "utf8"));
});

test("#2062 tester: every event-specific path deletion fails and restoration passes", () => {
  const canonical = canonicalWorkflowSource();
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
  const canonical = canonicalWorkflowSource();
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
  auditPlatformUrlContract(platformSource);
});

test("#2062 tester: precedence, exact normalization, Host replacement, and fail-loud mutations are rejected", () => {
  const canonical = readFileSync(
    resolve(REPO_ROOT, "mingla-business/src/constants/platformUrl.ts"),
    "utf8",
  );
  const normalization =
    "const RESOLVED = CONFIGURED && RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())\n  ? HOST_PUBLIC_ORIGIN\n  : CONFIGURED;";
  const mutations = [
    canonical.replace(
      "const CONFIGURED = FROM_EXTRA ?? FROM_PROCESS_ENV;",
      "const CONFIGURED = FROM_PROCESS_ENV ?? FROM_EXTRA;",
    ),
    canonical.replace(
      "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com\\/?$/i;",
      "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com/i;",
    ),
    canonical.replace(normalization, "const RESOLVED = CONFIGURED;"),
    canonical.replace(
      'const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";',
      'const HOST_PUBLIC_ORIGIN = "https://business.usemingla.com";',
    ),
    canonical.replace(normalization, "const RESOLVED = CONFIGURED ?? HOST_PUBLIC_ORIGIN;"),
    canonical.replace(
      "if (!RESOLVED || RESOLVED.length === 0) {",
      "if (false) {",
    ),
  ];
  for (const mutation of mutations) {
    expectAuditFailure("platform URL mutation passed", () =>
      auditPlatformUrlContract(mutation),
    );
    auditPlatformUrlContract(canonical);
  }
});

test("#2062 tester: active runtime and OTA guidance has no stale TypeScript-root path", () => {
  const inventory = auditTrackedInventory();
  assert.equal(inventory.guard.length, 10);
  assert.equal(inventory.historical.length, 1);
  assert.equal(inventory.stale.length, 0);
  assert.equal(inventory.unclassified.length, 0);

  assert.equal(
    classifyOccurrence(
      "scripts/ci/__tests__/unrelated-fixture.mjs",
      `// Current runtime source is ${STALE_CONFIG_ROOT}`,
    ),
    "stale",
  );
  assert.equal(
    classifyOccurrence(
      ".github/ci-batch/MANIFEST.json",
      `# Current runtime source is ${STALE_CONFIG_ROOT}`,
    ),
    "stale",
  );
});
