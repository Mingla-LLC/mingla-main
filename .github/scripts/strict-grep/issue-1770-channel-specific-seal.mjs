#!/usr/bin/env node
/** #1770 linked-account channel identity and non-retryable stale guard. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration:
    "supabase/migrations/20270318001770_issue_1770_channel_specific_seal.sql",
  sqlTest:
    "supabase/migrations/__tests__/issue_1770_channel_specific_seal.test.sql",
};

function count(source, token) {
  return source.split(token).length - 1;
}

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

export function violations(files) {
  const failures = [];
  const migration = files.migration ?? "";
  const sqlTest = files.sqlTest ?? "";

  for (const token of [
    "CREATE OR REPLACE FUNCTION public.biz_seal_offering_execution_snapshot(",
    "CREATE OR REPLACE FUNCTION public.biz_execute_offering_send_group(",
    "v_candidate->>'channel'<>'push' AND COALESCE(v_candidate->>'contactMethodId','')<>COALESCE(v_live_candidate->>'contactMethodId','')",
    "v_candidate->>'channel'='push' AND COALESCE(v_candidate->>'recipientUserId','')<>COALESCE(v_live_candidate->>'recipientUserId','')",
  ]) need(migration, token, "migration contract", failures);

  if (count(migration, "CREATE OR REPLACE FUNCTION public.") !== 2) {
    failures.push("migration scope: exactly seal and execute may be replaced");
  }
  if (migration.includes("ERRCODE='40001'")) {
    failures.push("retry contract: expected stale validation uses retryable 40001");
  }
  if (count(migration, "offering_execution_snapshot_stale' USING ERRCODE='22023'") !== 4) {
    failures.push("retry contract: all four stale exits must use non-retryable 22023");
  }
  if (migration.includes(
    "COALESCE(v_candidate->>'contactMethodId','')<>COALESCE(v_live_candidate->>'contactMethodId','') OR COALESCE(v_candidate->>'recipientUserId','')<>COALESCE(v_live_candidate->>'recipientUserId','')",
  )) failures.push("channel identity: unconditional cross-channel comparison returned");

  for (const token of [
    "T-1770-SEAL-01 PASS: linked user is ignored for email target comparison",
    '"recipientUserId":null',
    "SET record_state='retired',retired_at=now()",
    "T-1770-SEAL-02 PASS: real target drift fails promptly with non-retryable 22023",
    "v_state <> '22023'",
    "T-1770-SEAL-03 PASS: execute stale quote is non-retryable",
    "public.biz_execute_offering_send_group(",
  ]) need(sqlTest, token, "PG17 regression", failures);

  return failures;
}

function readFiles() {
  return Object.fromEntries(Object.entries(PATHS).map(([key, relative]) => [
    key,
    fs.readFileSync(path.join(ROOT, relative), "utf8"),
  ]));
}

function selfTest() {
  const clean = readFiles();
  const baseline = violations(clean);
  if (baseline.length) throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  const mutations = [
    [
      "migration",
      "v_candidate->>'channel'<>'push' AND COALESCE(v_candidate->>'contactMethodId','')<>COALESCE(v_live_candidate->>'contactMethodId','')",
      "COALESCE(v_candidate->>'contactMethodId','')<>COALESCE(v_live_candidate->>'contactMethodId','')",
      "email/SMS channel guard removed",
    ],
    [
      "migration",
      "offering_execution_snapshot_stale' USING ERRCODE='22023'",
      "offering_execution_snapshot_stale' USING ERRCODE='40001'",
      "retryable stale SQLSTATE restored",
    ],
    [
      "sqlTest",
      "T-1770-SEAL-02 PASS: real target drift fails promptly with non-retryable 22023",
      "T-1770-SEAL-02 proof removed",
      "actual target-drift proof removed",
    ],
  ];
  for (const [key, before, after, label] of mutations) {
    if (!clean[key].includes(before)) throw new Error(`self-test fixture missing: ${label}`);
    const broken = { ...clean, [key]: clean[key].replace(before, after) };
    if (violations(broken).length === 0) throw new Error(`mutation survived: ${label}`);
  }
  console.log("#1770 channel-specific seal self-test PASS (3 true mutations)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1770 channel-specific seal guard PASS");
}
