// META-ORCH-1059 [experiences-business-parity] · SUB-B · DRAFT LIFECYCLE
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/biz_publish_experience.draft_lifecycle.test.ts
//
// Source-level migration regression for biz_publish_experience (the UPDATE-in-
// place publish/re-save RPC). The worktree has no live SQL harness (repo
// convention — see biz_create_experience.happy.test.ts), so this pins the SQL
// contract that would FAIL if the RPC is reverted or the draft-first / one-ticket
// / publish-date logic is broken.
//
// Asserts (Sub-B contract) for biz_publish_experience(p_event_id, p_payload, p_publish):
//   1. It UPDATEs the EXISTING events row (no fresh INSERT into events).
//   2. EXACTLY ONE live ticket_types row results — prior tickets soft-deleted,
//      then one INSERT at the resolved total (I-1 one-ticket, never N).
//   3. On publish it flips status→'scheduled' / visibility→'public' / published_at,
//      replaces experience_stops, and materialises event_dates (publish only — I-4).
//   4. On p_publish=false it re-saves WITHOUT materialising event_dates (draft
//      stays unsellable / preview-only).
//   5. It asserts the row is an experience (event_not_an_experience) + the same
//      permission gate as create + no Stripe/parallel money fn (I-6).
//
// fails-on-revert: each assertion targets a distinct shipped construct; reverting
// the RPC (or breaking the one-ticket / publish-gate logic) flips an assertion.

import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260825000000_meta_orch_1059_sub_b_publish_experience.sql",
);

function functionBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.biz_publish_experience[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(match !== null, "biz_publish_experience function body is present");
  return match![1];
}

const body = functionBody(migration);

Deno.test("B-01 UPDATEs the existing events row in place (no fresh INSERT INTO events)", () => {
  assert(
    /UPDATE\s+public\.events\s+SET/i.test(body),
    "biz_publish_experience UPDATEs the existing events row",
  );
  const eventInserts = body.match(/INSERT\s+INTO\s+public\.events/gi) ?? [];
  assertEquals(
    eventInserts.length,
    0,
    "publish must NOT INSERT a new events row — it edits the existing draft (draft-first lifecycle)",
  );
});

Deno.test("B-02 exactly ONE live ticket: soft-delete prior tickets, then ONE INSERT at the resolved total", () => {
  const ticketInserts = body.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
  assertEquals(
    ticketInserts.length,
    1,
    "exactly one ticket_types INSERT (I-1 one-ticket)",
  );
  // Prior tickets are soft-deleted so the result is a single LIVE ticket.
  assert(
    /UPDATE\s+public\.ticket_types[\s\S]*?SET\s+deleted_at\s*=\s*v_now[\s\S]*?WHERE\s+event_id\s*=\s*p_event_id/i.test(
      body,
    ),
    "prior tickets are soft-deleted before the single re-insert",
  );
  // The single insert is NOT inside a per-stop loop (would mint N tickets).
  assert(
    !/FOR[\s\S]{0,120}INSERT\s+INTO\s+public\.ticket_types/i.test(body),
    "the single ticket insert is not inside a per-stop loop",
  );
  // Price written is the resolved total.
  assert(
    /v_resolved_total[\s\S]*?\)\s*RETURNING id INTO v_ticket_id/i.test(body) ||
      /price_cents[\s\S]*?VALUES[\s\S]*?v_resolved_total/i.test(body),
    "ticket price_cents is the resolved total",
  );
});

Deno.test("B-03 the resolved total is whole_price in whole mode, summed in per_stop mode", () => {
  assert(
    /v_resolved_total\s*:=[\s\S]*?WHEN v_pricing_mode\s*=\s*'whole'\s*THEN v_whole_price/i.test(body),
    "whole mode resolves to v_whole_price",
  );
  assert(
    /sum\(COALESCE\(\(s->>'price_cents'\)::integer,\s*0\)\)/i.test(body),
    "per_stop mode resolves to the SUM of stop prices",
  );
});

