#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUSINESS_ROOT = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(BUSINESS_ROOT, "..");
const TARGETS = new Set([
  "app/(tabs)/_layout.tsx",
  "app/(tabs)/home.tsx",
  "app/(tabs)/analytics.tsx",
  "app/(tabs)/__tests__/analytics.issue874.tester.adversarial.render.test.tsx",
  "app/(tabs)/__tests__/home.issue874.render.test.tsx",
  "src/services/brandAnalyticsService.ts",
  "src/services/__tests__/brandAnalyticsService.issue874.test.ts",
  "src/services/__tests__/brandAnalyticsService.issue874.tester.adversarial.test.ts",
  "src/hooks/useBrandAnalytics.ts",
  "src/hooks/__tests__/useBrandAnalytics.issue874.test.tsx",
  "src/hooks/brandCache.ts",
  "src/hooks/__tests__/brandCache.issue874.test.ts",
  "src/hooks/useBrands.ts",
  "src/analytics/businessAnalyticsEvents.ts",
  "src/analytics/__tests__/businessAnalyticsEvents.issue874.test.ts",
  "src/components/home/AnalyticsHomeTile.tsx",
  "src/components/home/__tests__/AnalyticsHomeTile.issue874.render.test.tsx",
  "src/components/analytics/AnalyticsModuleState.tsx",
  "src/components/analytics/BrandAnalyticsScreen.tsx",
  "src/components/analytics/CustomerPatternsSection.tsx",
  "src/components/analytics/CustomersMinglaDroveSection.tsx",
  "src/components/analytics/RegularsSection.tsx",
  "src/components/analytics/__tests__/BrandAnalyticsScreen.issue874.render.test.tsx",
  "src/components/analytics/__tests__/BrandAnalyticsA11y.issue874.tester.adversarial.render.test.tsx",
  "src/components/analytics/__tests__/RegularsSection.issue874.render.test.tsx",
  "src/store/liveEventStore.ts",
  "src/utils/liveEventConverter.ts",
  "src/utils/__tests__/issue_0962_prebank_display_no_gbp.test.ts",
  "src/utils/__tests__/issue_0962_r5_adversarial_prebank_display.test.ts",
]);
const PRIMARY_DIAGNOSTIC =
  /^(.*)\((\d+),(\d+)\): error TS(\d+):(?:\s?(.*))$/;
const QUOTED_STRING_UNION =
  /"(?:\\.|[^"\\])*"(?: \| "(?:\\.|[^"\\])*")+/g;

function normalizeSlashes(value) {
  return value.replaceAll("\\", "/");
}

function canonicalizeQuotedStringUnions(message) {
  return message.replace(QUOTED_STRING_UNION, (union) =>
    union.split(" | ").sort().join(" | "),
  );
}

function normalizeMessage(lines, runRepoRoot, runBusinessRoot) {
  const businessPrefixes = new Set([
    `${normalizeSlashes(runBusinessRoot)}/`,
    `${normalizeSlashes(BUSINESS_ROOT)}/`,
  ]);
  const repoPrefixes = new Set([
    `${normalizeSlashes(runRepoRoot)}/`,
    `${normalizeSlashes(REPO_ROOT)}/`,
  ]);
  let normalized = lines
    .join("\n")
    .replaceAll("\\", "/")
    .replace(/\(\d+,\d+\)/g, "(line,column)");
  for (const prefix of businessPrefixes) {
    normalized = normalized.replaceAll(prefix, "<business>/");
  }
  for (const prefix of repoPrefixes) {
    normalized = normalized.replaceAll(prefix, "<repo>/");
  }
  return canonicalizeQuotedStringUnions(normalized.trimEnd());
}

function normalizePrimaryPath(rawPath, runBusinessRoot) {
  const absolute = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(runBusinessRoot, rawPath);
  return normalizeSlashes(path.relative(runBusinessRoot, absolute));
}

export function parseDiagnostics(output, runRepoRoot, runBusinessRoot) {
  const lines = output.replaceAll("\r\n", "\n").split("\n");
  const diagnostics = [];
  const primaryLineIndexes = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const match = PRIMARY_DIAGNOSTIC.exec(lines[index]);
    if (match === null) continue;
    primaryLineIndexes.add(index);
    const messageLines = [match[5] ?? ""];
    let cursor = index + 1;
    while (cursor < lines.length && PRIMARY_DIAGNOSTIC.exec(lines[cursor]) === null) {
      if (lines[cursor].includes("error TS")) break;
      messageLines.push(lines[cursor]);
      cursor += 1;
    }
    diagnostics.push({
      path: normalizePrimaryPath(match[1], runBusinessRoot),
      code: `TS${match[4]}`,
      message: normalizeMessage(messageLines, runRepoRoot, runBusinessRoot),
    });
    index = cursor - 1;
  }

  const unparsedErrorLines = lines.filter(
    (line, index) => line.includes("error TS") && !primaryLineIndexes.has(index),
  );
  return { diagnostics, unparsedErrorLines };
}

