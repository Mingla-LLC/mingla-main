#!/usr/bin/env node
/**
 * #426 — Secrets-in-client scan for mingla-business.
 *
 * Flags hardcoded live Stripe keys, service-role references, and common
 * secret patterns in client-reachable paths.
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

const SCAN_ROOTS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
  join(REPO_ROOT, "mingla-business", "api"),
];

const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__"]);

const FORBIDDEN = [
  { re: /sk_live_[a-zA-Z0-9]+/, label: "Stripe live secret key" },
  { re: /SUPABASE_SERVICE_ROLE/i, label: "service_role reference" },
  { re: /service_role['"]\s*[,)]/, label: "service_role literal" },
  { re: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/, label: "JWT-like literal" },
];

const ALLOWLIST_TAG = "orch-426-allow secret-scan";

function scanFile(path) {
  const text = readText(path);
  const lines = text.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOWLIST_TAG)) continue;
    if (line.trim().startsWith("//") && line.includes("pk_test_")) continue;
    for (const rule of FORBIDDEN) {
      if (rule.re.test(line)) {
        hits.push(`${rel(path)}:${i + 1} — ${rule.label}`);
      }
    }
  }
  return hits;
}

function runScan(roots) {
  const violations = [];
  for (const root of roots) {
    const files = walkFiles(root, {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      skipDirNames: SKIP_DIRS,
    });
    for (const file of files) {
      if (file.includes(".test.")) continue;
      violations.push(...scanFile(file));
    }
  }
  return violations;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "orch-426-secrets-"));
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "bad.ts"), 'const x = "sk_live_abc123secret";\n');
  writeFileSync(join(src, "ok.ts"), "// pk_test_placeholder in comment only\n");

  const violations = runScan([join(dir, "src")]);
  rmSync(dir, { recursive: true, force: true });

  if (violations.length !== 1) {
    console.error("SELF-TEST FAIL: expected 1 violation, got", violations.length);
    process.exit(EXIT.ERROR);
  }
  console.log("SELF-TEST PASS: secrets-scan");
  process.exit(EXIT.OK);
}

function main() {
  const { selfTest: isSelfTest } = parseArgs(process.argv);
  if (isSelfTest) {
    selfTest();
    return;
  }
  const violations = runScan(SCAN_ROOTS);
  process.exit(reportViolations("No secrets in mingla-business client paths", violations));
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(EXIT.ERROR);
}
