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

function matchingToken(tokens, start, open, close, limit = tokens.length) {
  if (tokens[start]?.value !== open) return -1;
  let depth = 0;
  for (let index = start; index < limit; index += 1) {
    if (tokens[index].value === open) depth += 1;
    else if (tokens[index].value === close && --depth === 0) return index;
  }
  return -1;
}

function namedFunctionRange(tokens, name) {
  const matches = [];
  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (tokens[index].value !== "function" || tokens[index + 1].value !== name || tokens[index + 2].value !== "(") continue;
    const parametersEnd = matchingToken(tokens, index + 2, "(", ")");
    if (parametersEnd < 0) continue;
    let bodyStart = parametersEnd + 1;
    while (bodyStart < tokens.length && tokens[bodyStart].value !== "{" && tokens[bodyStart].value !== ";") bodyStart += 1;
    if (tokens[bodyStart]?.value !== "{") continue;
    const bodyEnd = matchingToken(tokens, bodyStart, "{", "}");
    if (bodyEnd >= 0) matches.push({ start: bodyStart + 1, end: bodyEnd });
  }
  return matches.length === 1 ? matches[0] : null;
}

function staticallyFalse(tokens, start, end) {
  const values = tokens.slice(start, end).map((token) => token.value);
  return (values.length === 1 && ["false", "0", "null", "undefined"].includes(values[0])) ||
    (values.length === 2 && values[0] === "!" && values[1] === "true");
}

function deadControlFlowRanges(tokens, start, end) {
  const ranges = [];
  for (let index = start; index < end; index += 1) {
    if (tokens[index].value !== "if" || tokens[index + 1]?.value !== "(") continue;
    const conditionEnd = matchingToken(tokens, index + 1, "(", ")", end);
    if (conditionEnd < 0 || !staticallyFalse(tokens, index + 2, conditionEnd)) continue;
    if (tokens[conditionEnd + 1]?.value === "{") {
      const blockEnd = matchingToken(tokens, conditionEnd + 1, "{", "}", end);
      if (blockEnd >= 0) ranges.push({ start: conditionEnd + 2, end: blockEnd });
    } else {
      let statementEnd = conditionEnd + 1;
      while (statementEnd < end && tokens[statementEnd].value !== ";") statementEnd += 1;
      ranges.push({ start: conditionEnd + 1, end: Math.min(statementEnd + 1, end) });
    }
  }
  return ranges;
}

function reachableSequenceIndex(tokens, sequence, range) {
  if (!range) return -1;
  const dead = deadControlFlowRanges(tokens, range.start, range.end);
  let index = sequenceIndex(tokens, sequence, range.start);
  while (index >= 0 && index + sequence.length <= range.end) {
    if (!dead.some((candidate) => index >= candidate.start && index < candidate.end)) return index;
    index = sequenceIndex(tokens, sequence, index + 1);
  }
  return -1;
}

function reachableReturnedObjectHas(tokens, owner, sequence) {
  if (!owner) return false;
  const dead = deadControlFlowRanges(tokens, owner.start, owner.end);
  for (let index = owner.start; index < owner.end; index += 1) {
    if (tokens[index].value !== "return" || tokens[index + 1]?.value !== "{") continue;
    if (dead.some((candidate) => index >= candidate.start && index < candidate.end)) continue;
    const objectEnd = matchingToken(tokens, index + 1, "{", "}", owner.end);
    if (objectEnd < 0) continue;
    const found = sequenceIndex(tokens, sequence, index + 2);
    if (found >= 0 && found + sequence.length <= objectEnd) return true;
  }
  return false;
}

