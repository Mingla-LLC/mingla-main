import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationUrl = new URL(
  "../20271025003720_issue_3720_support_product_signals.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationUrl);
const normalized = sql.replace(/\s+/g, " ").trim();

Deno.test("creates separate internal-ticket, private-signal, source-link and audit tables", () => {
  for (const table of [
    "support_internal_threads",
    "support_product_signals",
    "support_product_signal_sources",
    "support_product_workflow_audit",
  ]) {
    assertStringIncludes(normalized, `CREATE TABLE IF NOT EXISTS public.${table}`);
    assertStringIncludes(normalized, `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  }
  assertStringIncludes(normalized, "ALTER PUBLICATION supabase_realtime ADD TABLE public.support_internal_threads");
  assertStringIncludes(normalized, "ALTER PUBLICATION supabase_realtime ADD TABLE public.support_product_signals");
});

Deno.test("browser roles can read gated workflow state but cannot mutate tables directly", () => {
  assertStringIncludes(normalized, "GRANT SELECT ON public.support_internal_threads TO authenticated, service_role");
  assertStringIncludes(normalized, "GRANT SELECT ON public.support_product_signals TO authenticated, service_role");
  assertStringIncludes(normalized, "REVOKE UPDATE ON public.support_tickets FROM authenticated, anon");
  assert(!/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\s+ON\s+public\.support_(internal_threads|product_signals)\s+TO\s+authenticated/i.test(sql));
  assertStringIncludes(normalized, "public.is_support_staff(auth.uid()) OR public.is_admin_user()");
});

Deno.test("all six write RPCs are definer-gated and stale writes fail closed", () => {
  const names = [
    "issue_3720_create_internal_thread",
    "issue_3720_set_next_update",
    "issue_3720_update_internal_thread",
    "issue_3720_create_product_signal",
    "issue_3720_update_product_signal",
    "issue_3720_link_product_signal_source",
  ];
  for (const name of names) {
    const start = normalized.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    assert(start >= 0, `${name} missing`);
    const block = normalized.slice(start, start + 7000);
    assertStringIncludes(block, "SECURITY DEFINER");
    assertStringIncludes(block, "PERFORM public.issue_3720_support_operator_required()");
    assertStringIncludes(normalized, `REVOKE ALL ON FUNCTION public.${name}`);
  }
  assertEquals((normalized.match(/RAISE EXCEPTION 'stale_revision'/g) || []).length, 5);
});

Deno.test("live-chat promises are explicit customer-visible system events", () => {
  assertStringIncludes(normalized, "ADD COLUMN IF NOT EXISTS next_update_at timestamptz");
  assertStringIncludes(normalized, "INSERT INTO public.messages(conversation_id, sender_id, content, message_type)");
  assertStringIncludes(normalized, "last_message_at = now()");
  assertStringIncludes(normalized, "'Mingla will update you by '");
  assertStringIncludes(normalized, "'system'");
});

Deno.test("the private signal model has no GitHub write surface", () => {
  assert(!/github(_|\s)*(token|issue|repository|installation)/i.test(sql));
  assertStringIncludes(normalized, "signal_kind IN ('question', 'account', 'bug', 'feature', 'trust_safety')");
  assertStringIncludes(normalized, "UNIQUE (source_kind, source_id)");
});
