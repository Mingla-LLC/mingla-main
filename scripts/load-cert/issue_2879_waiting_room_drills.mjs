#!/usr/bin/env node
/**
 * #2879 / #2947 — waiting-room load-cert drill catalog (mocked providers).
 *
 * This file is the eng checklist for certification before public on-sale.
 * Live 150k/100k runs and Paystack canary are Gate 0 / Seth-owned; this suite
 * pins the drill names and invariants so they cannot silently disappear.
 *
 * Run: node --test scripts/load-cert/issue_2879_waiting_room_drills.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const DRILLS = Object.freeze([
  "retry_storm_no_duplicate_initialize",
  "provider_429_pauses_admission_keeps_queue_position",
  "late_success_after_local_expiry_recovery",
  "webhook_before_redirect_and_reverse",
  "capacity_cut_releases_newest_first",
  "identity_loss_device_token_not_ip",
  "operator_arm_disarm_quiet_path",
  "sold_out_goes_waitlist_never_queue",
  "inventory_150k_attempts_100k_no_oversell",
]);

describe("#2879 waiting-room load-cert catalog", () => {
  it("ships the approved drill list", () => {
    assert.equal(DRILLS.length, 9);
    assert.ok(DRILLS.includes("inventory_150k_attempts_100k_no_oversell"));
  });

  it("slice-2 migrations + SQL suites exist", () => {
    for (const rel of [
      "supabase/migrations/20271027002947_issue_2947_queue_admission_foundation.sql",
      "supabase/migrations/20271027102947_issue_2947_release_newest_holds_fn.sql",
      "supabase/migrations/__tests__/issue_2947_queue_admission.implementor.happy.pg17.test.sql",
      "supabase/migrations/__tests__/issue_2947_queue_admission.tester.adversarial.pg17.test.sql",
      "docs/runbooks/WAITING_ROOM_ADMISSION.md",
    ]) {
      assert.ok(fs.existsSync(path.join(root, rel)), rel);
    }
  });

  it("foundation migration wires cron.job with admit_due (not expire)", () => {
    const sql = fs.readFileSync(
      path.join(root, "supabase/migrations/20271027002947_issue_2947_queue_admission_foundation.sql"),
      "utf8",
    );
    assert.match(sql, /cron\.schedule/);
    assert.match(sql, /issue_2947_queue_admission_driver/);
    assert.match(sql, /issue_2947_queue_admit_due/);
    // Comments may mention expired; the admit path must not SET status='expired'.
    const admitFn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.issue_2947_queue_admit_batch"));
    assert.doesNotMatch(admitFn, /SET\s+status\s*=\s*'expired'/i);
  });

  it("does not re-emit pg_direct_event_checkout_bundle", () => {
    const sql = fs.readFileSync(
      path.join(root, "supabase/migrations/20271027002947_issue_2947_queue_admission_foundation.sql"),
      "utf8",
    );
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.pg_direct_event_checkout_bundle/i);
  });
});

export { DRILLS };
