#!/usr/bin/env node
// ORCH-0785-B — No Resend sandbox fallback gate.
//
// Fails if any source file under supabase/functions/** or mingla-admin/** or
// mingla-business/** contains the literal `onboarding@resend.dev` outside
// comments. Documentation .md files are allowlisted (we want CLOSE notes to
// be able to cite the historical fallback).

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = [
  path.join(ROOT, "supabase", "functions"),
  path.join(ROOT, "mingla-admin", "src"),
  path.join(ROOT, "mingla-business", "src"),
  path.join(ROOT, "mingla-business", "app"),
];
const NEEDLE = "onboarding@resend.dev";
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && SOURCE_EXTS.has(path.extname(full))) out.push(full);
  }
  return out;
}

const failures = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(NEEDLE)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(NEEDLE)) continue;
      const trimmed = lines[i].trim();
      // Allow inside line comments and block comments.
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
      }
      failures.push(
        `${path.relative(ROOT, file)}:${i + 1}: ${NEEDLE} appears outside a comment`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("ORCH-0785-B no-resend-sandbox-fallback gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-0785-B no-resend-sandbox-fallback gate passed.");
