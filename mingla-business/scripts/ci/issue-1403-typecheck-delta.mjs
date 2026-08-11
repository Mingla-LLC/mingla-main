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
  "app/insights/[id].tsx",
  "app/event/[id]/index.tsx",
  "app/trip/[id]/index.tsx",
  "app/experience/[id]/index.tsx",
  "app/rsvp/[id]/index.tsx",
  "src/components/event/ActionTile.tsx",
  "src/components/offering/offeringDashboardTiles.ts",
  "src/services/listingInsightsService.ts",
  "src/services/__tests__/listingInsightsService.issue1403.test.ts",
  "src/services/reservationMetricsService.ts",
  "src/services/__tests__/reservationMetricsService.issue1403.test.ts",
  "src/hooks/useListingInsights.ts",
  "src/hooks/__tests__/useListingInsights.issue1403.test.tsx",
  "src/hooks/useVenueReservationMetrics.ts",
  "src/hooks/__tests__/useVenueReservationMetrics.issue1403.test.tsx",
  "src/analytics/businessAnalyticsEvents.ts",
  "src/analytics/__tests__/businessAnalyticsEvents.issue1403.test.ts",
  "src/components/analytics/ListingInsightsScreen.tsx",
  "src/components/analytics/__tests__/ListingInsightsScreen.issue1403.render.test.tsx",
  "src/components/analytics/__tests__/ListingInsightsScreen.issue1403.web.render.test.tsx",
  "src/components/analytics/__tests__/listingInsightsRoleGate.issue1403.adversarial.test.ts",
  "src/components/venue/VenueReservationsCard.tsx",
  "src/components/venue/__tests__/VenueReservationsCard.issue1403.render.test.tsx",
  "src/components/venue/VenueIntelligenceModule.tsx",
]);
const PRIMARY = /^(.*)\((\d+),(\d+)\): error TS(\d+):(?:\s?(.*))$/;
const QUOTED_STRING_UNION =
  /"(?:\\.|[^"\\])*"(?: \| "(?:\\.|[^"\\])*")+/g;

const slashes = (value) => value.replaceAll("\\", "/");

const canonicalizeQuotedStringUnions = (message) =>
  message.replace(QUOTED_STRING_UNION, (union) =>
    union.split(" | ").sort().join(" | "),
  );

const normalizePath = (raw, businessRoot) =>
  slashes(
    path.relative(
      businessRoot,
      path.isAbsolute(raw) ? raw : path.resolve(businessRoot, raw),
    ),
  );

const normalizeMessage = (
  lines,
  repoRoot,
  businessRoot,
  alternateRoots = [],
) => {
  let normalized = lines.join("\n").replaceAll("\\", "/");
  for (const root of [
    businessRoot,
    ...alternateRoots.map((item) => item.businessRoot),
  ]) {
    normalized = normalized.replaceAll(`${slashes(root)}/`, "<business>/");
  }
  for (const root of [
    repoRoot,
    ...alternateRoots.map((item) => item.repoRoot),
  ]) {
    normalized = normalized.replaceAll(`${slashes(root)}/`, "<repo>/");
  }
  return canonicalizeQuotedStringUnions(
    normalized.replace(/\(\d+,\d+\)/g, "(line,column)").trimEnd(),
  );
};

export function parseDiagnostics(
  output,
  repoRoot,
  businessRoot,
  alternateRoots = [],
) {
  const lines = output.replaceAll("\r\n", "\n").split("\n");
  const diagnostics = [];
  const parsedIndexes = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const match = PRIMARY.exec(lines[index]);
    if (match === null) continue;
    parsedIndexes.add(index);
    const messageLines = [match[5] ?? ""];
    let cursor = index + 1;
    while (cursor < lines.length && PRIMARY.exec(lines[cursor]) === null) {
      if (lines[cursor].includes("error TS")) break;
      messageLines.push(lines[cursor]);
      cursor += 1;
    }
    diagnostics.push({
      path: normalizePath(match[1], businessRoot),
      code: `TS${match[4]}`,
      message: normalizeMessage(
        messageLines,
        repoRoot,
        businessRoot,
        alternateRoots,
      ),
    });
    index = cursor - 1;
  }
  return {
    diagnostics,
    unparsedErrorLines: lines.filter(
      (line, index) => line.includes("error TS") && !parsedIndexes.has(index),
    ),
  };
}

const signature = (diagnostic) =>
  `${diagnostic.path}\u0000${diagnostic.code}\u0000${diagnostic.message}`;

