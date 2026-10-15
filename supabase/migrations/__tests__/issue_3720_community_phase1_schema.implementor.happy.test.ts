/**
 * #3720 Slice E — Phase 1 community schema contract (fails-on-revert).
 *
 * Run:
 *   deno test --allow-read supabase/migrations/__tests__/issue_3720_community_phase1_schema.implementor.happy.test.ts
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MIG = Deno.readTextFileSync(
  new URL(
    "../20271017003720_issue_3720_community_phase1_schema.sql",
    import.meta.url,
  ),
);
const norm = MIG.replace(/\s+/g, " ").trim();

Deno.test("#3720 E creates announcements, roadmap, receipts, staff, audit", () => {
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public.community_announcements");
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public.community_roadmap_cards");
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public.community_read_receipts");
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public.community_staff");
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public.community_audit_log");
  assertStringIncludes(norm, "CREATE OR REPLACE VIEW public.community_roadmap_public");
});

Deno.test("#3720 E seeds community_announcement category (transactional default-on)", () => {
  assertStringIncludes(norm, "'community_announcement'");
  assertStringIncludes(norm, "ARRAY['inapp', 'push', 'email']");
  // Transactional = email on unless host prefs say otherwise.
  assert(/community_announcement[\s\S]{0,200}true/.test(MIG));
});

Deno.test("#3720 E community_staff admits only moderator/agent (not admin)", () => {
  const tableChunk = MIG.slice(
    MIG.indexOf("CREATE TABLE IF NOT EXISTS public.community_staff"),
    MIG.indexOf("COMMENT ON TABLE public.community_staff"),
  );
  assertStringIncludes(tableChunk, "CHECK (role IN ('moderator', 'agent'))");
  assertEquals(/'admin'/.test(tableChunk), false);
});

Deno.test("#3720 E publish is admin-gated and enqueues notification_outbox", () => {
  assertStringIncludes(norm, "FUNCTION public.community_publish_announcement");
  assertStringIncludes(norm, "IF NOT public.is_admin_user()");
  assertStringIncludes(norm, "INSERT INTO public.notification_outbox");
  assertStringIncludes(
    norm,
    "'community_announcement:' || p_id::text || ':' || h.user_id::text",
  );
  assertStringIncludes(norm, "ON CONFLICT (idempotency_key) DO NOTHING");
});

Deno.test("#3720 E support_is_online derives from support_staff.available", () => {
  assertStringIncludes(norm, "FUNCTION public.support_is_online()");
  assertStringIncludes(norm, "s.enabled = true AND s.available = true");
  assertEquals(
    /CREATE TABLE IF NOT EXISTS public\.support_is_online/i.test(MIG),
    false,
  );
});

Deno.test("#3720 E hosts read published only; roadmap view omits internal_note", () => {
  assertStringIncludes(norm, "status = 'published' OR public.is_admin_user()");
  assertStringIncludes(norm, "WHERE c.status = 'published'");
  const viewChunk = MIG.slice(
    MIG.indexOf("CREATE OR REPLACE VIEW public.community_roadmap_public"),
    MIG.indexOf("COMMENT ON VIEW public.community_roadmap_public"),
  );
  assertEquals(/internal_note/.test(viewChunk), false);
});

Deno.test("#3720 E does not invent Phase 2 UGC tables", () => {
  assertEquals(/community_ideas/i.test(MIG), false);
  assertEquals(/community_votes/i.test(MIG), false);
  assertEquals(/community_questions/i.test(MIG), false);
  assertEquals(/community_comments/i.test(MIG), false);
});

Deno.test("#3720 E self-check block is present", () => {
  assertStringIncludes(norm, "DO $check$");
  assertStringIncludes(norm, "self-check: community_announcement category missing");
  assert(norm.includes("COMMIT"), "migration must COMMIT");
});
