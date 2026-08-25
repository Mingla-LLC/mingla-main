#!/usr/bin/env node
//
// #1971 — the trip lifecycle has ONE command owner.
//
// WHY THIS EXISTS
// Before #1971 the trip domain had four ways to write the same graph: the
// Business service's own multi-statement client writes, the Ari executors'
// direct `.from(...)` mutations, the published-edit RPC, and the publish RPC.
// They could not read each other's writes reliably and none of them was
// atomic. #1971 collapses them onto six canonical SQL commands. This gate is
// what stops a later change from quietly re-opening a second door.
//
// EVERY ASSERTION HERE IS ANCHORED AT A CALL SITE, NOT A DEFINITION.
// A gate that only proved `biz_apply_trip_draft_graph` EXISTS would stay green
// if every caller stopped using it — the exact failure mode that has bitten
// sibling issues this week. So the checks below pair "the owner exists" with
// "the callers still reach it, and nothing else writes these tables".
//
// `--self-test` mutates each protected property and requires every mutant to
// go red. A mutant that passes for an incidental reason is a setup failure, so
// each one is asserted against ITS OWN message.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const PATHS = Object.freeze({
  migration: "supabase/migrations/20270509001971_issue_1971_ari_trip_lifecycle.sql",
  domainTools: "supabase/functions/_shared/agentDomainTools.ts",
  authorization: "supabase/functions/_shared/agentToolAuthorization.ts",
  tenantScope: "supabase/functions/_shared/agentTenantScope.ts",
  prompt: "supabase/functions/_shared/agentSystemPrompt.ts",
  confirm: "supabase/functions/agent-confirm-action/index.ts",
  tripsService: "mingla-business/src/services/tripsService.ts",
  intakeService: "mingla-business/src/services/intakeSchemaService.ts",
  useTrips: "mingla-business/src/hooks/useTrips.ts",
});

// The six canonical commands plus the Ari entry point.
const COMMANDS = Object.freeze([
  "biz_create_trip_draft",
  "biz_apply_trip_draft_graph",
  "biz_update_trip_live_command",
  "biz_publish_trip_command",
  "biz_soft_delete_trip",
  "biz_get_trip_order_money_snapshot",
]);

const TRIP_TOOLS = Object.freeze([
  "create_trip",
  "update_trip",
  "manage_trip_days",
  "manage_trip_inclusions",
  "manage_trip_tiers",
  "manage_trip_traveler_intake",
  "publish_trip",
  "delete_trip",
]);

// Tables whose trip writes are now owned exclusively by the SQL commands.
const OWNED_TABLES = Object.freeze([
  "events",
  "event_dates",
  "trip_days",
  "trip_inclusions",
  "ticket_types",
  "trip_pricing_tiers",
  "trip_intake_schemas",
]);

// Comments explain rules; they are not rules. Scanning prose is how a source
// audit reads green on code that violates what the prose describes.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The body of one SQL function, from its CREATE to its terminating `$fn$;`. */
function sqlBody(migration, name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return null;
  const end = migration.indexOf("$fn$;", start);
  return end < 0 ? null : migration.slice(start, end);
}

