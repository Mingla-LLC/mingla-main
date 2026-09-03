#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const functionsRoot = "supabase/functions";
const exportEdge = "supabase/functions/brand-people-export/index.ts";
const forbiddenRankAuthority = /\bbiz_(?:brand_effective_rank|role_rank)\b|\bBRAND_ROLE_RANK\b|\bMIN_RANK\b|\bcanPerformAction\b|\.brand_admin\b|(?:===?|includes\s*\()\s*["']brand_admin["']/;

const isProductionTypeScript = (name) =>
  name.endsWith(".ts") &&
  !name.endsWith(".test.ts") &&
  !name.includes(".tester.") &&
  !name.includes(".happy.") &&
  !name.includes(".adversarial.");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

export function audit(base) {
  const failures = [];
  const absoluteFunctions = path.join(base, functionsRoot);
  if (!fs.existsSync(absoluteFunctions)) {
    return [`${functionsRoot} is missing`];
  }
  const marketingDirectories = fs.readdirSync(absoluteFunctions, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("marketing-"))
    .map((entry) => path.join(absoluteFunctions, entry.name));
  if (marketingDirectories.length === 0) {
    failures.push("marketing edge-function family is empty");
  }
  for (const file of marketingDirectories.flatMap(walk).filter(isProductionTypeScript)) {
    const source = fs.readFileSync(file, "utf8");
    if (forbiddenRankAuthority.test(source)) {
      failures.push(`${path.relative(base, file)} imports or evaluates privileged brand rank authority`);
    }
  }
  const exportPath = path.join(base, exportEdge);
  if (!fs.existsSync(exportPath)) {
    failures.push(`${exportEdge} is missing`);
  } else {
    const source = fs.readFileSync(exportPath, "utf8");
    if (!/rpc\s*\(\s*["']biz_export_brand_people["']/.test(source) || !/rpc\s*\(\s*["']biz_get_brand_people_export_job["']/.test(source)) {
      failures.push("brand book export no longer delegates authorization to the dedicated RPC boundary");
    }
    if (/from\s+["'][^"']*marketing-/.test(source)) {
      failures.push("brand book export is coupled to a marketing edge function");
    }
  }
  return failures;
}

function selfTest() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "issue-1776-rank-boundary-"));
  try {
    const fixtureFunctions = path.join(fixture, functionsRoot);
    fs.mkdirSync(path.join(fixtureFunctions, "marketing-send"), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(fixture, exportEdge)), { recursive: true });
    const marketingFile = path.join(fixtureFunctions, "marketing-send", "index.ts");
    fs.writeFileSync(
      marketingFile,
      "export const statusCopy = 'Ask a brand admin for access';\nexport const send = () => true;\n",
    );
    fs.writeFileSync(
      path.join(fixture, exportEdge),
      'user.rpc("biz_export_brand_people");\nuser.rpc("biz_get_brand_people_export_job");\n',
    );
    const clean = audit(fixture);
    if (clean.length > 0) throw new Error(`clean fixture failed: ${clean.join("; ")}`);
    for (const mutation of [
      "biz_brand_effective_rank(actor)",
      "biz_role_rank('brand_admin')",
      "BRAND_ROLE_RANK.brand_admin",
      "MIN_RANK.EXPORT_BRAND_BOOK",
      "canPerformAction(rank, action)",
      "const allowed = role === 'brand_admin'",
    ]) {
      fs.writeFileSync(marketingFile, `export const leaked = ${JSON.stringify(mutation)};\n`);
      if (!audit(fixture).some((failure) => failure.includes("privileged brand rank authority"))) {
        throw new Error(`true mutation was not detected: ${mutation}`);
      }
    }
    fs.writeFileSync(marketingFile, "export const send = () => true;\n");
    fs.writeFileSync(path.join(fixture, exportEdge), "export const request = true;\n");
    if (!audit(fixture).some((failure) => failure.includes("dedicated RPC boundary"))) {
      throw new Error("true mutation was not detected: export RPC authority removal");
    }
    console.log("[issue-1776-marketing-edge-rank-boundary] self-test PASS");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = audit(root);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[issue-1776-marketing-edge-rank-boundary] FAIL: ${failure}`);
    process.exit(1);
  }
  console.log("[issue-1776-marketing-edge-rank-boundary] PASS");
}
