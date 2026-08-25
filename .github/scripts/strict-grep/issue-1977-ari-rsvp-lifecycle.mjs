#!/usr/bin/env node
//
// #1977 — RSVP lifecycle has ONE command owner for Ari + Business.
//
// Ari create/update/publish/guest-status/contribution-settings/refund go through
// ari_execute_rsvp_operation (or the contribution refund edge that binds the
// same receipt). Business screens call the same business_* graph / guest
// owners. set_guest_approval must not return as a parallel Ari verb.
//
// Certification literals stay owned by #2592 (120 / be0add47…). This gate only
// checks the safe promote of ari.rsvp.contribution_settings → write.
//
// Wired into supabase-migrations-and-stripe-deno.yml (no new workflow lane).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const files = {
  migration: "supabase/migrations/20270510001977_issue_1977_ari_rsvp_guest_contribution.sql",
  tools: "supabase/functions/_shared/agentDomainTools.ts",
  auth: "supabase/functions/_shared/agentToolAuthorization.ts",
  prompt: "supabase/functions/_shared/agentSystemPrompt.ts",
  confirm: "supabase/functions/agent-confirm-action/index.ts",
  refund: "supabase/functions/rsvp-contribution-refund/index.ts",
  drafts: "mingla-business/src/services/eventDrafts.ts",
  events: "mingla-business/src/services/rsvpEvents.ts",
  approvals: "mingla-business/src/services/rsvpApprovals.ts",
  roster: "mingla-business/src/services/guestRosterService.ts",
  refunds: "mingla-business/src/services/sourceRefundService.ts",
  pgTest: "supabase/migrations/__tests__/issue_1977_ari_rsvp_guest_contribution.test.sql",
  receiptTest: "supabase/migrations/__tests__/issue_1977_ari_rsvp_receipt.implementor.test.sql",
  denoTest: "supabase/functions/_shared/__tests__/issue_1977_ari_rsvp_lifecycle.test.ts",
  workflow: ".github/workflows/supabase-migrations-and-stripe-deno.yml",
  ledger: "docs/contracts/ari-capability-ledger.json",
};

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function audit(base) {
  const failures = [];
  const read = (key) => {
    const target = path.join(base, files[key]);
    if (!fs.existsSync(target)) {
      failures.push(`${files[key]} is missing`);
      return "";
    }
    return fs.readFileSync(target, "utf8");
  };

  const migration = read("migration");
  const tools = stripComments(read("tools"));
  const auth = read("auth");
  const prompt = read("prompt");
  const confirm = read("confirm");
  const refund = read("refund");
  const drafts = stripComments(read("drafts"));
  const events = stripComments(read("events"));
  const approvals = stripComments(read("approvals"));
  const roster = stripComments(read("roster"));
  const refunds = stripComments(read("refunds"));
  const receiptTest = read("receiptTest");
  const workflow = read("workflow");
  const ledger = read("ledger");
  read("pgTest");
  read("denoTest");

  for (
    const fn of [
      "business_create_rsvp_draft_graph",
      "business_update_rsvp_graph",
      "business_publish_rsvp_graph",
      "business_discard_rsvp_draft",
      "business_list_rsvp_roster",
      "business_set_rsvp_guest_status",
      "business_list_rsvp_contributions",
      "biz_prepare_rsvp_contribution_refund",
      "ari_execute_rsvp_operation",
    ]
  ) {
    if (!migration.includes(`FUNCTION public.${fn}`)) {
      failures.push(`canonical migration is missing ${fn}`);
    }
  }

  if (
    !migration.includes("agent_operation_receipt_begin") ||
    !migration.includes("agent_operation_receipt_complete") ||
    !migration.includes("rsvp_idempotency_hash_mismatch") ||
    !migration.includes("pg_advisory_xact_lock")
  ) {
    failures.push("shared Ari receipt and Business replay authority are incomplete");
  }

  if (
    !migration.includes("p_scope='selected'") ||
    !migration.includes("p_scope='all_pending'") ||
    !migration.includes("enqueue_rsvp_pass") ||
    !migration.includes("rsvp_capacity_full")
  ) {
    failures.push("guest effect owner lost selection/capacity/pass invariants");
  }

  if (
    !migration.includes(
      "biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('finance_manager')",
    ) &&
    !migration.includes(
      "biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('finance_manager')",
    )
  ) {
    failures.push("contribution read/refund is not finance-manager aligned");
  }

  if (
    /GRANT EXECUTE ON FUNCTION public\.(?:business_|biz_prepare_rsvp_contribution_refund)[^;]+ TO (?:PUBLIC|anon)/
      .test(migration)
  ) {
    failures.push("organizer RSVP RPC gained public/anon execute");
  }

  if (
    !migration.includes("issue_1977_expected_120_certification_requirements") ||
    !migration.includes("ari.rsvp.contribution_settings") ||
    !migration.includes("evidence_mode = 'write'")
  ) {
    failures.push("contribution_settings write promote / 120-row assert is incomplete");
  }

  if (
    migration.includes("CREATE OR REPLACE FUNCTION public.ari_cert_begin_run") ||
    migration.includes("CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run")
  ) {
    failures.push("#1977 must not rewrite ari_cert_begin_run / ari_cert_finalize_run");
  }

  for (
    const name of [
      "create_rsvp",
      "update_rsvp",
      "publish_rsvp",
      "update_rsvp_contribution_settings",
      "set_rsvp_guest_status",
      "list_guest_roster",
      "refund_rsvp_contribution",
    ]
  ) {
    if (!tools.includes(`"${name}"`) || !prompt.includes(name)) {
      failures.push(`${name} is not registered and advertised`);
    }
  }

  if (tools.includes('"set_guest_approval"')) {
    failures.push("duplicate guest approval verb returned");
  }

  if (
    /refundRsvpContribution[\s\S]{0,1200}(?:refund-order|order_id|amount_cents)/
      .test(tools)
  ) {
    failures.push("order-shaped contribution refund returned");
  }

  if (
    !auth.includes('refund_rsvp_contribution: role("finance_manager", "event")') ||
    !auth.includes('set_rsvp_guest_status: role("event_manager", "event")') ||
    !auth.includes('update_rsvp: role("event_manager", "event")')
  ) {
    failures.push("delegated RSVP authorization drifted");
  }

  for (
    const name of [
      "create_rsvp",
      "update_rsvp",
      "publish_rsvp",
      "update_rsvp_contribution_settings",
      "set_rsvp_guest_status",
    ]
  ) {
    if (!confirm.includes(`"${name}"`)) {
      failures.push(`agent-confirm-action lost receipt-backed ${name}`);
    }
  }

  if (
    !refund.includes("ari_execute_rsvp_operation") ||
    !refund.includes("boundEventId") ||
    !refund.includes('error: "refund_mode_invalid"') ||
    !refund.includes('error: "refund_reason_invalid"')
  ) {
    failures.push("refund edge does not bind exact event/mode/reason/receipt");
  }

  if (
    !drafts.includes('rpc("business_create_rsvp_draft_graph"') ||
    !drafts.includes('rpc("business_update_rsvp_graph"')
  ) {
    failures.push("Business drafts bypass the canonical RSVP graph");
  }

  if (
    !events.includes('rpc("business_publish_rsvp_graph"') &&
    !events.includes('rpc("business_update_rsvp_graph"')
  ) {
    failures.push("Business publish/live edit bypasses the canonical RSVP graph");
  }

  for (const source of [approvals, roster]) {
    if (!source.includes('rpc("business_set_rsvp_guest_status"')) {
      failures.push("Business guest path bypasses the single status owner");
    }
  }

  if (
    !refunds.includes("eventId") ||
    !refunds.includes("contributionId")
  ) {
    failures.push("Business contribution refund is not event-bound");
  }

  if (
    !receiptTest.includes("v_replay:=public.ari_execute_rsvp_operation") ||
    !receiptTest.includes("idempotency_conflict") ||
    !receiptTest.includes("operation_binding_mismatch")
  ) {
    failures.push("implementor receipt proof no longer covers exact replay/conflict");
  }

  if (
    !workflow.includes("issue-1977-ari-rsvp-lifecycle.mjs") ||
    !workflow.includes("issue_1977_ari_rsvp_lifecycle.test.ts") ||
    !workflow.includes("issue_1977_ari_rsvp_guest_contribution.test.sql")
  ) {
    failures.push("#1977 tests/gate are not wired into the shared supabase lane");
  }

  try {
    const parsed = JSON.parse(ledger);
    const mapped = (parsed.capabilities ?? [])
      .map((row) => row.ari_tool)
      .filter((name) => typeof name === "string");
    if (parsed.audit?.registered_tool_count !== 86) {
      failures.push("ledger audit registered_tool_count is not 86");
    }
    if (mapped.length !== 86 || new Set(mapped).size !== 86) {
      failures.push("ledger mapped tool census is not 86 unique tools");
    }
    if (!mapped.includes("update_rsvp") || !mapped.includes("update_rsvp_contribution_settings")) {
      failures.push("ledger lost the #1977 RSVP write mappings");
    }
    if (mapped.includes("set_guest_approval")) {
      failures.push("ledger still maps the retired set_guest_approval verb");
    }
  } catch {
    failures.push("ledger is not valid JSON");
  }

  return failures;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "issue-1977-gate-"));
  try {
    for (const relative of Object.values(files)) {
      const target = path.join(tmp, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, relative), target);
    }
    const clean = audit(tmp);
    if (clean.length) throw new Error(`clean fixture failed: ${clean.join("; ")}`);

    const migration = path.join(tmp, files.migration);
    const cleanMigration = fs.readFileSync(migration, "utf8");
    fs.writeFileSync(
      migration,
      cleanMigration.replace("PERFORM public.enqueue_rsvp_pass(v_id,NULL)", "PERFORM 1"),
    );
    if (!audit(tmp).some((failure) => failure.includes("guest effect owner"))) {
      throw new Error("true mutation: pass enqueue deletion was not detected");
    }
    fs.writeFileSync(migration, cleanMigration);

    const drafts = path.join(tmp, files.drafts);
    const cleanDrafts = fs.readFileSync(drafts, "utf8");
    fs.writeFileSync(
      drafts,
      cleanDrafts.replace('rpc("business_create_rsvp_draft_graph"', 'from("events").insert'),
    );
    if (!audit(tmp).some((failure) => failure.includes("drafts bypass"))) {
      throw new Error("true mutation: direct RSVP draft write was not detected");
    }
    fs.writeFileSync(drafts, cleanDrafts);

    const toolsPath = path.join(tmp, files.tools);
    const cleanTools = fs.readFileSync(toolsPath, "utf8");
    fs.writeFileSync(
      toolsPath,
      cleanTools.replace('"set_rsvp_guest_status"', '"set_guest_approval"'),
    );
    if (!audit(tmp).some((failure) => failure.includes("duplicate guest approval"))) {
      throw new Error("true mutation: set_guest_approval return was not detected");
    }
    fs.writeFileSync(toolsPath, cleanTools);

    const workflow = path.join(tmp, files.workflow);
    const cleanWorkflow = fs.readFileSync(workflow, "utf8");
    fs.writeFileSync(
      workflow,
      cleanWorkflow.replaceAll("issue-1977-ari-rsvp-lifecycle.mjs", "issue-1977-missing.mjs"),
    );
    if (!audit(tmp).some((failure) => failure.includes("shared supabase lane"))) {
      throw new Error("true mutation: workflow unwire was not detected");
    }

    console.log("[issue-1977-ari-rsvp-lifecycle] self-test PASS");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = audit(root);
  if (failures.length) {
    failures.forEach((failure) =>
      console.error(`[issue-1977-ari-rsvp-lifecycle] FAIL: ${failure}`)
    );
    process.exit(1);
  }
  console.log("[issue-1977-ari-rsvp-lifecycle] PASS");
}
