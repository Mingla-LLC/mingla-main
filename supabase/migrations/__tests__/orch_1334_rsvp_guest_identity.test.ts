// ORCH-1334 [rsvp-guest-console-identity-gap] — migration source-contract guard.
//
// CI has no live Postgres for behavioral RPC assertions, so (matching the proven
// orch_1203 / orch_1195 / orch_1200 SQL source tests) this pins the load-bearing
// SQL invariants by asserting the migration TEXT. The live behavioral half (T-1
// host identity resolves; T-4 non-host rejected) lives in the sibling
// orch_1334_rsvp_guest_identity.test.sql, run by the tester/orchestrator AFTER the
// migration is applied.
//
// The `// [FAILS-ON-REVERT KEY]` lines are the assertions proven to go RED when
// the fix is reverted in-worktree (true line deletion — e.g. removing the host
// profiles LEFT JOIN or the DEFINER guard).
//
// Run: deno test --allow-read supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.ts
import { assert } from "jsr:@std/assert@1";

const MIG =
  "supabase/migrations/20261224000000_orch_1334_rsvp_guest_identity.sql";
const sql = await Deno.readTextFile(MIG);
// Comment-stripped view: negative assertions must inspect EXECUTABLE SQL only, not
// the explanatory `--` comments (which legitimately name the reverted-state
// keywords and the out-of-scope write-path function).
const code = sql.replace(/--[^\n]*/g, "");
const has = (n: string, why: string) =>
  assert(sql.includes(n), `migration must contain \`${n}\` (${why})`);
const hasNot = (n: string, why: string) =>
  assert(!code.includes(n), `migration code must NOT contain \`${n}\` (${why})`);

// The consumer twin's function body, isolated so contact-column assertions cannot
// be satisfied by the host/admin functions above it.
const consumerBlock = (() => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)",
  );
  assert(start >= 0, "fetch_user_going_rsvps must be re-created in this migration");
  const end = sql.indexOf("$function$;", start);
  assert(end > start, "fetch_user_going_rsvps body must be terminated");
  return sql.slice(start, end);
})();

// ───────────────────────────────────────────────────────────────────────────
// Host RPC — DEFINER + guard-first + profiles join + provenance (§4B).
// I-PROPOSED-1334-RSVP-HOST-LIST-DEFINER-GUARD.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("host_list_rsvp_guests is DROP+CREATE plpgsql SECURITY DEFINER", () => {
  has("DROP FUNCTION IF EXISTS public.host_list_rsvp_guests(uuid);", "widen/security change → DROP-before-CREATE");
  has("CREATE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)", "re-created host RPC");
  // [FAILS-ON-REVERT KEY] — a SECURITY INVOKER form silently degraded to 'Guest'.
  has("SECURITY DEFINER", "DEFINER so the profiles join is readable behind the guard");
  hasNot("SECURITY INVOKER", "the INVOKER no-join form is the regressed state");
});

Deno.test("host RPC guards FIRST on event-manager brand rank (RAISE before any row)", () => {
  // [FAILS-ON-REVERT KEY] — without the guard, DEFINER is an open per-event scraper.
  has("public.biz_brand_effective_rank(e.brand_id, auth.uid())", "brand-rank guard predicate");
  has(">= public.biz_role_rank('event_manager'::text)", "event_manager threshold");
  has("RAISE EXCEPTION 'insufficient_event_permission'", "guard raises, returns no rows");
});

Deno.test("host RPC resolves identity from profiles at read time", () => {
  // [FAILS-ON-REVERT KEY] — deleting this join reverts display_name to 'Guest'.
  has("LEFT JOIN public.profiles p ON p.id = r.user_id", "resolve the RSVP-er's own profile");
  has(
    "COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name)",
    "real name for app, typed for web, never fabricated",
  );
  has(
    "COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(r.guest_email), ''))",
    "email: profile-or-web, present for app",
  );
});

Deno.test("host RPC never fabricates a phone (honest NULL — Constitution #9 / SC-2)", () => {
  // [FAILS-ON-REVERT KEY] — the COALESCE yields NULL when neither source has a phone.
  has(
    "COALESCE(NULLIF(btrim(p.phone), ''), NULLIF(btrim(r.guest_phone), ''))",
    "phone resolves profile-or-web, else NULL",
  );
});

Deno.test("host RPC returns the app/web source discriminator", () => {
  has("CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END", "the core where-from answer");
});

Deno.test("host RPC preserves the ORCH-1150 maybe-order bucket byte-identical (SC-11/T-14)", () => {
  // [FAILS-ON-REVERT KEY] — the maybe grouping must survive the DROP+CREATE.
  has("WHEN r.rsvp_status = 'maybe' THEN 3", "maybe bucket between waitlist and the else tail");
});

Deno.test("host RPC whitelists only the six profile-derived columns (no SELECT p.*)", () => {
  // I-PROPOSED-1334-RSVP-GUEST-CONTACT-WHITELIST — never project the whole profile.
  hasNot("SELECT p.*", "must not leak visibility_mode / bio / arbitrary profile fields");
});

// ───────────────────────────────────────────────────────────────────────────
// Admin RPC — CREATE OR REPLACE, guard kept, same 6 keys appended (§4C).
// ───────────────────────────────────────────────────────────────────────────
Deno.test("admin_list_event_rsvps keeps its is_admin_user() guard + joins profiles", () => {
  has("CREATE OR REPLACE FUNCTION public.admin_list_event_rsvps(", "no DROP for the jsonb return");
  has("IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'", "admin guard preserved");
  has("p.display_name AS profile_display_name", "profiles join in the ranked CTE");
  has(
    "'source',          CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END",
    "admin row carries the source discriminator",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Consumer twin — identity-ONLY, NO contact columns (§4D, C-CONSUMER).
// I-PROPOSED-1334-RSVP-CONSUMER-SELF-IDENTITY-ONLY.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("fetch_user_going_rsvps resolves display_name on BOTH branches", () => {
  assert(
    consumerBlock.includes("LEFT JOIN public.profiles pr ON pr.id = r.user_id"),
    "primary branch resolves the RSVP-er's own profile",
  );
  assert(
    consumerBlock.includes("LEFT JOIN public.profiles pg ON pg.id = g.matched_user_id"),
    "guest branch resolves the matched user's profile",
  );
  assert(
    consumerBlock.includes(
      "COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name)",
    ),
    "primary display_name resolved (≠ 'Guest')",
  );
});

Deno.test("consumer twin adds NO email/phone/contact columns (self-facing only)", () => {
  // [FAILS-ON-REVERT KEY for C-CONSUMER] — a user's own calendar never exposes
  // another guest's contact. The consumer function body must contain no contact.
  assert(!consumerBlock.includes("email"), "consumer twin must not reference email");
  assert(!consumerBlock.includes("phone"), "consumer twin must not reference phone");
  // Self-scoping WHERE clauses retained.
  assert(consumerBlock.includes("WHERE r.user_id = p_user_id"), "primary self-scope retained");
  assert(consumerBlock.includes("WHERE g.matched_user_id = p_user_id"), "guest self-scope retained");
});

// ───────────────────────────────────────────────────────────────────────────
// Write path untouched (SC-10) + schema reload.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("migration touches no write-path function + reloads PostgREST", () => {
  hasNot("submit_event_rsvp", "the write path stays out of scope");
  has("NOTIFY pgrst, 'reload schema';", "PostgREST picks up the widened return shape");
});
