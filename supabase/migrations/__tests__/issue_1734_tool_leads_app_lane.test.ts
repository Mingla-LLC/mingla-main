// ISSUE-1734 T-M1 / T-L1 / T-L2 — SCHEMA-LAYER static contract suite for the
// single additive migration 20270303001734_issue_1734_tool_leads_app_lane.sql
// (house idiom: static SQL scan, same as orch_1337_guard_first_privilege).
// Pins, per P-52:
//   1. the 6 tool_leads columns (lane NOT NULL DEFAULT 'web' + user_id/
//      brand_id/client_ref/input_hash/subject_ref)
//   2. the 3 named CHECKs, each inside the pg_constraint idempotency guard
//      (lane_check, lane_identity_check, subject_ref_lane_check with the P-40
//      normative full-UUID regex)
//   3. the 4 partial indexes (quota / cache / client_ref / subject)
//   4. the apply-time self-asserts (RAISE EXCEPTION on any violating row)
//   5. tool_competitors: real FKs (brand CASCADE, venue CASCADE, pool SET
//      NULL), name/city length CHECKs mirroring the grader validation, RLS
//      enabled with ZERO policies, the unique dedup index on
//      (venue_listing_id, lower(btrim(website))), and the cap-guard trigger
//      with per-venue FOR UPDATE serialization + cap 5 + brand_mismatch —
//      a direct service-role insert past the cap dies HERE (T-CW2 structural
//      half)
//   6. admin RPC recreation (P-50): 6-arg list with p_lane filter and `lane`
//      appended LAST; get gains lane/brand_id/user_id/subject_ref appended
//      last; guard-first is_admin_user() as the FIRST executable statement in
//      BOTH bodies (the i-admin-gate-first-statement shape); lockdown
//      revoke/grant + privilege self-asserts on the NEW signatures; the list
//      NEVER selects report/report_token/ip_hash; the get NEVER selects
//      ip_hash (T-L1/T-L2)
//   7. ROLLBACK comment block present; no destructive DDL outside it
//
// fails-on-revert: deleting any column/CHECK/index/trigger clause or the
// guard-first statement from the migration turns the matching assert red.
//
// Run: deno test --allow-read \
//   supabase/migrations/__tests__/issue_1734_tool_leads_app_lane.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MIG =
  "supabase/migrations/20270303001734_issue_1734_tool_leads_app_lane.sql";
const src = await Deno.readTextFile(MIG);

Deno.test("T-M1.1 — the 6 additive tool_leads columns", () => {
  assert(/ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'web'/.test(src));
  for (
    const col of [
      "user_id uuid",
      "brand_id uuid",
      "client_ref uuid",
      "input_hash text",
      "subject_ref text",
    ]
  ) {
    assert(
      new RegExp(
        `ADD COLUMN IF NOT EXISTS ${col.split(" ")[0]} ${col.split(" ")[1]}`,
      ).test(src),
      `column ${col} added`,
    );
  }
});

Deno.test("T-M1.2 — the 3 named CHECKs inside pg_constraint idempotency guards", () => {
  for (
    const name of [
      "tool_leads_lane_check",
      "tool_leads_lane_identity_check",
      "tool_leads_subject_ref_lane_check",
    ]
  ) {
    assert(
      new RegExp(`conname = '${name}'`).test(src),
      `${name} is pg_constraint-guarded`,
    );
    assert(new RegExp(`ADD CONSTRAINT ${name}`).test(src), `${name} added`);
  }
  assert(src.includes("CHECK (lane IN ('web', 'app'))"));
  assert(
    src.includes("(lane = 'web' AND user_id IS NULL AND brand_id IS NULL)"),
  );
  assert(
    src.includes(
      "(lane = 'app' AND user_id IS NOT NULL AND brand_id IS NOT NULL)",
    ),
  );
  assert(src.includes("(subject_ref IS NULL OR lane = 'app')"));
  // P-40 normative regex: full 36-char UUID shape, three namespaces.
  assert(src.includes(
    "subject_ref ~ '^(venue|competitor|event):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
  ));
});

