#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const checkedRoots = ["mingla-business/app", "mingla-business/src"];
const allowedNativeImportFiles = new Set([
  "mingla-business/src/payments/StripeNativeProvider.native.tsx",
  "mingla-business/src/payments/stripePaymentSheet.native.ts",
]);
const failures = [];

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    if (
      /(?:from\s+["']@stripe\/stripe-react-native["']|require\(\s*["']@stripe\/stripe-react-native["']\s*\)|import\(\s*["']@stripe\/stripe-react-native["']\s*\))/.test(
        source,
      ) &&
      !allowedNativeImportFiles.has(relativePath)
    ) {
      failures.push(relativePath);
    }
  }
};

for (const checkedRoot of checkedRoots) {
  walk(path.join(root, checkedRoot));
}

if (failures.length > 0) {
  console.error(
    "ORCH-0778 web Stripe native import gate failed. Move Stripe React Native imports behind a .native platform boundary:",
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0778 web Stripe native import gate passed.");
