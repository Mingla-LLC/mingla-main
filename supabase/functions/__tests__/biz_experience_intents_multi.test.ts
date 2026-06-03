// META-ORCH-1059 — Intent picker → 4 ids + MULTI-select (forward migration).
//
// Source-level regression over
// supabase/migrations/20260828000000_meta_orch_1059_experience_intents_multi.sql.
// The worktree mounts supabase/ at the repo root, so the relative path resolves
// from the Deno test runner's CWD (repo root).
//
// What these assert (fails-on-revert of the multi change):
//   * a NEW events.experience_intents text[] column + CHECK restricted to the 4
//     KEPT ids (adventurous/first-date/romantic/group-fun) — NOT the removed
//     picnic-dates/take-a-stroll;
//   * a backfill from the legacy singular experience_intent;
//   * both RPCs read p_payload->'experience_intents' (array), validate against
//     the 4 ids, require ≥1 at publish, and persist BOTH columns.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260828000000_meta_orch_1059_experience_intents_multi.sql",
);

// Split the two RPC bodies so assertions target the right function.
const createIdx = migration.indexOf("CREATE OR REPLACE FUNCTION public.biz_create_experience");
const publishIdx = migration.indexOf("CREATE OR REPLACE FUNCTION public.biz_publish_experience");
assert(createIdx >= 0, "migration must define biz_create_experience");
assert(publishIdx >= 0, "migration must define biz_publish_experience");
const createBody = migration.slice(createIdx, publishIdx);
const publishBody = migration.slice(publishIdx);

// ── Column + CHECK ───────────────────────────────────────────────────────────
Deno.test("MI-01 adds events.experience_intents text[] column", () => {
  assert(
    /ADD COLUMN IF NOT EXISTS experience_intents text\[\]/.test(migration),
    "migration must add events.experience_intents text[]",
  );
});

Deno.test("MI-02 array CHECK restricts to the 4 KEPT ids only (no picnic/stroll)", () => {
  const m = /events_experience_intents_chk[\s\S]*?CHECK[\s\S]*?ARRAY\[([\s\S]*?)\]/.exec(migration);
  assert(m !== null, "array CHECK must exist");
  const body = m[1];
  for (const id of ["adventurous", "first-date", "romantic", "group-fun"]) {
    assert(body.includes(`'${id}'`), `array CHECK must allow '${id}'`);
  }
  assert(!body.includes("picnic-dates"), "array CHECK must NOT allow picnic-dates");
  assert(!body.includes("take-a-stroll"), "array CHECK must NOT allow take-a-stroll");
});

Deno.test("MI-03 backfills experience_intents from the legacy singular column", () => {
  assert(
    /UPDATE public\.events\s+SET experience_intents = ARRAY\[experience_intent\]/.test(migration),
    "migration must backfill experience_intents from experience_intent",
  );
});

Deno.test("MI-04 relaxes the legacy singular CHECK to the 4 kept ids", () => {
  assert(
    /events_experience_intent_chk[\s\S]*?CHECK[\s\S]*?'adventurous'[\s\S]*?'first-date'[\s\S]*?'romantic'[\s\S]*?'group-fun'/.test(
      migration,
    ),
    "singular CHECK must be re-added with the 4 ids",
  );
  // The relaxed singular CHECK must NOT re-admit the removed ids.
  const singularChk = /DROP CONSTRAINT IF EXISTS events_experience_intent_chk[\s\S]*?VALIDATE CONSTRAINT events_experience_intent_chk/.exec(
    migration,
  );
  assert(singularChk !== null, "singular CHECK swap block must exist");
  assert(!singularChk[0].includes("picnic-dates"), "singular CHECK must drop picnic-dates");
  assert(!singularChk[0].includes("take-a-stroll"), "singular CHECK must drop take-a-stroll");
});

// ── RPC payload read + validation (both functions) ───────────────────────────
for (const [name, body] of [["create", createBody], ["publish", publishBody]] as const) {
  Deno.test(`MI-05 ${name} reads p_payload->'experience_intents' (array)`, () => {
    assert(
      /jsonb_typeof\(p_payload->'experience_intents'\) = 'array'/.test(body),
      `${name} must read the experience_intents array from the payload`,
    );
  });

  Deno.test(`MI-06 ${name} validates each id against the 4 kept ids`, () => {
    assert(
      /v_intents <@ ARRAY\['adventurous','first-date','romantic','group-fun'\]/.test(body),
      `${name} must containment-check intents against the 4 ids`,
    );
    assert(
      /RAISE EXCEPTION 'experience_intent_invalid'/.test(body),
      `${name} must raise experience_intent_invalid on a bad id`,
    );
  });

  Deno.test(`MI-07 ${name} requires ≥1 intent at publish`, () => {
    assert(
      /p_publish AND \(v_intents IS NULL OR array_length\(v_intents, 1\) IS NULL\)[\s\S]*?RAISE EXCEPTION 'experience_intent_required'/.test(
        body,
      ),
      `${name} must require ≥1 intent at publish`,
    );
  });

  Deno.test(`MI-08 ${name} persists BOTH experience_intents + the back-compat mirror`, () => {
    assert(/experience_intents/.test(body), `${name} must write experience_intents`);
    assert(/v_intent := v_intents\[1\]/.test(body), `${name} must mirror element [1] to experience_intent`);
  });
}

// ── publish-specific: default to stored array when key absent ─────────────────
Deno.test("MI-09 publish defaults to the stored array when the payload omits the key", () => {
  assert(
    /NOT \(p_payload \? 'experience_intents'\)[\s\S]*?v_intents := v_existing\.experience_intents/.test(
      publishBody,
    ),
    "publish must default to v_existing.experience_intents when the key is absent",
  );
});

// ── ONE-TICKET invariant preserved (regression guard, COMMS-0014/0016) ───────
Deno.test("MI-10 both RPCs still write EXACTLY ONE ticket_types row (I-1)", () => {
  const createInserts = (createBody.match(/INSERT INTO public\.ticket_types/g) ?? []).length;
  const publishInserts = (publishBody.match(/INSERT INTO public\.ticket_types/g) ?? []).length;
  assert(createInserts === 1, `create must INSERT exactly one ticket (got ${createInserts})`);
  assert(publishInserts === 1, `publish must INSERT exactly one ticket (got ${publishInserts})`);
});
