#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const scanRoots = [
  "mingla-business/app",
  "mingla-business/src",
  "supabase/functions",
];

const allowedFiles = new Set([
  "mingla-business/src/utils/currency.ts",
  "mingla-business/src/store/brandList.ts",
  "mingla-business/src/types/brand.ts",
  "mingla-business/app/__styleguide.tsx",
]);

const allowedContains = [
  "legacy",
  "Legacy",
  "GBP-only",
  "Gbp",
  "formatGbp =",
  "formatGbpRound =",
  "currency ?? \"GBP\"",
  "?? \"GBP\"",
  "defaultCurrency ?? \"GBP\"",
  "default_currency: \"GBP\"",
  "default_currency || \"GBP\"",
  "currency-aware",
];

const forbidden = [
  /\bformatGbp(?:Round)?\(/,
  /currency:\s*["']GBP["']/,
  /currency:\s*["']GBP["']/,
  /Intl\.NumberFormat\([^)]*currency:\s*["']GBP["']/,
];

const legacyField = /\b(?:priceGbp|amountGbp|totalGbp|revenueGbp|unitPriceGbp)\b/;

const walk = (absDir) => {
  const out = [];
  for (const dirent of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (dirent.name === "node_modules" || dirent.name.startsWith(".")) continue;
    const absPath = path.join(absDir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...walk(absPath));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(dirent.name)) {
      out.push(absPath);
    }
  }
  return out;
};

const isAllowedLine = (relPath, line) => {
  if (allowedFiles.has(relPath)) return true;
  if (relPath.includes("__tests__")) return true;
  if (allowedContains.some((marker) => line.includes(marker))) return true;
  return false;
};

const violations = [];

for (const root of scanRoots) {
  const absRoot = path.join(repoRoot, root);
  if (!fs.existsSync(absRoot)) continue;
  for (const absPath of walk(absRoot)) {
    const relPath = path.relative(repoRoot, absPath);
    const source = fs.readFileSync(absPath, "utf8");
    source.split(/\r?\n/).forEach((line, idx) => {
      const hitsForbidden = forbidden.some((pattern) => pattern.test(line));
      const hitsLegacyField =
        legacyField.test(line) &&
        !line.includes("refundedAmountGbp") &&
        !line.includes("unitPriceGbpAtPurchase") &&
        !line.includes("unitPriceGbpAtSale") &&
        !line.includes("totalGbpAtPurchase") &&
        !line.includes("totalGbpAtSale");
      if ((hitsForbidden || hitsLegacyField) && !isAllowedLine(relPath, line)) {
        violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error("ORCH-0769 violation: active money paths must use app-wide currency plumbing.");
  for (const violation of violations.slice(0, 80)) {
    console.error(violation);
  }
  if (violations.length > 80) {
    console.error(`...and ${violations.length - 80} more`);
  }
  process.exit(1);
}

console.log("ORCH-0769 PASS: active currency regression guard passed.");
