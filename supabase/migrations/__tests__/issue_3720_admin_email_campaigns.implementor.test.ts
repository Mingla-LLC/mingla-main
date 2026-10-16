import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const sql = Deno.readTextFileSync(
  new URL(
    "../20271021003720_issue_3720_admin_email_campaigns.sql",
    import.meta.url,
  ),
);
const edge = Deno.readTextFileSync(
  new URL("../../functions/admin-send-email/index.ts", import.meta.url),
);

Deno.test("#3720 campaign migration provides durable scheduling and recipient retries", () => {
  assertStringIncludes(sql, "admin_email_recipient_deliveries");
  assertStringIncludes(sql, "claim_due_admin_email_campaign");
  assertStringIncludes(sql, "claim_admin_email_delivery_batch");
  assertStringIncludes(sql, "FOR UPDATE SKIP LOCKED");
  assertStringIncludes(sql, "issue_3720_admin_email_campaign_drain");
  assertStringIncludes(sql, "'* * * * *'");
  assertStringIncludes(
    sql,
    "issue_3720_admin_email_campaign_dependencies_missing",
  );
  assertStringIncludes(sql, "'pending', 'draft', 'scheduled'");
});

Deno.test("#3720 composer assets are public-read/admin-write with bounded safe formats", () => {
  assertStringIncludes(sql, "admin-email-assets");
  assertStringIncludes(sql, "5242880");
  assertStringIncludes(sql, "image/gif");
  assertStringIncludes(sql, "public.is_admin_user()");
  assertEquals(sql.includes("image/svg+xml"), false);
});

Deno.test("#3720 delivery has no product count cap and uses provider idempotency", () => {
  assertStringIncludes(edge, "RECIPIENT_PAGE_SIZE");
  assertStringIncludes(
    edge,
    ".range(offset, offset + RECIPIENT_PAGE_SIZE - 1)",
  );
  assertStringIncludes(edge, "Idempotency-Key");
  assertStringIncludes(edge, "reply_to: ADMIN_REPLY_TO");
  assertStringIncludes(edge, 'address: "hello@usemingla.com"');
  assertStringIncludes(edge, 'ADMIN_REPLY_TO = "noreply@usemingla.com"');
  assertEquals(edge.includes(".limit(500)"), false);
  assertStringIncludes(edge, 'select("id", { count: "exact", head: true })');
  assertEquals(edge.includes('.select("status")'), false);
});
