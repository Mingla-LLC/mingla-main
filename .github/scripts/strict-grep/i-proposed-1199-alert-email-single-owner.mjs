#!/usr/bin/env node
/**
 * I-PROPOSED-1199-ALERT-EMAIL-SINGLE-OWNER (DRAFT) — ORCH-1199.
 *
 * The api-health hub sends operator alerts ONLY through `sendOpsAlertEmail`.
 * No new Resend EMAIL-SEND path inside the api-health-probe edge fn.
 *
 * NOTE: the probe DOES reach `api.resend.com/domains` as a Layer-B *liveness
 * check* (health probe, not an alert send) — that is allowed. The forbidden
 * thing is a new email-SEND path: `api.resend.com/emails` or `RESEND_API_URL`
 * (the send endpoint used by stripeOpsAlertEmail). Alerts must route through
 * sendOpsAlertEmail, the single owner.
 *
 * Fails if:
 *   (a) api-health-probe references the Resend email-SEND endpoint
 *       (api.resend.com/emails) or RESEND_API_URL in live code, OR
 *   (b) api-health-probe does NOT import/call sendOpsAlertEmail.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const fnDir = join(root, "supabase/functions/api-health-probe");
const failures = [];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
};

if (!existsSync(fnDir)) {
  console.error("I-PROPOSED-1199-ALERT-EMAIL-SINGLE-OWNER: api-health-probe dir missing");
  process.exit(1);
}

const files = walk(fnDir);
let sawSendOpsAlert = false;
for (const file of files) {
  const rel = relative(root, file);
  const code = stripComments(readFileSync(file, "utf8"));
  if (/api\.resend\.com\/emails/.test(code) || /RESEND_API_URL/.test(code)) {
    failures.push(`${rel}: introduces a direct Resend email-SEND path — alerts MUST go through sendOpsAlertEmail.`);
  }
  if (/sendOpsAlertEmail/.test(code)) sawSendOpsAlert = true;
}
if (!sawSendOpsAlert) {
  failures.push("api-health-probe: must import + call sendOpsAlertEmail (single alert-email owner).");
}

if (failures.length > 0) {
  console.error("I-PROPOSED-1199-ALERT-EMAIL-SINGLE-OWNER gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("I-PROPOSED-1199-ALERT-EMAIL-SINGLE-OWNER gate passed.");
