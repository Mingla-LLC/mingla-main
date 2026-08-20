#!/usr/bin/env node
// #1971 — CI-wired structural guard for the canonical trip command boundary.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function check(inputs) {
  const failures = [];
  const requiredSql = [
    "biz_create_trip_draft", "biz_apply_trip_draft_graph", "biz_update_trip_live_command",
    "biz_publish_trip_command", "biz_soft_delete_trip", "biz_get_trip_order_money_snapshot",
    "biz_trip_command_receipts", "trip_revision_conflict", "trip_deleted_order_forbidden",
    "ari_execute_trip_operation", "agent_operation_receipt_begin", "agent_operation_receipt_complete",
  ];
  for (const token of requiredSql) if (!inputs.sql.includes(token)) failures.push(`SQL missing ${token}`);
  for (const tool of ["manage_trip_days", "manage_trip_inclusions", "manage_trip_tiers", "manage_trip_traveler_intake", "get_trip_order_money"]) {
    if (!inputs.tools.includes(tool)) failures.push(`tool missing ${tool}`);
    if (!inputs.prompt.includes(`- ${tool} —`)) failures.push(`prompt missing ${tool}`);
    if (!inputs.ledger.includes(`"ari_tool": "${tool}"`)) failures.push(`ledger missing ${tool}`);
  }
  for (const forbidden of ['.from("events").insert(', '.from("trip_days").insert(', '.from("trip_inclusions").insert(']) {
    if (inputs.tripService.includes(forbidden)) failures.push(`manual parallel write remains: ${forbidden}`);
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const good = {
    sql: "biz_create_trip_draft biz_apply_trip_draft_graph biz_update_trip_live_command biz_publish_trip_command biz_soft_delete_trip biz_get_trip_order_money_snapshot biz_trip_command_receipts trip_revision_conflict trip_deleted_order_forbidden ari_execute_trip_operation agent_operation_receipt_begin agent_operation_receipt_complete",
    tools: "manage_trip_days manage_trip_inclusions manage_trip_tiers manage_trip_traveler_intake get_trip_order_money",
    prompt: "- manage_trip_days —\n- manage_trip_inclusions —\n- manage_trip_tiers —\n- manage_trip_traveler_intake —\n- get_trip_order_money —",
    ledger: '"ari_tool": "manage_trip_days" "ari_tool": "manage_trip_inclusions" "ari_tool": "manage_trip_tiers" "ari_tool": "manage_trip_traveler_intake" "ari_tool": "get_trip_order_money"',
    tripService: "canonical rpc only",
  };
  if (check(good).length) throw new Error("good fixture failed");
  const broken = { ...good, sql: good.sql.replace("trip_deleted_order_forbidden", ""), tripService: '.from("events").insert(' };
  if (check(broken).length !== 2) throw new Error("fails-on-revert fixture was not caught exactly");
  console.log("issue-1971-trip-lifecycle self-test PASS (revert caught)");
  process.exit(0);
}

const inputs = {
  sql: fs.readFileSync(path.join(root, "supabase/migrations/20270502001971_issue_1971_ari_trip_lifecycle.sql"), "utf8"),
  tools: fs.readFileSync(path.join(root, "supabase/functions/_shared/agentDomainTools.ts"), "utf8"),
  prompt: fs.readFileSync(path.join(root, "supabase/functions/_shared/agentSystemPrompt.ts"), "utf8"),
  ledger: fs.readFileSync(path.join(root, "docs/contracts/ari-capability-ledger.json"), "utf8"),
  tripService: fs.readFileSync(path.join(root, "mingla-business/src/services/tripsService.ts"), "utf8"),
};
const failures = check(inputs);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("issue-1971-trip-lifecycle PASS");