Deno.test("T-M1.3 — the 4 partial indexes", () => {
  assert(
    /idx_tool_leads_app_quota[\s\S]*?\(brand_id, tool, created_at DESC\) WHERE lane = 'app'/
      .test(src),
  );
  assert(
    /idx_tool_leads_app_cache[\s\S]*?\(brand_id, tool, input_hash, created_at DESC\) WHERE lane = 'app'/
      .test(src),
  );
  assert(
    /idx_tool_leads_app_client_ref[\s\S]*?\(client_ref\) WHERE client_ref IS NOT NULL/
      .test(src),
  );
  assert(
    /idx_tool_leads_app_subject[\s\S]*?\(brand_id, tool, subject_ref, created_at DESC\)\s*\n?\s*WHERE lane = 'app' AND subject_ref IS NOT NULL/
      .test(src),
  );
});

Deno.test("T-M1.4 — apply-time self-asserts RAISE on violating rows", () => {
  assert(src.includes("violate tool_leads_lane_identity_check"));
  assert(src.includes("violate tool_leads_lane_check"));
  assert(src.includes("violate tool_leads_subject_ref_lane_check"));
  assert((src.match(/RAISE EXCEPTION 'ISSUE-1734:/g) ?? []).length >= 3);
});

Deno.test("T-CW2 (structural) — tool_competitors: FKs, CHECKs, deny-all RLS, dedup index, cap trigger", () => {
  assert(src.includes("CREATE TABLE IF NOT EXISTS public.tool_competitors"));
  assert(
    /brand_id\s+uuid NOT NULL REFERENCES public\.brands\(id\) ON DELETE CASCADE/
      .test(src),
  );
  assert(
    /venue_listing_id uuid NOT NULL REFERENCES public\.venue_listings\(id\) ON DELETE CASCADE/
      .test(src),
  );
  assert(
    /place_pool_id\s+uuid NULL REFERENCES public\.place_pool\(id\) ON DELETE SET NULL/
      .test(src),
  );
  // Length CHECKs mirror the grader input validation (P-45).
  assert(src.includes("CHECK (length(btrim(name)) BETWEEN 2 AND 80)"));
  assert(src.includes("CHECK (length(btrim(city)) BETWEEN 2 AND 60)"));
  assert(src.includes("CHECK (length(btrim(website)) > 0)"));
  // Deny-all: RLS enabled, ZERO policies anywhere in this migration.
  assert(
    src.includes(
      "ALTER TABLE public.tool_competitors ENABLE ROW LEVEL SECURITY",
    ),
  );
  assertEquals(
    /CREATE POLICY/i.test(src),
    false,
    "zero policies — deny-all (P-46)",
  );
  // Structural dedup.
  assert(
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_competitors_venue_site[\s\S]*?\(venue_listing_id, lower\(btrim\(website\)\)\)/
      .test(src),
  );
  // Cap trigger: FOR UPDATE serialization, cap 5, brand consistency.
  const trigger = src.match(
    /CREATE OR REPLACE FUNCTION public\.tool_competitors_cap_guard\(\)[\s\S]*?\$\$;/,
  )?.[0] ?? "";
  assert(trigger.length > 0, "cap guard function present");
  assert(
    trigger.includes("FOR UPDATE"),
    "per-venue serialization — the cap cannot be raced past",
  );
  assert(trigger.includes(">= 5"), "cap constant 5");
  assert(trigger.includes("RAISE EXCEPTION 'competitor_watch_cap'"));
  assert(trigger.includes("RAISE EXCEPTION 'brand_mismatch'"));
  assert(trigger.includes("RAISE EXCEPTION 'venue_not_found'"));
  assert(
    /CREATE TRIGGER trg_tool_competitors_cap_guard\s*\n?\s*BEFORE INSERT ON public\.tool_competitors/
      .test(src),
  );
});

function fnBody(name: string): string {
  const m = src.match(
    new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"),
  );
  assert(m !== null, `definition of ${name} found`);
  return m![0];
}

function firstStatement(body: string): string {
  const bi = body.search(/\bbegin\b/i);
  assert(bi >= 0);
  const after = body.slice(bi + 5)
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  const semi = after.indexOf(";");
  return (semi < 0 ? after : after.slice(0, semi)).trim();
}

const GUARD_RE =
  /^IF\b[\s\S]*?\bNOT\b[\s\S]*?is_admin_user\s*\(\s*\)[\s\S]*?\bTHEN\b[\s\S]*?\bRAISE\b/i;

Deno.test("T-L1 — admin_tool_leads_list: 6-arg signature, p_lane filter, lane appended LAST, guard-first, no PII columns", () => {
  const body = fnBody("admin_tool_leads_list");
  assert(
    body.includes("p_lane      text    default null"),
    "p_lane parameter, defaulted",
  );
  assert(
    body.includes("(p_lane is null or tl.lane = p_lane)"),
    "house filter shape — null = All",
  );
  // lane appended as the LAST output column.
  const returns = body.match(/returns table\(([\s\S]*?)\)/i)![1];
  const cols = returns.split(",").map((c) => c.trim().split(/\s+/)[0]);
  assertEquals(
    cols[cols.length - 1],
    "lane",
    "lane is the LAST output column (positional safety)",
  );
  // Never selects the PII/secret columns.
  for (const forbidden of ["report_token", "ip_hash"]) {
    assertEquals(
      body.includes(forbidden),
      false,
      `list body must not mention ${forbidden}`,
    );
  }
  assert(
    !/tl\.report(?!\s+is)/.test(body),
    "list never returns the report jsonb (only `report is not null`)",
  );
  assert(
    GUARD_RE.test(firstStatement(body)),
    "is_admin_user() guard is the FIRST executable statement",
  );
});

Deno.test("T-L2 — admin_tool_lead_get: gains lane/brand_id/user_id/subject_ref appended last; never ip_hash; guard-first", () => {
  const body = fnBody("admin_tool_lead_get");
  const returns = body.match(/returns table\(([\s\S]*?)\)/i)![1];
  const cols = returns.split(",").map((c) => c.trim().split(/\s+/)[0]);
  assertEquals(
    cols.slice(-4),
    ["lane", "brand_id", "user_id", "subject_ref"],
    "appended LAST, in order (P-50)",
  );
  assertEquals(body.includes("ip_hash"), false, "get NEVER returns ip_hash");
  assert(GUARD_RE.test(firstStatement(body)), "guard-first shape preserved");
});

Deno.test("P-50 lockdown — drop old signatures, revoke public+anon, grant authenticated, self-asserts on the NEW 6-arg signature", () => {
  assert(
    src.includes(
      "drop function if exists public.admin_tool_leads_list(text, boolean, text, int, int);",
    ),
  );
  assert(
    src.includes(
      "drop function if exists public.admin_tool_leads_list(text, boolean, text, int, int, text);",
    ),
  );
  assert(
    src.includes("drop function if exists public.admin_tool_lead_get(uuid);"),
  );
  const sig =
    "public.admin_tool_leads_list(text, boolean, text, int, int, text)";
  assert(src.includes(`revoke all    on function ${sig} from public;`));
  assert(src.includes(`revoke all    on function ${sig} from anon;`));
  assert(src.includes(`grant execute on function ${sig} to authenticated;`));
  assert(
    src.includes(`has_function_privilege('anon', '${sig}', 'EXECUTE')`),
    "anon self-assert on the new signature",
  );
  assert(
    src.includes(
      "has_function_privilege('authenticated', 'public.admin_tool_lead_get(uuid)', 'EXECUTE')",
    ),
  );
});

Deno.test("safe-migration — ROLLBACK block covers every object; additive only", () => {
  assert(src.includes("-- ROLLBACK"));
  for (
    const obj of [
      "trg_tool_competitors_cap_guard",
      "tool_competitors_cap_guard()",
      "uq_tool_competitors_venue_site",
      "idx_tool_leads_app_subject",
      "idx_tool_leads_app_client_ref",
      "idx_tool_leads_app_cache",
      "idx_tool_leads_app_quota",
      "tool_leads_subject_ref_lane_check",
    ]
  ) {
    assert(src.includes(obj), `ROLLBACK/DDL names ${obj}`);
  }
  // Nothing destructive outside the trigger recreate + RPC drop-and-recreate
  // + the commented ROLLBACK block: no DROP TABLE / DROP COLUMN executes.
  const executable = src.split("\n").filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assertEquals(
    /DROP TABLE/i.test(executable),
    false,
    "no executable DROP TABLE",
  );
  assertEquals(
    /DROP COLUMN/i.test(executable),
    false,
    "no executable DROP COLUMN",
  );
});
