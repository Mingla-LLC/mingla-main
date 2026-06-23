#!/usr/bin/env node
/**
 * ORCH-1227 (DEC-192) — Nigeria SMS via Termii invariants.
 *
 * I-PROPOSED-1227-NG-SMS-VIA-TERMII: the smsAdapter routes NG numbers to Termii
 * behind the existing region seam (transactional→`dnd` channel, marketing→
 * `generic` channel); every other country stays Twilio; NG is still gated by the
 * SMS_LIVE_ENABLED_NG kill-switch; the termii-delivery-status webhook FAIL-CLOSED
 * verifies its signature.
 *
 * This gate fails if:
 *   (a) the smsAdapter no longer references termiiSend / TERMII_ env, OR
 *   (b) the NG country branch (=== "NG") is removed, OR
 *   (c) the dnd/generic channel mapping is removed, OR
 *   (d) the SMS_LIVE_ENABLED_NG kill-switch (via resolveMarketKillSwitch /
 *       SMS_LIVE_ENABLED_) is removed, OR
 *   (e) the termii-delivery-status function is missing its signature verification.
 *
 * Mirrors the sibling 1161 gate
 * (i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

const adapterPath = join(root, "supabase/functions/_shared/adapters/smsAdapter.ts");
const webhookPath = join(root, "supabase/functions/termii-delivery-status/index.ts");

if (!existsSync(adapterPath)) {
  failures.push(
    `smsAdapter missing at supabase/functions/_shared/adapters/smsAdapter.ts — the unified SMS owner must exist (I-PROPOSED-1227-NG-SMS-VIA-TERMII).`,
  );
} else {
  const src = readFileSync(adapterPath, "utf8");

  if (!/termiiSend/.test(src) || !/TERMII_/.test(src)) {
    failures.push(
      `smsAdapter must route NG via the Termii provider (termiiSend + TERMII_ env) — I-PROPOSED-1227-NG-SMS-VIA-TERMII.`,
    );
  }

  // The NG country branch must exist in the routing seam.
  if (!/===\s*["']NG["']/.test(src)) {
    failures.push(
      `smsAdapter must keep the NG country branch (=== "NG") that routes to Termii — I-PROPOSED-1227-NG-SMS-VIA-TERMII.`,
    );
  }

  // The dnd/generic channel mapping must survive.
  if (!/["']dnd["']/.test(src) || !/["']generic["']/.test(src)) {
    failures.push(
      `smsAdapter must keep the Termii channel mapping (transactional→"dnd", marketing→"generic") — I-PROPOSED-1227-NG-SMS-VIA-TERMII.`,
    );
  }

  // The NG kill-switch must still gate (resolveMarketKillSwitch returns
  // SMS_LIVE_ENABLED_NG; the SMS_LIVE_ENABLED_ check is the gate itself).
  if (!/SMS_LIVE_ENABLED_/.test(src) || !/SMS_LIVE_ENABLED_NG/.test(src)) {
    failures.push(
      `smsAdapter must keep the SMS_LIVE_ENABLED_NG kill-switch (NG ships text-dark) — I-PROPOSED-1227-NG-SMS-VIA-TERMII.`,
    );
  }
}

if (!existsSync(webhookPath)) {
  failures.push(
    `termii-delivery-status webhook missing at supabase/functions/termii-delivery-status/index.ts — the NG delivery/suppression webhook must exist (I-PROPOSED-1227-NG-SMS-VIA-TERMII).`,
  );
} else {
  const wsrc = readFileSync(webhookPath, "utf8");
  // FAIL-CLOSED signature verification: must reference the signature header and
  // the HMAC-SHA512 verification, and return 403 when it fails.
  const hasSignatureHeader = /x-termii-signature/i.test(wsrc) || /X-Termii-Signature/.test(wsrc);
  const hasHmac = /SHA-512/.test(wsrc) || /hmacSha512/i.test(wsrc);
  const hasForbidden = /403/.test(wsrc);
  if (!hasSignatureHeader || !hasHmac || !hasForbidden) {
    failures.push(
      `termii-delivery-status must FAIL-CLOSED verify the X-Termii-Signature HMAC-SHA512 over the raw body and return 403 on failure — I-PROPOSED-1227-NG-SMS-VIA-TERMII.`,
    );
  }
}

if (failures.length > 0) {
  console.error("✗ I-PROPOSED-1227 NG-SMS-via-Termii gate FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("✓ I-PROPOSED-1227 NG-SMS-via-Termii gate passed.");
