#!/usr/bin/env node
/** #1817 tester guard: callback/result ordering may enrich, never downgrade truth. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration:
    "supabase/migrations/20270314001817_issue_1817_free_plan_invite_send.sql",
  sqlTest:
    "supabase/migrations/__tests__/issue_1817_free_plan_invite_send.test.sql",
};

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function before(source, earlier, later, label, failures) {
  const a = source.indexOf(earlier);
  const b = source.indexOf(later, Math.max(0, a));
  if (a < 0 || b < 0 || a >= b) failures.push(`${label}: precedence drifted`);
}

export function violations(files) {
  const failures = [];
  const migration = files.migration ?? "";
  const sqlTest = files.sqlTest ?? "";

  // Callback-before-result may admit a failed row only when an applied event
  // for the exact attempt/app/message tuple proves that the callback won the race.
  for (const token of [
    "v.status='failed' AND v_has_matching_event",
    "provider_app_id=p_provider_app_id",
    "provider_message_id=p_provider_message_id",
    "WHERE attempt_id=v.id AND disposition='applied'",
    "v.status IN ('sent','delivered')",
    "AND v.provider_app_id=p_provider_app_id",
    "AND v.provider_message_id=p_provider_message_id::text",
  ]) need(migration, token, "callback-first exact tuple", failures);

  // Create acceptance is Sent unless a genuine Received callback already made
  // the row Delivered. Failed evidence may add detail but cannot own status.
  for (const token of [
    "status=CASE WHEN v.status='delivered' OR v_has_received THEN 'delivered' ELSE 'sent' END",
    "WHEN v.status='delivered' OR v_has_received THEN NULL",
    "WHEN v_has_failed THEN 'provider_partial_failure'",
    "is_retryable=false",
  ]) need(migration, token, "accepted result monotonicity", failures);

  const reducer = migration.slice(
    migration.indexOf("IF v_disposition='applied' THEN"),
    migration.indexOf("RETURN jsonb_build_object('disposition',v_disposition)"),
  );
  before(
    reducer,
    "WHEN v_has_received THEN 'delivered'",
    "WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'",
    "Received must outrank acceptance",
    failures,
  );
  before(
    reducer,
    "WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'",
    "WHEN v_has_failed THEN 'failed'",
    "acceptance must outrank late failure",
    failures,
  );
  for (const token of [
    "WHEN (provider_accepted_at IS NOT NULL OR v_has_sent) AND v_has_failed THEN 'provider_partial_failure'",
    "WHEN v_has_received THEN NULL",
    "delivered_at=CASE WHEN v_has_received THEN COALESCE(delivered_at,p_occurred_at) ELSE delivered_at END",
  ]) need(reducer, token, "reducer enrichment", failures);

  for (const forbidden of [
    "WHEN v_has_failed THEN 'delivered'",
    "WHEN v_has_failed THEN COALESCE(delivered_at",
    "ELSE 'delivered' END,\n      provider_app_id",
    "WHEN v_has_failed THEN 'failed'\n        WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'",
  ]) {
    if (migration.includes(forbidden)) {
      failures.push(`monotonic state: forbidden ${forbidden}`);
    }
  }

  // The executable PG17 matrix must exercise both temporal directions and the
  // sole Delivered owner, so the structural guard cannot pass beside a hollow test.
  for (const token of [
    "failed callback before result becomes accepted Sent + partial detail",
    "received callback before result remains the sole Delivered owner",
    "accepted -> failed -> received -> failed never erases Sent/Delivered",
    "safe_reason_code='provider_partial_failure' AND NOT is_retryable",
    "T-1817-06 FAIL: failure after received downgraded Delivered",
    "delivered_at IS NULL",
  ]) need(sqlTest, token, "adversarial PG17 matrix", failures);

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
      "WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'\n        WHEN v_has_failed THEN 'failed'",
      "WHEN v_has_failed THEN 'failed'\n        WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'",
      "late failure downgraded accepted Sent",
    ],
    [
      "migration",
      "v.status='failed' AND v_has_matching_event",
      "v.status='failed'",
      "callback-first failed row accepted without event proof",
    ],
    [
      "migration",
      "THEN 'delivered' ELSE 'sent' END,",
      "THEN 'delivered' ELSE 'delivered' END,",
      "Create acceptance fabricated Delivered",
    ],
    [
      "migration",
      "delivered_at=CASE WHEN v_has_received THEN COALESCE(delivered_at,p_occurred_at) ELSE delivered_at END",
      "delivered_at=CASE WHEN v_has_failed THEN COALESCE(delivered_at,p_occurred_at) ELSE delivered_at END",
      "failed receipt fabricated delivered_at",
    ],
    [
      "sqlTest",
      "T-1817-06 FAIL: failure after received downgraded Delivered",
      "T-1817-06 removed",
      "temporal state-matrix assertion removed",
    ],
  ];
  for (const [key, oldText, newText, label] of mutations) {
    if (!clean[key].includes(oldText)) throw new Error(`self-test fixture missing: ${label}`);
    const broken = { ...clean, [key]: clean[key].replace(oldText, newText) };
    if (violations(broken).length === 0) throw new Error(`mutation survived: ${label}`);
  }
  console.log("#1817 tester adversarial self-test PASS (5 true mutations)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1817 tester adversarial ordering guard PASS");
}
