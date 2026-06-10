#!/usr/bin/env node
/**
 * #426 — N+1 heuristic for mingla-business services.
 *
 * Flags for/forEach loops containing await + supabase client calls.
 * Informational by default; exits 0 unless --strict.
 */

import {
  EXIT,
  REPO_ROOT,
  walkFiles,
  rel,
  readText,
  parseArgs,
} from "./_shared.mjs";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SERVICES_ROOT = join(REPO_ROOT, "mingla-business", "src", "services");

function scanFile(path) {
  const text = readText(path);
  const lines = text.split("\n");
  const violations = [];

  let loopDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bfor\s*\(|\bfor\s+of\b|\.forEach\s*\(/.test(line)) {
      loopDepth += 1;
    }
    if (loopDepth > 0 && /\bawait\b/.test(line) && /supabase/.test(line)) {
      violations.push(
        `${rel(path)}:${i + 1} — await supabase inside loop (possible N+1)`,
      );
    }
    if (/^\s*\}\s*$/.test(line) && loopDepth > 0) {
      loopDepth = Math.max(0, loopDepth - 1);
    }
  }
  return violations;
}

function runScan(root) {
  const files = walkFiles(root, {
    extensions: [".ts", ".tsx"],
    skipDirNames: new Set(["__tests__", "node_modules"]),
  });
  const violations = [];
  for (const file of files) {
    if (file.endsWith(".test.ts")) continue;
    violations.push(...scanFile(file));
  }
  return violations;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "orch-426-n1-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "bad.ts"),
    `for (const id of ids) {\n  await supabase.from("x").select();\n}\n`,
  );

  const violations = runScan(dir);
  rmSync(dir, { recursive: true, force: true });

  if (violations.length < 1) {
    console.error("SELF-TEST FAIL: expected at least 1 violation");
    process.exit(EXIT.ERROR);
  }
  console.log("SELF-TEST PASS: n-plus-one-heuristic");
  process.exit(EXIT.OK);
}

function main() {
  const { selfTest: isSelfTest } = parseArgs(process.argv);
  const strict = process.argv.includes("--strict");

  if (isSelfTest) {
    selfTest();
    return;
  }

  const violations = runScan(SERVICES_ROOT);
  if (violations.length === 0) {
    console.log("PASS: n-plus-one heuristic (no hits)");
    process.exit(EXIT.OK);
  }

  console.warn(`WARN: ${violations.length} possible N+1 pattern(s)`);
  for (const v of violations.slice(0, 30)) {
    console.warn(`  - ${v}`);
  }
  if (violations.length > 30) {
    console.warn(`  ... and ${violations.length - 30} more`);
  }

  process.exit(strict ? EXIT.VIOLATION : EXIT.OK);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(EXIT.ERROR);
}
