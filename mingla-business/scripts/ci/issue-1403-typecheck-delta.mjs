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

// Keyed by signature; each entry keeps the diagnostic's own fields alongside
// the count so relocation matching can compare code/message/path structurally
// instead of re-splitting the packed signature string.
const multiset = (diagnostics) => {
  const result = new Map();
  for (const diagnostic of diagnostics) {
    const key = signature(diagnostic);
    const existing = result.get(key);
    if (existing === undefined) {
      result.set(key, {
        path: diagnostic.path,
        code: diagnostic.code,
        message: diagnostic.message,
        count: 1,
      });
      continue;
    }
    existing.count += 1;
  }
  return result;
};

const instances = (items) => items.reduce((sum, item) => sum + item.count, 0);

/**
 * Signatures are keyed on PATH, so moving a line of code from one file to
 * another registers the SAME pre-existing diagnostic as one removal plus one
 * addition. #1627 hit exactly this: an unresolvable
 * `react-native-keyboard-controller` import moved between two files inside
 * `packages/phone-input` and the run reported 765 -> 765, added 1 / removed 1,
 * with a byte-identical message. Net type-safety did not change; only the file
 * holding a pre-existing hole did.
 *
 * A relocation is recognised ONLY when ALL of the following hold:
 *
 *   1. The repo-wide diagnostic total did NOT grow. A net increase suspends
 *      the allowance entirely -- there is no partial cancellation, so real
 *      growth is always reported at full size.
 *      Pinned by RELOCATION-RED-NET-INCREASE.
 *   2. The added and removed diagnostics carry an IDENTICAL (already
 *      normalised) message. A changed message is a changed finding at any
 *      total.
 *      Pinned by RELOCATION-RED-NEW-DIAGNOSTIC, which deliberately reuses the
 *      origin's CODE so that only the message check can be keeping it red.
 *   3. They carry an IDENTICAL code.
 *      Pinned by RELOCATION-RED-DIFFERENT-CODE.
 *   4. Matching is ONE-TO-ONE against the removed multiset, never by counting.
 *      One diagnostic that becomes two is a duplication: the first instance
 *      cancels, the second is still reported.
 *      Pinned by RELOCATION-RED-DUPLICATION, which needs a count of 2 to
 *      discriminate -- at multiplicity 1 the two implementations agree.
 *   5. They sit at DIFFERENT paths. This one is a belt-and-braces assertion
 *      rather than a load-bearing guard, and it is honest to say so: path is
 *      part of the signature, so identical path + code + message is the SAME
 *      key and can never appear in both the added and removed lists. Deleting
 *      this line alone leaves the self-test green (measured). It is kept
 *      because it states the intent at the point of use, and because deleting
 *      it TOGETHER with the message check does go red.
 *
 * This is deliberately NOT "same total => pass". Anything that survives
 * matching is still reported as added, and the exact-#1403-target check runs
 * over the CURRENT diagnostics independently of matching, so a diagnostic that
 * relocates INTO a target file still fails the gate
 * (RELOCATION-RED-INTO-TARGET).
 */
