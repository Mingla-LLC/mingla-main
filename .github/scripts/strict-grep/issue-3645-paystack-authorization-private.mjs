#!/usr/bin/env node
/** #3645 — saved charge credentials stay private and never enter logs. */
// MINGLA-INVARIANT: I-3645-PS-2 | issue #3645 | Paystack authorization never leaves the server.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

export function authorizationPrivacyFailures(entries) {
  const failures = [];
  for (const { file, source } of entries) {
    const consoleCalls = source.match(/console\.(?:log|info|warn|error)\s*\([\s\S]{0,500}?\);?/g) ?? [];
    if (consoleCalls.some((call) => /authorization_code|authorization\.authorization_code/.test(call))) {
      failures.push(`${file}: logs a saved authorization value`);
    }
    if (/\.from\(["']order_payment_authorizations["']\)/.test(source) &&
        !/\.schema\(["']private["']\)/.test(source)) {
      failures.push(`${file}: reads the authorization table outside private schema`);
    }
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const good = authorizationPrivacyFailures([{ file: "good.ts", source: 'supabase.schema("private").from("order_payment_authorizations").select("last4")' }]);
  const badLog = authorizationPrivacyFailures([{ file: "bad.ts", source: "console.warn('card', authorization_code);" }]);
  const badSchema = authorizationPrivacyFailures([{ file: "bad.ts", source: 'supabase.from("order_payment_authorizations").select("authorization_code")' }]);
  if (good.length || badLog.length !== 1 || badSchema.length !== 1) {
    console.error("#3645 authorization-private self-test FAILED");
    process.exit(1);
  }
  console.log("#3645 authorization-private self-test PASS (3/3 cases).");
  process.exit(0);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const entries = walk(path.join(root, "supabase/functions")).map((file) => ({
  file: path.relative(root, file),
  source: fs.readFileSync(file, "utf8"),
}));
const failures = authorizationPrivacyFailures(entries);
const model = fs.readFileSync(path.join(root, "supabase/migrations/20280201003645_issue_3645_paystack_plan_model.sql"), "utf8");
if (!/CREATE TABLE IF NOT EXISTS private\.order_payment_authorizations/i.test(model)) failures.push("private authorization table is missing");
if (!/REVOKE ALL[\s\S]*order_payment_authorizations[\s\S]*anon, authenticated/i.test(model)) failures.push("authorization table grants are not revoked");
if (failures.length) {
  console.error("#3645 authorization-private gate FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`#3645 authorization-private gate PASS (${entries.length} function files).`);
