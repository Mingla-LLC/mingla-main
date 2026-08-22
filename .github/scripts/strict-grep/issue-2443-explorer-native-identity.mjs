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
const implementorCommand =
  "npx jest --runInBand src/services/__tests__/issue_2443_explorer_native_identity.implementor.test.ts";
const testerCommand =
  "npx jest --runInBand src/services/__tests__/issue_2443_explorer_native_identity.tester_adversarial.test.ts";

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

const literal = (value) => ({ kind: "string", value });

function scanTypeScript(source) {
  const tokens = [];
  const errors = [];
  let index = 0;
  const push = (kind, value) => tokens.push({ kind, value });
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) index = source.length;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) {
        errors.push("unterminated block comment");
        break;
      }
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          if (index + 1 >= source.length) break;
          value += source[index + 1];
          index += 2;
        } else if (source[index] === quote) {
          index += 1;
          closed = true;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!closed) errors.push("unterminated string literal");
      push("string", value);
      continue;
    }
    if (character === "`") {
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === "`") {
          index += 1;
          closed = true;
          break;
        } else index += 1;
      }
      if (!closed) errors.push("unterminated template literal");
      push("template", "<template>");
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      push("identifier", source.slice(start, index));
      continue;
    }
    if (/\d/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_.]/.test(source[index])) index += 1;
      push("number", source.slice(start, index));
      continue;
    }
    const previous = tokens.at(-1)?.value;
    if (character === "/" && ["=", "(", "[", "{", ",", ":", "return", "=>"].includes(previous)) {
      index += 1;
      let inClass = false;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === "[") {
          inClass = true;
          index += 1;
        } else if (source[index] === "]") {
          inClass = false;
          index += 1;
        } else if (source[index] === "/" && !inClass) {
          index += 1;
          while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
          closed = true;
          break;
        } else index += 1;
      }
      if (!closed) errors.push("unterminated regular expression literal");
      push("regex", "<regex>");
      continue;
    }
    const punctuator = ["===", "!==", "=>", "??", "?.", "&&", "||", "==", "!=", "<=", ">="]
      .find((candidate) => source.startsWith(candidate, index)) ?? character;
    push("punctuator", punctuator);
    index += punctuator.length;
  }
  return { tokens, errors };
}

function sequenceIndex(tokens, sequence, from = 0) {
  outer: for (let start = from; start <= tokens.length - sequence.length; start += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      const expected = sequence[offset];
      const token = tokens[start + offset];
      if (typeof expected === "string") {
        if (token.kind === "string" || token.value !== expected) continue outer;
      } else if (token.kind !== expected.kind || token.value !== expected.value) continue outer;
    }
    return start;
  }
  return -1;
}

function yamlScalar(raw) {
  let value = "";
  let quote = null;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote) {
      value += character;
      if (character === quote && raw[index - 1] !== "\\") quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      value += character;
    } else if (character === "#" && (index === 0 || /\s/.test(raw[index - 1]))) break;
    else value += character;
  }
  value = value.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function parseWorkflowSteps(source) {
  const lines = source.split(/\r?\n/);
  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index].match(/^(\s*)-\s+(name|uses|run|working-directory):\s*(.*)$/);
    if (!first || first[1].length < 4) continue;
    const itemIndent = first[1].length;
    const step = {};
    const assign = (key, raw, lineIndex, keyIndent) => {
      const scalar = yamlScalar(raw);
      if (!["|", "|-", "|+", ">", ">-", ">+"].includes(scalar)) {
        step[key] = scalar;
        return lineIndex;
      }
      const block = [];
      let cursor = lineIndex + 1;
      for (; cursor < lines.length; cursor += 1) {
        const indent = lines[cursor].match(/^\s*/)[0].length;
        if (lines[cursor].trim() && indent <= keyIndent) break;
        if (indent > keyIndent) block.push(lines[cursor].slice(keyIndent + 2));
      }
      step[key] = scalar.startsWith(">") ? block.join(" ").trim() : block.join("\n").trimEnd();
      return cursor - 1;
    };
    index = assign(first[2], first[3], index, itemIndent);
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const trimmed = lines[cursor].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = lines[cursor].match(/^\s*/)[0].length;
      if (indent <= itemIndent) break;
      const field = lines[cursor].match(/^\s+(name|uses|run|working-directory):\s*(.*)$/);
      if (field) cursor = assign(field[1], field[2], cursor, indent);
      index = cursor;
    }
    steps.push(step);
  }
  return steps;
}

