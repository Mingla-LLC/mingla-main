#!/usr/bin/env node
// #3872: staff venue orders may receive automatic/sale pricing, but promo
// codes, stays, RSVP, and comps remain outside the R1 discount rails.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith(".github")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) return null;
  const afterStart = source.slice(start + 1);
  const next = afterStart.search(/\nasync function /);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

function checkStaff(source, failures) {
  for (const name of ["handleStaffCreate", "handleSettle", "handleTabClose"]) {
    const body = functionBody(source, name);
    if (body === null) {
      failures.push(`${name} is missing`);
      continue;
    }
    if (!body.includes('"discountCode" in body')) {
      failures.push(`${name} does not reject every discountCode-bearing body`);
    }
    if (!body.includes('error: "discount_code_not_accepted"')) {
      failures.push(`${name} does not return discount_code_not_accepted`);
    }
  }
  const unsafeCodeArg = [...source.matchAll(/\bp_code\s*:\s*([^,}\n]+)/g)]
    .map((match) => match[1].trim())
    .filter((value) => value !== "null" && value !== "NULL");
  if (unsafeCodeArg.length > 0) {
    failures.push(`staff RPC carries a non-null code: ${unsafeCodeArg.join(", ")}`);
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function checkForbiddenFiles(files, needles, failures, label) {
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const needle of needles) {
      if (source.includes(needle)) {
        failures.push(`${label}: ${path.relative(root, file)} contains ${needle}`);
      }
    }
  }
}

function selfTest() {
  const good = `
async function handleStaffCreate(_c, _r, body): Promise<Response> {
  if ("discountCode" in body) return jsonResponse({ error: "discount_code_not_accepted" }, 400);
  return rpc({ p_code: null });
}
async function handleSettle(_c, body): Promise<Response> {
  if ("discountCode" in body) return jsonResponse({ error: "discount_code_not_accepted" }, 400);
}
async function handleTabClose(_c, _r, body): Promise<Response> {
  if ("discountCode" in body) return jsonResponse({ error: "discount_code_not_accepted" }, 400);
}`;
  const failures = [];
  checkStaff(good, failures);
  if (failures.length > 0) throw new Error(`good fixture failed: ${failures.join("; ")}`);
  for (const bad of [
    good.replace('"discountCode" in body', '"promo" in body'),
    good.replace("p_code: null", "p_code: body.code"),
  ]) {
    const found = [];
    checkStaff(bad, found);
    if (found.length === 0) throw new Error("revert fixture was not rejected");
  }
  console.log("issue-3872 excluded-rails self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const failures = [];
const staffFile = path.join(root, "supabase/functions/venue-order-staff/index.ts");
if (!fs.existsSync(staffFile)) failures.push("venue-order-staff is missing");
else checkStaff(fs.readFileSync(staffFile, "utf8"), failures);

checkForbiddenFiles(
  walk(path.join(root, "mingla-business/src/components/venue/orderPad")),
  ["discountCode"],
  failures,
  "staff order pad",
);
const stayFiles = walk(path.join(root, "supabase/functions")).filter((file) =>
  /\/stay-[^/]+\//.test(file)
);
checkForbiddenFiles(stayFiles, ["issue_3872_", "discountEngine"], failures, "stay rail");

if (failures.length > 0) {
  console.error(`I-3872-EXCLUDED-RAILS FAIL:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("I-3872-EXCLUDED-RAILS passed");
