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
const stripeReactNativeImportPattern =
  /(?:import\s+["']@stripe\/stripe-react-native["']|from\s+["']@stripe\/stripe-react-native["']|require\(\s*["']@stripe\/stripe-react-native["']\s*\)|import\(\s*["']@stripe\/stripe-react-native["']\s*\))/;

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
    if (stripeReactNativeImportPattern.test(source) && !allowedNativeImportFiles.has(relativePath)) {
      failures.push(
        `${relativePath} import-scan: @stripe/stripe-react-native must stay behind approved .native payment boundaries`,
      );
    }
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

for (const checkedRoot of checkedRoots) {
  walk(path.join(root, checkedRoot));
}

checkNpmWiring();
checkWorkflowWiring();

if (failures.length > 0) {
  console.error("ORCH-0778 web Stripe native import gate failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0778 web Stripe native import gate passed.");
