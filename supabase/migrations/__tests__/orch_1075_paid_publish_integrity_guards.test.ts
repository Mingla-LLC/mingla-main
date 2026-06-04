// ORCH-1075 [Paid-publish integrity guards] — implementor Step-0.5 regression.
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/orch_1075_paid_publish_integrity_guards.test.ts
//
// The worktree has no live SQL harness (read-only MCP cannot run a write
// transaction), so — following the established Mingla pattern
// (pg_public_trips_by_brand.test.ts, biz_trip_tickets_sold.test.ts) — this
// test pins the SQL guard contract by reading the migration file and asserting
// each RPC body carries the correct guard. The behavioral live-DB exercise
// lives in orch_1075_paid_publish_integrity_guards.test.sql (hand-run
// post-`db push`).
//
// fails-on-revert: removing a guard from the migration (e.g. deleting the
// pg_brand_can_charge call or the offering_date_past RAISE) fails the matching
// assertion. Verified by the implementor by stripping a guard and re-running.

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION =
  "supabase/migrations/20260909000000_orch_1075_paid_publish_integrity_guards.sql";

const sql = await Deno.readTextFile(MIGRATION);

/**
 * Slice the body of a named CREATE OR REPLACE FUNCTION, bounded by its own
 * dollar-quote terminator (`$$;` or `$function$;`) so trailing statements
 * (other functions, the self-verify DO block) never bleed into the slice.
 */
function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert(start !== -1, `migration defines public.${name}`);
  // The function body opens with the first dollar-quote tag ($function$ or $$)
  // that appears after the CREATE header. Whichever opens FIRST is the body
  // delimiter; slice to its matching close + the terminating ';'.
  const fnTagIdx = sql.indexOf("$function$", start);
  const dollarIdx = sql.indexOf("$$", start);
  const useFunctionTag =
    fnTagIdx !== -1 && (dollarIdx === -1 || fnTagIdx < dollarIdx);
  const tag = useFunctionTag ? "$function$" : "$$";
  const open = sql.indexOf(tag, start);
  const close = sql.indexOf(tag, open + tag.length);
  assert(close !== -1, `public.${name} body is dollar-quote balanced`);
  return sql.slice(start, close + tag.length);
}

const BOTH_GUARD_RPCS = [
  "biz_create_experience",
  "biz_publish_experience",
  "biz_update_live_experience",
  "business_publish_event_draft",
  "business_publish_trip_draft",
  "biz_update_live_trip",
];

// ── Helper exists and reads the SOURCE column, not the brands cache ──────────
Deno.test("pg_brand_can_charge mirrors the checkout SOURCE predicate", () => {
  const body = fnBody("pg_brand_can_charge");
  assert(
    /FROM public\.stripe_connect_accounts/i.test(body),
    "reads stripe_connect_accounts (the checkout source)",
  );
  assert(
    /detached_at IS NULL/i.test(body),
    "filters detached_at IS NULL (attached account only)",
  );
  assert(
    /charges_enabled IS DISTINCT FROM false/i.test(body),
    "true-only charges_enabled test mirrors checkout",
  );
  assert(
    /stripe_account_id IS NOT NULL/i.test(body),
    "requires a non-null stripe_account_id",
  );
});

// ── T-18 (source-level): every paid-publish/edit RPC carries BOTH guards ─────
for (const rpc of BOTH_GUARD_RPCS) {
  Deno.test(`${rpc} carries Guard A (pg_brand_can_charge) + Guard B (offering_date_past)`, () => {
    const body = fnBody(rpc);
    assert(
      body.includes("pg_brand_can_charge("),
      `${rpc} gates on Stripe readiness via pg_brand_can_charge`,
    );
    assert(
      body.includes("offering_date_past"),
      `${rpc} rejects past-dated paid offerings (offering_date_past)`,
    );
  });
}

// ── business_patch_event_when: Guard B ONLY (no Stripe guard by design) ──────
Deno.test("business_patch_event_when carries Guard B only (no Stripe guard)", () => {
  const body = fnBody("business_patch_event_when");
  assert(
    body.includes("offering_date_past"),
    "patch_event_when rejects shifting a paid event onto a past date",
  );
  assertEquals(
    body.includes("pg_brand_can_charge("),
    false,
    "patch_event_when must NOT carry Guard A (it never changes price/availability)",
  );
});

// ── Guards are PAID-only (T-08/T-09/T-16: FREE + in-person exempt) ───────────
Deno.test("experience guards gate on resolved-paid only (FREE exempt)", () => {
  // The experience publish guards are wrapped in a paid predicate
  // (NOT v_is_free AND v_resolved_total > 0).
  for (const rpc of ["biz_create_experience", "biz_publish_experience"]) {
    const body = fnBody(rpc);
    assert(
      /NOT v_is_free AND v_resolved_total > 0/.test(body),
      `${rpc} guards fire only for resolved-paid (NOT v_is_free AND v_resolved_total > 0)`,
    );
  }
});

Deno.test("event publish guard gates on online-paid only (in-person/door-only exempt)", () => {
  const body = fnBody("business_publish_event_draft");
  // Paid test reads the ticket's online availability + price.
  assert(
    /available_online|availableAt.*online/i.test(body),
    "event guard scopes paid to online-sellable tickets (in-person exempt)",
  );
  assert(
    body.includes("v_paid_online"),
    "event guard uses the online-paid flag",
  );
});

Deno.test("trip guards gate on online-paid tier only", () => {
  for (const rpc of ["business_publish_trip_draft", "biz_update_live_trip"]) {
    const body = fnBody(rpc);
    assert(
      /available_online = true/.test(body),
      `${rpc} scopes paid to online-sellable pricing tiers`,
    );
  }
});

// ── I-PUBLISH-WRITES-EVENT-DATES preserved (orch-0792 not regressed) ─────────
Deno.test("event publish RPC still writes event_dates (orch-0792 invariant)", () => {
  const body = fnBody("business_publish_event_draft");
  assert(
    body.includes("INSERT INTO public.event_dates"),
    "business_publish_event_draft still materialises event_dates",
  );
});

// ── COMMS-0003: Stripe docs URLs cited inline in the migration header ────────
Deno.test("migration header cites the canonical Stripe docs URLs (COMMS-0003)", () => {
  assert(
    sql.includes("https://docs.stripe.com/api/accounts/object"),
    "cites the Stripe Account object (charges_enabled) doc",
  );
  assert(
    sql.includes("https://docs.stripe.com/connect/onboarding.md"),
    "cites the Stripe Connect onboarding doc",
  );
});
