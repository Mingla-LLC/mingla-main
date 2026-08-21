#!/usr/bin/env node
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
  refund: "supabase/functions/rsvp-contribution-refund/index.ts",
  drafts: "mingla-business/src/services/eventDrafts.ts",
  events: "mingla-business/src/services/rsvpEvents.ts",
  approvals: "mingla-business/src/services/rsvpApprovals.ts",
  roster: "mingla-business/src/services/guestRosterService.ts",
  refunds: "mingla-business/src/services/sourceRefundService.ts",
  pgTest: "supabase/migrations/__tests__/issue_1977_ari_rsvp_guest_contribution.test.sql",
  receiptTest: "supabase/migrations/__tests__/issue_1977_ari_rsvp_receipt.implementor.test.sql",
  certificationTest: "supabase/migrations/__tests__/issue_1977_ari_certification_118.implementor.pg17.test.sql",
  denoTest: "supabase/functions/_shared/__tests__/issue_1977_ari_rsvp_lifecycle.test.ts",
  taskStateTest: "supabase/functions/_shared/__tests__/issue_1977_rsvp_task_state.implementor.test.ts",
  jestTest: "mingla-business/src/services/__tests__/issue1977RsvpLifecycle.test.ts",
  certifier: "scripts/ari/certify-capabilities.mjs",
  evidenceSchema: "docs/contracts/ari-certification-evidence.schema.json",
};

export function audit(base) {
  const failures = [];
  const read = (key) => {
    const target = path.join(base, files[key]);
    if (!fs.existsSync(target)) { failures.push(`${files[key]} is missing`); return ""; }
    return fs.readFileSync(target, "utf8");
  };
  const migration=read("migration"),tools=read("tools"),auth=read("auth"),prompt=read("prompt"),refund=read("refund"),drafts=read("drafts"),events=read("events"),approvals=read("approvals"),roster=read("roster"),refunds=read("refunds");
  const receiptTest=read("receiptTest"),certificationTest=read("certificationTest"),certifier=read("certifier"),evidenceSchema=read("evidenceSchema");
  read("pgTest"); read("denoTest"); read("taskStateTest"); read("jestTest");
  for (const fn of ["business_create_rsvp_draft_graph","business_update_rsvp_graph","business_publish_rsvp_graph","business_discard_rsvp_draft","business_list_rsvp_roster","business_set_rsvp_guest_status","business_list_rsvp_contributions","biz_prepare_rsvp_contribution_refund"]) {
    if (!migration.includes(`FUNCTION public.${fn}`)) failures.push(`canonical migration is missing ${fn}`);
  }
  if (!migration.includes("ari_execute_rsvp_operation") || !migration.includes("agent_operation_receipt_begin") || !migration.includes("agent_operation_receipt_complete") || !migration.includes("rsvp_idempotency_hash_mismatch") || !migration.includes("pg_advisory_xact_lock")) failures.push("shared Ari receipt and Business replay authority are incomplete");
  if (!migration.includes("p_scope='selected'") || !migration.includes("p_scope='all_pending'") || !migration.includes("enqueue_rsvp_pass") || !migration.includes("rsvp_capacity_full")) failures.push("guest effect owner lost selection/capacity/pass invariants");
  if (!migration.includes("biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('finance_manager')") || !migration.includes("biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('finance_manager')")) failures.push("contribution read/refund is not finance-manager aligned");
  if (/GRANT EXECUTE ON FUNCTION public\.(?:business_|biz_prepare_rsvp_contribution_refund)[^;]+ TO (?:PUBLIC|anon)/.test(migration)) failures.push("organizer RSVP RPC gained public/anon execute");
  for (const name of ["create_rsvp","update_rsvp","publish_rsvp","update_rsvp_contribution_settings","set_rsvp_guest_status","list_guest_roster","list_rsvp_contributions","refund_rsvp_contribution"]) {
    if (!tools.includes(`"${name}"`) || !prompt.includes(name)) failures.push(`${name} is not registered and advertised`);
  }
  if (tools.includes('"set_guest_approval"') || /refundRsvpContribution[\s\S]{0,1200}(?:refund-order|order_id|amount_cents)/.test(tools)) failures.push("duplicate guest approval or order-shaped contribution refund returned");
  if (!auth.includes('list_rsvp_contributions: role("finance_manager", "event")') || !auth.includes('refund_rsvp_contribution: role("finance_manager", "event")')) failures.push("delegated contribution authorization drifted");
  if (!refund.includes("p_event_id: boundEventId") || !refund.includes('rpc("ari_execute_rsvp_operation"') || !refund.includes('error: "refund_mode_invalid"') || !refund.includes('error: "refund_reason_invalid"')) failures.push("refund edge does not bind exact event/mode/reason/receipt");
  if (!drafts.includes('rpc("business_create_rsvp_draft_graph"') || !drafts.includes('rpc("business_update_rsvp_graph"') || !drafts.includes('"business_discard_rsvp_draft"')) failures.push("Business drafts bypass the canonical RSVP graph");
  if (!events.includes('rpc("business_publish_rsvp_graph"') || !events.includes('rpc("business_update_rsvp_graph"')) failures.push("Business publish/live edit bypasses the canonical RSVP graph");
  for (const source of [approvals,roster]) if (!source.includes('rpc("business_set_rsvp_guest_status"')) failures.push("Business guest path bypasses the single status owner");
  if (!refunds.includes("eventId: string") || !refunds.includes("`${input.eventId}:${input.contributionId}:${input.mode}`")) failures.push("Business contribution refund is not event-bound/idempotent");
  if (!receiptTest.includes("v_replay:=public.ari_execute_rsvp_operation") || !receiptTest.includes("idempotency_conflict") || !receiptTest.includes("operation_binding_mismatch")) failures.push("implementor receipt proof no longer covers exact replay/conflict");
  if (!certificationTest.includes("expected exactly 118 certification requirements") || !certificationTest.includes("ari_cert_missing_capabilities:117") || !certificationTest.includes("bac1588dd5d65fd2accdbaebfc7168fd2d682b41c9a253f98e1b3afd97d3dab6")) failures.push("118-row certification regression is incomplete");
  if (!certifier.includes("ledger.capabilities.length !== 118") || !certifier.includes("rows.length === 118") || !evidenceSchema.includes('"minItems": 118') || !evidenceSchema.includes('"maxItems": 118')) failures.push("current certifier/schema is not pinned to 118 rows");
  return failures;
}

