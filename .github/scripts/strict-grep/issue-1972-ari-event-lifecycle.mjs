#!/usr/bin/env node
// #1972 Class A event-lifecycle contract. The self-test performs true source
// mutations and proves each load-bearing invariant fails on revert.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

export function check(sources) {
  const failures = [];
  const {
    migration,
    tools,
    domains,
    confirm,
    coverEdge,
    coverService,
    editor,
    menu,
    parseMenu,
    parsePlay,
    workflow,
  } = sources;
  for (const token of [
    "IF v_event.status = 'draft' THEN",
    "v_event.theme#>'{business_draft,when}'",
    "v_event.theme#>'{business_draft,multiDates}'",
    "v_event.theme#>'{business_draft,recurrenceRule}'",
    "v_event.theme#>'{business_draft,requestedVisibility}'",
    "v_event.theme#>'{business_draft,location}'",
  ]) if (!migration.includes(token)) failures.push(`draft topology preservation missing ${token}`);
  for (const token of [
    "e.theme#>'{business_draft,tickets}'",
    "business_resolve_event_local_datetime",
    "event_date_dst_invalid",
    "CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic",
    "WHEN 'patch_event_when' THEN\n      v_result:=public.business_update_live_event_atomic(",
    "FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer)\n  TO service_role;",
    "public.business_patch_event_taxonomy(\n    uuid,text,text[],text[],text[],numeric,numeric,text,text\n  ) TO service_role;",
    "v_payload:=jsonb_set(v_payload,'{visibility}'",
    "v_core ? 'visibility'",
    "COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private')",
  ]) if (!migration.includes(token)) failures.push(`round-three lifecycle contract missing ${token}`);
  for (const token of [
    "CREATE OR REPLACE FUNCTION public.business_assert_event_visibility",
    "p_value IS NULL OR jsonb_typeof(p_value) IS DISTINCT FROM 'string'",
    "v_visibility NOT IN('public','unlisted','private')",
    "p_payload#>'{theme,business_draft,requestedVisibility}'",
    "p_args->'visibility'",
    "CREATE TRIGGER business_guard_event_publish_visibility",
    "NEW.theme#>'{business_event,requestedVisibility}'",
  ]) if (!migration.includes(token)) failures.push(`closed visibility contract missing ${token}`);
  if (!tools.includes('required: ["brand_id", "title", "when_mode", "visibility"]'))
    failures.push("Ari create schema does not require an explicit visibility choice");
  if ((migration.match(/business_assert_event_visibility\(/g) ?? []).length < 8)
    failures.push("closed visibility validator is not shared by every lifecycle boundary");
  for (const token of [
    "(SELECT min(start_at) FROM public.event_dates WHERE event_id=p_event_id)<=now()",
    "public.waitlist_entries WHERE event_id=p_event_id",
    "public.scan_events WHERE event_id=p_event_id",
    "event_unpublish_has_commitments",
  ]) if (!migration.includes(token)) failures.push(`unpublish fail-closed contract missing ${token}`);
  for (const token of [
    "CREATE OR REPLACE FUNCTION public.terminalize_agent_pending_action",
    "agent_pending_action_terminal_receipts",
    "trusted_terminal_attestation_required",
    "pending_action_cas_conflict",
    "operation_receipt_required",
  ]) if (!migration.includes(token)) failures.push(`atomic terminal owner missing ${token}`);
  for (const token of [
    "RECEIPT_BACKED_EVENT_TOOL_NAMES",
    "RECEIPT_BACKED_EVENT_TOOL_NAMES.has(pending.tool_name)",
    '"terminalize_agent_pending_action"',
    '.select("id, status").maybeSingle()',
  ]) if (!confirm.includes(token)) failures.push(`confirmation recovery contract missing ${token}`);
  for (const token of ["when_mode:", "multi_dates:", "recurrence_rule:", "p_upcoming_only:"])
    if (!tools.includes(token)) failures.push(`Ari event input contract missing ${token}`);
  for (const token of ["brand_id: UUID", "clear_cover:"])
    if (!domains.includes(token)) failures.push(`cover tool schema missing ${token}`);
  for (const token of [
    "trusted_cover_attestation_required",
    "business_clear_event_cover_media",
    "assert_event_cover_selection_source",
  ]) if (!migration.includes(token)) failures.push(`cover SQL trust boundary missing ${token}`);
  for (const token of ["api.pexels.com/v1/photos/", "api.giphy.com/v1/gifs/", "SUPABASE_SERVICE_ROLE_KEY"])
    if (!coverEdge.includes(token)) failures.push(`provider attestation missing ${token}`);
  for (const token of [
    "p_credit: verifiedMetadata.credit",
    "p_credit_url: verifiedMetadata.creditUrl",
    "p_alt: verifiedMetadata.alt",
  ]) if (!coverEdge.includes(token)) failures.push(`provider metadata attestation missing ${token}`);
  if (!coverService.includes('functions.invoke(\n    "event-cover-attest-selection"'))
    failures.push("Business cover service bypasses trusted Edge attestation");
  if (!editor.includes("await patchPublishedEventAtomically("))
    failures.push("Business live editor bypasses the atomic mutation owner");
  for (const staleOwner of [
    "await patchPublishedEventCore(",
    "await patchPublishedEventTaxonomy(",
    "await patchPublishedEventWhen(",
    "await patchPublishedEventPricingSwitches(",
    "await setEventCover(",
    "await clearEventCover(",
  ]) if (editor.includes(staleOwner)) failures.push(`Business live editor retains fragmented owner ${staleOwner}`);
  for (const [name, source] of [["menu", parseMenu], ["play", parsePlay]]) {
    if (!source.includes("const pendingStateClient = buildServiceClient();"))
      failures.push(`${name} parser lacks server-authoritative proposal client`);
    if (!source.includes('pendingStateClient\n      .from("agent_pending_actions")'))
      failures.push(`${name} parser does not constrain service role to pending proposals`);
    if ((source.match(/pendingStateClient\s*\n?\s*\.from\(/g) ?? []).length !== 1)
      failures.push(`${name} parser expands service role beyond one proposal write`);
    if (!source.includes("server_proposed_at: new Date().toISOString()"))
      failures.push(`${name} parser proposal lacks trusted server provenance`);
  }
  const liveBlock = menu.slice(menu.indexOf('if (status === "live"'), menu.indexOf("// Cancel event"));
  if (liveBlock.includes("onUnpublish")) failures.push("live event still exposes impossible unpublish action");
  for (const token of [
    "issue_1972_ari_event_lifecycle.implementor.test.ts",
    "issue_1972_ari_event_lifecycle.tester_adversarial.test.ts",
    "issue_1972_ari_event_lifecycle.tester_round2.adversarial.test.ts",
    "issue_1972_ari_event_lifecycle.test.sql",
    "issue_1972_ari_event_lifecycle.tester.adversarial.test.sql",
    "issue_1972_ari_event_lifecycle.tester_round2.adversarial.test.sql",
    "issue_1972_ari_event_lifecycle.round3.implementor.test.sql",
    "issue_1972_ari_event_lifecycle.tester_round3.adversarial.test.sql",
    "issue_1972_ari_event_lifecycle.round4.implementor.test.sql",
    "issue_1972_ari_event_lifecycle.tester_round4.adversarial.test.sql",
    "issue_1972_ari_event_lifecycle.round5.implementor.test.sql",
    "issue-1972-ari-event-lifecycle.mjs --self-test",
  ]) if (!workflow.includes(token)) failures.push(`CI proof missing ${token}`);
  return failures;
}

const sources = {
  migration: read("supabase/migrations/20270404001972_issue_1972_ari_event_lifecycle.sql"),
  tools: read("supabase/functions/_shared/agentTools.ts"),
  domains: read("supabase/functions/_shared/agentDomainTools.ts"),
  confirm: read("supabase/functions/agent-confirm-action/index.ts"),
  coverEdge: read("supabase/functions/event-cover-attest-selection/index.ts"),
  coverService: read("mingla-business/src/services/eventCoverMediaService.ts"),
  editor: read("mingla-business/src/components/event/EditPublishedScreen.tsx"),
  menu: read("mingla-business/src/components/event/EventManageMenu.tsx"),
  parseMenu: read("supabase/functions/parse-restaurant-menu/index.ts"),
  parsePlay: read("supabase/functions/parse-play-activities/index.ts"),
  workflow: read(".github/workflows/issue-1972-ari-event-lifecycle.yml"),
};

if (process.argv.includes("--self-test")) {
  const good = check(sources);
  const mutations = [
    { ...sources, migration: sources.migration.replace("IF v_event.status = 'draft' THEN", "IF false THEN") },
    { ...sources, migration: sources.migration.replace("public.waitlist_entries WHERE event_id=p_event_id", "public.waitlist_entries WHERE false") },
    { ...sources, confirm: sources.confirm.replace("RECEIPT_BACKED_EVENT_TOOL_NAMES.has(pending.tool_name)", "true") },
    { ...sources, coverEdge: sources.coverEdge.replace("api.pexels.com/v1/photos/", "example.invalid/photos/") },
    { ...sources, migration: sources.migration.replace("CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic", "CREATE OR REPLACE FUNCTION public.business_update_live_event_fragmented") },
    { ...sources, editor: sources.editor.replace("await patchPublishedEventAtomically(", "await patchPublishedEventCore(") },
    { ...sources, parseMenu: sources.parseMenu.replace("pendingStateClient\n      .from", "userClient\n      .from") },
    { ...sources, workflow: sources.workflow.replaceAll("issue_1972_ari_event_lifecycle.tester.adversarial.test.sql", "removed.sql") },
    { ...sources, migration: sources.migration.replace("v_event.theme#>'{business_draft,requestedVisibility}'", "'public'::jsonb") },
    { ...sources, migration: sources.migration.replace("v_event.theme#>'{business_draft,location}'", "'null'::jsonb") },
    { ...sources, migration: sources.migration.replace("v_core ? 'visibility'", "false") },
    { ...sources, workflow: sources.workflow.replaceAll("issue_1972_ari_event_lifecycle.tester_round3.adversarial.test.sql", "removed-round3.sql") },
    { ...sources, workflow: sources.workflow.replaceAll("issue_1972_ari_event_lifecycle.tester_round4.adversarial.test.sql", "removed-round4.sql") },
    { ...sources, migration: sources.migration.replace("v_visibility NOT IN('public','unlisted','private')", "false") },
    { ...sources, migration: sources.migration.replace("CREATE TRIGGER business_guard_event_publish_visibility", "CREATE TRIGGER removed_publish_visibility_guard") },
    { ...sources, tools: sources.tools.replace('required: ["brand_id", "title", "when_mode", "visibility"]', 'required: ["brand_id", "title", "when_mode"]') },
    { ...sources, workflow: sources.workflow.replaceAll("issue_1972_ari_event_lifecycle.round5.implementor.test.sql", "removed-round5.sql") },
  ];
  const undetected = mutations.filter((mutation) => check(mutation).length === 0);
  if (good.length || undetected.length) {
    console.error("issue-1972 self-test FAIL", { good, undetected: undetected.length });
    process.exit(1);
  }
  console.log("issue-1972 self-test PASS: clean sources pass; topology, dependency, replay, provenance, and CI reverts fail.");
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error("issue-1972-ari-event-lifecycle FAIL:\n" + failures.map((failure) => `  - ${failure}`).join("\n"));
  process.exit(1);
}
console.log("issue-1972-ari-event-lifecycle PASS.");
