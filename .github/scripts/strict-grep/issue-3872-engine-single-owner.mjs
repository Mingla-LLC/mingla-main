#!/usr/bin/env node
/* eslint-disable no-console */
// MINGLA-INVARIANT: I-3872-ENGINE-SINGLE-OWNER | issue #3872 | All discount money arithmetic lives in public.issue_3872_discount_apply; TypeScript only normalises codes and carries typed RPC payloads.
// #3872: SQL is the single discount arithmetic owner. The shared TypeScript
// module may define wire types, normalise codes and call RPCs, but it may not
// calculate money.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith(".github")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const owner = path.join(root, "supabase/functions/_shared/discountEngine.ts");

const arithmetic =
  /\b(?:bps|[A-Za-z0-9_]*(?:Minor|Cents))\b\s*[*/]|[*/]\s*\b(?:bps|[A-Za-z0-9_]*(?:Minor|Cents))\b/g;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function violations(source) {
  return stripComments(source).match(arithmetic) ?? [];
}

function selfTest() {
  const cases = [
    ["const total = valueMinor * qty;", true],
    ["const pct = cents / bps;", true],
    ["const wire = { valueMinor, amountCents };", false],
    ["// amountMinor * qty belongs in SQL", false],
  ];
  for (const [source, shouldFail] of cases) {
    if (violations(source).length > 0 !== shouldFail) {
      console.error(`SELF-TEST FAIL: ${source}`);
      process.exit(1);
    }
  }
  console.log("issue-3872 engine single-owner self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

if (!fs.existsSync(owner)) {
  console.error(
    "I-3872-ENGINE-SINGLE-OWNER FAIL: discountEngine.ts is missing",
  );
  process.exit(2);
}
const found = violations(fs.readFileSync(owner, "utf8"));
if (found.length > 0) {
  console.error(
    `I-3872-ENGINE-SINGLE-OWNER FAIL: TypeScript money arithmetic found: ${found.join(", ")}`,
  );
  process.exit(1);
}
console.log(
  "I-3872-ENGINE-SINGLE-OWNER passed: SQL remains the only discount money engine",
);
