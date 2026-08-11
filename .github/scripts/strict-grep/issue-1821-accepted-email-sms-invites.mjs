#!/usr/bin/env node
/** #1821 accepted email/SMS invitation truth and serialized group guard. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration:
    "supabase/migrations/20270314001821_issue_1821_accepted_email_sms_invites.sql",
  sqlTest:
    "supabase/migrations/__tests__/issue_1821_accepted_email_sms_invites.test.sql",
  sender: "supabase/functions/marketing-send/index.ts",
  denoTest:
    "supabase/functions/marketing-send/issue-1821-accepted-email-sms-invites.test.ts",
  invariant: "docs/INVARIANT_REGISTRY.md",
};

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbid(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

function count(source, token) {
  return source.split(token).length - 1;
}

export function violations(files) {
  const failures = [];
  const migration = files.migration ?? "";
  const sqlTest = files.sqlTest ?? "";
  const sender = files.sender ?? "";
  const denoTest = files.denoTest ?? "";
  const invariant = files.invariant ?? "";

  for (const token of [
    "CREATE OR REPLACE FUNCTION public.issue_1821_project_offering_send_group(",
    "CREATE OR REPLACE FUNCTION public.issue_1770_project_offering_push_delivery(",
    "CREATE OR REPLACE FUNCTION public.issue_1770_reconcile_marketing_message()",
    "RAISE EXCEPTION 'offering_send_group_not_found'",
    "count(*) FILTER(WHERE status IN ('queued','sending'))",
    "count(*) FILTER(WHERE status IN ('sent','delivered'))",
    "WHEN v_failed=(v_total-v_suppressed) THEN 'failed'",
    "PERFORM public.issue_1821_project_offering_send_group(",
    "RAISE EXCEPTION 'offering_marketing_message_attempt_ambiguous'",
    "RAISE EXCEPTION 'offering_marketing_message_tuple_mismatch'",
    "RAISE EXCEPTION 'offering_marketing_message_provider_mismatch'",
    "IF NEW.provider_message_id IS NOT NULL\n    AND btrim(NEW.provider_message_id)=''",
    "provider_accepted_at=COALESCE(",
    "WHEN status='delivered' OR NEW.status='delivered' THEN 'delivered'",
    "ELSE 'sent'",
    "THEN 'provider_partial_failure'",
    "THEN 'provider_outcome_unknown'",
    "THEN 'campaign_delivery_failed'",
    "THEN 'provider_io_disabled'",
    "REVOKE ALL ON FUNCTION public.issue_1821_project_offering_send_group(uuid)",
    "GRANT EXECUTE ON FUNCTION public.issue_1770_reconcile_marketing_message()",
  ]) need(migration, token, "migration contract", failures);
  if (count(migration, "CREATE OR REPLACE FUNCTION public.") !== 3) {
    failures.push("migration scope: exactly three approved functions required");
  }
  const projectorStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1821_project_offering_send_group(",
  );
  const groupLock = migration.indexOf("FOR UPDATE;", projectorStart);
  const recount = migration.indexOf(
    "FROM public.brand_offering_invite_delivery_attempts",
    projectorStart,
  );
  if (projectorStart < 0 || groupLock < projectorStart || recount < 0 || groupLock > recount) {
    failures.push("serialization: group row lock must precede the all-attempt recount");
  }
  const matchedTupleCheck = migration.indexOf(
    "IF v_attempt.provider_message_id IS NOT NULL\n    AND NEW.provider_message_id IS NOT NULL\n    AND v_attempt.provider_message_id IS DISTINCT FROM NEW.provider_message_id",
  );
  const stateBranch = migration.indexOf("IF NEW.status IN ('sent','delivered') THEN");
  if (matchedTupleCheck < 0 || stateBranch < 0 || matchedTupleCheck > stateBranch) {
    failures.push("provider identity: cross-state tuple check must precede every matched state branch");
  }
  forbid(
    migration,
    "WHEN status='delivered' OR NEW.status='delivered' THEN 'delivered'\n        ELSE 'sending'",
    "accepted state",
    failures,
  );
  forbid(migration, "actual_cost_minor=", "cost authority", failures);
  forbid(migration, "DROP TRIGGER", "trigger identity", failures);
  forbid(migration, "CREATE TRIGGER", "trigger identity", failures);
  forbid(migration, "mingla.issue1770_push_result_rpc", "push transition bypass", failures);

  for (const token of [
    "export async function persistEmailSentTerminal(",
    '.select("id,status,provider_message_id")',
    "for (let attempt = 0; attempt < 2; attempt += 1)",
    "row.status === \"sent\" && row.provider_message_id === providerMessageId",
    "email_sent_terminal_update_lost:${messageId}:${safeError}",
    "await persistEmailSentTerminal(",
    "sent += 1;",
    'error: "resend_success_response_invalid"',
    "(value as { id: string }).id.trim().length > 0",
  ]) need(sender, token, "Resend/terminal-write boundary", failures);
  const caller = sender.slice(
    sender.indexOf("if (sendOutcome.ok)"),
    sender.indexOf("} else if (providerClaimed", sender.indexOf("if (sendOutcome.ok)")),
  );
  if (!/await persistEmailSentTerminal\([\s\S]*?\);[\s\S]*?sent \+= 1;/.test(caller)) {
    failures.push("email count: sent may advance only after verified persistence");
  }
  forbid(
    sender,
    "return { ok: true, providerId };",
    "invalid Resend success",
    failures,
  );

  for (const token of [
    "T-1821-01 FAIL: email accepted did not settle Sent/group completion",
    "T-1821-02 FAIL: SMS provider % did not settle Sent",
    "T-1821-03 FAIL: conflicting provider tuple was accepted",
    "T-1821-03 FAIL: failed provider tuple conflict was accepted",
    "T-1821-03 FAIL: bounced provider tuple conflict was accepted",
    "T-1821-03 FAIL: failed provider conflict did not roll back all rows",
    "T-1821-03 FAIL: bounced provider conflict did not roll back all rows",
    "T-1821-03 FAIL: present blank provider id was accepted",
    "T-1821-04 FAIL: accepted then failed downgraded Sent",
    "T-1821-05 FAIL: post-claim ambiguity fabricated acceptance or retry",
    "T-1821-06 FAIL: accepted + failed was not partial",
    "T-1821-07 FAIL: group lock does not precede attempt recount",
    "T-1821-07 FAIL: concurrent email/SMS/push projection published stale totals",
    "T-1821-07 PASS: concurrent email/SMS/push completion serialized to Sent=3",
    "dblink_send_query(",
    "T-1821-08 FAIL: duplicate correlation did not fail closed",
    "T-1821-09 FAIL: function grants/search path or RLS drifted",
  ]) need(sqlTest, token, "PG17 state matrix", failures);

  for (const token of [
    "#1821 Resend success requires a nonblank canonical id",
    "#1821 Resend 2xx without canonical id is ambiguous, never accepted",
    "#1821 email terminal write retries once and accepts only exact readback",
    "#1821 zero-row or mismatched readback retries then fails loud",
    "#1821 two database failures expose only the safe error code",
  ]) need(denoTest, token, "Deno acceptance/write matrix", failures);

  for (const token of [
    "I-PROPOSED-OFFERING-EMAIL-SMS-ACCEPTANCE-1 (DRAFT)",
    "documented successful Resend/Twilio/Termii send response",
    "serialized group rollup",
    "may never erase acceptance",
    "depend on a paid receipt feature",
  ]) need(invariant, token, "DRAFT invariant", failures);

  const runtime = `${migration}\n${sender}`.toLowerCase();
  for (const token of [
    "cron.schedule",
    "onesignal_event_stream",
    "confirmed receipt",
    "setinterval(",
    "actual_cost_minor=",
  ]) forbid(runtime, token, "no paid/polling/accounting expansion", failures);

  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(PATHS).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(ROOT, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const clean = readFiles();
  const baseline = violations(clean);
  if (baseline.length) throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  const mutations = [
    [
      "migration",
      "WHEN status='delivered' OR NEW.status='delivered' THEN 'delivered'\n        ELSE 'sent'",
      "WHEN status='delivered' OR NEW.status='delivered' THEN 'delivered'\n        ELSE 'sending'",
      "accepted target reverted to Sending",
    ],
    [
      "migration",
      "IF v_attempt.provider_message_id IS NOT NULL\n    AND NEW.provider_message_id IS NOT NULL\n    AND v_attempt.provider_message_id IS DISTINCT FROM NEW.provider_message_id",
      "IF v_attempt.provider_message_id IS NOT NULL\n    AND NEW.status IN ('sent','delivered')\n    AND v_attempt.provider_message_id IS DISTINCT FROM NEW.provider_message_id",
      "cross-state provider tuple check narrowed back to accepted states",
    ],
    [
      "migration",
      "FOR UPDATE;",
      ";",
      "group row lock removed",
    ],
    [
      "sender",
      "(value as { id: string }).id.trim().length > 0",
      "true",
      "blank Resend id accepted",
    ],
    [
      "sender",
      '.select("id,status,provider_message_id")',
      '.select("id")',
      "terminal write readback weakened",
    ],
    [
      "sqlTest",
      "T-1821-01 FAIL: email accepted did not settle Sent/group completion",
      "T-1821-01 removed",
      "happy-path SQL proof removed",
    ],
    [
      "denoTest",
      "#1821 zero-row or mismatched readback retries then fails loud",
      "#1821 zero-row proof removed",
      "zero-row terminal proof removed",
    ],
  ];
  for (const [key, before, after, label] of mutations) {
    if (!clean[key].includes(before)) throw new Error(`self-test fixture missing: ${label}`);
    const broken = { ...clean, [key]: clean[key].replace(before, after) };
    if (violations(broken).length === 0) throw new Error(`mutation survived: ${label}`);
  }
  console.log("#1821 accepted email/SMS invite self-test PASS (7 true mutations)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1821 accepted email/SMS invite guard PASS");
}
