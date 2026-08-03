#!/usr/bin/env node
/**
 * ORCH-1227 (DEC-192) — Nigeria SMS via Termii invariants.
 *
 * I-PROPOSED-1227-NG-SMS-VIA-TERMII: the smsAdapter routes NG numbers to Termii
 * behind the existing region seam; every other country stays Twilio; NG is still
 * gated by the SMS_LIVE_ENABLED_NG kill-switch; the termii-delivery-status
 * webhook FAIL-CLOSED verifies its signature.
 *
 * #1518 (2026-08-03) — INTERIM channel routing, an ACCEPTED OPERATOR DECISION
 * and NOT the intended design. DEC-192's transactional→`dnd` mapping is dead:
 * Termii returns 400 "Country Inactive" on `dnd` for Nigeria (the route was
 * never activated — proven live in #1480), while `generic` delivers. BOTH NG
 * message classes therefore ride `generic`, and no NG code path may emit `dnd`.
 * Accepted costs, recorded so nobody reads this as the target state: `generic`
 * is blacked out for Nigerian MTN numbers 20:00-08:00 WAT; it is not the NCC
 * DND corporate route so DND-registered recipients may never be reached; and it
 * departs from Termii's documented guidance against transactional traffic on
 * `generic`. REVERT when #1480 lands DND activation.
 *
 * This gate fails if:
 *   (a) the smsAdapter no longer references termiiSend / TERMII_ env, OR
 *   (b) the NG country branch (=== "NG") is removed, OR
 *   (c1) the NG call site stops passing "generic" unconditionally, OR
 *   (c2) any NG code path emits the `dnd` channel again, OR
 *   (c3) the provider-error-string `dnd` blacklisted classifier is removed, OR
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

  // #1518 INTERIM — NG channel selection. SUPERSEDES the DEC-192 check that
  // required the transactional→"dnd" mapping to survive. Termii's `dnd` route
  // returns 400 "Country Inactive" for Nigeria (never activated on this
  // account; proven live in #1480), so BOTH NG message classes now send over
  // `generic` and NO NG code path may emit `dnd`.
  //
  // Note the OLD check (`/["']dnd["']/ && /["']generic["']/`) would now pass
  // VACUOUSLY — the string "dnd" still appears in termiiSend's channel union
  // type and in the provider-error-string classifier — so it would have gone on
  // asserting a mapping that no longer exists. These checks are falsifiable:
  // restoring the `messageType === "marketing" ? "generic" : "dnd"` ternary
  // re-introduces a bare "dnd" literal outside those two sanctioned sites and
  // fails (c2).
  //
  // QUOTE CLASS — every `dnd`/`generic` pattern below uses ["'`], NOT ["'].
  // #1518 tester finding P2-1: TypeScript accepts a no-substitution TEMPLATE
  // LITERAL as a string-literal type, so `termiiSend(to, body, \`dnd\`)` (with
  // backticks) type-checks cleanly, restores exactly the behaviour this gate
  // exists to block, and slipped past the original ["'] class while (c1) still
  // matched a sibling quoted "generic" call in the other ternary arm. The
  // backtick is in EVERY class — the two positive checks, the two scrub
  // patterns, and the negative check — so a mixed-quote write-up (e.g. a
  // backtick union type, or a backtick error classifier) cannot desync the
  // scrub from the negative check and re-open the hole from the other side.
  //
  // KNOWN RESIDUAL, deliberately not chased here: a SUBSTITUTED template
  // (`dn${x}`) or other runtime-computed channel string cannot be caught by any
  // static text gate. That class is covered at runtime instead, by the tester's
  // construction-agnostic C-1 assertion (no `dnd` anywhere in the serialized
  // Termii payload) plus T-1/T-2b in the implementor suite. Static + runtime
  // together are the defence; neither alone is claimed to be sufficient.
  //
  // The channel checks below evaluate CODE, not prose — the #1518 rationale
  // comments quote the retired "dnd" mapping verbatim on purpose so a future
  // reader can see exactly what to restore. Mirrors the sibling 1282 gate's
  // stripLineComments (the `[^:]` guard keeps `https://` URLs intact).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  // (c1) the NG call site must pass the literal "generic" UNCONDITIONALLY.
  if (!/termiiSend\(\s*to,\s*body,\s*["'`]generic["'`]\s*,?\s*\)/.test(code)) {
    failures.push(
      `smsAdapter's NG branch must call termiiSend(to, body, "generic") unconditionally — #1518 interim, both NG message classes ride Termii's generic channel because dnd 400s "Country Inactive" (I-PROPOSED-1227-NG-SMS-VIA-TERMII).`,
    );
  }

  // (c2) no NG code path may emit `dnd` as a channel. Two sites legitimately
  // contain the substring and are scrubbed before the check:
  //   - termiiSend's channel union type (the #1480 revert target, unreachable),
  //   - the `includes("dnd")` provider-ERROR-STRING classifier, which is the
  //     honest signal that a DND-registered recipient rejected the send and
  //     MUST stay (it classifies responses, never channel selection).
  const scrubbed = code
    .replace(/channel:\s*["'`]dnd["'`]\s*\|\s*["'`]generic["'`]/g, "channel: <union>")
    .replace(/includes\(\s*["'`]dnd["'`]\s*\)/g, "includes(<provider-error-token>)");
  if (/["'`]dnd["'`]/.test(scrubbed)) {
    failures.push(
      `smsAdapter must NOT emit the Termii "dnd" channel from any NG code path while the #1518 interim stands (dnd returns 400 "Country Inactive" — see #1480). Revert this gate together with the mapping when Termii activates DND — I-PROPOSED-1227-NG-SMS-VIA-TERMII.`,
    );
  }

  // (c3) the provider-error-string `blacklisted` classifier must survive — it is
  // the only honest signal that `generic` failed to reach a DND-registered
  // recipient (#1518 accepted trade-off b). Explicitly NOT channel selection.
  if (!/includes\(\s*["'`]dnd["'`]\s*\)/.test(code)) {
    failures.push(
      `smsAdapter must keep the termiiSend blacklisted classifier reading provider error strings for "dnd" — it is the honest signal for the #1518 DND-register trade-off (I-PROPOSED-1227-NG-SMS-VIA-TERMII).`,
    );
  }

  if (!/["'`]generic["'`]/.test(code)) {
    failures.push(
      `smsAdapter must keep the Termii "generic" channel literal — I-PROPOSED-1227-NG-SMS-VIA-TERMII.`,
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