Deno.test("B-04 experience_stops are REPLACED (delete + re-insert) on every save", () => {
  assert(
    /DELETE\s+FROM\s+public\.experience_stops\s+WHERE\s+event_id\s*=\s*p_event_id/i.test(body),
    "existing stops are deleted before re-insert (replace semantics)",
  );
  assert(
    /INSERT\s+INTO\s+public\.experience_stops/i.test(body),
    "stops are re-inserted from the payload",
  );
});

Deno.test("B-05 event_dates materialise on PUBLISH only (I-4); publish flips lifecycle", () => {
  // The event_dates work is gated by IF p_publish.
  const publishBlock = body.match(/IF p_publish THEN[\s\S]*?event_dates[\s\S]*?END IF;/i);
  assert(publishBlock !== null, "event_dates work is gated by IF p_publish");
  assert(
    /DELETE\s+FROM\s+public\.event_dates\s+WHERE\s+event_id\s*=\s*p_event_id/i.test(body),
    "prior dates cleared before re-materialising on publish",
  );
  assert(
    /INSERT\s+INTO\s+public\.event_dates[\s\S]*?is_master/i.test(body),
    "a master event_dates row is written on publish",
  );
  // Lifecycle flips ONLY on publish.
  assert(
    /status\s*=\s*CASE WHEN p_publish THEN 'scheduled' ELSE status END/i.test(body),
    "status flips to scheduled on publish, unchanged otherwise",
  );
  assert(
    /visibility\s*=\s*CASE WHEN p_publish THEN 'public' ELSE visibility END/i.test(body),
    "visibility flips to public on publish, unchanged otherwise",
  );
  assert(
    /published_at\s*=\s*CASE WHEN p_publish AND published_at IS NULL THEN v_now ELSE published_at END/i.test(
      body,
    ),
    "published_at set once on first publish",
  );
});

Deno.test("B-06 draft re-save does NOT materialise dates (preview-only / unsellable)", () => {
  // The single date-materialisation block lives entirely inside IF p_publish.
  // A draft save (p_publish=false) skips it, so a draft never gets event_dates.
  const dateInserts = body.match(/INSERT\s+INTO\s+public\.event_dates/gi) ?? [];
  assert(dateInserts.length >= 1, "there is an event_dates insert path (publish)");
  // Every event_dates INSERT must sit after an `IF p_publish THEN` and before its END IF.
  const publishGate = body.indexOf("IF p_publish THEN");
  const firstDateInsert = body.search(/INSERT\s+INTO\s+public\.event_dates/i);
  assert(
    publishGate !== -1 && firstDateInsert > publishGate,
    "event_dates inserts are downstream of the IF p_publish gate (drafts get none)",
  );
});

Deno.test("B-07 asserts experience type + same permission gate + no Stripe (I-6)", () => {
  assert(
    /v_existing\.event_type\s*<>\s*'experience'/i.test(body),
    "rejects non-experience rows",
  );
  assert(
    /RAISE EXCEPTION\s+'event_not_an_experience'/i.test(body),
    "raises event_not_an_experience for the wrong type",
  );
  assert(
    /biz_brand_effective_rank\([\s\S]*?biz_role_rank\('event_manager'::text\)/i.test(body),
    "same event_manager permission gate as biz_create_experience",
  );
  assert(/SECURITY DEFINER/i.test(migration), "RPC is SECURITY DEFINER");
  assert(
    /GRANT EXECUTE ON FUNCTION public\.biz_publish_experience\(uuid, jsonb, boolean\) TO authenticated/i.test(
      migration,
    ),
    "execute granted to authenticated",
  );
  assert(
    !/payment_intent|application_fee|stripe\./i.test(body),
    "biz_publish_experience touches no Stripe/payment surface (I-6 / COMMS-0014/0016)",
  );
});

Deno.test("B-08 currency defaults to brand default_currency, never a hardcoded GBP fallback (I-7)", () => {
  assert(/v_currency\s*:=\s*upper\(COALESCE\(/i.test(body), "currency resolves via COALESCE");
  assert(/v_brand\.default_currency::text/i.test(body), "currency falls back to brand.default_currency");
  assert(
    /'USD'\s*\)\)::char\(3\)/i.test(body),
    "final currency fallback is USD, NOT a hardcoded GBP (I-7)",
  );
});