const multiset = (diagnostics) => {
  const result = new Map();
  for (const diagnostic of diagnostics) {
    const key = signature(diagnostic);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
};

export function compareDiagnostics(base, current) {
  const failures = [];
  if (base.unparsedErrorLines.length > 0) {
    failures.push("base compiler output contains unparsed TypeScript errors");
  }
  if (current.unparsedErrorLines.length > 0) {
    failures.push("current compiler output contains unparsed TypeScript errors");
  }
  const baseCounts = multiset(base.diagnostics);
  const currentCounts = multiset(current.diagnostics);
  const added = [];
  const removed = [];
  for (const [key, count] of currentCounts) {
    const growth = count - (baseCounts.get(key) ?? 0);
    if (growth > 0) added.push({ signature: key, count: growth });
  }
  for (const [key, count] of baseCounts) {
    const reduction = count - (currentCounts.get(key) ?? 0);
    if (reduction > 0) removed.push({ signature: key, count: reduction });
  }
  if (added.length > 0) {
    failures.push(
      `${added.reduce((sum, item) => sum + item.count, 0)} added diagnostic instance(s)`,
    );
  }
  const targetDiagnostics = current.diagnostics.filter((diagnostic) =>
    TARGETS.has(diagnostic.path),
  );
  if (targetDiagnostics.length > 0) {
    failures.push(
      `${targetDiagnostics.length} diagnostic(s) touch exact issue #1403 targets`,
    );
  }
  return { failures, added, removed, targetDiagnostics };
}

const synthetic = (file, code, message, copies = 1) =>
  Array.from(
    { length: copies },
    (_, index) => `${file}(${index + 1},2): error ${code}: ${message}`,
  ).join("\n");

const selfTest = () => {
  const repo = "/synthetic/repo";
  const business = `${repo}/mingla-business`;
  const parse = (log) => parseDiagnostics(log, repo, business);
  const baseline = synthetic("src/legacy.ts", "TS2322", "Legacy mismatch");
  const orderedUnion = synthetic(
    "src/legacy.ts",
    "TS2322",
    'Type string is not assignable to type "error" | "loading" | "ready".',
  );
  const reorderedUnion = synthetic(
    "src/legacy.ts",
    "TS2322",
    'Type string is not assignable to type "error" | "ready" | "loading".',
  );
  const orderOnly = compareDiagnostics(parse(orderedUnion), parse(reorderedUnion));
  const memberChanged = compareDiagnostics(
    parse(orderedUnion),
    parse(
      synthetic(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type "error" | "loaded" | "ready".',
      ),
    ),
  );
  const duplicateGrowthAfterNormalization = compareDiagnostics(
    parse(orderedUnion),
    parse(
      synthetic(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type "ready" | "error" | "loading".',
        2,
      ),
    ),
  );
  const nonStringOrderChange = compareDiagnostics(
    parse(
      synthetic(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type "error" | undefined.',
      ),
    ),
    parse(
      synthetic(
        "src/legacy.ts",
        "TS2322",
        'Type string is not assignable to type undefined | "error".',
      ),
    ),
  );
  const targetAfterNormalization = compareDiagnostics(
    parse(
      synthetic(
        "src/services/listingInsightsService.ts",
        "TS2322",
        'Type string is not assignable to type "error" | "loading" | "ready".',
      ),
    ),
    parse(
      synthetic(
        "src/services/listingInsightsService.ts",
        "TS2322",
        'Type string is not assignable to type "ready" | "error" | "loading".',
      ),
    ),
  );
  const cases = [
    compareDiagnostics(parse(baseline), parse(baseline)).failures.length === 0,
    compareDiagnostics(parse(baseline), parse("")).failures.length === 0,
    compareDiagnostics(
      parse(""),
      parse(
        synthetic(
          "src/services/listingInsightsService.ts",
          "TS2322",
          "Target mismatch",
        ),
      ),
    ).failures.length > 0,
    compareDiagnostics(
      parse(""),
      parse(synthetic("src/unrelated.ts", "TS2345", "Unrelated growth")),
    ).failures.length > 0,
    compareDiagnostics(
      parse(baseline),
      parse(synthetic("src/legacy.ts", "TS2322", "Legacy mismatch", 2)),
    ).failures.length > 0,
    compareDiagnostics(
      parse(""),
      parse("error TS5083: Cannot read file 'missing-tsconfig.json'."),
    ).failures.length > 0,
    compareDiagnostics(
      parseDiagnostics(
        synthetic(
          "src/legacy.ts",
          "TS7016",
          "Types resolved from /current/repo/mingla-business/node_modules/pkg/index.js",
        ),
        "/base/repo",
        "/base/repo/mingla-business",
        [
          {
            repoRoot: "/current/repo",
            businessRoot: "/current/repo/mingla-business",
          },
        ],
      ),
      parseDiagnostics(
        synthetic(
          "src/legacy.ts",
          "TS7016",
          "Types resolved from /current/repo/mingla-business/node_modules/pkg/index.js",
        ),
        "/current/repo",
        "/current/repo/mingla-business",
      ),
    ).failures.length === 0,
    orderOnly.failures.length === 0 &&
      orderOnly.added.length === 0 &&
      orderOnly.removed.length === 0,
    memberChanged.failures.length > 0 &&
      memberChanged.added.reduce((sum, item) => sum + item.count, 0) === 1 &&
      memberChanged.removed.reduce((sum, item) => sum + item.count, 0) === 1,
    duplicateGrowthAfterNormalization.failures.length > 0 &&
      duplicateGrowthAfterNormalization.added.reduce(
        (sum, item) => sum + item.count,
        0,
      ) === 1,
    nonStringOrderChange.failures.length > 0 &&
      nonStringOrderChange.added.length === 1 &&
      nonStringOrderChange.removed.length === 1,
    targetAfterNormalization.failures.length > 0 &&
      targetAfterNormalization.added.length === 0 &&
      targetAfterNormalization.removed.length === 0 &&
      targetAfterNormalization.targetDiagnostics.length === 1,
  ];
  if (cases.some((passed) => !passed)) {
    console.error("issue #1403 typecheck delta self-test FAIL");
    return 1;
  }
  console.log("issue #1403 typecheck delta self-test PASS (12/12 cases)");
  return 0;
};

const runCompiler = (businessRoot) => {
  const run = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
    cwd: businessRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: process.env,
  });
  if (run.error !== undefined) throw run.error;
  return {
    exitCode: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  };
};

