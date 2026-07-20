// issue #1014 — implementor happy-path regression (migration-pinning).
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/issue_1014_free_publish_currency.test.ts
//
// Follows the established file-pinning pattern
// (orch_1075_paid_publish_integrity_guards.test.ts): reads the migration file
// and asserts each function body carries the issue #1014 contract. The
// behavioral live-DB exercise lives in issue_1014_free_publish_currency.test.sql
// (write-safe ROLLBACK blocks; verified green on supabase/postgres:17.4.1.075
// with the full migration chain applied, and hand-run post-`db push`).
//
// fails-on-revert: reverting trigger (c)'s body to the ORCH-0769 unconditional
// `RAISE EXCEPTION 'event_currency_required'` (deleting the
// mingla.publish_free_only branch / the steady-state branch) fails the
// trigger-(c) assertions below. Verified by the implementor by actual revert.

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION =
  "supabase/migrations/20270108001014_issue_1014_free_only_publish_currency_relax.sql";

const sql = await Deno.readTextFile(MIGRATION);

/**
 * Slice the body of a named CREATE OR REPLACE FUNCTION, bounded by its own
 * dollar-quote terminator (`$$;` or `$function$;`) so trailing statements
 * never bleed into the slice. (Same helper as the ORCH-1075 pinning test.)
 */
function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert(start !== -1, `migration defines public.${name}`);
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

// ── (a)+(b) schema: money-row CHECKs + events CHECK drop ─────────────────────
Deno.test("money-row CHECKs added; events published-currency CHECK dropped", () => {
  assert(
    sql.includes("ticket_types_paid_currency_required_check") &&
      sql.includes("CHECK (price_cents = 0 OR currency IS NOT NULL)"),
    "ticket_types paid-currency CHECK present",
  );
  assert(
    sql.includes("orders_paid_currency_required_check") &&
      sql.includes("CHECK (total_cents = 0 OR currency IS NOT NULL)"),
    "orders paid-currency CHECK present",
  );
  assert(
    sql.includes("ticket_checkout_sessions_paid_currency_required_check"),
    "checkout-sessions paid-currency CHECK present",
  );
  assert(
    sql.includes(
      "ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_published_currency_required_check;",
    ),
    "events published-currency CHECK dropped",
  );
  assert(
    sql.includes(
      "ALTER TABLE public.ticket_checkout_sessions ALTER COLUMN currency DROP DEFAULT;",
    ),
    "checkout-sessions GBP DEFAULT dropped",
  );
});

// ── (c) tg_require_event_brand_currency: free-only flag + steady-state branch ─
Deno.test("trigger (c): free-only flag branch NULLs the published currency", () => {
  const body = fnBody("tg_require_event_brand_currency");
  assert(
    body.includes("current_setting('mingla.publish_free_only', true) = 'on'"),
    "trigger (c) reads the transaction-scoped mingla.publish_free_only flag",
  );
  const flagIdx = body.indexOf(
    "current_setting('mingla.publish_free_only', true) = 'on'",
  );
  const afterFlag = body.slice(flagIdx, flagIdx + 400);
  assert(
    afterFlag.includes("NEW.currency := NULL"),
    "flagged free-only publish sets NEW.currency := NULL (nulls fabricated draft currency)",
  );
});

Deno.test("trigger (c): §9(8) steady-state non-draft transitions permitted; strict RAISE preserved", () => {
  const body = fnBody("tg_require_event_brand_currency");
  assert(
    body.includes("OLD.status <> 'draft'") &&
      body.includes("NEW.currency IS NOT DISTINCT FROM OLD.currency"),
    "steady-state branch: non-draft → non-draft with currency untouched does not raise",
  );
  assert(
    body.includes("RAISE EXCEPTION 'event_currency_required'"),
    "the fail-close RAISE remains for undeclared paths",
  );
  // Stamping branches identical to ORCH-0769 when the brand currency resolves.
  assert(
    body.includes("ELSIF OLD.status = 'draft' THEN") &&
      body.includes("ELSIF NEW.currency IS NULL THEN"),
    "resolved-currency stamping branches preserved",
  );
});

// ── (d) tg_enforce_event_ticket_currency: resolve-or-block, one token ────────
Deno.test("trigger (d): free tickets carry NULL; paid resolve-or-block stamps events.currency", () => {
  const body = fnBody("tg_enforce_event_ticket_currency");
  assert(
    body.includes("COALESCE(NEW.price_cents, 0) = 0") &&
      body.includes("NEW.currency := NULL"),
    "free tickets on NULL-currency events carry NULL",
  );
  assert(
    body.includes("UPDATE public.events") &&
      body.includes("SET currency = v_resolved"),
    "paid entry stamps events.currency (stay-NULL-until-money moment)",
  );
  assert(
    body.includes("RAISE EXCEPTION 'event_currency_required'"),
    "unresolvable brand currency on money entry fails close",
  );
});

Deno.test("trigger (d): the event_currency_not_found raiser is retired (one-token contract)", () => {
  const body = fnBody("tg_enforce_event_ticket_currency");
  assert(
    !body.includes("RAISE EXCEPTION 'event_currency_not_found'"),
    "no raiser of the retired token remains on this path",
  );
});

Deno.test("trigger (d): re-attached with price_cents so 0→paid flips resolve-or-block", () => {
  assert(
    sql.includes(
      "BEFORE INSERT OR UPDATE OF event_id, currency, price_cents ON public.ticket_types",
    ),
    "trg_enforce_event_ticket_currency fires on price_cents too",
  );
});

