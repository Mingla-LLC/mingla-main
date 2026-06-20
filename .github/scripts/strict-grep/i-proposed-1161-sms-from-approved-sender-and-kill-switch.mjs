#!/usr/bin/env node
/**
 * META-ORCH-1161 Sub-A — SMS sender + kill-switch invariants (DRAFT).
 *
 * I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY: the smsAdapter MUST send only
 * via a configured Messaging Service SID (TWILIO_MESSAGING_SERVICE_SID), never a
 * raw `From:` number.
 *
 * I-PROPOSED-1161-SMS-MARKET-KILL-SWITCH: the smsAdapter MUST consult a
 * per-market kill-switch env (SMS_LIVE_ENABLED_US) and return WITHOUT an HTTP
 * call when off.
 *
 * This gate fails if:
 *   (a) the smsAdapter is missing (the unified SMS owner must exist), OR
 *   (b) the smsAdapter references MessagingServiceSid is removed, OR
 *   (c) the kill-switch (SMS_LIVE_ENABLED_) check is removed, OR
 *   (d) the adapter introduces a raw Twilio `From` form param.
 *
 * Mirrors the modular gate pattern (sibling: orch-1130-no-buyer-tax-form.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

const adapterPath = join(root, "supabase/functions/_shared/adapters/smsAdapter.ts");

if (!existsSync(adapterPath)) {
  failures.push(
    `smsAdapter missing at supabase/functions/_shared/adapters/smsAdapter.ts — the unified SMS owner must exist (I-PROPOSED-1161-UNIFIED-DISPATCHER-SOLE-SEND-PATH).`,
  );
} else {
  const src = readFileSync(adapterPath, "utf8");

  if (!src.includes("MessagingServiceSid")) {
    failures.push(
      `smsAdapter must send via MessagingServiceSid (the approved toll-free), not a raw From number — I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY.`,
    );
  }

  // A raw From: number param is forbidden (the adapter must use the Messaging
  // Service). Allow the word in comments; forbid an actual URLSearchParams "From".
  if (/params\.set\(\s*["']From["']/.test(src) || /["']From["']\s*:/.test(src)) {
    failures.push(
      `smsAdapter must NOT set a raw Twilio "From" param — use MessagingServiceSid (I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY).`,
    );
  }

  if (!/SMS_LIVE_ENABLED_/.test(src)) {
    failures.push(
      `smsAdapter must consult the per-market kill-switch SMS_LIVE_ENABLED_<MKT> and skip without an HTTP call when off — I-PROPOSED-1161-SMS-MARKET-KILL-SWITCH.`,
    );
  }
}

if (failures.length > 0) {
  console.error("✗ I-PROPOSED-1161 SMS sender/kill-switch gate FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("✓ I-PROPOSED-1161 SMS sender/kill-switch gate passed.");