function createClientOptionsRange(tokens) {
  const declaration = sequenceIndex(tokens, ["export", "const", "supabase", "=", "createClient", "("]);
  if (declaration < 0) return null;
  const open = declaration + 5;
  const close = matchingToken(tokens, open, "(", ")");
  if (close < 0) return null;
  const argumentStarts = [open + 1];
  const stack = [];
  for (let index = open + 1; index < close; index += 1) {
    if (["(", "[", "{"].includes(tokens[index].value)) stack.push(tokens[index].value);
    else if ([")", "]", "}"].includes(tokens[index].value)) stack.pop();
    else if (tokens[index].value === "," && stack.length === 0) argumentStarts.push(index + 1);
  }
  if (argumentStarts.length !== 3 || tokens[argumentStarts[2]]?.value !== "{") return null;
  const objectEnd = matchingToken(tokens, argumentStarts[2], "{", "}", close);
  return objectEnd < 0 ? null : { start: argumentStarts[2] + 1, end: objectEnd };
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

function parseWorkflowSteps(source, intendedJob) {
  const lines = source.split(/\r?\n/);
  const steps = [];
  const jobsLine = lines.findIndex((line) => line === "jobs:");
  if (jobsLine < 0) return steps;
  let jobStart = -1;
  let jobEnd = lines.length;
  for (let index = jobsLine + 1; index < lines.length; index += 1) {
    const job = lines[index].match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (!job) continue;
    if (jobStart >= 0) {
      jobEnd = index;
      break;
    }
    if (job[1] === intendedJob) jobStart = index;
  }
  if (jobStart < 0) return steps;
  const stepsLine = lines.findIndex((line, index) => index > jobStart && index < jobEnd && /^    steps:\s*(?:#.*)?$/.test(line));
  if (stepsLine < 0) return steps;
  for (let index = stepsLine + 1; index < jobEnd; index += 1) {
    const first = lines[index].match(/^(      )-\s+(name|uses|run|working-directory|if):\s*(.*)$/);
    if (!first) continue;
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
      const field = lines[cursor].match(/^        (name|uses|run|working-directory|if):\s*(.*)$/);
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
  const installedVersionOwner = namedFunctionRange(identityTokens, "getInstalledNativeVersion");
  const headerOwner = namedFunctionRange(identityTokens, "getNativeAppVersionHeaders");
  const diagnosticOwner = namedFunctionRange(identityTokens, "reportIdentityOutcome");
  const requireSequence = (tokens, sequence, label) => {
    if (sequenceIndex(tokens, sequence) < 0) failures.push(label);
  };
  const requireOwnedSequence = (tokens, sequence, owner, label) => {
    if (reachableSequenceIndex(tokens, sequence, owner) < 0) failures.push(label);
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

  const platformRead = reachableSequenceIndex(identityTokens, ["const", "platform", "=", "getNativeAppPlatform", "(", ")", ";"], installedVersionOwner);
  const webReturn = reachableSequenceIndex(identityTokens, ["if", "(", "platform", "===", "null", ")", "return", "null", ";"], installedVersionOwner);
  const primaryRead = reachableSequenceIndex(identityTokens, [
    "if", "(", "isStrictSemver", "(", "Constants", ".", "nativeAppVersion", ")", ")", "{",
    "return", "Constants", ".", "nativeAppVersion", ";", "}",
  ], installedVersionOwner);
  if (platformRead < 0 || webReturn < platformRead || primaryRead < webReturn) {
    failures.push("web must exit before the executable primary native identity branch");
  }
  requireOwnedSequence(
    identityTokens,
    ["const", "expoConfigVersion", "=", "Constants", ".", "expoConfig", "?.", "version", ";"],
    installedVersionOwner,
    "Release identity must retain the executable Expo config source",
  );
  requireOwnedSequence(
    identityTokens,
    [
      "if", "(", "isStrictSemver", "(", "expoConfigVersion", ")", ")", "{",
      "reportIdentityOutcome", "(", "platform", ",", literal("expo_config_fallback"), ")", ";",
      "return", "expoConfigVersion", ";", "}",
    ],
    installedVersionOwner,
    "Release identity must retain the strict executable fallback and diagnostic",
  );
  requireOwnedSequence(
    identityTokens,
    ["reportIdentityOutcome", "(", "platform", ",", literal("unavailable"), ")", ";", "return", "null", ";"],
    installedVersionOwner,
    "unavailable identity must retain its executable diagnostic",
  );
  requireSequence(
    identityTokens,
    ["let", "reportedFallback", "=", "false", ";"],
    "fallback diagnostic state must remain executable",
  );
  requireOwnedSequence(
    identityTokens,
    ["if", "(", "reportedFallback", ")", "return", ";", "reportedFallback", "=", "true", ";"],
    diagnosticOwner,
    "fallback diagnostic must retain its executable once-only guard",
  );
  requireSequence(
    identityTokens,
    ["let", "reportedUnavailable", "=", "false", ";"],
    "unavailable diagnostic state must remain executable",
  );
  requireOwnedSequence(
    identityTokens,
    ["if", "(", "reportedUnavailable", ")", "return", ";", "reportedUnavailable", "=", "true", ";"],
    diagnosticOwner,
    "unavailable diagnostic must retain its executable once-only guard",
  );
  requireOwnedSequence(
    identityTokens,
    ["console", ".", "warn", "(", literal("[app-version-identity]"), ",", "{"],
    diagnosticOwner,
    "identity diagnostic must retain its executable console transport",
  );
  requireOwnedSequence(
    identityTokens,
    ["appId", ":", "APP_VERSION_APP_ID", ",", "platform", ",", "outcome", ",", "severity", ":", "outcome", "===", literal("unavailable"), "?", literal("error"), ":", literal("warning")],
    diagnosticOwner,
    "identity diagnostic must retain its fixed sanitized fields",
  );
  if (!reachableReturnedObjectHas(
    identityTokens,
    headerOwner,
    [literal("X-Mingla-App-Version"), ":", "getInstalledNativeVersion", "(", ")", "??", literal("")],
  )) failures.push("native header must use the executable installed-version resolver in the live returned header object");
  const supabaseOptions = createClientOptionsRange(supabaseTokens);
  if (reachableSequenceIndex(
    supabaseTokens,
    ["global", ":", "{", "fetch", ":", "fetchWithTimeout", ",", "headers", ":", "getNativeAppVersionHeaders", "(", ")"],
    supabaseOptions,
  ) < 0) failures.push("shared Explorer Supabase client must retain the executable global header owner in its actual createClient options");
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

  const workflowSteps = parseWorkflowSteps(sources.workflow, "jest-suites");
  const exactStepCount = (name, command) => workflowSteps.filter(
    (step) => step.name === name && step["working-directory"] === "app-mobile" &&
      step.run === command && step.uses === undefined && step.if === undefined,
  ).length;
  if (exactStepCount("Issue #2443: Explorer release native identity", implementorCommand) !== 1) {
    failures.push("Class D must invoke the implementor test once by exact active filename");
  }
  if (workflowSteps.some((step) => typeof step.run === "string" && /issue_2443_explorer_native_identity[^\n]*\*/.test(step.run))) {
    failures.push("#2443 Class D wiring must not rely on a wildcard");
  }
  if (sources.testerExists && exactStepCount("Issue #2443: adversarial Explorer native identity", testerCommand) !== 1) {
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
    [
      "dead primary branch ownership",
      {
        ...sources,
        identity: sources.identity.replace(
          "  if (isStrictSemver(Constants.nativeAppVersion)) {\n    return Constants.nativeAppVersion;\n  }",
          "  if (false) {\n    if (isStrictSemver(Constants.nativeAppVersion)) {\n      return Constants.nativeAppVersion;\n    }\n  }",
        ),
      },
    ],
    [
      "unused forged native header owner",
      {
        ...sources,
        identity: sources.identity.replace(
          '    "X-Mingla-App-Version": getInstalledNativeVersion() ?? "",\n',
          "",
        ) + '\nfunction unusedForgedHeader() { return { "X-Mingla-App-Version": getInstalledNativeVersion() ?? "" }; }\n',
      },
    ],
    [
      "unused forged Supabase options owner",
      {
        ...sources,
        supabase: sources.supabase.replace(
          "    headers: getNativeAppVersionHeaders(),",
          "    headers: {},",
        ) + "\nfunction unusedForgedOptions() { return { global: { fetch: fetchWithTimeout, headers: getNativeAppVersionHeaders() } }; }\n",
      },
    ],
    [
      "Class D command nested under uses input",
      {
        ...sources,
        workflow: sources.workflow.replace(
          `      - name: "Issue #2443: Explorer release native identity"\n        working-directory: app-mobile\n        run: ${implementorCommand}`,
          `      - name: "Issue #2443: Explorer release native identity"\n        uses: actions/github-script@v7\n        with:\n          working-directory: app-mobile\n          run: ${implementorCommand}`,
        ),
      },
    ],
    [
      "disabled Class D command",
      {
        ...sources,
        workflow: sources.workflow.replace(
          `      - name: "Issue #2443: Explorer release native identity"\n        working-directory: app-mobile`,
          `      - name: "Issue #2443: Explorer release native identity"\n        if: false\n        working-directory: app-mobile`,
        ),
      },
    ],
  ];
  for (const [label, mutated] of mutations) {
    if (validate(mutated).length === 0) {
      throw new Error(`self-test failed: ${label} mutation passed`);
    }
  }
  console.log("#2443 Explorer native-identity strict gate self-test: 32/32 + downstream fixture PASS");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