export function matchRelocations(added, removed, totalDidNotGrow) {
  if (!totalDidNotGrow) {
    return { relocated: [], residualAdded: added, residualRemoved: removed };
  }
  const pool = removed.map((item) => ({ ...item, remaining: item.count }));
  const relocated = [];
  const residualAdded = [];
  for (const item of added) {
    let outstanding = item.count;
    for (const candidate of pool) {
      if (outstanding === 0) break;
      if (candidate.remaining === 0) continue;
      if (candidate.code !== item.code) continue;
      if (candidate.message !== item.message) continue;
      if (candidate.path === item.path) continue;
      const matched = Math.min(outstanding, candidate.remaining);
      candidate.remaining -= matched;
      outstanding -= matched;
      relocated.push({
        from: candidate.path,
        to: item.path,
        code: item.code,
        message: item.message,
        count: matched,
      });
    }
    if (outstanding > 0) {
      residualAdded.push({ ...item, count: outstanding });
    }
  }
  return {
    relocated,
    residualAdded,
    residualRemoved: pool
      .filter((candidate) => candidate.remaining > 0)
      .map(({ remaining, ...candidate }) => ({
        ...candidate,
        count: remaining,
      })),
  };
}

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
  const rawAdded = [];
  const rawRemoved = [];
  for (const [key, entry] of currentCounts) {
    const growth = entry.count - (baseCounts.get(key)?.count ?? 0);
    if (growth > 0) rawAdded.push({ ...entry, signature: key, count: growth });
  }
  for (const [key, entry] of baseCounts) {
    const reduction = entry.count - (currentCounts.get(key)?.count ?? 0);
    if (reduction > 0) {
      rawRemoved.push({ ...entry, signature: key, count: reduction });
    }
  }
  const { relocated, residualAdded, residualRemoved } = matchRelocations(
    rawAdded,
    rawRemoved,
    current.diagnostics.length <= base.diagnostics.length,
  );
  if (residualAdded.length > 0) {
    failures.push(`${instances(residualAdded)} added diagnostic instance(s)`);
  }
  const targetDiagnostics = current.diagnostics.filter((diagnostic) =>
    TARGETS.has(diagnostic.path),
  );
  if (targetDiagnostics.length > 0) {
    failures.push(
      `${targetDiagnostics.length} diagnostic(s) touch exact issue #1403 targets`,
    );
  }
  return {
    failures,
    added: residualAdded,
    removed: residualRemoved,
    relocated,
    targetDiagnostics,
  };
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
  // --- #1627 relocation fixtures -------------------------------------------
  // The observed non-event: one unresolvable-module diagnostic moves between
  // two files inside packages/phone-input. Identical code, identical message,
  // different path, repo total flat. Everything below it proves the allowance
  // is narrow enough that the gate still bites on the real thing.
  const UNRESOLVED_KEYBOARD_LIBRARY =
    "Cannot find module 'react-native-keyboard-controller' or its corresponding type declarations.";
  const UNRESOLVED_REANIMATED =
    "Cannot find module 'react-native-reanimated' or its corresponding type declarations.";
  const ORIGIN_FILE = "../packages/phone-input/CountryPickerModal.tsx";
  const DESTINATION_FILE = "../packages/phone-input/keyboardPrimitives.tsx";
  const relocationOrigin = synthetic(
    ORIGIN_FILE,
    "TS2307",
    UNRESOLVED_KEYBOARD_LIBRARY,
  );
  const relocationDestination = synthetic(
    DESTINATION_FILE,
    "TS2307",
    UNRESOLVED_KEYBOARD_LIBRARY,
  );
  const ballast = synthetic("src/ballast.ts", "TS2322", "Ballast mismatch");
  // PASS: the provable non-event.
  const relocationFlatTotal = compareDiagnostics(
    parse(relocationOrigin),
    parse(relocationDestination),
  );
  // RED: a genuinely new diagnostic, at a flat total. Proves the rule is not
  // "same total => pass". Deliberately shares the ORIGIN's code so that the
  // MESSAGE check -- not the code check -- is the thing under test: a weaker
  // fixture using a different code stays red even if message identity is
  // deleted, which would make this case unfalsifiable.
  const relocationRedNewDiagnostic = compareDiagnostics(
    parse(relocationOrigin),
    parse(synthetic("src/newModule.ts", "TS2307", UNRESOLVED_REANIMATED)),
  );
  // RED: a genuine message change at the SAME path, at a flat total.
  const relocationRedMessageChangeSamePath = compareDiagnostics(
    parse(synthetic(DESTINATION_FILE, "TS2307", UNRESOLVED_KEYBOARD_LIBRARY)),
    parse(synthetic(DESTINATION_FILE, "TS2307", UNRESOLVED_REANIMATED)),
  );
  // RED: a net increase. A real relocation is present, but growth suspends the
  // allowance entirely -- BOTH instances are reported, not just the new one.
  const relocationRedNetIncrease = compareDiagnostics(
    parse(relocationOrigin),
    parse(
      `${relocationDestination}\n${synthetic("src/newModule.ts", "TS2345", "Unrelated growth")}`,
    ),
  );
  // RED: ONE diagnostic becomes TWO copies at a new path, with unrelated
  // ballast keeping the repo total flat. Only one instance has a partner in
  // the removed multiset, so the second is still reported. Multiplicity here
  // is the point: with every count at 1, min(outstanding, remaining) and plain
  // counting are indistinguishable and the case cannot fail.
  const relocationRedDuplication = compareDiagnostics(
    parse(
      `${relocationOrigin}\n${synthetic("src/ballast.ts", "TS2322", "Ballast mismatch", 2)}`,
    ),
    parse(
      `${synthetic(DESTINATION_FILE, "TS2307", UNRESOLVED_KEYBOARD_LIBRARY, 2)}\n${ballast}`,
    ),
  );
  // RED: identical message text but a DIFFERENT code is a different finding.
  const relocationRedDifferentCode = compareDiagnostics(
    parse(relocationOrigin),
    parse(
      synthetic(DESTINATION_FILE, "TS2306", UNRESOLVED_KEYBOARD_LIBRARY),
    ),
  );
  // RED: a diagnostic that relocates INTO an exact #1403 target still fails --
  // the target net is independent of relocation matching.
  const relocationRedIntoTarget = compareDiagnostics(
    parse(synthetic("src/unrelated.ts", "TS2322", "Legacy mismatch")),
    parse(
      synthetic("src/services/listingInsightsService.ts", "TS2322", "Legacy mismatch"),
    ),
  );
  const cases = [
    {
      name: "identical output passes",
      passed:
        compareDiagnostics(parse(baseline), parse(baseline)).failures.length ===
        0,
    },
    {
      name: "removed diagnostics pass",
      passed: compareDiagnostics(parse(baseline), parse("")).failures.length === 0,
    },
    {
      name: "new diagnostic on an exact #1403 target fails",
      passed:
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
    },
    {
      name: "new diagnostic off-target fails",
      passed:
        compareDiagnostics(
          parse(""),
          parse(synthetic("src/unrelated.ts", "TS2345", "Unrelated growth")),
        ).failures.length > 0,
    },
    {
      name: "duplicated existing diagnostic fails",
      passed:
        compareDiagnostics(
          parse(baseline),
          parse(synthetic("src/legacy.ts", "TS2322", "Legacy mismatch", 2)),
        ).failures.length > 0,
    },
    {
      name: "unparsed compiler error fails",
      passed:
        compareDiagnostics(
          parse(""),
          parse("error TS5083: Cannot read file 'missing-tsconfig.json'."),
        ).failures.length > 0,
    },
    {
      name: "alternate-root paths inside a message normalize to one signature",
      passed:
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
    },
    {
      name: "string-union reordering alone is not a delta",
      passed:
        orderOnly.failures.length === 0 &&
        orderOnly.added.length === 0 &&
        orderOnly.removed.length === 0,
    },
    {
      name: "changed union member fails",
      passed:
        memberChanged.failures.length > 0 &&
        instances(memberChanged.added) === 1 &&
        instances(memberChanged.removed) === 1,
    },
    {
      name: "duplicate growth after normalization fails",
      passed:
        duplicateGrowthAfterNormalization.failures.length > 0 &&
        instances(duplicateGrowthAfterNormalization.added) === 1,
    },
    {
      name: "non-string union reordering still fails",
      passed:
        nonStringOrderChange.failures.length > 0 &&
        nonStringOrderChange.added.length === 1 &&
        nonStringOrderChange.removed.length === 1,
    },
    {
      name: "target diagnostic fails even when normalization cancels the delta",
      passed:
        targetAfterNormalization.failures.length > 0 &&
        targetAfterNormalization.added.length === 0 &&
        targetAfterNormalization.removed.length === 0 &&
        targetAfterNormalization.targetDiagnostics.length === 1,
    },
    {
      name: "RELOCATION-PASS: identical diagnostic moving path at a flat total is not an addition",
      passed:
        relocationFlatTotal.failures.length === 0 &&
        relocationFlatTotal.added.length === 0 &&
        relocationFlatTotal.removed.length === 0 &&
        instances(relocationFlatTotal.relocated) === 1 &&
        relocationFlatTotal.relocated[0].from === ORIGIN_FILE &&
        relocationFlatTotal.relocated[0].to === DESTINATION_FILE,
    },
    {
      name: "RELOCATION-RED-NEW-DIAGNOSTIC: a genuinely new diagnostic at a flat total still fails",
      passed:
        relocationRedNewDiagnostic.failures.length > 0 &&
        instances(relocationRedNewDiagnostic.added) === 1 &&
        relocationRedNewDiagnostic.relocated.length === 0,
    },
    {
      name: "RELOCATION-RED-MESSAGE-CHANGE-SAME-PATH: a changed message in place still fails",
      passed:
        relocationRedMessageChangeSamePath.failures.length > 0 &&
        instances(relocationRedMessageChangeSamePath.added) === 1 &&
        relocationRedMessageChangeSamePath.relocated.length === 0,
    },
    {
      name: "RELOCATION-RED-NET-INCREASE: growth suspends the allowance and reports every added instance",
      passed:
        relocationRedNetIncrease.failures.length > 0 &&
        instances(relocationRedNetIncrease.added) === 2 &&
        relocationRedNetIncrease.relocated.length === 0,
    },
    {
      name: "RELOCATION-RED-DUPLICATION: matching is one-to-one, so a duplicated copy still fails",
      passed:
        relocationRedDuplication.failures.length > 0 &&
        instances(relocationRedDuplication.added) === 1 &&
        instances(relocationRedDuplication.relocated) === 1,
    },
    {
      name: "RELOCATION-RED-DIFFERENT-CODE: same message under a different code still fails",
      passed:
        relocationRedDifferentCode.failures.length > 0 &&
        instances(relocationRedDifferentCode.added) === 1 &&
        relocationRedDifferentCode.relocated.length === 0,
    },
    {
      name: "RELOCATION-RED-INTO-TARGET: relocating onto an exact #1403 target still fails",
      passed:
        relocationRedIntoTarget.failures.length > 0 &&
        relocationRedIntoTarget.added.length === 0 &&
        instances(relocationRedIntoTarget.relocated) === 1 &&
        relocationRedIntoTarget.targetDiagnostics.length === 1,
    },
  ];
  const failed = cases.filter((testCase) => !testCase.passed);
  if (failed.length > 0) {
    console.error("issue #1403 typecheck delta self-test FAIL");
    failed.forEach((testCase) => console.error(`  FAILED CASE: ${testCase.name}`));
    return 1;
  }
  console.log(
    `issue #1403 typecheck delta self-test PASS (${cases.length}/${cases.length} cases)`,
  );
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
      added: instances(result.added),
      removed: instances(result.removed),
      // Reported so a relocation is visible in the uploaded evidence rather
      // than silently absorbed: a run that cancels something must say so.
      relocated: instances(result.relocated),
      relocations: result.relocated.map((item) => ({
        from: item.from,
        to: item.to,
        code: item.code,
        count: item.count,
      })),
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