function signature(diagnostic) {
  return `${diagnostic.path}\u0000${diagnostic.code}\u0000${diagnostic.message}`;
}

function toMultiset(diagnostics) {
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    const key = signature(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function compareDiagnostics(baseParsed, currentParsed) {
  const failures = [];
  if (baseParsed.unparsedErrorLines.length > 0) {
    failures.push(
      `base output has ${baseParsed.unparsedErrorLines.length} unparsed error TS line(s)`,
    );
  }
  if (currentParsed.unparsedErrorLines.length > 0) {
    failures.push(
      `current output has ${currentParsed.unparsedErrorLines.length} unparsed error TS line(s)`,
    );
  }

  const baseCounts = toMultiset(baseParsed.diagnostics);
  const currentCounts = toMultiset(currentParsed.diagnostics);
  const added = [];
  const removed = [];
  for (const [key, currentCount] of currentCounts) {
    const baseCount = baseCounts.get(key) ?? 0;
    if (currentCount > baseCount) {
      added.push({ signature: key, count: currentCount - baseCount });
    }
  }
  for (const [key, baseCount] of baseCounts) {
    const currentCount = currentCounts.get(key) ?? 0;
    if (baseCount > currentCount) {
      removed.push({ signature: key, count: baseCount - currentCount });
    }
  }
  if (added.length > 0) {
    failures.push(
      `${added.reduce((sum, item) => sum + item.count, 0)} new diagnostic instance(s)`,
    );
  }

  const targetDiagnostics = currentParsed.diagnostics.filter((diagnostic) =>
    TARGETS.has(diagnostic.path),
  );
  if (targetDiagnostics.length > 0) {
    failures.push(
      `${targetDiagnostics.length} diagnostic(s) on exact issue #874 targets`,
    );
  }

  return { failures, added, removed, targetDiagnostics };
}

function syntheticLog(pathname, code, message, copies = 1) {
  return Array.from(
    { length: copies },
    (_, index) => `${pathname}(${index + 1},2): error ${code}: ${message}`,
  ).join("\n");
}

function runSelfTest() {
  const repo = "/synthetic/repo";
  const business = `${repo}/mingla-business`;
  const parse = (log) => parseDiagnostics(log, repo, business);
  const baseline = syntheticLog("src/legacy.ts", "TS2322", "Legacy mismatch");
  const orderedUnion = syntheticLog(
    "src/legacy.ts",
    "TS2322",
    'Type string is not assignable to type "error" | "loading" | "ready".',
  );
  const reorderedUnion = syntheticLog(
    "src/legacy.ts",
    "TS2322",
    'Type string is not assignable to type "error" | "ready" | "loading".',
  );
  const orderOnly = compareDiagnostics(parse(orderedUnion), parse(reorderedUnion));
  const memberChanged = compareDiagnostics(
    parse(orderedUnion),
    parse(
      syntheticLog(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type "error" | "loaded" | "ready".',
      ),
    ),
  );
  const duplicateGrowthAfterNormalization = compareDiagnostics(
    parse(orderedUnion),
    parse(
      syntheticLog(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type "ready" | "error" | "loading".',
        2,
      ),
    ),
  );
  const nonStringOrderChange = compareDiagnostics(
    parse(
      syntheticLog(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type "error" | undefined.',
      ),
    ),
    parse(
      syntheticLog(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type undefined | "error".',
      ),
    ),
  );
  const targetAfterNormalization = compareDiagnostics(
    parse(
      syntheticLog(
        "src/services/brandAnalyticsService.ts",
        "TS2322",
        'Type string is not assignable to type "error" | "loading" | "ready".',
      ),
    ),
    parse(
      syntheticLog(
        "src/services/brandAnalyticsService.ts",
        "TS2322",
        'Type string is not assignable to type "ready" | "error" | "loading".',
      ),
    ),
  );

  const cases = [
    {
      name: "unchanged diagnostics pass",
      passes: compareDiagnostics(parse(baseline), parse(baseline)).failures.length === 0,
    },
    {
      name: "removed diagnostics pass",
      passes: compareDiagnostics(parse(baseline), parse("")).failures.length === 0,
    },
    {
      name: "new target diagnostic fails",
      passes:
        compareDiagnostics(
          parse(""),
          parse(
            syntheticLog(
              "src/services/brandAnalyticsService.ts",
              "TS2322",
              "Target mismatch",
            ),
          ),
        ).failures.length > 0,
    },
    {
      name: "new unrelated diagnostic fails",
      passes:
        compareDiagnostics(
          parse(""),
          parse(syntheticLog("src/unrelated.ts", "TS2345", "New mismatch")),
        ).failures.length > 0,
    },
    {
      name: "duplicate diagnostic growth fails",
      passes:
        compareDiagnostics(
          parse(baseline),
          parse(syntheticLog("src/legacy.ts", "TS2322", "Legacy mismatch", 2)),
        ).failures.length > 0,
    },
    {
      name: "malformed compiler error output fails",
      passes:
        compareDiagnostics(
          parse(""),
          parse("error TS5083: Cannot read file 'missing-tsconfig.json'."),
        ).failures.length > 0,
    },
    {
      name: "quoted string union presentation order is canonicalized",
      passes:
        orderOnly.failures.length === 0 &&
        orderOnly.added.length === 0 &&
        orderOnly.removed.length === 0,
    },
    {
      name: "quoted string union member replacement remains a real delta",
      passes:
        memberChanged.failures.length > 0 &&
        memberChanged.added.reduce((sum, item) => sum + item.count, 0) === 1 &&
        memberChanged.removed.reduce((sum, item) => sum + item.count, 0) === 1,
    },
    {
      name: "duplicate growth still fails after union normalization",
      passes:
        duplicateGrowthAfterNormalization.failures.length > 0 &&
        duplicateGrowthAfterNormalization.added.reduce(
          (sum, item) => sum + item.count,
          0,
        ) === 1,
    },
    {
      name: "unions containing non-string members remain order-sensitive",
      passes:
        nonStringOrderChange.failures.length > 0 &&
        nonStringOrderChange.added.length === 1 &&
        nonStringOrderChange.removed.length === 1,
    },
    {
      name: "exact target diagnostics still fail after union normalization",
      passes:
        targetAfterNormalization.failures.length > 0 &&
        targetAfterNormalization.added.length === 0 &&
        targetAfterNormalization.removed.length === 0 &&
        targetAfterNormalization.targetDiagnostics.length === 1,
    },
  ];

  const failed = cases.filter((testCase) => !testCase.passes);
  if (failed.length > 0) {
    for (const testCase of failed) {
      console.error(`issue-874 typecheck delta self-test FAIL: ${testCase.name}`);
    }
    return 1;
  }
  console.log(
    `issue-874 typecheck delta self-test PASS (${cases.length} fail-closed cases).`,
  );
  return 0;
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
    return null;
  }
  return argv[index + 1];
}

function runCompiler(runBusinessRoot) {
  const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
    cwd: runBusinessRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: process.env,
  });
  if (result.error !== undefined) throw result.error;
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeRunEvidence(outputDir, name, run) {
  const files = new Map([
    [`${name}.stdout.log`, run.stdout],
    [`${name}.stderr.log`, run.stderr],
    [`${name}.combined.log`, `${run.stdout}${run.stderr}`],
    [`${name}.exit-code.txt`, `${String(run.exitCode)}\n`],
  ]);
  for (const [filename, content] of files) {
    const destination = path.join(outputDir, filename);
    fs.writeFileSync(destination, content);
    if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== content) {
      throw new Error(`incomplete compiler evidence file: ${filename}`);
    }
  }
}

