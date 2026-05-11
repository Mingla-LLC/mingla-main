#!/usr/bin/env node
// ORCH-0785-E — Ticket PDF privacy gate.
//
// `_shared/ticketPdf.ts` and any caller must not reference forbidden
// privacy-sensitive identifiers (qr_token_hash, app.qr_token_pepper,
// stripe_payment_intent_id, stripe_charge_id, buyer_phone, buyer_phone_e164).
// Scope is intentionally narrow: `_shared/ticketPdf.ts` and
// `ticket-confirmation-dispatch/index.ts`. Other functions still legitimately
// reference these tokens for unrelated database work.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCOPED_FILES = [
  "supabase/functions/_shared/ticketPdf.ts",
  "supabase/functions/ticket-confirmation-dispatch/index.ts",
];
const FORBIDDEN = [
  "qr_token_hash",
  "qr_token_pepper",
  "stripe_payment_intent_id",
  "stripe_charge_id",
  "buyer_phone",
  "buyer_phone_e164",
];

const failures = [];
for (const rel of SCOPED_FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    failures.push(`${rel}: file expected but missing`);
    continue;
  }
  const text = fs.readFileSync(full, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Allow inside line/block comments.
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const token of FORBIDDEN) {
      // Allow `buyer_phone_e164` ONLY in the SELECT column list of the
      // dispatcher (it's read but never passed into the PDF). To keep the
      // gate simple we whitelist any occurrence in a backtick SELECT block.
      if (token.startsWith("buyer_phone") && /buyer_phone_e164/.test(line)) {
        // Allow in the orders SELECT only — line context check: look back 30
        // lines for a `.from("orders")` to mark this as SELECT context.
        const window = lines.slice(Math.max(0, i - 30), i).join("\n");
        if (/\.from\(["']orders["']\)/.test(window)) continue;
      }
      if (line.includes(token)) {
        failures.push(`${rel}:${i + 1}: forbidden privacy token \`${token}\``);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("ORCH-0785-E ticket-pdf-privacy gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-0785-E ticket-pdf-privacy gate passed.");