const validateRun = (name, run, parsed) => {
  if (run.exitCode !== 0 && run.exitCode !== 2) {
    throw new Error(`${name} compiler exited ${String(run.exitCode)}`);
  }
  if (run.exitCode === 2 && parsed.diagnostics.length === 0) {
    throw new Error(`${name} compiler exited 2 without a parsed path diagnostic`);
  }
};

const writeEvidence = (dir, name, run) => {
  fs.writeFileSync(path.join(dir, `${name}.stdout.log`), run.stdout);
  fs.writeFileSync(path.join(dir, `${name}.stderr.log`), run.stderr);
  fs.writeFileSync(
    path.join(dir, `${name}.combined.log`),
    `${run.stdout}${run.stderr}`,
  );
  fs.writeFileSync(
    path.join(dir, `${name}.exit-code.txt`),
    `${String(run.exitCode)}\n`,
  );
};

const argument = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
};

const compare = (baseRef, outputArg) => {
  const baseSha = execFileSync(
    "git",
    ["rev-parse", "--verify", `${baseRef}^{commit}`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
  const outputDir = path.isAbsolute(outputArg)
    ? outputArg
    : path.resolve(REPO_ROOT, outputArg);
  fs.mkdirSync(outputDir, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "issue1403-typecheck-"));
  const baseRoot = path.join(tempRoot, "base");
  let addedWorktree = false;
  try {
    execFileSync("git", ["worktree", "add", "--detach", baseRoot, baseSha], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    addedWorktree = true;
    const baseBusiness = path.join(baseRoot, "mingla-business");
    const nodeModules = path.join(BUSINESS_ROOT, "node_modules");
    if (!fs.existsSync(nodeModules)) {
      throw new Error("current mingla-business/node_modules is missing");
    }
    fs.symlinkSync(nodeModules, path.join(baseBusiness, "node_modules"), "dir");
    const currentRun = runCompiler(BUSINESS_ROOT);
    const baseRun = runCompiler(baseBusiness);
    writeEvidence(outputDir, "current", currentRun);
    writeEvidence(outputDir, "base", baseRun);
    const currentParsed = parseDiagnostics(
      `${currentRun.stdout}${currentRun.stderr}`,
      REPO_ROOT,
      BUSINESS_ROOT,
      [{ repoRoot: baseRoot, businessRoot: baseBusiness }],
    );
    const baseParsed = parseDiagnostics(
      `${baseRun.stdout}${baseRun.stderr}`,
      baseRoot,
      baseBusiness,
      [{ repoRoot: REPO_ROOT, businessRoot: BUSINESS_ROOT }],
    );
    validateRun("current", currentRun, currentParsed);
    validateRun("base", baseRun, baseParsed);
    const result = compareDiagnostics(baseParsed, currentParsed);
    const summary = {
      baseRef,
      baseSha,
      baseExit: baseRun.exitCode,
      currentExit: currentRun.exitCode,
      baseDiagnostics: baseParsed.diagnostics.length,
      currentDiagnostics: currentParsed.diagnostics.length,
      added: result.added.reduce((sum, item) => sum + item.count, 0),
      removed: result.removed.reduce((sum, item) => sum + item.count, 0),
      targetDiagnostics: result.targetDiagnostics.length,
      failures: result.failures,
    };
    fs.writeFileSync(
      path.join(outputDir, "comparison-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    const incomplete = path.join(outputDir, "INCOMPLETE.txt");
    if (fs.existsSync(incomplete)) fs.unlinkSync(incomplete);
    console.log(JSON.stringify(summary));
    if (result.failures.length > 0) {
      result.failures.forEach((failure) => console.error(`FAIL: ${failure}`));
      return 1;
    }
    console.log("issue #1403 typecheck delta PASS");
    return 0;
  } finally {
    if (addedWorktree) {
      execFileSync("git", ["worktree", "remove", "--force", baseRoot], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

const main = () => {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--self-test") {
    process.exit(selfTest());
  }
  const base = argument(argv, "--base");
  const output = argument(argv, "--output-dir");
  if (base === null || output === null || argv.length !== 4) {
    console.error(
      "Usage: issue-1403-typecheck-delta.mjs --base <git-ref> --output-dir <dir>",
    );
    process.exit(1);
  }
  try {
    process.exit(compare(base, output));
  } catch (error) {
    console.error(`issue #1403 typecheck delta FAIL: ${error.message}`);
    process.exit(1);
  }
};

if (
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
