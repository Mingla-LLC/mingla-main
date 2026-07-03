#!/usr/bin/env node
/**
 * ORCH-1270 — I-PROPOSED-1270-QUIET-HOURS-DEFERS-NOT-FAILS (DRAFT until CLOSE).
 *
 * Rule: a marketing SMS recipient who is outside the recipient-local quiet-hours
 * window with a RESOLVABLE timezone is written status='deferred' (retryable),
 * NEVER the old terminal status='failed' + failure_reason='quiet_hours_deferred'.
 *
 * This gate scans supabase/functions/marketing-send/index.ts (comments stripped)
 * and FAILS if:
 *   (a) the exported decideSmsDisposition helper is missing, OR
 *   (b) there is no `status: "deferred"` write (the defer path was removed), OR
 *   (c) the OLD terminal-fail-on-quiet-hours pattern is back: an insert/upsert
 *       pairing status:'failed' with failure_reason:'quiet_hours_deferred'.
 *
 * Mirrors the modular gate pattern (sibling: i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = "supabase/functions/marketing-send/index.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluate = (rawCode) => {
  const code = stripComments(rawCode);
  const failures = [];

  if (!/export function decideSmsDisposition\b/.test(code)) {
    failures.push(
      "the exported pure helper `decideSmsDisposition` must exist (SPEC §5.1). I-PROPOSED-1270-QUIET-HOURS-DEFERS-NOT-FAILS.",
    );
  }

  if (!/status:\s*["']deferred["']/.test(code)) {
    failures.push(
      "out-of-window recipients must be written `status: \"deferred\"` (retryable), not terminal-failed. I-PROPOSED-1270-QUIET-HOURS-DEFERS-NOT-FAILS.",
    );
  }

  // The OLD defect: a write pairing a 'failed' status with the quiet-hours label.
  // (The label survives ONLY as an informational failure_reason on the DEFERRED
  // write — that pairs with status:'deferred', not 'failed', so it does not match.)
  const oldTerminalFail =
    /status:\s*["']failed["'][^;]*failure_reason:\s*["']quiet_hours_deferred["']/;
  const oldTerminalFailReversed =
    /failure_reason:\s*["']quiet_hours_deferred["'][^;]*status:\s*["']failed["']/;
  if (oldTerminalFail.test(code) || oldTerminalFailReversed.test(code)) {
    failures.push(
      "the pre-ORCH-1270 defect is back: a write pairs status:'failed' with failure_reason:'quiet_hours_deferred'. Quiet-hours recipients must DEFER. I-PROPOSED-1270-QUIET-HOURS-DEFERS-NOT-FAILS.",
    );
  }

  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const GOOD = `
    export function decideSmsDisposition(phone, cc, now, existing) {
      if (tz === null) return { action: "fail", reason: "unknown_timezone" };
      return { action: "defer", next_attempt_at: iso, attempt_count: 1 };
    }
    // in the loop:
    await supabase.from("marketing_messages").upsert({
      campaign_id: c.id, recipient_phone: phone, channel: "sms",
      status: "deferred", failure_reason: "quiet_hours_deferred",
    }, { onConflict: "campaign_id,recipient_phone" });
  `;
  // BAD_A: reverted to the old terminal-fail on quiet hours.
  const BAD_A = `
    if (!isWithinQuietHours(phone, cc, now)) {
      await supabase.from("marketing_messages").insert({
        campaign_id: c.id, recipient_phone: phone, channel: "sms",
        status: "failed", failure_reason: "quiet_hours_deferred",
      });
      continue;
    }
  `;
  // BAD_B: helper + defer write both gone.
  const BAD_B = `
    if (!isWithinQuietHours(phone, cc, now)) { continue; }
  `;
  const g = evaluate(GOOD), a = evaluate(BAD_A), b = evaluate(BAD_B);
  const ok = g.length === 0 && a.length >= 1 && b.length >= 1;
  if (!ok) {
    console.error("ORCH-1270 defers-not-fails SELF-TEST failed:", { g, a, b });
    process.exit(1);
  }
  console.log("ORCH-1270 quiet-hours-defers-not-fails gate self-test passed.");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const abs = join(root, TARGET);
const failures = [];
if (!existsSync(abs)) {
  failures.push(`${TARGET}: marketing-send edge function not found.`);
} else {
  failures.push(...evaluate(readFileSync(abs, "utf8")));
}

if (failures.length > 0) {
  console.error("ORCH-1270 quiet-hours-defers-not-fails gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1270 quiet-hours-defers-not-fails gate passed.");
