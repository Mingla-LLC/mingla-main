import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationUrl = new URL(
  "../20271029003720_issue_3720_brand_groups_messages.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationUrl);
const normalized = sql.replace(/\s+/g, " ").trim();

Deno.test("#3720 derives exactly one official Brand group and roster sync", () => {
  assertStringIncludes(normalized, "CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_official_brand_group");
  assertStringIncludes(normalized, "CREATE TRIGGER issue_3720_sync_brand_group_from_brand");
  assertStringIncludes(normalized, "CREATE TRIGGER issue_3720_sync_brand_group_member");
  assertStringIncludes(normalized, "member.accepted_at IS NOT NULL");
  assertStringIncludes(normalized, "member.removed_at IS NULL");
});

Deno.test("#3720 Brand-group writes are RPC-only and context is contained", () => {
  assertStringIncludes(normalized, "AS RESTRICTIVE FOR INSERT TO authenticated");
  assertStringIncludes(normalized, "p_reply_to_id IS NOT NULL");
  assertStringIncludes(normalized, "m.conversation_id=p_conversation_id");
  assertStringIncludes(normalized, "cardinality(v_related)>20");
  assertStringIncludes(normalized, "RAISE EXCEPTION 'invalid_related_messages'");
  assertStringIncludes(normalized, "sender_display_name_snapshot");
  assertStringIncludes(normalized, "sender_role_snapshot");
});

Deno.test("#3720 Support access, read/watch state and push identity are server-authoritative", () => {
  assertStringIncludes(normalized, "public.is_support_staff(p_user_id)");
  assertStringIncludes(normalized, "CREATE TABLE IF NOT EXISTS public.brand_group_reads");
  assertStringIncludes(normalized, "ALTER PUBLICATION supabase_realtime ADD TABLE public.brand_group_reads");
  assertStringIncludes(normalized, "business.brand_group_message");
  assertStringIncludes(normalized, "mingla-business://messages/");
  assertStringIncludes(normalized, "WHERE public.issue_3720_brand_group_can_access(p_conversation_id,recipient.user_id)");
});

Deno.test("#3720 definer functions fail closed for anonymous callers and protect is_admin_user", () => {
  for (const fn of [
    "issue_3720_brand_group_can_access(uuid, uuid)",
    "issue_3720_ensure_official_brand_group(uuid)",
    "issue_3720_sync_brand_group_from_brand()",
    "issue_3720_sync_brand_group_member()",
    "issue_3720_list_brand_groups()",
    "issue_3720_list_brand_group_messages(uuid,integer,timestamptz)",
    "issue_3720_mark_brand_group_read(uuid)",
    "issue_3720_set_brand_group_watch(uuid,boolean)",
    "issue_3720_send_brand_group_message(uuid,text,uuid,uuid[],text)",
  ]) {
    assertStringIncludes(normalized, `REVOKE ALL ON FUNCTION public.${fn}`);
  }
  assertStringIncludes(normalized, "SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure)");
  assertStringIncludes(normalized, "RAISE EXCEPTION 'is_admin_user_changed'");
  assert(!/CREATE OR REPLACE FUNCTION public\.is_admin_user/i.test(sql));
});

Deno.test("#3720 Brand messages bridge to private Product signals without GitHub writes", () => {
  assertStringIncludes(normalized, "'brand_group_message'");
  assertStringIncludes(normalized, "issue_3720_create_brand_message_product_signal");
  assertStringIncludes(normalized, "issue_3720_link_brand_message_product_signal");
  assert(!/github(_|\s)*(token|issue|repository|installation)/i.test(sql));
});