/** The source of one TypeScript top-level `const <name> = ` binding. */
function tsBinding(source, name) {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) return null;
  const next = source.indexOf("\nconst ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

export function check(sources) {
  const failures = [];
  const migration = sources.migration;
  const tools = stripComments(sources.domainTools);
  const trips = stripComments(sources.tripsService);
  const intake = stripComments(sources.intakeService);

  // ---------------------------------------------------------------- SQL owner
  for (const command of COMMANDS) {
    const body = sqlBody(migration, command);
    if (body === null) {
      failures.push(`migration: canonical command ${command} is missing`);
      continue;
    }
    if (!/SECURITY DEFINER/.test(body)) {
      failures.push(`migration: ${command} is not SECURITY DEFINER`);
    }
    if (!/SET search_path = public(?:, extensions)?, pg_temp/.test(body)) {
      failures.push(`migration: ${command} has no fixed search_path`);
    }
  }

  // Publish must reconstruct its payload from stored state. The pre-#1971
  // executor sent `{}` to the publish owner and could never succeed.
  const publish = sqlBody(migration, "biz_publish_trip_command") ?? "";
  if (!/v_payload := jsonb_build_object\(/.test(publish) ||
    !/issue_1719_publish_trip_with_poster\(p_event_id, v_payload, NULL\)/.test(publish)) {
    failures.push(
      "migration: biz_publish_trip_command no longer builds its payload from persisted state",
    );
  }

  // The live command must forward the shared top-level Business vocabulary
  // untouched. Allow-listing only Ari's grouped keys made published trip
  // editing dead on web, iOS and Android at once.
  const live = sqlBody(migration, "biz_update_trip_live_command") ?? "";
  if (!/v_forward := COALESCE\(p_patch, '\{\}'::jsonb\) - v_graph_only;/.test(live)) {
    failures.push(
      "migration: biz_update_trip_live_command stopped forwarding the shared LiveTripPatch keys",
    );
  }
  if (!/issue_1719_update_live_trip_with_poster\(p_event_id, v_forward, p_reason\)/.test(live)) {
    failures.push(
      "migration: biz_update_trip_live_command stopped delegating to the audited live owner",
    );
  }
  for (const key of ["title", "description", "theme", "pricing_tiers"]) {
    if (!new RegExp(`'${key}'`).test(live)) {
      failures.push(`migration: live command no longer admits the shared key ${key}`);
    }
  }

  // Delete must reject every rail, and must not fall back to the
  // web-purchase notification predicate.
  const del = sqlBody(migration, "biz_soft_delete_trip") ?? "";
  if (!/payment_status NOT IN \('failed', 'cancelled'\)/.test(del)) {
    failures.push("migration: soft delete no longer rejects every confirmed order");
  }
  // Called, not merely mentioned: the comment above it explains WHY it is not
  // the delete predicate, and a gate that matched prose would red on its own
  // explanation.
  if (/public\.biz_trip_has_web_purchases\(/.test(migration)) {
    failures.push(
      "migration: the notification-only web-purchase predicate is being used as a delete guard",
    );
  }
  if (!/CREATE TRIGGER trg_biz_trip_order_delete_lock/.test(migration)) {
    failures.push("migration: the order/delete serialization trigger is missing");
  }

  // Compare-and-swap and receipt identity.
  for (const command of [
    "biz_apply_trip_draft_graph",
    "biz_update_trip_live_command",
    "biz_publish_trip_command",
    "biz_soft_delete_trip",
  ]) {
    const body = sqlBody(migration, command) ?? "";
    if (!/RAISE EXCEPTION 'trip_revision_conflict'/.test(body)) {
      failures.push(`migration: ${command} lost its compare-and-swap`);
    }
    // The expected revision must be part of the receipt's argument hash, or a
    // replay with a materially different revision returns the prior result
    // instead of failing closed.
    if (!/'expected_updated_at', p_expected_updated_at/.test(body)) {
      failures.push(`migration: ${command} omits expected_updated_at from its receipt identity`);
    }
  }
  const begin = sqlBody(migration, "biz_trip_command_begin") ?? "";
  for (const bind of ["actor_user_id <> v_actor", "brand_id <> p_brand_id", "arguments_hash <> v_hash"]) {
    if (!begin.includes(bind)) {
      failures.push(`migration: the command receipt no longer binds ${bind}`);
    }
  }

  // Deposit/instalment bounds run at the AUTHORING boundary, on both
  // vocabularies, before anything is stored.
  const validatorCallers = (migration.match(/PERFORM public\.biz_validate_trip_installment_schedule\(/g) ?? []).length;
  if (validatorCallers < 3) {
    failures.push(
      `migration: instalment validation has ${validatorCallers} call sites, expected at least 3 (draft tiers, live grouped tiers, live pricing_tiers)`,
    );
  }

  // Sidecar RLS floor.
  for (const table of ["trip_days", "trip_inclusions", "trip_pricing_tiers"]) {
    if (!new RegExp(`CREATE POLICY ${table}_write_event_managers ON public\\.${table}`).test(migration)) {
      failures.push(`migration: ${table} write policy is not at the event_manager floor`);
    }
    if (!new RegExp(`DROP POLICY IF EXISTS ${table}_write_brand_members`).test(migration)) {
      failures.push(`migration: the read-member ${table} write policy is not removed`);
    }
  }

  // ------------------------------------------------------------- Ari callers
  // The region markers ARE comments, so this one slice is taken from the raw
  // source and only then stripped.
  const rawTools = sources.domainTools;
  const tripRegion = stripComments(rawTools.slice(
    rawTools.indexOf("// D. Trips"),
    rawTools.indexOf("// E. RSVP"),
  ));
  if (tripRegion.length < 100) {
    failures.push("agentDomainTools: the trip tool region could not be located");
  }

  const executor = tsBinding(tools, "executeTripWrite") ??
    (tools.includes("async function executeTripWrite(") ? tools : null);
  if (executor === null || !/ari_execute_trip_operation/.test(tripRegion)) {
    failures.push("agentDomainTools: the trip executor no longer calls ari_execute_trip_operation");
  }
  // Scoped to the trip region on purpose: the same helper is used by the event,
  // experience and brand domains, so a file-wide match would stay green while
  // the TRIP executor quietly minted its own id.
  if (!/requireAgentOperationId\(context\)/.test(tripRegion)) {
    failures.push("agentDomainTools: trip writes no longer bind the confirmed operation id");
  }
  for (const tool of TRIP_TOOLS) {
    if (!new RegExp(`writeTool\\(\\s*"${tool}"`).test(tools)) {
      failures.push(`agentDomainTools: ${tool} is not registered as a literal writeTool`);
    }
    if (!new RegExp(`"${tool}"`).test(sources.confirm)) {
      failures.push(`agent-confirm-action: ${tool} is not receipt-backed`);
    }
    if (!new RegExp(`\\b${tool}:\\s*role\\("`).test(sources.authorization)) {
      failures.push(`agentToolAuthorization: ${tool} has no role declaration`);
    }
    if (!new RegExp(`^- ${tool} —`, "m").test(sources.prompt)) {
      failures.push(`agentSystemPrompt: ${tool} is not advertised`);
    }
  }
  if (!/get_trip_order_money:\s*role\("finance_manager"/.test(sources.authorization)) {
    failures.push("agentToolAuthorization: the trip money read is not finance-gated");
  }
  if (!/"get_trip_order_money"/.test(sources.tenantScope)) {
    failures.push("agentTenantScope: the trip money read is outside the tenant-scoped registry");
  }

  // No Ari executor may write these tables directly for a trip operation.
  for (const table of OWNED_TABLES) {
    const direct = new RegExp(
      `\\.from\\("${table}"\\)[\\s\\S]{0,400}?\\.(insert|update|upsert|delete)\\(`,
    );
    if (direct.test(tripRegion)) {
      failures.push(`agentDomainTools: a trip executor writes ${table} directly`);
    }
  }

  // ------------------------------------------------------- Business callers
  for (
    const [fn, command] of [
      ["createTripDraft", "biz_create_trip_draft"],
      ["publishTrip", "biz_publish_trip_command"],
      ["softDeleteTrip", "biz_soft_delete_trip"],
      ["updateLiveTripFields", "biz_update_trip_live_command"],
      ["applyTripDraftGraph", "biz_apply_trip_draft_graph"],
    ]
  ) {
    const start = trips.indexOf(`export async function ${fn}(`);
    if (start < 0) {
      failures.push(`tripsService: ${fn} is missing`);
      continue;
    }
    const next = trips.indexOf("\nexport ", start + 1);
    const body = trips.slice(start, next < 0 ? trips.length : next);
    if (!new RegExp(`supabase\\.rpc\\(\\s*"${command}"`).test(body)) {
      failures.push(`tripsService: ${fn} no longer calls ${command}`);
    }
  }
  for (const helper of ["upsertTripDays", "upsertTripInclusions", "updateTripBasics", "updateTripPricing", "createTripPricingTier", "removeTripPricingTier"]) {
    const start = trips.indexOf(`export async function ${helper}(`);
    if (start < 0) {
      failures.push(`tripsService: ${helper} is missing`);
      continue;
    }
    const next = trips.indexOf("\nexport ", start + 1);
    const body = trips.slice(start, next < 0 ? trips.length : next);
    if (!/applyTripDraftGraph\(/.test(body)) {
      failures.push(`tripsService: ${helper} no longer routes through the canonical graph command`);
    }
  }
  for (const table of OWNED_TABLES) {
    const direct = new RegExp(
      `\\.from\\("${table}"\\)[\\s\\S]{0,600}?\\.(insert|upsert|delete)\\(`,
    );
    if (direct.test(trips)) {
      failures.push(`tripsService: a client-side write to ${table} survives`);
    }
    if (direct.test(intake)) {
      failures.push(`intakeSchemaService: a client-side write to ${table} survives`);
    }
  }
  // Every #1971-owned lifecycle function must be free of a direct events
  // UPDATE. This is scoped rather than file-wide on purpose:
  // `setTripPricingSwitches` is ORCH-1006's own owner — a single, trip-scoped,
  // rowcount-verified per-column write whose NULL-means-inherit semantics apply
  // to draft AND published trips, which the draft-only graph command cannot
  // express. It is deliberately out of #1971's scope, and pretending otherwise
  // here would make this gate a lie.
  for (const fn of ["createTripDraft", "updateTripBasics", "upsertTripDays", "upsertTripInclusions", "updateTripPricing", "createTripPricingTier", "removeTripPricingTier", "publishTrip", "softDeleteTrip", "updateLiveTripFields"]) {
    const start = trips.indexOf(`export async function ${fn}(`);
    if (start < 0) continue;
    const next = trips.indexOf("\nexport ", start + 1);
    const body = trips.slice(start, next < 0 ? trips.length : next);
    if (/\.from\("events"\)[\s\S]{0,300}?\.(update|insert|delete)\(/.test(body)) {
      failures.push(`tripsService: ${fn} still writes the events table directly`);
    }
  }
  if (!/biz_apply_trip_draft_graph/.test(intake) || !/biz_update_trip_live_command/.test(intake)) {
    failures.push("intakeSchemaService: intake writes no longer reach the canonical commands");
  }

  // The hook layer owns operation-id stability.
  // Counted, not merely present. Every trip mutation hook must pin an id, and
  // `publishTrip` needs a second one for its pre-save, so a single surviving
  // call site must not be able to keep this green while the others regress.
  const pinnedIds = (stripComments(sources.useTrips).match(/operationIdFor\(/g) ?? []).length;
  if (pinnedIds < 11) {
    failures.push(
      `useTrips: only ${pinnedIds} mutations pin a stable operation id, expected at least 11`,
    );
  }
  if (!/const TRIP_OPERATION_IDS = new WeakMap/.test(trips)) {
    failures.push("tripsService: the per-action operation-id map is gone");
  }

  return failures;
}

// ---------------------------------------------------------------------------
const sources = Object.fromEntries(
  Object.entries(PATHS).map(([key, file]) => [key, read(file)]),
);
const LABEL = "issue-1971-ari-trip-lifecycle";

if (process.argv.includes("--self-test")) {
  const mutate = (key, from, to) => {
    const next = sources[key].replace(from, to);
    if (next === sources[key]) {
      console.error(`${LABEL} self-test SETUP FAIL: anchor not found in ${key}: ${from}`);
      process.exit(1);
    }
    return { ...sources, [key]: next };
  };

  // Each mutant names the failure it must produce, so a mutant that goes red
  // for an unrelated reason is caught as a setup error rather than counted as
  // a pass.
  const mutants = [
    ["publish stops loading persisted state",
      mutate("migration", "v_payload := jsonb_build_object(", "v_payload := COALESCE(NULL, jsonb_build_object("),
      /builds its payload from persisted state/],
    ["the live command stops forwarding shared Business keys",
      mutate("migration", "v_forward := COALESCE(p_patch, '{}'::jsonb) - v_graph_only;", "v_forward := '{}'::jsonb;"),
      /forwarding the shared LiveTripPatch keys/],
    ["the live command stops delegating to the audited owner",
      mutate("migration", "issue_1719_update_live_trip_with_poster(p_event_id, v_forward, p_reason)", "jsonb_build_object('ok', true)"),
      /delegating to the audited live owner/],
    ["delete narrows to the web-purchase predicate",
      mutate("migration", "payment_status NOT IN ('failed', 'cancelled')", "public.biz_trip_has_web_purchases(p_event_id)"),
      /rejects every confirmed order/],
    ["the order/delete serialization trigger is dropped",
      mutate("migration", "CREATE TRIGGER trg_biz_trip_order_delete_lock", "-- removed trigger"),
      /serialization trigger is missing/],
    ["a command loses its compare-and-swap",
      mutate("migration", "RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = '40001';\n  END IF;\n  IF jsonb_typeof(COALESCE(p_patch", "NULL;\n  END IF;\n  IF jsonb_typeof(COALESCE(p_patch"),
      /lost its compare-and-swap/],
    ["expected_updated_at leaves the receipt identity",
      mutate("migration", "jsonb_build_object('patch', p_patch, 'expected_updated_at', p_expected_updated_at)", "jsonb_build_object('patch', p_patch)"),
      /omits expected_updated_at from its receipt identity/],
    ["the receipt stops binding the actor",
      mutate("migration", "actor_user_id <> v_actor", "false"),
      /no longer binds actor_user_id/],
    ["instalment validation loses the shared-vocabulary call site",
      // The `pricing_tiers` branch is the one that guards the ESTABLISHED
      // Business live payload — independent QA found an out-of-range deposit
      // could be persisted through it.
      mutate("migration", "FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'pricing_tiers') LOOP\n      PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');",
        "FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'pricing_tiers') LOOP\n      NULL;"),
      /instalment validation has 2 call sites/],
    ["the sidecar write floor drops back to read members",
      mutate("migration", "CREATE POLICY trip_days_write_event_managers ON public.trip_days", "CREATE POLICY trip_days_write_anyone ON public.trip_days"),
      /trip_days write policy is not at the event_manager floor/],
    ["an Ari trip write drops the confirmed operation id",
      mutate("domainTools",
        "  return await callRpc(client, \"ari_execute_trip_operation\", {\n    p_operation_id: requireAgentOperationId(context),",
        "  return await callRpc(client, \"ari_execute_trip_operation\", {\n    p_operation_id: crypto.randomUUID(),"),
      /no longer bind the confirmed operation id/],
    ["a trip tool is deregistered",
      mutate("domainTools", 'writeTool(\n  "manage_trip_days"', 'legacyTool(\n  "manage_trip_days"'),
      /manage_trip_days is not registered as a literal writeTool/],
    ["a trip tool loses its role declaration",
      mutate("authorization", 'manage_trip_tiers: role("', 'manage_trip_tiers: legacy("'),
      /manage_trip_tiers has no role declaration/],
    ["the money read stops being finance-gated",
      mutate("authorization", 'get_trip_order_money: role("finance_manager"', 'get_trip_order_money: role("scanner"'),
      /trip money read is not finance-gated/],
    ["the money read leaves the tenant-scoped registry",
      mutate("tenantScope", '"get_trip_order_money"', '"get_trip_order_money_retired"'),
      /outside the tenant-scoped registry/],
    ["a trip tool stops being receipt-backed on confirmation",
      mutate("confirm", '  "manage_trip_days",\n', ""),
      /manage_trip_days is not receipt-backed/],
    ["an Ari executor writes a trip table directly",
      mutate("domainTools", "const deleteTrip = writeTool(",
        'const legacyDeleteTrip = async (client: any) =>\n  await client.from("events").update({ deleted_at: null });\n\nconst deleteTrip = writeTool('),
      /writes events directly/],
    ["the Business create leaves the canonical command",
      mutate("tripsService", 'supabase.rpc("biz_create_trip_draft"', 'supabase.rpc("legacy_create_trip"'),
      /createTripDraft no longer calls biz_create_trip_draft/],
    ["the Business publish leaves the canonical command",
      mutate("tripsService", 'supabase.rpc("biz_publish_trip_command"', 'supabase.rpc("issue_1719_publish_trip_with_poster"'),
      /publishTrip no longer calls biz_publish_trip_command/],
    ["the Business delete goes back to a raw events update",
      mutate("tripsService", 'supabase.rpc("biz_soft_delete_trip"', 'supabase.rpc("legacy_delete"'),
      /softDeleteTrip no longer calls biz_soft_delete_trip/],
    ["day replacement leaves the canonical graph command",
      mutate("tripsService", "  const graph = await applyTripDraftGraph(\n    eventId,\n    {\n      days:", "  const graph = await legacyReplaceDays(\n    eventId,\n    {\n      days:"),
      /upsertTripDays no longer routes through the canonical graph command/],
    ["the intake service goes back to a direct table write",
      mutate("intakeService", 'supabase.rpc("biz_apply_trip_draft_graph"', 'supabase.from("trip_intake_schemas").upsert('),
      /a client-side write to trip_intake_schemas survives|intake writes no longer reach the canonical commands/],
    ["one hook stops pinning a stable operation id",
      mutate("useTrips", "operationIdFor(variables)", "crypto.randomUUID()"),
      /mutations pin a stable operation id, expected at least 11/],
    ["the per-action operation-id map is deleted",
      mutate("tripsService", "const TRIP_OPERATION_IDS = new WeakMap", "const TRIP_OPERATION_IDS_RETIRED = new WeakMap"),
      /per-action operation-id map is gone/],
  ];

  const clean = check(sources);
  if (clean.length) {
    console.error(`${LABEL} self-test FAIL: clean sources are already red:\n  - ${clean.join("\n  - ")}`);
    process.exit(1);
  }

  const problems = [];
  for (const [name, mutated, expected] of mutants) {
    const failures = check(mutated);
    if (!failures.length) {
      problems.push(`${name}: mutant escaped`);
    } else if (!failures.some((failure) => expected.test(failure))) {
      // A mutant that reds for the WRONG reason proves nothing about the
      // property it was written to attack.
      problems.push(`${name}: red for the wrong reason (${failures.join("; ")})`);
    }
  }
  if (problems.length) {
    console.error(`${LABEL} self-test FAIL:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`${LABEL} self-test PASS (${mutants.length} mutants, each red for its own assertion)`);
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error(`${LABEL} FAIL:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(
  `${LABEL} PASS: six canonical trip commands own every write; Business and Ari ` +
    "both reach them, carry a revision and a confirmed operation id, and no direct " +
    "trip-table mutation survives on either client",
);
