// MINGLA-INVARIANT: I-3988-BRAND-SUPPORT-AUDIENCE | issue #3988 | Only tickets explicitly marked for a brand are readable by accepted members whose membership has not been removed; internal staff threads remain private.
// MINGLA-INVARIANT: I-3988-BRAND-SUPPORT-FANOUT | issue #3988 | Opening or materially progressing a brand-visible support ticket enqueues one idempotent notification for every accepted member whose membership has not been removed.
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL(
  "../20271215003988_issue_3988_brand_visible_support.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(root);
const normalizedSql = sql.replace(/\s+/g, " ");

Deno.test("#3988 brand-visible support is explicit and leaves internal threads private", () => {
  assertStringIncludes(sql, "audience IN ('requester', 'brand')");
  assertStringIncludes(sql, "ticket.audience = 'brand'");
  assertStringIncludes(sql, "issue_3988_create_brand_support_ticket");
  assert(
    !sql.includes(
      "support_internal_threads FOR SELECT TO authenticated\n  USING (true)",
    ),
  );
});

Deno.test("#3988 creation and progress fan out idempotently to active accepted brand members", () => {
  assertStringIncludes(sql, "member.accepted_at IS NOT NULL");
  assertStringIncludes(sql, "member.removed_at IS NULL");
  assertStringIncludes(sql, "'business.support_brand_opened:'");
  assertStringIncludes(sql, "'business.support_brand_progress:'");
  assertStringIncludes(sql, "ON CONFLICT (idempotency_key) DO NOTHING");
});

Deno.test("#3988 progress trigger helper is not client-executable", () => {
  assertStringIncludes(
    normalizedSql,
    "REVOKE ALL ON FUNCTION public.issue_3988_notify_brand_support_progress() FROM PUBLIC, anon, authenticated, service_role;",
  );
});
