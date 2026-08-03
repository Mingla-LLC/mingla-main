#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const checkedRoots = ["mingla-business/app", "mingla-business/src"];
// ORCH-0849 (2026-05-15): hosted-checkout-only era ended; mingla-business
// re-adopts native PaymentSheet (parity with consumer, app-mobile).
// I-PROPOSED-AE STRIPE_REACT_NATIVE_NATIVE_BOUNDARY_ONLY is preserved —
// the allowlist permits the `.native.ts` platform-extension file used by
// the buyer-side checkout glue; Metro picks it only on iOS/Android, and
// the sibling bare-extension stub keeps web bundles free of any Stripe
// React Native pull. Adding any other entry to this allowlist requires a
// new ORCH proving web-bundle safety (web export probe + Vercel build).
//
// `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
// the pure `check(fileEntries, failures)` (the import-scan) is exercised with a
// GOOD fixture (only the allowlisted .native.ts imports it) and ≥2 DISTINCT BAD
// fixtures. The disk-walking main path feeds the SAME `check(...)` the walked
// entries; the npm/workflow wiring assertions are behavior-preserving and
// unchanged. This gate runs as a job:* carve-out, so its self-test is wired via
// an explicit workflow step (see strict-grep-mingla-business.yml).
const allowedNativeImportFiles = new Set([
  "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
]);
const failures = [];
const stripeReactNativeImportPattern =
  /(?:import\s+["']@stripe\/stripe-react-native["']|from\s+["']@stripe\/stripe-react-native["']|require\(\s*["']@stripe\/stripe-react-native["']\s*\)|import\(\s*["']@stripe\/stripe-react-native["']\s*\))/;

// Pure verdict. `fileEntries` = [{ relativePath, source }]. Flags any file that
// imports @stripe/stripe-react-native unless it is on the .native allowlist.
function check(fileEntries, failures) {
  for (const { relativePath, source } of fileEntries) {
    if (stripeReactNativeImportPattern.test(source) && !allowedNativeImportFiles.has(relativePath)) {
      failures.push(
        `${relativePath} import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries`,
      );
    }
  }
}

const walk = (directory, fileEntries) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, fileEntries);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    fileEntries.push({ relativePath, source });
  }
};

const checkNpmWiring = () => {
  const packageJsonPath = path.join(root, "mingla-business/package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    failures.push(
      `ORCH-0781 wiring: mingla-business/package.json npm wiring parse failed: ${error.message}`,
    );
    return;
  }

  const script = packageJson.scripts?.["test:orch-0778"];
  if (typeof script !== "string" || !script.includes("orch-0778-web-stripe-native-import-gate.mjs")) {
    failures.push(
      `ORCH-0781 wiring: mingla-business/package.json missing scripts["test:orch-0778"] or expected gate script path (npm wiring)`,
    );
  }
};

const getTopLevelBlock = (source, key) => {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return "";

  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#][^:]*:\s*$/.test(line)) break;
    if (/^[^\s#][^:]*:\s+/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
};

const getIndentedChildBlock = (source, key, indent = 2) => {
  const lines = source.split(/\r?\n/);
  const childPattern = new RegExp(`^\\s{${indent}}${key}:\\s*$`);
  const siblingPattern = new RegExp(`^\\s{${indent}}\\S[^:]*:\\s*`);
  const start = lines.findIndex((line) => childPattern.test(line));
  if (start === -1) return "";

  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (siblingPattern.test(line)) break;
    if (/^[^\s#]/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
};

const branchBlockHas = (pushBlock, branchName) => {
  const inlineBranches = pushBlock.match(/^\s{4}branches:\s*\[(?<branches>[^\]]*)\]\s*$/m);
  if (inlineBranches?.groups?.branches) {
    return inlineBranches.groups.branches
      .split(",")
      .map((branch) => branch.trim())
      .includes(branchName);
  }

  const lines = pushBlock.split(/\r?\n/);
  const branchesIndex = lines.findIndex((line) => /^\s{4}branches:\s*$/.test(line));
  if (branchesIndex === -1) return false;

  for (let index = branchesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{4}\S/.test(line)) break;
    if (new RegExp(`^\\s{6}-\\s*${branchName}\\s*$`).test(line)) return true;
  }
  return false;
};

const checkWorkflowWiring = () => {
  const workflowRelativePath = ".github/workflows/strict-grep-mingla-business.yml";
  const workflowPath = path.join(root, workflowRelativePath);
  let workflowSource;
  try {
    workflowSource = fs.readFileSync(workflowPath, "utf8");
  } catch (error) {
    failures.push(
      `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml read failed: ${error.message} (CI wiring)`,
    );
    failures.push(
      `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)`,
    );
    return;
  }

  if (!/^\s{2}orch-0778-web-stripe-native-import-gate:\s*$/m.test(workflowSource)) {
    failures.push(
      `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0778-web-stripe-native-import-gate (CI wiring)`,
    );
  }

  const onBlock = getTopLevelBlock(workflowSource, "on");
  const pushBlock = getIndentedChildBlock(onBlock, "push", 2);
  if (!pushBlock || !branchBlockHas(pushBlock, "main") || !branchBlockHas(pushBlock, "Seth")) {
    failures.push(
      `ORCH-0781 wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)`,
    );
  }
};

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: only the allowlisted .native.ts imports @stripe/stripe-react-native;
  // a sibling bare-extension file imports nothing → silent (specificity).
  let f = [];
  check(
    [
      {
        relativePath: "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
        source: "import { initPaymentSheet } from '@stripe/stripe-react-native';\n",
      },
      {
        relativePath: "mingla-business/src/payments/nativeCheckoutFlow.ts",
        source: "export async function runNativeCheckout() {}\n",
      },
    ],
    f,
  );
  if (f.length) self.push("GOOD (only allowlisted .native.ts imports it) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): a non-allowlisted src file imports the native SDK →
  // fires.
  f = [];
  check(
    [{ relativePath: "mingla-business/src/payments/checkoutGlue.ts", source: "import '@stripe/stripe-react-native';\n" }],
    f,
  );
  if (f.length === 0) self.push("BAD1 (@stripe/stripe-react-native import in a non-allowlisted src file) not flagged");

  // BAD2 (regression, different angle): a DIFFERENT import form —
  // require(\"@stripe/stripe-react-native\") — in another (app) file → fires.
  f = [];
  check(
    [{ relativePath: "mingla-business/app/checkout/pay.tsx", source: "const stripe = require('@stripe/stripe-react-native');\n" }],
    f,
  );
  if (f.length === 0) self.push("BAD2 (require('@stripe/stripe-react-native') in another file) not flagged");

  if (self.length) {
    console.error("ORCH-0778 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0778 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const fileEntries = [];
for (const checkedRoot of checkedRoots) {
  walk(path.join(root, checkedRoot), fileEntries);
}
check(fileEntries, failures);

checkNpmWiring();
checkWorkflowWiring();

if (failures.length > 0) {
  console.error("ORCH-0778 web Stripe native import gate failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0778 web Stripe native import gate passed.");