function selfTest() {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"issue-1977-gate-"));
  try {
    for (const relative of Object.values(files)) { const target=path.join(tmp,relative); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(path.join(root,relative),target); }
    const clean=audit(tmp); if (clean.length) throw new Error(`clean fixture failed: ${clean.join("; ")}`);
    const migration=path.join(tmp,files.migration),cleanMigration=fs.readFileSync(migration,"utf8");
    fs.writeFileSync(migration,cleanMigration.replace("PERFORM public.enqueue_rsvp_pass(v_id,NULL)","PERFORM 1"));
    if (!audit(tmp).some((failure)=>failure.includes("guest effect owner"))) throw new Error("true mutation: pass enqueue deletion was not detected");
    fs.writeFileSync(migration,cleanMigration);
    const drafts=path.join(tmp,files.drafts),cleanDrafts=fs.readFileSync(drafts,"utf8");
    fs.writeFileSync(drafts,cleanDrafts.replace('rpc("business_create_rsvp_draft_graph"','from("events").insert'));
    if (!audit(tmp).some((failure)=>failure.includes("drafts bypass"))) throw new Error("true mutation: direct RSVP draft write was not detected");
    const certification=path.join(tmp,files.certificationTest),cleanCertification=fs.readFileSync(certification,"utf8");
    fs.writeFileSync(certification,cleanCertification.replace("ari_cert_missing_capabilities:117","ari_cert_missing_capabilities:116"));
    if (!audit(tmp).some((failure)=>failure.includes("certification regression"))) throw new Error("true mutation: obsolete certifier evidence count was not detected");
    console.log("[issue-1977-ari-rsvp-lifecycle] self-test PASS");
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

if (process.argv.includes("--self-test")) selfTest();
else { const failures=audit(root); if (failures.length) { failures.forEach((failure)=>console.error(`[issue-1977-ari-rsvp-lifecycle] FAIL: ${failure}`)); process.exit(1); } console.log("[issue-1977-ari-rsvp-lifecycle] PASS"); }
