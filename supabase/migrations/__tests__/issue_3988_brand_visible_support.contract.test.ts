import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL(
  "../20271215003988_issue_3988_brand_visible_support.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(root);

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
