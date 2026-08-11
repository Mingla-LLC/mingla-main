#!/usr/bin/env node
/** #1817 free-plan offering-push acceptance and callback convergence guard. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration:
    "supabase/migrations/20270314001817_issue_1817_free_plan_invite_send.sql",
  sqlTest:
    "supabase/migrations/__tests__/issue_1817_free_plan_invite_send.test.sql",
  push: "supabase/functions/_shared/push-utils.ts",
  adapter: "supabase/functions/_shared/adapters/pushAdapter.ts",
  denoTest:
    "supabase/functions/_shared/adapters/pushAdapter.issue1817.test.ts",
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
  const push = files.push ?? "";
  const adapter = files.adapter ?? "";
  const denoTest = files.denoTest ?? "";
  const invariant = files.invariant ?? "";

  need(
    push,
    'outcome: "accepted";\n    ok: true;\n    status: "sent";',
    "sender accepted type",
    failures,
  );
  need(
    push,
    'outcome: "accepted",\n        ok: true,\n        status: "sent",',
    "sender accepted result",
    failures,
  );
  need(
    adapter,
    'outcome: "accepted";\n    ok: true;\n    status: "sent";',
    "adapter accepted type",
    failures,
  );
  for (const source of [push, adapter]) {
    forbid(
      source,
      'outcome: "accepted";\n    ok: true;\n    status: "sending";',
      "accepted cannot remain sending",
      failures,
    );
    forbid(
      source,
      'outcome: "accepted";\n    ok: true;\n    status: "delivered";',
      "acceptance cannot claim delivery",
      failures,
    );
  }

  for (const token of [
    "CREATE OR REPLACE FUNCTION public.biz_record_offering_push_dispatch_result(",
    "CREATE OR REPLACE FUNCTION public.biz_reconcile_offering_push_event(",
    "v.provider_io_claimed_at IS NULL",
    "v.status IN ('sent','delivered')",
    "v.status='failed' AND v_has_matching_event",
    "provider_accepted_at=COALESCE(provider_accepted_at,now())",
    "sent_at=COALESCE(sent_at,provider_accepted_at,now())",
    "status=CASE WHEN v.status='delivered' OR v_has_received THEN 'delivered' ELSE 'sent' END",
    "WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'",
    "WHEN (provider_accepted_at IS NOT NULL OR v_has_sent) AND v_has_failed THEN 'provider_partial_failure'",
    "PERFORM public.issue_1770_project_offering_push_delivery(v.id)",
    "REVOKE ALL ON FUNCTION public.biz_record_offering_push_dispatch_result(uuid,text,uuid,uuid,text,boolean)",
    "GRANT EXECUTE ON FUNCTION public.biz_reconcile_offering_push_event(uuid,text,timestamptz,uuid,uuid,uuid,uuid)",
  ]) need(migration, token, "migration contract", failures);
  if (count(migration, "CREATE OR REPLACE FUNCTION public.") !== 2) {
    failures.push("migration scope: must replace exactly two functions");
  }
  if (count(migration, "PERFORM public.issue_1770_project_offering_push_delivery(v.id)") !== 2) {
    failures.push("projection: both result and event owners must project in-transaction");
  }
  const reducerAcceptance = migration.indexOf(
    "WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'",
  );
  const reducerFailure = migration.indexOf("WHEN v_has_failed THEN 'failed'", reducerAcceptance);
  if (reducerAcceptance < 0 || reducerFailure < reducerAcceptance) {
    failures.push("event precedence: acceptance/sent must outrank failure");
  }
  const received = migration.indexOf("WHEN v_has_received THEN 'delivered'");
  if (received < 0 || received > reducerAcceptance) {
    failures.push("event precedence: received must remain the sole delivered owner");
  }
  forbid(migration, "WHEN v_has_failed THEN 'delivered'", "delivery truth", failures);
  forbid(migration, "status='sending',provider_app_id=p_provider_app_id", "accepted SQL", failures);
  forbid(migration, "sent_at=NULL", "acceptance immutability", failures);
  forbid(migration, "provider_accepted_at=NULL", "acceptance immutability", failures);

  for (const token of [
    "T-1817-03 FAIL: free-plan acceptance did not settle Sent/group completion",
    "T-1817-04 FAIL: conflicting provider tuple was accepted",
    "T-1817-05 FAIL: failed-before-result did not retain accepted truth",
    "T-1817-06 FAIL: late failure erased or retried accepted Sent",
    "T-1817-07 FAIL: ambiguous outcome fabricated acceptance",
    "T-1817-08 FAIL: mixed terminal group did not become partial",
    "T-1817-09 FAIL: anon invoked service-only result RPC",
    "EXISTS(SELECT 1 FROM public.offering_push_provider_events WHERE attempt_id=v_attempt)",
  ]) need(sqlTest, token, "PG17 state matrix", failures);

  for (const token of [
    "#1817 canonical OneSignal acceptance is Sent, never Delivered",
    'status: "sent"',
    'new Response("", { status: 429',
    'new Response("", { status: 408',
    'new Response("", { status: 500',
    'new Response(JSON.stringify({ id: "not-a-uuid" })',
    'safeCode: "provider_outcome_unknown"',
    'assertEquals(result.safeCode, "provider_config_missing")',
  ]) need(denoTest, token, "Deno result matrix", failures);

  for (const token of [
    "I-OFFERING-PROVIDER-ACCEPTANCE-1 (ACTIVE)",
    "canonical OneSignal Create Message ID is durable Sent/provider-accepted truth",
    "never device-delivery truth",
    "without Event Streams",
    "may never erase provider acceptance",
  ]) need(invariant, token, "DRAFT invariant", failures);

  const runtime = `${migration}\n${push}\n${adapter}`.toLowerCase();
  for (const forbidden of [
    "cron.schedule",
    "setinterval(",
    "settimeout(async",
    "view message",
    "view-message",
    "/notifications/",
    "onesignal_event_stream_token",
    "confirmed receipt",
  ]) forbid(runtime, forbidden, "no paid/polling dependency", failures);
  forbid(
    push,
    "console.log(\"[push-utils] push accepted\", { app: appType, providerMessageId:",
    "raw provider logging",
    failures,
  );
  forbid(push, "console.log(body", "raw provider logging", failures);

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
      "push",
      'outcome: "accepted",\n        ok: true,\n        status: "sent",',
      'outcome: "accepted",\n        ok: true,\n        status: "sending",',
      "accepted result restored to sending",
    ],
    [
      "adapter",
      'outcome: "accepted";\n    ok: true;\n    status: "sent";',
      'outcome: "accepted";\n    ok: true;\n    status: "delivered";',
      "adapter fabricated delivery",
    ],
    [
      "migration",
      "WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'",
      "WHEN v_has_sent THEN 'sent'",
      "persisted acceptance removed from reducer",
    ],
    [
      "migration",
      "WHEN (provider_accepted_at IS NOT NULL OR v_has_sent) AND v_has_failed THEN 'provider_partial_failure'",
      "WHEN (provider_accepted_at IS NOT NULL OR v_has_sent) AND v_has_failed THEN 'provider_push_failed'",
      "late failure erased partial truth",
    ],
    [
      "migration",
      "BEGIN;",
      "BEGIN;\nSELECT cron.schedule('poll-provider','* * * * *','SELECT 1');",
      "poller added",
    ],
    [
      "sqlTest",
      "T-1817-03 FAIL: free-plan acceptance did not settle Sent/group completion",
      "T-1817-03 removed",
      "happy-path SQL proof removed",
    ],
  ];
  for (const [key, before, after, label] of mutations) {
    if (!clean[key].includes(before)) throw new Error(`self-test fixture missing: ${label}`);
    const broken = { ...clean, [key]: clean[key].replace(before, after) };
    if (violations(broken).length === 0) throw new Error(`mutation survived: ${label}`);
  }
  console.log("#1817 free-plan invite-send self-test PASS (6 true mutations)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1817 free-plan invite-send guard PASS");
}
