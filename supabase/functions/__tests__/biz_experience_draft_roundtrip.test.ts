// META-ORCH-1059 [experiences-business-parity] · DRAFT ROUND-TRIP + COVER + NEVER-ENDS
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/biz_experience_draft_roundtrip.test.ts
//
// Source-level migration regression for 20260829000000 (draft round-trip +
// cover persistence + recurrence never-ends). The worktree has no live SQL
// harness (repo convention — see biz_publish_experience.draft_lifecycle.test.ts),
// so this pins the SQL contract that FAILS if the migration is reverted.
//
// Asserts the operator-reported bug fixes:
//   R-01  Both RPCs persist the RAW When inputs to
//         theme.experience_meta.when_draft on EVERY save (draft round-trips its
//         date/time — the prior RPC stored event_dates publish-only + nothing
//         of the raw When, so a draft reopened blank).
//   R-02  Both RPCs write the 7 cover_media_* columns from p_payload->cover
//         (the prior RPC dropped the cover entirely → cover_media_url NULL).
//   R-03  The publish UPDATE preserves an existing cover when the payload's
//         coverMediaUrl is empty (don't clobber a webhook-applied video cover).
//   R-04  ONE-TICKET (I-1) + publish-only event_dates (I-4) preserved verbatim.
//   R-05  never-ends materialises exactly the master occurrence on publish.
//
// fails-on-revert: each assertion targets a distinct shipped construct.

import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260829000000_meta_orch_1059_draft_roundtrip_cover_neverends.sql",
);

function functionBody(sql: string, fn: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
  );
  const match = sql.match(re);
  assert(match !== null, `${fn} function body is present`);
  return match![1];
}

const createBody = functionBody(migration, "biz_create_experience");
const publishBody = functionBody(migration, "biz_publish_experience");