export function validate(sources) {
  const failures = [];
  const identityScan = scanTypeScript(sources.identity);
  const supabaseScan = scanTypeScript(sources.supabase);
  if (identityScan.errors.length > 0) failures.push(`Explorer identity TypeScript scan failed: ${identityScan.errors.join(", ")}`);
  if (supabaseScan.errors.length > 0) failures.push(`Explorer Supabase TypeScript scan failed: ${supabaseScan.errors.join(", ")}`);
  const identityTokens = identityScan.tokens;
  const supabaseTokens = supabaseScan.tokens;
  const requireSequence = (tokens, sequence, label) => {
    if (sequenceIndex(tokens, sequence) < 0) failures.push(label);
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

  const platformRead = sequenceIndex(identityTokens, ["const", "platform", "=", "getNativeAppPlatform", "(", ")", ";"]);
  const webReturn = sequenceIndex(identityTokens, ["if", "(", "platform", "===", "null", ")", "return", "null", ";"], platformRead + 1);
  const primaryRead = sequenceIndex(identityTokens, [
    "if", "(", "isStrictSemver", "(", "Constants", ".", "nativeAppVersion", ")", ")", "{",
    "return", "Constants", ".", "nativeAppVersion", ";", "}",
  ], webReturn + 1);
  if (platformRead < 0 || webReturn < 0 || primaryRead < 0) {
    failures.push("web must exit before the executable primary native identity branch");
  }
  requireSequence(
    identityTokens,
    ["const", "expoConfigVersion", "=", "Constants", ".", "expoConfig", "?.", "version", ";"],
    "Release identity must retain the executable Expo config source",
  );
  requireSequence(
    identityTokens,
    [
      "if", "(", "isStrictSemver", "(", "expoConfigVersion", ")", ")", "{",
      "reportIdentityOutcome", "(", "platform", ",", literal("expo_config_fallback"), ")", ";",
      "return", "expoConfigVersion", ";", "}",
    ],
    "Release identity must retain the strict executable fallback and diagnostic",
  );
  requireSequence(
    identityTokens,
    ["reportIdentityOutcome", "(", "platform", ",", literal("unavailable"), ")", ";", "return", "null", ";"],
    "unavailable identity must retain its executable diagnostic",
  );
  requireSequence(
    identityTokens,
    ["let", "reportedFallback", "=", "false", ";"],
    "fallback diagnostic state must remain executable",
  );
  requireSequence(
    identityTokens,
    ["if", "(", "reportedFallback", ")", "return", ";", "reportedFallback", "=", "true", ";"],
    "fallback diagnostic must retain its executable once-only guard",
  );
  requireSequence(
    identityTokens,
    ["let", "reportedUnavailable", "=", "false", ";"],
    "unavailable diagnostic state must remain executable",
  );
  requireSequence(
    identityTokens,
    ["if", "(", "reportedUnavailable", ")", "return", ";", "reportedUnavailable", "=", "true", ";"],
    "unavailable diagnostic must retain its executable once-only guard",
  );
  requireSequence(
    identityTokens,
    ["console", ".", "warn", "(", literal("[app-version-identity]"), ",", "{"],
    "identity diagnostic must retain its executable console transport",
  );
  requireSequence(
    identityTokens,
    ["appId", ":", "APP_VERSION_APP_ID", ",", "platform", ",", "outcome", ",", "severity", ":", "outcome", "===", literal("unavailable"), "?", literal("error"), ":", literal("warning")],
    "identity diagnostic must retain its fixed sanitized fields",
  );
  requireSequence(
    identityTokens,
    [literal("X-Mingla-App-Version"), ":", "getInstalledNativeVersion", "(", ")", "??", literal("")],
    "native header must use the executable installed-version resolver",
  );
  requireSequence(
    supabaseTokens,
    ["global", ":", "{", "fetch", ":", "fetchWithTimeout", ",", "headers", ":", "getNativeAppVersionHeaders", "(", ")"],
    "shared Explorer Supabase client must retain the executable global header owner",
  );
  requireSequence(
    identityTokens,
    ["outcome", ":", literal("expo_config_fallback"), "|", literal("unavailable")],
    "identity diagnostic outcome contract must remain bounded",
  );
  requireSequence(
    identityTokens,
    ["if", "(", "isStrictSemver", "(", "Constants", ".", "nativeAppVersion", ")", ")"],
    "nativeAppVersion must remain the primary strict identity",
  );
  if (sequenceIndex(identityTokens, ["if", "(", "__DEV__", "&&", "isStrictSemver", "(", "expoConfigVersion", ")"]) >= 0) {
    failures.push("Expo config fallback must not be development-only");
  }
  const relativeImport = identityTokens.some((token, index) =>
    token.value === "import" && identityTokens.slice(index + 1, index + 12)
      .some((candidate) => candidate.kind === "string" && candidate.value.startsWith(".")),
  );
  if (relativeImport) {
    failures.push("identity resolver must not add a relative import");
  }

  const workflowSteps = parseWorkflowSteps(sources.workflow);
  const exactStepCount = (command) => workflowSteps.filter(
    (step) => step["working-directory"] === "app-mobile" && step.run === command,
  ).length;
  if (exactStepCount(implementorCommand) !== 1) {
    failures.push("Class D must invoke the implementor test once by exact active filename");
  }
  if (workflowSteps.some((step) => typeof step.run === "string" && /issue_2443_explorer_native_identity[^\n]*\*/.test(step.run))) {
    failures.push("#2443 Class D wiring must not rely on a wildcard");
  }
  if (sources.testerExists && exactStepCount(testerCommand) !== 1) {
    failures.push("Class D must invoke the tester test once by exact active filename");
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
    [
      "comment-forged primary identity",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (isStrictSemver(Constants.nativeAppVersion)) {",
          "// isStrictSemver(Constants.nativeAppVersion)\n  if (false) {",
        ),
      },
    ],
    [
      "comment-forged Release fallback",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (isStrictSemver(expoConfigVersion)) {",
          "// if (isStrictSemver(expoConfigVersion)) {\n  if (false) {",
        ),
      },
    ],
    [
      "comment-forged web exclusion",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (platform === null) return null;",
          "// if (platform === null) return null;",
        ),
      },
    ],
    [
      "comment-forged fallback diagnostic",
      {
        ...sources,
        identity: sources.identity.replace(
          'reportIdentityOutcome(platform, "expo_config_fallback");',
          '// reportIdentityOutcome(platform, "expo_config_fallback");',
        ),
      },
    ],
    [
      "comment-forged fallback once guard",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (reportedFallback) return;",
          "// if (reportedFallback) return;",
        ),
      },
    ],
    [
      "comment-forged unavailable diagnostic",
      {
        ...sources,
        identity: sources.identity.replace(
          'reportIdentityOutcome(platform, "unavailable");',
          '// reportIdentityOutcome(platform, "unavailable");',
        ),
      },
    ],
    [
      "comment-forged diagnostic transport",
      {
        ...sources,
        identity: sources.identity.replace(
          'console.warn("[app-version-identity]", {',
          '// console.warn("[app-version-identity]", {',
        ),
      },
    ],
    [
      "comment-forged native version header",
      {
        ...sources,
        identity: sources.identity.replace(
          '"X-Mingla-App-Version": getInstalledNativeVersion() ?? "",',
          '// "X-Mingla-App-Version": getInstalledNativeVersion() ?? "",',
        ),
      },
    ],
    [
      "comment-forged Supabase header owner",
      {
        ...sources,
        supabase: sources.supabase.replace(
          "headers: getNativeAppVersionHeaders()",
          "// headers: getNativeAppVersionHeaders()",
        ),
      },
    ],
    [
      "comment-forged implementor Class D command",
      {
        ...sources,
        workflow: sources.workflow.replace(
          implementorCommand,
          `# ${implementorCommand}`,
        ),
      },
    ],
    [
      "comment-forged tester Class D command",
      {
        ...sources,
        workflow: sources.workflow.replace(
          testerCommand,
          `# ${testerCommand}`,
        ),
      },
    ],
  ];
  for (const [label, mutated] of mutations) {
    if (validate(mutated).length === 0) {
      throw new Error(`self-test failed: ${label} mutation passed`);
    }
  }
  console.log("#2443 Explorer native-identity strict gate self-test: 27/27 + downstream fixture PASS");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
