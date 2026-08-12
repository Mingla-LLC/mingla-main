import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationUrl = new URL(
  "../20270323001919_issue_1919_provider_neutral_paid_readiness.sql",
  import.meta.url,
);
const migration = await Deno.readTextFile(migrationUrl);
const anonDefinerAllowlist = await Deno.readTextFile(
  new URL(
    "../../security/anon_executable_definer_allowlist.txt",
    import.meta.url,
  ),
);

const writeFunctions = [
  "business_publish_event_draft",
  "business_publish_trip_draft",
  "biz_create_experience",
  "biz_publish_experience",
  "biz_update_live_trip",
  "biz_update_live_experience",
] as const;

const readFunctions = [
  "pg_public_brand_upcoming",
  "pg_discover_business_events",
  "pg_eligible_experiences_for_deck",
  "pg_brand_experiences_for_place",
  "pg_public_experience_by_slug",
  "pg_public_experiences_by_brand",
  "pg_public_trips_by_brand",
] as const;

function body(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  assert(start >= 0, `missing ${name}`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  return next < 0 ? migration.slice(start) : migration.slice(start, next);
}

Deno.test("#1919 structural: all 13 boundaries use collect authority only", () => {
  assertEquals(new Set([...writeFunctions, ...readFunctions]).size, 13);
  for (const name of [...writeFunctions, ...readFunctions]) {
    const definition = body(name);
    assert(definition.includes("pg_brand_can_collect("), `${name}: collect missing`);
    assert(!definition.includes("pg_brand_can_charge("), `${name}: charge remains`);
  }
});

Deno.test("#1919 structural: Upcoming preserves the #1902 RSVP contract", () => {
  const upcoming = body("pg_public_brand_upcoming");
  assertMatch(upcoming, /WHEN 'rsvp' THEN ed\.start_at/);
  assertMatch(
    upcoming,
    /REVOKE ALL ON FUNCTION public\.pg_public_brand_upcoming\(text, timestamptz, integer\) FROM PUBLIC;/,
  );
  assertMatch(
    upcoming,
    /GRANT EXECUTE ON FUNCTION public\.pg_public_brand_upcoming\(text, timestamptz, integer\) TO anon, authenticated;/,
  );
});

Deno.test("#1919 structural: six writes retain only the #1922 transitional alias", () => {
  let aliases = 0;
  for (const name of writeFunctions) {
    const definition = body(name);
    assert(definition.includes("stripe_charges_disabled"), `${name}: alias missing`);
    assert(
      !definition.includes("payment_collection_unavailable"),
      `${name}: canonical server token is premature`,
    );
    assert(definition.includes("github.com/Mingla-LLC/mingla-main/issues/1922"));
    aliases += definition.match(/stripe_charges_disabled/g)?.length ?? 0;
  }
  assertEquals(aliases, 6);
});

Deno.test("#1919 structural: batch helper is exact, value-blind, and hardened", () => {
  const helper = body("pg_brands_can_collect");
  assertMatch(helper, /RETURNS TABLE \(brand_id uuid\)/);
  assertMatch(helper, /LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = ''/);
  assertMatch(helper, /pg_catalog\.unnest\([\s\S]*COALESCE\(p_brand_ids, ARRAY\[\]::uuid\[\]\)/);
  assert(helper.includes("SELECT DISTINCT bid AS brand_id"));
  assert(helper.includes("WHERE public.pg_brand_can_collect(bid)"));
  assert(helper.includes("REVOKE ALL ON FUNCTION public.pg_brands_can_collect(uuid[]) FROM PUBLIC;"));
  assertMatch(
    helper,
    /GRANT EXECUTE ON FUNCTION public\.pg_brands_can_collect\(uuid\[\]\)\s+TO anon, authenticated, service_role;/,
  );
  for (const forbidden of [
    "paystack_subaccount_code",
    "stripe_account_id",
    "payment_provider",
    "brand_currency_reconciliations",
  ]) {
    assert(!helper.includes(forbidden), `helper leaked/duplicated ${forbidden}`);
  }
});

Deno.test("#1919 structural: public batch helper has one justified anon-definer exception", () => {
  const signature = "pg_brands_can_collect(p_brand_ids uuid[])";
  assert(
    anonDefinerAllowlist.includes(
      "# #1919: anonymous buyer feeds batch-check caller-supplied brand IDs; returns only distinct ready IDs and delegates to the hardened provider-neutral predicate.",
    ),
  );
  assertEquals(
    anonDefinerAllowlist.split("\n").filter((line) => line === signature)
      .length,
    1,
  );
});

Deno.test("#1919 structural: migration is one transaction and contains no schema/data rewrite", () => {
  assertEquals(migration.match(/^BEGIN;$/gm)?.length, 1);
  assertEquals(migration.match(/^COMMIT;$/gm)?.length, 1);
  assert(!migration.includes("74aa"), "protected draft identifier must not appear");
  for (const forbidden of [
    /^ALTER TABLE\s/mi,
    /^CREATE TABLE\s/mi,
    /^DROP TABLE\s/mi,
    /^TRUNCATE\s/mi,
  ]) {
    assert(!forbidden.test(migration), `forbidden migration statement ${forbidden}`);
  }
});