Deno.test("R-01 biz_create persists raw When to theme.experience_meta.when_draft", () => {
  assert(
    /v_when_draft\s*:=\s*jsonb_strip_nulls\(jsonb_build_object\(/i.test(createBody),
    "create builds a when_draft jsonb from the raw When inputs",
  );
  assert(
    /'when_draft',\s*v_when_draft/i.test(createBody),
    "create writes when_draft into theme.experience_meta on INSERT",
  );
});

Deno.test("R-01b biz_publish persists raw When to when_draft on EVERY save (draft + publish)", () => {
  assert(
    /v_when_draft\s*:=\s*jsonb_strip_nulls\(jsonb_build_object\(/i.test(publishBody),
    "publish builds a when_draft jsonb",
  );
  // The when_draft write is in the unconditional top-level UPDATE (runs for
  // draft saves too). It sits between `UPDATE public.events SET` and the
  // publish-only `DELETE FROM public.event_dates` block — i.e. NOT inside the
  // IF p_publish date-materialisation gate.
  const updateIdx = publishBody.search(/UPDATE\s+public\.events\s+SET/i);
  const whenDraftWriteIdx = publishBody.search(/'\{experience_meta,when_draft\}',\s*\n?\s*v_when_draft/i);
  const dateDeleteIdx = publishBody.search(/DELETE\s+FROM\s+public\.event_dates/i);
  assert(updateIdx !== -1, "publish has a top-level events UPDATE");
  assert(
    whenDraftWriteIdx !== -1 && whenDraftWriteIdx > updateIdx,
    "when_draft is written in the unconditional events UPDATE (runs on draft save)",
  );
  assert(
    dateDeleteIdx !== -1 && whenDraftWriteIdx < dateDeleteIdx,
    "when_draft write precedes the publish-only event_dates block (draft saves persist it)",
  );
});

Deno.test("R-02 both RPCs write all 7 cover_media_* columns from p_payload->cover", () => {
  for (const [name, body] of [["create", createBody], ["publish", publishBody]] as const) {
    assert(/v_cover\s*:=\s*COALESCE\(p_payload->'cover'/i.test(body), `${name} reads p_payload->cover`);
    for (const col of [
      "cover_media_url",
      "cover_media_type",
      "cover_media_provider",
      "cover_media_source_url",
      "cover_media_credit",
      "cover_media_credit_url",
      "cover_media_alt",
    ]) {
      assert(body.includes(col), `${name} writes ${col}`);
    }
    assert(/coverMediaUrl/i.test(body), `${name} maps coverMediaUrl from the patch`);
  }
});

Deno.test("R-03 publish preserves existing cover when payload coverMediaUrl is empty", () => {
  // v_has_cover gates on a NON-EMPTY url, not key-presence — so an empty cover
  // patch leaves the existing columns intact (no clobber of a video cover).
  assert(
    /v_has_cover\s*:=\s*NULLIF\(v_cover->>'coverMediaUrl',\s*''\)\s+IS NOT NULL/i.test(publishBody),
    "publish only applies a cover when coverMediaUrl is non-empty",
  );
  assert(
    /cover_media_url\s*=\s*CASE WHEN v_has_cover THEN[\s\S]*?ELSE cover_media_url END/i.test(publishBody),
    "publish UPDATE preserves cover_media_url when v_has_cover is false",
  );
});

Deno.test("R-04 ONE-TICKET (I-1) + publish-only event_dates (I-4) preserved", () => {
  // create: exactly one ticket insert.
  const createTicketInserts = createBody.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
  assertEquals(createTicketInserts.length, 1, "create inserts exactly one ticket (I-1)");
  // publish: soft-delete then exactly one insert.
  const publishTicketInserts = publishBody.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
  assertEquals(publishTicketInserts.length, 1, "publish inserts exactly one ticket (I-1)");
  assert(
    /UPDATE\s+public\.ticket_types\s+SET\s+deleted_at\s*=\s*v_now/i.test(publishBody),
    "publish soft-deletes prior tickets before the single re-insert",
  );
  // event_dates inserts are downstream of IF p_publish in BOTH RPCs.
  for (const [name, body] of [["create", createBody], ["publish", publishBody]] as const) {
    const gate = body.indexOf("IF p_publish THEN");
    const firstDateInsert = body.search(/INSERT\s+INTO\s+public\.event_dates/i);
    assert(gate !== -1, `${name} has an IF p_publish gate`);
    assert(
      firstDateInsert > gate,
      `${name} event_dates inserts are publish-gated (I-4; drafts get none)`,
    );
  }
});

Deno.test("R-05 never-ends materialises exactly the master occurrence on publish", () => {
  // The single/recurring publish branch inserts ONE master event_dates row.
  // A 'never' termination flows through the same single-master path (the rule
  // carries the repeat) — no count/until-specific materialisation branch.
  for (const [name, body] of [["create", createBody], ["publish", publishBody]] as const) {
    const singleRecurringBlock = body.match(
      /IF v_when_mode IN \('single','recurring'\) THEN([\s\S]*?)ELSIF v_when_mode = 'multi_date'/i,
    );
    assert(singleRecurringBlock !== null, `${name} has a single/recurring date branch`);
    const inserts = singleRecurringBlock![1].match(/INSERT\s+INTO\s+public\.event_dates/gi) ?? [];
    assertEquals(
      inserts.length,
      1,
      `${name} single/recurring (incl. never-ends) writes exactly one master date`,
    );
    assert(
      /is_master\)[\s\S]*?VALUES[\s\S]*?true\)/i.test(singleRecurringBlock![1]),
      `${name} marks the materialised occurrence is_master=true`,
    );
  }
});

Deno.test("R-06 migration is SECURITY DEFINER, granted, and self-verifies", () => {
  assert(/SECURITY DEFINER/i.test(migration), "RPCs are SECURITY DEFINER");
  assert(
    /GRANT EXECUTE ON FUNCTION public\.biz_create_experience\(uuid, jsonb, boolean\) TO authenticated/i.test(
      migration,
    ),
    "create execute granted to authenticated",
  );
  assert(
    /GRANT EXECUTE ON FUNCTION public\.biz_publish_experience\(uuid, jsonb, boolean\) TO authenticated/i.test(
      migration,
    ),
    "publish execute granted to authenticated",
  );
  // Self-verify probe present (fails-on-revert at apply time).
  assert(
    /position\('when_draft' IN v_create_def\)\s*=\s*0/i.test(migration),
    "migration self-verifies when_draft persistence",
  );
  assert(
    /position\('cover_media_url' IN v_publish_def\)\s*=\s*0/i.test(migration),
    "migration self-verifies cover_media_url persistence",
  );
  // No Stripe surface (I-6 / COMMS-0014/0016).
  assert(
    !/payment_intent|application_fee|stripe\./i.test(createBody + publishBody),
    "no Stripe/payment surface (I-6)",
  );
});