// ── (e) business_publish_event_draft ─────────────────────────────────────────
Deno.test("event publish RPC: GBP fabrication removed from v_currency", () => {
  const body = fnBody("business_publish_event_draft");
  const vCurrencyIdx = body.indexOf("v_currency := upper(COALESCE(");
  assert(vCurrencyIdx !== -1, "v_currency computation present");
  const compute = body.slice(vCurrencyIdx, body.indexOf("))::char(3);", vCurrencyIdx));
  assert(
    !compute.includes("'GBP'"),
    "v_currency COALESCE no longer ends in a fabricated 'GBP'",
  );
});

Deno.test("event publish RPC: NGN whitelisted; whitelist NULL-guarded", () => {
  const body = fnBody("business_publish_event_draft");
  assert(body.includes("'NGN'::bpchar"), "NGN admitted to the publish whitelist");
  assert(
    body.includes("IF v_currency IS NOT NULL AND v_currency <> ALL ("),
    "whitelist runs only for a known currency",
  );
});

Deno.test("event publish RPC: money-bearing predicate + explicit gate + free-only flag", () => {
  const body = fnBody("business_publish_event_draft");
  assert(body.includes("INTO v_money_bearing"), "v_money_bearing predicate present");
  // Predicate is price-based (no availableAt filter, no isFree shortcut) —
  // door money counts. It must NOT reuse the availableAt-filtered shape.
  const predIdx = body.indexOf("INTO v_money_bearing");
  const predStart = body.lastIndexOf("SELECT bool_or(", predIdx);
  const predicate = body.slice(predStart, predIdx);
  assert(
    !predicate.includes("availableAt") && !predicate.includes("isFree"),
    "money predicate is price-truth only (door-paid counts; isFree flag irrelevant)",
  );
  assert(
    body.includes(
      "IF COALESCE(v_money_bearing, false) AND v_currency IS NULL THEN",
    ) &&
      body.includes("RAISE EXCEPTION 'event_currency_required'"),
    "money without a resolvable currency fails close in the RPC",
  );
  assert(
    body.includes("IF NOT COALESCE(v_money_bearing, false) THEN") &&
      body.includes("set_config('mingla.publish_free_only', 'on', true)"),
    "moneyless publish declares the free-only flag",
  );
});

// ── (f) business_publish_rsvp_draft ──────────────────────────────────────────
Deno.test("RSVP publish RPC: chip-in-off publishes declare the free-only flag; ticket wall intact", () => {
  const body = fnBody("business_publish_rsvp_draft");
  assert(
    body.includes("IF NOT v_rsvp_contribution_enabled THEN") &&
      body.includes("set_config('mingla.publish_free_only', 'on', true)"),
    "chip-in OFF → free-only flag",
  );
  // I-PROPOSED-1150-RSVP-NO-TICKET-ROWS wall preserved verbatim.
  assert(
    body.includes("An RSVP creates ZERO ticket_types") &&
      body.includes("SET deleted_at = v_now"),
    "RSVP zero-ticket wall preserved",
  );
  // ORCH-1291 provider-aware chip-in gate untouched.
  assert(
    body.includes("pg_brand_can_collect") &&
      body.includes("RAISE EXCEPTION 'stripe_charges_disabled'"),
    "ORCH-1291 chip-in bank gate preserved",
  );
});

// ── (g) business_publish_trip_draft ──────────────────────────────────────────
Deno.test("trip publish RPC: row-based money predicate + free-only flag + ticket normalization", () => {
  const body = fnBody("business_publish_trip_draft");
  assert(
    body.includes("v_money_bearing := EXISTS (") &&
      body.includes("AND tt.price_cents > 0"),
    "money predicate over pre-existing ticket rows (price-based, door counts)",
  );
  assert(
    body.includes("IF NOT v_money_bearing THEN") &&
      body.includes("set_config('mingla.publish_free_only', 'on', true)"),
    "moneyless trip declares the free-only flag",
  );
  assert(
    body.includes("SET currency = e.currency") &&
      body.includes("tt.currency IS DISTINCT FROM e.currency"),
    "post-publish ticket-currency normalization to the event's final currency",
  );
});

// ── (h) biz_ticket_checkout_create_session ───────────────────────────────────
Deno.test("checkout RPC: every coalesce-to-GBP currency fabrication removed", () => {
  const body = fnBody("biz_ticket_checkout_create_session");
  assertEquals(
    body.includes("COALESCE(v_currency, 'GBP'"),
    false,
    "no COALESCE(v_currency, 'GBP' remains in the checkout RPC",
  );
});

Deno.test("checkout RPC: null-safe cart mixing + paid-cart currency gate", () => {
  const body = fnBody("biz_ticket_checkout_create_session");
  assert(
    body.includes("v_saw_null_currency") &&
      body.includes("ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN"),
    "mixing check is null-safe (all-free NULL cart never raises)",
  );
  assert(
    body.includes("IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN"),
    "null-vs-non-null mixing raises only when the cart carries money",
  );
  assert(
    body.includes("IF v_total > 0 AND v_currency IS NULL THEN") &&
      body.includes("RAISE EXCEPTION 'event_currency_required'"),
    "belt-and-braces: money never enters a session without a currency",
  );
});

// ── (i) semantics encoded at the schema level ────────────────────────────────
Deno.test("COMMENTs encode stay-NULL-until-money", () => {
  assert(
    sql.includes("Never retro-stamped when the brand later acquires a currency"),
    "events.currency COMMENT carries the backfill decision",
  );
});
