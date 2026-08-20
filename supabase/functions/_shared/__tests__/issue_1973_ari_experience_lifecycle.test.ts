import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("#1973 Ari experience tools use canonical graph owners", async () => {
  const [tools, domain, auth, prompt] = await Promise.all([
    read("supabase/functions/_shared/agentTools.ts"),
    read("supabase/functions/_shared/agentDomainTools.ts"),
    read("supabase/functions/_shared/agentToolAuthorization.ts"),
    read("supabase/functions/_shared/agentSystemPrompt.ts"),
  ]);

  const create = tools.slice(
    tools.indexOf("const createExperience"),
    tools.indexOf(
      "// ----------------------------------------------------------------------------\n// Registry",
    ),
  );
  assertStringIncludes(create, '"ari_execute_experience_operation"');
  assertStringIncludes(create, "requireAgentOperationId(context)");
  assert(!create.includes("p_payload"));
  assert(!create.includes('.from("events").insert'));
  assert(!create.includes('.from("experience_stops").insert'));
  assert(!create.includes('.from("ticket_types").insert'));
  assert(!create.includes('timezone: "UTC"'));

  const experienceDomain = domain.slice(
    domain.indexOf("// C. Experiences"),
    domain.indexOf("// D. Trips"),
  );
  for (
    const tool of [
      "publish_experience",
      "update_experience",
      "manage_experience_stops",
      "unpublish_experience",
      "delete_experience",
    ]
  ) {
    assertStringIncludes(experienceDomain, `"${tool}"`);
    assertStringIncludes(auth, `${tool}: role("event_manager", "event")`);
  }
  assertStringIncludes(experienceDomain, "ari_execute_experience_operation");
  assertStringIncludes(experienceDomain, "requireAgentOperationId(context)");
  assert(!experienceDomain.includes('.from("events").update({ deleted_at'));
  assertStringIncludes(prompt, "Created draft");
  assertStringIncludes(prompt, "/experience/snap");
});

Deno.test("#1973 SQL owns graph readback, revision gates, media provenance, demotion and grants", async () => {
  const sql = await read(
    "supabase/migrations/20270505001973_issue_1973_ari_experience_lifecycle.sql",
  );
  for (
    const fn of [
      "issue_1973_read_experience_graph",
      "issue_1973_current_experience_payload",
      "issue_1973_agent_experience_payload",
      "business_create_experience_graph",
      "business_apply_experience_action",
      "business_discard_experience_draft",
      "business_unpublish_experience_to_draft",
      "ari_execute_experience_operation",
    ]
  ) {
    assertStringIncludes(sql, `FUNCTION public.${fn}`);
  }
  assertStringIncludes(sql, "FOR UPDATE");
  assertStringIncludes(sql, "stale_experience_revision");
  assertStringIncludes(sql, "experience_media_reference_required");
  assertStringIncludes(sql, "experience_has_buyer_dependencies");
  assertStringIncludes(sql, "DELETE FROM public.event_dates");
  assertStringIncludes(
    sql,
    "status='draft',visibility='draft',published_at=NULL",
  );
  assertStringIncludes(sql, "coordinate_precision=x.precision");
  assertStringIncludes(sql, "{experience_meta,when_draft}");
  assertStringIncludes(sql, "FROM PUBLIC,anon");
  assertStringIncludes(sql, "TO authenticated,service_role");
  assertStringIncludes(sql, "agent_operation_receipt_begin");
  assertStringIncludes(sql, "agent_operation_receipt_complete");
  assertStringIncludes(
    sql,
    "public.issue_1973_agent_experience_payload(p_args)",
  );
  assert(!sql.includes("CREATE TABLE public.agent_operation_receipts"));
});

Deno.test("#1973 ledger covers every experience row without claiming verification", async () => {
  const ledger = JSON.parse(
    await read("docs/contracts/ari-capability-ledger.json"),
  );
  assertEquals(ledger.audit.capability_count, ledger.capabilities.length);
  type LedgerRow = { id: string; ari_tool: string | null; status: string };
  const rows = (ledger.capabilities as LedgerRow[]).filter((row) =>
    row.id.startsWith("ari.experience.")
  );
  assertEquals(rows.length, 7);
  const byId = new Map(rows.map((row) => [row.id, row]));
  assertEquals(
    byId.get("ari.experience.unpublish")?.ari_tool,
    "unpublish_experience",
  );
  assertEquals(
    byId.get("ari.experience.manage_stops")?.ari_tool,
    "manage_experience_stops",
  );
  assertEquals(
    byId.get("ari.experience.snap_generation")?.status,
    "guided_handoff",
  );
  for (const row of rows) assert(row.status !== "verified");
});

Deno.test("#1973 Snap parsers authorize event managers and call the server-owned proposal batch", async () => {
  for (
    const path of [
      "supabase/functions/parse-restaurant-menu/index.ts",
      "supabase/functions/parse-play-activities/index.ts",
    ]
  ) {
    const source = await read(path);
    assertStringIncludes(source, "biz_brand_effective_rank_for_caller");
    assertStringIncludes(source, 'p_role: "event_manager"');
    assertStringIncludes(source, 'rpc("issue_1973_create_snap_proposals"');
    assert(!source.includes('.from("agent_pending_actions").insert'));
    assert(!source.includes("buildServiceClient"));
    assert(!source.includes("brand.account_id !== userId"));
    assert(
      !source.includes(
        "for (const exp of parseResult.experiences) {\n    const tool_args",
      ),
    );
  }
});
