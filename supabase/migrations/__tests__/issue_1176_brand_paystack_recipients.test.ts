import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../20270110000005_issue_1176_brand_paystack_recipients.sql",
    import.meta.url,
  ),
);

Deno.test("#1176 migration stores one RCP_ identity per brand and no full NUBAN", () => {
  assertMatch(sql, /CREATE TABLE public\.brand_paystack_recipients/);
  assertMatch(sql, /brand_id uuid NOT NULL UNIQUE REFERENCES public\.brands/);
  assertMatch(sql, /recipient_code text NOT NULL UNIQUE/);
  assertMatch(sql, /account_fingerprint text NOT NULL/);
  assertMatch(sql, /\^hmac-sha256:\[0-9a-f\]\{64\}\$/);
  assertMatch(sql, /account_number_masked text NOT NULL/);
  assertEquals(
    /\baccount_number\s+(?:text|varchar|character)/i.test(sql),
    false,
  );
});

Deno.test("#1176 recipient mirror is client read-only and payment-manager scoped", () => {
  assertMatch(
    sql,
    /ALTER TABLE public\.brand_paystack_recipients ENABLE ROW LEVEL SECURITY/,
  );
  assertMatch(
    sql,
    /ALTER TABLE public\.brand_paystack_recipients FORCE ROW LEVEL SECURITY/,
  );
  assertMatch(
    sql,
    /biz_can_manage_payments_for_brand_for_caller\(brand_id\)/,
  );
  assertMatch(sql, /OR public\.is_admin_user\(\)/);
  const policies = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) =>
    m[0]
  );
  assertEquals(policies.length, 1);
  assert(policies[0].includes("FOR SELECT"));
});
