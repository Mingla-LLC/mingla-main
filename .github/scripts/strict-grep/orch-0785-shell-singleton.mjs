#!/usr/bin/env node
// ORCH-0785-D — Email shell singleton gate.
//
// No file under supabase/functions/**/*.ts may construct its own
// `<!doctype html>` or `<html lang=` string outside `_shared/email/**`.
// Forces every future customer-facing email to opt into the shared shell.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ROOT_FNS = path.join(ROOT, "supabase", "functions");
const NEEDLES = ["<!doctype html>", "<!DOCTYPE html>", "<html lang="];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const SHELL_DIR = path.join("supabase", "functions", "_shared", "email");

// Allowlist — paths that legitimately render HTML outside the email shell
// because they serve HTTP response pages, NOT marketing/transactional emails.
// Each entry must include the reason inline.
const ALLOWLIST_DIRS = [
  // marketing-unsubscribe renders an HTTP confirmation form + success page
  // shown in the recipient's browser when they click the List-Unsubscribe
  // link. These are web pages, not email bodies — the email-shell-singleton
  // invariant is scoped to email composition, not HTTP responses.
  path.join("supabase", "functions", "marketing-unsubscribe"),
];

const failures = [];
for (const file of walk(ROOT_FNS)) {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith(SHELL_DIR + path.sep) || rel === SHELL_DIR) continue;
  if (ALLOWLIST_DIRS.some((p) => rel.startsWith(p + path.sep) || rel === p)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const needle of NEEDLES) {
    if (!text.includes(needle)) continue;
    failures.push(`${rel}: builds its own \`${needle}\` outside _shared/email/`);
    break;
  }
}

if (failures.length > 0) {
  console.error("ORCH-0785-D email-shell-singleton gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-0785-D email-shell-singleton gate passed.");
