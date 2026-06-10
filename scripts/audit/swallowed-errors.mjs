#!/usr/bin/env node
/**
 * #426 — Swallowed-error heuristic (ORCH-1106 class).
 *
 * Flags catch blocks that only log or are empty in mingla-business/src.
 * Edge functions: warn-only unless --strict.
 */

import {
  EXIT,
  REPO_ROOT,
  walkFiles,
  rel,
  readText,
  parseArgs,
  reportViolations,
} from "./_shared.mjs";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ALLOWLIST_TAG = "orch-426-allow swallowed-error";

const BUSINESS_ROOT = join(REPO_ROOT, "mingla-business", "src");
const EDGE_ROOT = join(REPO_ROOT, "supabase", "functions");

function findSwallowedInFile(path) {
  const text = readText(path);
  if (text.includes(ALLOWLIST_TAG) && text.match(/orch-426-allow swallowed-error/g)?.length > 2) {
    return [];
  }

  const violations = [];
  const catchRe = /catch\s*\([^)]*\)\s*\{([^}]*)\}/g;
  let m;
  while ((m = catchRe.exec(text)) !== null) {
    const body = m[1].trim();
    const startIdx = text.lastIndexOf("catch", m.index);
    const context = text.slice(Math.max(0, startIdx - 120), startIdx);
    if (context.includes(ALLOWLIST_TAG)) continue;

    const isEmpty = body.length === 0;
    const onlyLog =
      body.length > 0 &&
      body
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((stmt) => /^console\.(log|warn|debug|info)\(/.test(stmt));

    if (isEmpty) {
      const line = text.slice(0, m.index).split("\n").length;
      violations.push(`${rel(path)}:${line} — empty catch block (swallowed error risk)`);
    } else if (onlyLog) {
      const line = text.slice(0, m.index).split("\n").length;
      violations.push(
        `${rel(path)}:${line} — catch block only console.* (instrumentation swallow; fix in follow-up ORCH)`,
      );
    }
  }
  return violations;
}

function runScan(roots) {
  const violations = [];
  for (const root of roots) {
    const files = walkFiles(root, {
      extensions: [".ts", ".tsx"],
      skipDirNames: new Set(["node_modules", "__tests__"]),
    });
    for (const file of files) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      violations.push(...findSwallowedInFile(file));
    }
  }
  return violations;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "orch-426-swallow-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "bad.ts"),
    `try { x(); } catch (e) { console.log(e); }\n`,
  );
  writeFileSync(
    join(dir, "good.ts"),
    `try { x(); } catch (e) { throw e; }\n`,
  );

  const violations = runScan([dir]);
  rmSync(dir, { recursive: true, force: true });

  if (violations.length !== 1) {
    console.error("SELF-TEST FAIL: expected 1 violation, got", violations.length, violations);
    process.exit(EXIT.ERROR);
  }
  console.log("SELF-TEST PASS: swallowed-errors");
  process.exit(EXIT.OK);
}

function main() {
  const { selfTest: isSelfTest, warnOnly } = parseArgs(process.argv);
  const strict = process.argv.includes("--strict");

  if (isSelfTest) {
    selfTest();
    return;
  }

  const businessViolations = runScan([BUSINESS_ROOT]);
  const edgeViolations = runScan([EDGE_ROOT]);

  const businessEmpty = businessViolations.filter((v) => v.includes("empty catch"));
  const businessConsoleOnly = businessViolations.filter((v) => v.includes("only console"));

  if (businessEmpty.length > 0) {
    process.exit(reportViolations("mingla-business empty catch blocks", businessEmpty));
  }
  console.log("PASS: mingla-business empty catch blocks");

  if (businessConsoleOnly.length > 0) {
    console.warn(
      `WARN: ${businessConsoleOnly.length} mingla-business catch block(s) only log to console (informational)`,
    );
    for (const v of businessConsoleOnly.slice(0, 15)) {
      console.warn(`  - ${v}`);
    }
    if (businessConsoleOnly.length > 15) {
      console.warn(`  ... and ${businessConsoleOnly.length - 15} more`);
    }
  }

  if (edgeViolations.length > 0) {
    if (warnOnly || !strict) {
      console.warn(
        `WARN: ${edgeViolations.length} edge-function swallowed-error heuristic hit(s) (informational; use --strict to fail)`,
      );
      for (const v of edgeViolations.slice(0, 20)) {
        console.warn(`  - ${v}`);
      }
      if (edgeViolations.length > 20) {
        console.warn(`  ... and ${edgeViolations.length - 20} more`);
      }
      process.exit(EXIT.OK);
    }
    process.exit(reportViolations("edge function swallowed errors", edgeViolations));
  }

  console.log("PASS: edge function swallowed errors");
  process.exit(EXIT.OK);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(EXIT.ERROR);
}
