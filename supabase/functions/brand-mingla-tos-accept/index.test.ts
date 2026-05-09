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
