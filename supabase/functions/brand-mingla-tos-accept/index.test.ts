import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("brand-mingla-tos-accept is repeat-safe after accepted state", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );

  assertStringIncludes(source, "already_accepted: true");
  assertStringIncludes(source, ".maybeSingle<AcceptedRow>()");
  assertStringIncludes(source, "existingRow.mingla_tos_accepted_at");
  assertStringIncludes(
    source,
    "existingRow.mingla_tos_version_accepted === version",
  );
});

Deno.test("brand-mingla-tos-accept pins the server-owned current Organiser Terms version", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );

  // Client-supplied strings must not write arbitrary / stale versions
  // (v3-pre-launch-placeholder must not overwrite 1.0).
  assertStringIncludes(source, 'CURRENT_ORGANISER_TERMS_VERSION = "1.0"');
  assertStringIncludes(source, "version_not_current");
  assertStringIncludes(source, "current_version: CURRENT_ORGANISER_TERMS_VERSION");
  assertStringIncludes(
    source,
    "requestedVersion !== CURRENT_ORGANISER_TERMS_VERSION",
  );
  assertStringIncludes(source, "const version = CURRENT_ORGANISER_TERMS_VERSION");
});

Deno.test("brand-mingla-tos-accept audit failure does not make accepted ToS fail", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );

  assertStringIncludes(source, "try {");
  assertStringIncludes(source, "await writeAudit(supabase");
  assertStringIncludes(source, "audit write failed");
  assertEquals(source.includes("actor_user_id"), false);
  assertEquals(source.includes("target_table"), false);
  assertEquals(source.includes("metadata:"), false);
  assertStringIncludes(source, 'target_type: "brand_team_members"');
});

Deno.test("brand-mingla-tos-accept allows event_manager+ (paid-publish audience)", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );

  assertStringIncludes(source, "biz_brand_effective_rank");
  assertStringIncludes(source, "RANK_EVENT_MANAGER");
  assertEquals(source.includes("requirePaymentsManager"), false);
});

Deno.test("brand-mingla-tos-accept scopes read/write to the active membership row", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );

  // #3622 soft-closes outgoing owners; unscoped maybeSingle errors on two rows.
  assertStringIncludes(source, '.is("removed_at", null)');
  assertStringIncludes(source, '.not("accepted_at", "is", null)');
  assertStringIncludes(source, ".maybeSingle<AcceptedRow>()");
  // Update path must not widen to soft-closed rows via .single() without filters.
  assertEquals(source.includes(".single<AcceptedRow>()"), false);
});
