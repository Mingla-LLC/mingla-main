#!/usr/bin/env node
/** #1770 Ring-1 Brand People structural, ACL, and fail-open contract. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration: "supabase/migrations/20270305001770_issue_1770_ring1_brand_people_foundation.sql",
  sqlTest: "supabase/migrations/__tests__/issue_1770_ring1_brand_people_foundation.test.sql",
  concurrencyTest: "supabase/migrations/__tests__/issue_1770_attempt_ordinal_concurrency.pg17.test.sql",
  token: "supabase/functions/_shared/offeringInviteToken.ts",
  tokenTest: "supabase/functions/_shared/offeringInviteToken.happy.test.ts",
  tokenVectorTest: "supabase/functions/_shared/offeringInviteToken.deterministic.test.ts",
  quote: "supabase/functions/_shared/offeringInviteQuote.ts",
  quoteTest: "supabase/functions/_shared/offeringInviteQuote.test.ts",
  brandPeople: "supabase/functions/_shared/brandPeople.ts",
  brandPeopleTest: "supabase/functions/_shared/brandPeople.happy.test.ts",
  worker: "supabase/functions/brand-person-ingest-worker/index.ts",
  workerTest: "supabase/functions/brand-person-ingest-worker/issue_1770_ingest_worker.happy.test.ts",
  dispatch: "supabase/functions/offering-invite-dispatch/index.ts",
  dispatchTest: "supabase/functions/offering-invite-dispatch/issue_1770_dispatch.happy.test.ts",
  export: "supabase/functions/brand-people-export/index.ts",
  exportWorker: "supabase/functions/brand-people-export-worker/index.ts",
  exportWorkerTest: "supabase/functions/brand-people-export-worker/issue_1770_export_worker.happy.test.ts",
  csv: "supabase/functions/brand-people-export/csv.ts",
  exportTest: "supabase/functions/brand-people-export/issue_1770_export.happy.test.ts",
  audience: "supabase/functions/_shared/marketingAudience.ts",
  emailRender: "supabase/functions/_shared/marketingEmailRender.ts",
  emailRenderTest: "supabase/functions/_shared/marketingEmailRender.offeringInvitePrivacy.test.ts",
  marketingSend: "supabase/functions/marketing-send/index.ts",
  marketingSendTest: "supabase/functions/marketing-send/issue-1770-offering-invite-delivery.test.ts",
  notify: "supabase/functions/_shared/notifyV2.ts",
  notifyTest: "supabase/functions/_shared/notifyV2.offeringPersistedPush.happy.test.ts",
  notifyReconcileTest: "supabase/functions/_shared/notifyV2.offeringPushReconciliation.issue1770.test.ts",
  push: "supabase/functions/_shared/push-utils.ts",
  pushAdapter: "supabase/functions/_shared/adapters/pushAdapter.ts",
  pushAdapterTest: "supabase/functions/_shared/adapters/pushAdapter.issue1770.test.ts",
  eventAuth: "supabase/functions/_shared/oneSignalEventStreamAuth.ts",
  eventAuthTest: "supabase/functions/_shared/oneSignalEventStreamAuth.issue1770.test.ts",
  eventReceiver: "supabase/functions/onesignal-event-stream/index.ts",
  eventReceiverTest: "supabase/functions/onesignal-event-stream/issue_1770_event_stream.test.ts",
  config: "supabase/config.toml",
  manifest: "supabase/secrets.manifest.json",
};

const REQUIRED_TABLES = [
  "brand_people", "brand_person_names", "brand_person_source_links",
  "brand_person_contact_methods", "brand_person_contact_method_sources",
  "brand_person_identity_conflicts", "brand_person_merge_events",
  "brand_person_channel_suppressions", "brand_offering_invites",
  "brand_offering_invite_tokens", "marketing_send_groups",
  "marketing_send_group_campaigns", "brand_offering_invite_delivery_attempts",
  "brand_person_ingest_outbox", "brand_people_export_jobs",
  "brand_people_export_audit",
  "offering_push_provider_events",
];

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbid(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

export function violations(files) {
  const failures = [];
  const actorRpcNames = [
    "biz_offering_send_quote_candidates",
    "biz_seal_offering_execution_snapshot",
    "biz_execute_offering_send_group",
    "biz_execute_offering_delivery_retry",
  ];
  for (const entry of files.callSites ?? []) {
    for (const rpc of actorRpcNames) {
      if (
        entry.source.includes(rpc) &&
        entry.path !== "supabase/functions/offering-invite-dispatch/index.ts" &&
        entry.path !== "supabase/functions/guest-roster-actions/index.ts"
      ) failures.push(`actor RPC call site forbidden: ${entry.path}:${rpc}`);
    }
  }
  const migration = files.migration ?? "";
  for (const table of REQUIRED_TABLES) {
    need(migration, `CREATE TABLE public.${table} (`, "schema", failures);
  }
  need(migration, "EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table)", "RLS", failures);
  need(migration, "FOREACH v_table IN ARRAY ARRAY[", "RLS", failures);
  for (const source of ["event_rsvp", "rsvp_plus_one", "order", "ticket_holder"]) {
    need(migration, `EXECUTE FUNCTION public.issue_1770_enqueue_source('${source}')`, "fail-open outbox", failures);
  }
  for (const required of [
    "brand_person_ingest_outbox_active_revision_uniq",
    "v_old_state IS NOT DISTINCT FROM v_new_state",
    "md5(COALESCE(v_new_state,v_old_state,'{}'::jsonb)::text)",
    "'rsvpStatus',to_jsonb(OLD)->>'rsvp_status'",
    "'rsvpStatus',to_jsonb(NEW)->>'rsvp_status'",
    "'approvalStatus',to_jsonb(OLD)->>'approval_status'",
    "'approvalStatus',to_jsonb(NEW)->>'approval_status'",
    "EXCEPTION WHEN OTHERS THEN",
    "CREATE OR REPLACE FUNCTION public.issue_1770_next_attempt_ordinal",
    "pg_advisory_xact_lock(hashtextextended(p_invite_id::text || ':' || p_channel,1770))",
    "v_ordinal:=public.issue_1770_next_attempt_ordinal",
    "p_filter_snapshot<>'{}'::jsonb",
    "p_filter NOT IN ('all','reachable','suppressed')",
    "p_filter NOT IN ('all','rsvpd','ticketed','not_yet','suppressed')",
    "v_snapshot:=jsonb_build_object('filter',p_filter,'search',v_search,'sort',p_sort)",
    "v_job.filter_json->>'filter'='suppressed'",
    "v_job.filter_json->>'search'=''",
  ]) need(migration, required, "QA repair", failures);
  forbid(migration, "md5(TG_TABLE_NAME || ':' || v_id::text || ':' || TG_OP || ':' || clock_timestamp()::text)", "deterministic ingest", failures);
  forbid(migration, "'snapshot',p_filter_snapshot", "server-owned export snapshot", failures);
  for (const token of [
    "AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvps",
    "AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvp_guests",
    "AFTER INSERT OR UPDATE OR DELETE ON public.orders",
    "AFTER INSERT OR UPDATE OR DELETE ON public.tickets",
    "FOR UPDATE SKIP LOCKED LIMIT p_limit",
    "status='processing' AND locked_at<now()-interval '15 minutes'",
    "p_limit > 100",
    "status='processing'",
    "consumed_at=COALESCE(consumed_at,now())",
    "convert_to('mingla:offering-invite:lookup:v1','UTF8')",
    "'public.biz_reverse_brand_person_merge(uuid,uuid)','public.biz_validate_offering_invite_token(text,uuid,uuid,text,text,text)'",
    "EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',v_signature)",
    "RAISE EXCEPTION 'export_provider_not_ready'",
    "public.can_send(v_linked_user,'offering_invitation',p_channel,v_method.normalized_value)",
    "('offering_invitation','Marketing',false,'low',ARRAY['email','push','sms'],'reach_once',true)",
    "CREATE TRIGGER issue_1770_user_erasure BEFORE DELETE ON auth.users",
    "linked_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL",
    "created_by uuid NOT NULL,",
    "created_by_erased_at timestamptz NULL",
    "execution_snapshot_hash text NOT NULL",
    "CREATE OR REPLACE FUNCTION public.biz_offering_send_quote_candidates(",
    "CREATE OR REPLACE FUNCTION public.biz_seal_offering_execution_snapshot(",
    "CREATE OR REPLACE FUNCTION public.biz_execute_offering_send_group(",
    "CREATE OR REPLACE FUNCTION public.biz_execute_offering_delivery_retry(",
    "push_payload_v1 jsonb NULL",
    "push_payload_hash text NULL CHECK",
    "CREATE TRIGGER issue_1770_push_payload_immutable",
    "offering_push_payload_immutable",
    "CREATE OR REPLACE FUNCTION public.biz_claim_offering_push_provider_io(",
    "CREATE OR REPLACE FUNCTION public.biz_preflight_offering_push_provider_io(",
    "CREATE OR REPLACE FUNCTION public.biz_record_offering_push_dispatch_result(",
    "CREATE OR REPLACE FUNCTION public.biz_reconcile_offering_push_event(",
    "CREATE OR REPLACE FUNCTION public.issue_1770_project_offering_push_delivery(",
    "provider_io_claimed_at timestamptz NULL",
    "provider_accepted_at timestamptz NULL",
    "provider_app_id uuid NULL",
    "message.push.received",
    "v_invite.status<>'active' OR v_invite.superseded_by_invite_id IS NOT NULL",
    "'provider_rate_limited','inbox_unavailable','provider_config_missing','local_before_provider_io_failed'",
    "'provider_push_failed'",
    "'provider_partial_failure'",
    "public.issue_1770_push_payload_valid(v_source_group.push_payload_v1,p_event_id,v_source_group.push_payload_hash)",
    "p_actor_id uuid,p_event_id uuid,p_purpose text,p_selection jsonb,p_channels text[]",
    "idempotency_actor_mismatch",
    "offering_execution_snapshot_stale",
    "requested_by uuid NOT NULL,",
    "CREATE TRIGGER issue_1770_brand_erasure AFTER UPDATE OF deleted_at ON public.brands",
    "IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN",
    "RAISE EXCEPTION 'issue_1770_export_worker_dependencies_missing'",
    "RAISE NOTICE 'issue-1770 advisory: vault.decrypted_secrets row \"supabase_url\" missing.",
    "RAISE NOTICE 'issue-1770 advisory: vault.decrypted_secrets row \"service_role_key\" missing.",
  ]) need(migration, token, "migration contract", failures);
  forbid(migration, "OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets", "migration-safe vault advisory", failures);
  forbid(migration, "BEFORE INSERT OR UPDATE OR DELETE ON public.event_rsvps", "source fail-open", failures);
  forbid(migration, "requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT", "auth erasure", failures);
  forbid(migration, "created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT", "auth erasure", failures);

  const token = files.token ?? "";
  for (const required of [
    'Deno.env.get("OFFERING_INVITE_TOKEN_PEPPER")',
    'crypto.subtle.importKey(',
    "crypto.subtle.sign(",
    "deriveOfferingInviteToken",
    "mingla:offering-invite:derive:v1",
    "mingla:offering-invite:lookup:v1",
    "pepperReadiness",
  ]) need(token, required, "token helper", failures);
  forbid(token, "console.", "token helper", failures);
  need(files.brandPeople ?? "", "safeBrandPersonResolution", "shared owner", failures);
  forbid(files.brandPeople ?? "", "opaqueToken", "shared persistence", failures);

  const quote = files.quote ?? "";
  for (const required of [
    "mingla:offering-payload:v1", "mingla:offering-eligibility:v1",
    "mingla:offering-quote:v1", "mingla:offering-execution:v1",
    "resolveOfferingInviteSmsPriceBook", "composeSmsBody(body, true)",
    "executionCandidateParts", "allowEmptyPreview",
  ]) need(quote, required, "quote owner", failures);
  forbid(quote, "frame(input.quotedAt)", "stable quote identity", failures);

  const worker = files.worker ?? "";
  for (const required of [
    'rpc("biz_claim_brand_person_ingest"',
    '"biz_resolve_brand_person_source_derived"',
    '"biz_finish_brand_person_ingest"',
    "p_limit: 100",
  ]) need(worker, required, "worker", failures);
  for (const pii of ["guest_email", "buyer_email", "normalized_value", "console.log"]) {
    forbid(worker, pii, "worker response/logging", failures);
  }

  const dispatch = files.dispatch ?? "";
  need(dispatch, 'if (body.mode === "preview")', "dispatch preview", failures);
  need(dispatch, "resolveOfferingInviteTokenPepper", "dispatch crypto", failures);
  need(dispatch, 'p_actor_id: actorId', "dispatch actor", failures);
  need(dispatch, '"biz_offering_send_quote_candidates"', "dispatch quote", failures);
  need(dispatch, '"biz_seal_offering_execution_snapshot"', "dispatch seal", failures);
  need(dispatch, '"biz_execute_offering_send_group"', "dispatch execute", failures);
  need(dispatch, "/functions/v1/marketing-send", "dispatch provider reuse", failures);
  need(dispatch, "dispatchV2(", "dispatch push reuse", failures);
  need(dispatch, 'category_key: "offering_invitation"', "dispatch can_send category", failures);
  need(dispatch, '"biz_preflight_offering_push_provider_io"', "dispatch persisted push preflight", failures);
  need(dispatch, "persisted_offering_push: claimed.pushPayload", "dispatch persisted push payload", failures);
  forbid(dispatch, "quoted.snapshot.campaigns.push", "dispatch transient push payload", failures);
  if (
    dispatch.indexOf('if (body.mode === "preview")') > dispatch.indexOf("/functions/v1/marketing-send") ||
    dispatch.indexOf('if (body.mode === "preview")') > dispatch.indexOf("dispatchV2(")
  ) failures.push("dispatch preview: provider boundary precedes preview return");
  for (const provider of ["api.resend.com", "api.twilio.com", "api.termii.com", "onesignal.com/api"]) {
    forbid(dispatch, provider, "dispatch direct provider", failures);
  }

  const notify = files.notify ?? "";
  for (const required of [
    'input.category_key === "offering_invitation"',
    'input.requested_channel === "push"',
    "validatePersistedOfferingPushV1(",
    "title: persisted.title", "body: persisted.body",
    "event_id: persisted.eventId",
    '"biz_claim_offering_push_provider_io"',
    '"biz_record_offering_push_dispatch_result"',
    "if (categoryError)",
    'reason: "category_lookup_unavailable"',
    "if (existing.error)",
    'reason: "inbox_unavailable"',
    "if (policy.error)",
    'reason: "can_send_unavailable"',
    '"inbox_idempotency_collision"',
  ]) need(notify, required, "offering-only persisted push seam", failures);
  for (const required of ["internalProviderClaimKey", "oneSignalIdempotencyKey", "provider_outcome_unknown", 'outcome: "accepted"'])
    need(files.push ?? "", required, "OneSignal sender contract", failures);
  for (const required of ["PushAdapterResult", "beforeProviderIo"])
    need(files.pushAdapter ?? "", required, "push adapter contract", failures);
  for (const required of ["AD_CONVERSION_TOKENS", "constantTimeEqual", "ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT"])
    need(files.eventAuth ?? "", required, "Event Stream auth", failures);
  for (const required of ["MAX_BODY = 8192", 'resolveAppCredentials("consumer")', '"biz_reconcile_offering_push_event"'])
    need(files.eventReceiver ?? "", required, "Event Stream receiver", failures);
  for (const forbidden of ["push_payload_v1", "biz_claim_offering_push_provider_io", "pushAdapter", "dispatchV2"])
    forbid(files.marketingSend ?? "", forbidden, "marketing-send push ownership", failures);

  const exportSource = files.export ?? "";
  for (const required of [
    ".createSignedUrl(storagePath, 60)",
    '"biz_export_brand_people"',
    ", 202)",
  ]) need(exportSource, required, "export", failures);
  const exportWorker = files.exportWorker ?? "";
  for (const required of [
    '"brand-people-exports"', "csvFromRows", '"biz_claim_brand_people_export_jobs"',
    '"biz_prepare_brand_people_export_upload"', '"biz_complete_brand_people_export"',
    '"biz_expire_brand_people_export"', ").remove(paths)",
    'Deno.env.get("SUPABASE_URL")', 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
    "url.length === 0 || serviceKey.length === 0", 'error: "forbidden"',
  ]) need(exportWorker, required, "export worker", failures);
  need(files.csv ?? "", "export function csvCell", "export CSV", failures);
  need(files.csv ?? "", "/^[=+\\-@]/", "export CSV", failures);
  need(files.audience ?? "", 'kind: "offering_send_group"', "marketing audience", failures);
  need(files.audience ?? "", 'rpc("biz_offering_send_group_audience"', "marketing audience", failures);

  for (const testKey of ["sqlTest", "concurrencyTest", "tokenTest", "tokenVectorTest", "quoteTest", "brandPeopleTest", "workerTest", "dispatchTest", "exportTest", "exportWorkerTest", "emailRenderTest", "marketingSendTest", "notifyTest", "notifyReconcileTest", "pushAdapterTest", "eventAuthTest", "eventReceiverTest"]) {
    if ((files[testKey] ?? "").length < 100) failures.push(`${testKey}: happy-path proof missing`);
  }
  need(files.sqlTest ?? "", "legitimate retry lost attribution", "SQL happy path", failures);
  need(files.sqlTest ?? "", "wrong event accepted the token", "SQL happy path", failures);
  need(files.sqlTest ?? "", "auth erasure deleted token audit instead of revoking it", "SQL happy path", failures);
  need(files.sqlTest ?? "", "current can_send denial was bypassed", "SQL happy path", failures);
  need(files.sqlTest ?? "", "replay duplicated identity or active source", "SQL happy path", failures);
  need(files.sqlTest ?? "", "stale processing ingest was not reclaimed", "SQL happy path", failures);
  need(files.sqlTest ?? "", "actor-changed replay succeeded", "SQL actor replay", failures);
  need(files.sqlTest ?? "", "erasure did not preserve pseudonymous send audit", "SQL erasure", failures);
  need(files.sqlTest ?? "", "callback-before-delivery did not project sent truth", "SQL push reconciliation", failures);
  need(files.sqlTest ?? "", "unsubscribe was not dedupe-only", "SQL ignored event", failures);
  need(files.sqlTest ?? "", "preflight accepted inactive invite", "SQL push preflight", failures);
  need(files.sqlTest ?? "", "result RPC persisted unallowlisted provider text", "SQL safe-code allowlist", failures);
  need(files.sqlTest ?? "", "provider_partial_failure", "SQL out-of-order evidence", failures);
  need(files.sqlTest ?? "", "source revision counts were %/%/%/% instead of 1/1/2/3", "SQL source coalescing", failures);
  need(files.sqlTest ?? "", "approval revision counts were %/%/% instead of 1/2/2", "SQL approval revision", failures);
  need(files.sqlTest ?? "", "forced enqueue failure rolled back source or wrote outbox", "SQL source fail-open", failures);
  need(files.sqlTest ?? "", "arbitrary caller snapshot was accepted", "SQL export validation", failures);
  need(files.concurrencyTest ?? "", "dblink_is_busy('issue1770_b')", "two-session ordinal wait", failures);
  need(files.concurrencyTest ?? "", "concurrent ordinals were %/%", "two-session ordinal commit", failures);
  need(files.quoteTest ?? "", "4af027908ace4d56fec849b7736e69ef4c2c351f7d3cdf06c6ab3d07743bab56", "quote vector", failures);
  need(files.tokenVectorTest ?? "", "eeba954e4b6ddd70398092199f2161cec470c078ebff4e11f72530efff8241bc", "token vector", failures);

  for (const required of [
    '"biz_prepare_offering_invite_delivery"', '"biz_claim_offering_invite_provider_io"',
    "provider_outcome_unknown", "beforeProviderIo", "constantTimeTokenHashEquals",
  ]) need(files.marketingSend ?? "", required, "JIT invite delivery", failures);
  need(files.emailRender ?? "", "offering_invite_url_marker", "email volatile seam", failures);

  for (const [name, jwt] of [
    ["brand-person-ingest-worker", "false"],
    ["offering-invite-dispatch", "true"],
    ["brand-people-export", "true"],
    ["brand-people-export-worker", "true"],
    ["onesignal-event-stream", "false"],
  ]) {
    need(files.config ?? "", `[functions.${name}]\nverify_jwt = ${jwt}`, "function config", failures);
  }

  let manifest;
  try {
    manifest = JSON.parse(files.manifest ?? "");
  } catch {
    failures.push("secret manifest: invalid JSON");
    manifest = {};
  }
  const pepper = manifest.secrets?.find((entry) => entry.name === "OFFERING_INVITE_TOKEN_PEPPER");
  const conversion = manifest.secrets?.find((entry) => entry.name === "AD_CONVERSION_TOKENS");
  if (
    manifest.policy?.normal_ceiling !== 87 ||
    manifest.rollout?.expected_user_managed_count !== 88 ||
    manifest.secrets?.length !== 88 ||
    pepper?.class !== "cryptographic_secret" ||
    pepper?.issue !== 1770 ||
    JSON.stringify(pepper?.readers) !== JSON.stringify([
      "supabase/functions/_shared/offeringInviteToken.ts",
      "supabase/functions/marketing-send/index.ts",
      "supabase/functions/offering-invite-dispatch/index.ts",
    ]) || !conversion?.bundle_fields?.some((field) => field.name === "ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT" && field.owner === "Messaging Engineering" && field.source_type === "secure_vault") ||
    !conversion?.bundle_fields?.some((field) => field.name === "ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS" && field.owner === "Messaging Engineering" && field.source_type === "secure_vault")
  ) failures.push("secret manifest: #1770 pepper contract missing from approved 88-name manifest");
  return failures;
}

function readFiles() {
  const files = Object.fromEntries(Object.entries(PATHS).map(([key, relative]) => [
    key,
    fs.readFileSync(path.join(ROOT, relative), "utf8"),
  ]));
  const callSites = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (
        entry.name.endsWith(".ts") && !entry.name.includes(".test.") &&
        !entry.name.includes("tester")
      ) {
        callSites.push({
          path: path.relative(ROOT, absolute),
          source: fs.readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  visit(path.join(ROOT, "supabase/functions"));
  files.callSites = callSites;
  return files;
}

function selfTest() {
  const clean = readFiles();
  const baseline = violations(clean);
  if (baseline.length) throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  const reversions = [
    ["migration", "consumed_at=COALESCE(consumed_at,now())", "token validator"],
    ["migration", "FOR UPDATE SKIP LOCKED LIMIT p_limit", "outbox claim"],
    ["migration", "EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table)", "RLS"],
    ["worker", "p_limit: 100", "worker claim"],
    ["dispatch", 'if (body.mode === "preview")', "preview"],
    ["dispatch", '"biz_seal_offering_execution_snapshot"', "snapshot seal"],
    ["migration", "idempotency_actor_mismatch", "actor-bound replay"],
    ["quote", "mingla:offering-execution:v1", "execution hash"],
    ["token", "mingla:offering-invite:derive:v1", "deterministic token"],
    ["marketingSend", '"biz_prepare_offering_invite_delivery"', "JIT token"],
    ["exportWorker", '"biz_claim_brand_people_export_jobs"', "export lease"],
    ["exportWorker", "url.length === 0 || serviceKey.length === 0", "export rollout credential preflight"],
    ["export", ".createSignedUrl(storagePath, 60)", "signed URL"],
    ["sqlTest", "legitimate retry lost attribution", "SQL behavior"],
    ["migration", "CREATE TRIGGER issue_1770_push_payload_immutable", "push immutability"],
    ["migration", "v_old_state IS NOT DISTINCT FROM v_new_state", "source no-op coalescing"],
    ["migration", "'rsvpStatus',to_jsonb(NEW)->>'rsvp_status'", "RSVP status revision"],
    ["migration", "'approvalStatus',to_jsonb(NEW)->>'approval_status'", "RSVP approval revision"],
    ["migration", "pg_advisory_xact_lock(hashtextextended(p_invite_id::text || ':' || p_channel,1770))", "ordinal namespace lock"],
    ["migration", "p_filter_snapshot<>'{}'::jsonb", "export snapshot rejection"],
    ["migration", "RAISE EXCEPTION 'issue_1770_export_worker_dependencies_missing'", "extension hard dependency"],
    ["migration", "RAISE NOTICE 'issue-1770 advisory: vault.decrypted_secrets row \"supabase_url\" missing.", "missing URL migration advisory"],
    ["migration", "RAISE NOTICE 'issue-1770 advisory: vault.decrypted_secrets row \"service_role_key\" missing.", "missing service key migration advisory"],
    ["concurrencyTest", "dblink_is_busy('issue1770_b')", "two-session concurrency proof"],
    ["notify", '"biz_claim_offering_push_provider_io"', "DB-backed push claim"],
    ["notify", 'input.category_key === "offering_invitation"', "offering-only push seam"],
    ["notify", "if (categoryError)", "category lookup outage"],
    ["notify", "if (policy.error)", "policy lookup outage"],
    ["notify", "if (existing.error)", "inbox collision reload outage"],
  ];
  for (const [key, line, label] of reversions) {
    if (!clean[key].includes(line)) throw new Error(`self-test fixture missing: ${label}`);
    const broken = { ...clean, [key]: clean[key].replaceAll(line, "") };
    if (violations(broken).length === 0) throw new Error(`true-source deletion passed: ${label}`);
  }
  const forbiddenCallSite = {
    ...clean,
    callSites: [...clean.callSites, {
      path: "supabase/functions/brand-people-export-worker/invented.ts",
      source: 'service.rpc("biz_execute_offering_send_group", {})',
    }],
  };
  if (violations(forbiddenCallSite).length === 0) {
    throw new Error("forbidden worker actor-RPC call site passed");
  }
  console.log(`#1770 Ring-1 self-test PASS (${reversions.length} true-source deletions)`);
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1770 Ring-1 Brand People guard PASS");
}
