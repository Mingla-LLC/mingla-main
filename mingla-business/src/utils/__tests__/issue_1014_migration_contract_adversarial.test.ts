/**
 * issue #1014 — TESTER ADVERSARIAL suite: migration-contract tripwires the
 * implementor's Deno pinning test does NOT carry.
 *
 * Runs under the mingla-business jest job of
 * .github/workflows/issue-1014-free-publish-currency-tests.yml (the workflow's
 * Deno job pins ONLY the implementor's exact test file — a new Deno test file
 * would NOT auto-register, so these DB-contract tripwires live in jest, which
 * auto-picks-up every issue_1014_* suite).
 *
 * Angles (all verified live on the full 344-migration chain in the tester's
 * container run; these pins keep them from silently regressing):
 *   1. §9(1) flag scoping — every mingla.publish_free_only write is
 *      transaction-local (`, true)`); a session-scoped write (`, false)`)
 *      would leak the free-only bypass across pooled HTTP requests.
 *   2. The event RPC money predicate reads ALL THREE client price keys
 *      (priceMajor / price / priceGbp) — dropping one silently re-opens a
 *      free-looking money publish for older client payload shapes.
 *   3. The NGN whitelist stays NULL-guarded (bare brand ≠ unsupported currency).
 *   4. The trip ticket-currency normalization stays scoped to non-deleted rows.
 *   5. Resolver parity — trigger (d)'s money-entry brand-currency resolver uses
 *      the SAME COALESCE(sca.default_currency, b.default_currency) shape as
 *      trigger (c); drift would let publish and money-entry disagree about a
 *      brand's currency.
 *   6. The ticket trigger is re-attached via DROP+CREATE with price_cents in
 *      the UPDATE OF list (the 0→paid flip leg dies without it).
 *   7. The free-only flag branch exists inside trigger (c) (fails-on-revert
 *      anchor: deleting the branch reddens this suite too, independently of
 *      the implementor's Deno suite).
 *   8. Safe-migration shape: BEGIN/COMMIT wrap + GRANTs re-emitted for all
 *      four replaced RPCs.
 *
 * fails-on-revert: reverting trigger (c) to the ORCH-0769 unconditional RAISE
 * (deleting the flag branch) turns pins 1-count and 7 red; deleting the
 * price_cents re-attachment turns pin 6 red. Verified by true line deletion.
 */

import * as fs from "fs";
import * as path from "path";

const MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20270108001014_issue_1014_free_only_publish_currency_relax.sql",
);

const sql = fs.readFileSync(MIGRATION, "utf8");

/** Slice a named function body bounded by its own dollar-quote terminator. */
const fnBody = (name: string): string => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const fnTag = sql.indexOf("$function$", start);
  const dollar = sql.indexOf("$$", start);
  const tag =
    fnTag !== -1 && (dollar === -1 || fnTag < dollar) ? "$function$" : "$$";
  const open = sql.indexOf(tag, start);
  const close = sql.indexOf(tag, open + tag.length);
  expect(close).toBeGreaterThan(-1);
  return sql.slice(start, close + tag.length);
};

describe("issue #1014 — migration contract tripwires (tester angles)", () => {
  it("(1) every publish_free_only write is transaction-local; none session-scoped", () => {
    const writes = sql.match(/set_config\('mingla\.publish_free_only'[^)]*\)/g) ?? [];
    // One per publish RPC (event, rsvp, trip).
    expect(writes.length).toBeGreaterThanOrEqual(3);
    for (const w of writes) {
      expect(w).toContain("'on', true)");
    }
    expect(sql).not.toMatch(/set_config\('mingla\.publish_free_only',\s*'on',\s*false\)/);
  });

  it("(2) the event money predicate reads priceMajor, price AND priceGbp", () => {
    const body = fnBody("business_publish_event_draft");
    const predStart = body.indexOf("INTO v_money_bearing");
    expect(predStart).toBeGreaterThan(-1);
    const predicate = body.slice(body.lastIndexOf("SELECT bool_or(", predStart), predStart);
    expect(predicate).toContain("'priceMajor'");
    expect(predicate).toContain("'price'");
    expect(predicate).toContain("'priceGbp'");
  });

  it("(3) the currency whitelist is NULL-guarded and admits NGN", () => {
    const body = fnBody("business_publish_event_draft");
    expect(body).toContain("IF v_currency IS NOT NULL AND v_currency <> ALL (");
    expect(body).toContain("'NGN'::bpchar");
  });

  it("(4) trip ticket normalization touches only non-deleted rows", () => {
    const body = fnBody("business_publish_trip_draft");
    const norm = body.slice(body.indexOf("SET currency = e.currency"));
    expect(norm).toContain("tt.deleted_at IS NULL");
    expect(norm).toContain("tt.currency IS DISTINCT FROM e.currency");
  });

  it("(5) trigger (d)'s money-entry resolver matches trigger (c)'s brand resolver shape", () => {
    const resolver =
      "upper(COALESCE(sca.default_currency::text, b.default_currency::text))::char(3)";
    expect(fnBody("tg_require_event_brand_currency")).toContain(resolver);
    expect(fnBody("tg_enforce_event_ticket_currency")).toContain(resolver);
  });

  it("(6) the ticket trigger is re-attached with price_cents (0→paid flip leg)", () => {
    expect(sql).toContain(
      "DROP TRIGGER IF EXISTS trg_enforce_event_ticket_currency ON public.ticket_types;",
    );
    expect(sql).toContain(
      "BEFORE INSERT OR UPDATE OF event_id, currency, price_cents ON public.ticket_types",
    );
  });

  it("(7) trigger (c) carries the free-only flag branch (fails-on-revert anchor)", () => {
    const body = fnBody("tg_require_event_brand_currency");
    expect(body).toContain(
      "current_setting('mingla.publish_free_only', true) = 'on'",
    );
    expect(body).toContain("RAISE EXCEPTION 'event_currency_required'");
  });

  it("(8) safe-migration shape: BEGIN/COMMIT wrap + GRANTs for the four RPCs", () => {
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    for (const fn of [
      "business_publish_event_draft",
      "business_publish_rsvp_draft",
      "business_publish_trip_draft",
      "biz_ticket_checkout_create_session",
    ]) {
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
    }
  });
});