function validateCompilerRun(name, run, parsed) {
  if (run.exitCode !== 0 && run.exitCode !== 2) {
    throw new Error(`${name} compiler exited ${String(run.exitCode)} (expected 0 or 2)`);
  }
  if (run.exitCode === 2 && parsed.diagnostics.length === 0) {
    throw new Error(`${name} compiler exited 2 without a parsed path diagnostic`);
  }
}

function formatAdded(item) {
  const [diagnosticPath, code, message] = item.signature.split("\u0000");
  return `${diagnosticPath} ${code} (${item.count} added): ${message}`;
}

function runComparison(baseRef, outputDirArg) {
  let resolvedBase;
  try {
    resolvedBase = execFileSync(
      "git",
      ["rev-parse", "--verify", `${baseRef}^{commit}`],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    throw new Error(`cannot resolve base ref: ${baseRef}`);
  }

  const outputDir = path.isAbsolute(outputDirArg)
    ? outputDirArg
    : path.resolve(REPO_ROOT, outputDirArg);
  fs.mkdirSync(outputDir, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "issue874-typecheck-"));
  const baseWorktree = path.join(tempRoot, "base");
  let worktreeAdded = false;

  try {
    execFileSync(
      "git",
      ["worktree", "add", "--detach", baseWorktree, resolvedBase],
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
    worktreeAdded = true;
    const baseBusinessRoot = path.join(baseWorktree, "mingla-business");
    const currentNodeModules = path.join(BUSINESS_ROOT, "node_modules");
    if (!fs.existsSync(currentNodeModules)) {
      throw new Error("current mingla-business/node_modules is missing");
    }
    fs.symlinkSync(currentNodeModules, path.join(baseBusinessRoot, "node_modules"), "dir");

    const currentRun = runCompiler(BUSINESS_ROOT);
    const baseRun = runCompiler(baseBusinessRoot);
    writeRunEvidence(outputDir, "current", currentRun);
    writeRunEvidence(outputDir, "base", baseRun);

    const currentOutput = `${currentRun.stdout}${currentRun.stderr}`;
    const baseOutput = `${baseRun.stdout}${baseRun.stderr}`;
    const currentParsed = parseDiagnostics(currentOutput, REPO_ROOT, BUSINESS_ROOT);
    const baseParsed = parseDiagnostics(baseOutput, baseWorktree, baseBusinessRoot);
    validateCompilerRun("current", currentRun, currentParsed);
    validateCompilerRun("base", baseRun, baseParsed);
    const comparison = compareDiagnostics(baseParsed, currentParsed);
    const summary = {
      baseRef,
      resolvedBase,
      baseExit: baseRun.exitCode,
      currentExit: currentRun.exitCode,
      baseDiagnostics: baseParsed.diagnostics.length,
      currentDiagnostics: currentParsed.diagnostics.length,
      removedDiagnostics: comparison.removed.reduce(
        (sum, item) => sum + item.count,
        0,
      ),
      addedDiagnostics: comparison.added.reduce(
        (sum, item) => sum + item.count,
        0,
      ),
      targetDiagnostics: comparison.targetDiagnostics.length,
      failures: comparison.failures,
    };
    fs.writeFileSync(
      path.join(outputDir, "comparison-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    const incompleteMarker = path.join(outputDir, "INCOMPLETE.txt");
    if (fs.existsSync(incompleteMarker)) fs.unlinkSync(incompleteMarker);

    console.log(
      `issue-874 typecheck delta: base exit=${String(summary.baseExit)} diagnostics=${summary.baseDiagnostics}; ` +
        `current exit=${String(summary.currentExit)} diagnostics=${summary.currentDiagnostics}; ` +
        `removed=${summary.removedDiagnostics}; added=${summary.addedDiagnostics}; ` +
        `target diagnostics=${summary.targetDiagnostics}.`,
    );
    if (comparison.failures.length > 0) {
      for (const failure of comparison.failures) console.error(`FAIL: ${failure}`);
      for (const added of comparison.added) console.error(formatAdded(added));
      return 1;
    }
    console.log("issue-874 typecheck delta PASS — full graph bounded; exact targets clean.");
    return 0;
  } finally {
    if (worktreeAdded) {
      try {
        execFileSync("git", ["worktree", "remove", "--force", baseWorktree], {
          cwd: REPO_ROOT,
          stdio: "pipe",
        });
      } catch (error) {
        console.error(`Failed to remove temporary worktree: ${error.message}`);
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--self-test") {
    process.exit(runSelfTest());
  }
  const baseRef = argumentValue(argv, "--base");
  const outputDir = argumentValue(argv, "--output-dir");
  if (
    baseRef === null ||
    outputDir === null ||
    argv.length !== 4 ||
    argv.some((arg) => arg.startsWith("--") && !["--base", "--output-dir"].includes(arg))
  ) {
    console.error(
      "Usage: issue-874-typecheck-delta.mjs --base <git-ref> --output-dir <dir>",
    );
    process.exit(1);
  }
  try {
    process.exit(runComparison(baseRef, outputDir));
  } catch (error) {
    console.error(`issue-874 typecheck delta FAIL: ${error.message}`);
    process.exit(1);
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
