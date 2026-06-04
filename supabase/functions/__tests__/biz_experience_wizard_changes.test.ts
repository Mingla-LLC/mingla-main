// META-ORCH-1059 [experiences-business-parity] · WIZARD CHANGES 1+2+3 regression.
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/biz_experience_wizard_changes.test.ts
//
// Source-level migration regression for the forward migration
// 20260827000000_meta_orch_1059_wizard_intent_desc_validation.sql. The worktree
// has no live SQL harness (repo convention), so this pins the exact SQL contract
// that would FAIL if the migration were reverted to the Sub-A/B behaviour.
//
// CHANGE 1 — stop_name_required (and stop_description_required) must be gated on
//            p_publish (NOT fired unconditionally on a draft create).
// CHANGE 2 — events.experience_intent column + 6-id CHECK + publish-time required.
// CHANGE 3 — per-stop ai_description required at publish; written from the stop.
//
// fails-on-revert: each assertion targets a distinct shipped construct; reverting
// the migration (or dropping the p_publish gating / the intent column / the desc
// gate) flips at least one assertion.

import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260827000000_meta_orch_1059_wizard_intent_desc_validation.sql",
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

// ── CHANGE 1 — draft must NOT raise stop_name_required ───────────────────────

Deno.test("C1-01 create: stop_name_required is gated on p_publish (not unconditional)", () => {
  // The ONLY place stop_name_required is raised must be inside a `IF p_publish AND ...`
  // guard. Assert there is no bare `IF NULLIF(...place_name...) IS NULL THEN ... stop_name_required`
  // without a p_publish prefix.
  const bareNameCheck =
    /IF\s+NULLIF\(btrim\(COALESCE\(v_stop->>'place_name'[\s\S]*?stop_name_required/i;
  const gatedNameCheck =
    /IF\s+p_publish\s+AND\s+NULLIF\(btrim\(COALESCE\(v_stop->>'place_name'[\s\S]*?stop_name_required/i;
  assert(
    gatedNameCheck.test(createBody),
    "biz_create_experience must gate stop_name_required on p_publish",
  );
  assert(
    !bareNameCheck.test(createBody) || gatedNameCheck.test(createBody),
    "biz_create_experience must NOT raise stop_name_required without a p_publish guard",
  );
});

Deno.test("C1-02 publish: stop_name_required is gated on p_publish", () => {
  const gatedNameCheck =
    /IF\s+p_publish\s+AND\s+NULLIF\(btrim\(COALESCE\(v_stop->>'place_name'[\s\S]*?stop_name_required/i;
  assert(
    gatedNameCheck.test(publishBody),
    "biz_publish_experience must gate stop_name_required on p_publish",
  );
});

// ── CHANGE 3 — per-stop description required at publish, written from the stop ─

Deno.test("C3-01 create: stop_description_required is gated on p_publish", () => {
  const gated =
    /IF\s+p_publish\s+AND\s+NULLIF\(btrim\(COALESCE\(v_stop->>'ai_description'[\s\S]*?stop_description_required/i;
  assert(gated.test(createBody), "create must require ai_description at publish only");
});

Deno.test("C3-02 publish: stop_description_required is gated on p_publish", () => {
  const gated =
    /IF\s+p_publish\s+AND\s+NULLIF\(btrim\(COALESCE\(v_stop->>'ai_description'[\s\S]*?stop_description_required/i;
  assert(gated.test(publishBody), "publish must require ai_description at publish only");
});

Deno.test("C3-03 both RPCs persist the stop's ai_description (not a hardcoded '')", () => {
  // The experience_stops INSERT writes the trimmed payload ai_description.
  const writesDesc = /COALESCE\(NULLIF\(btrim\(v_stop->>'ai_description'\), ''\), ''\)/;
  assert(writesDesc.test(createBody), "create must write the stop ai_description");
  assert(writesDesc.test(publishBody), "publish must write the stop ai_description");
});

// ── CHANGE 2 — experience_intent column + CHECK + publish-time required ───────

Deno.test("C2-01 migration adds events.experience_intent column + 6-id CHECK", () => {
  assert(
    /ADD COLUMN IF NOT EXISTS experience_intent text/.test(migration),
    "migration must add events.experience_intent",
  );
  assert(
    /events_experience_intent_chk[\s\S]*?'adventurous'[\s\S]*?'first-date'[\s\S]*?'romantic'[\s\S]*?'group-fun'[\s\S]*?'picnic-dates'[\s\S]*?'take-a-stroll'/.test(
      migration,
    ),
    "the CHECK must list the exact 6 consumer intent ids",
  );
});

Deno.test("C2-02 both RPCs require intent at publish + validate the 6 ids", () => {
  for (const [name, body] of [
    ["create", createBody],
    ["publish", publishBody],
  ] as const) {
    assert(
      /IF\s+p_publish\s+AND\s+v_intent\s+IS\s+NULL\s+THEN[\s\S]*?experience_intent_required/i.test(
        body,
      ),
      `${name} must raise experience_intent_required at publish when intent is null`,
    );
    assert(
      /v_intent\s+IS\s+NOT\s+NULL\s+AND\s+v_intent\s+NOT\s+IN[\s\S]*?experience_intent_invalid/i.test(
        body,
      ),
      `${name} must reject an out-of-set intent with experience_intent_invalid`,
    );
  }
});

Deno.test("C2-03 create INSERT + publish UPDATE persist experience_intent", () => {
  assert(
    /INSERT INTO public\.events[\s\S]*?experience_intent[\s\S]*?VALUES/i.test(createBody),
    "create must INSERT experience_intent",
  );
  assert(
    /UPDATE public\.events SET[\s\S]*?experience_intent\s*=\s*v_intent/i.test(publishBody),
    "publish must UPDATE experience_intent",
  );
});

// ── I-1 one-ticket invariant must survive the rewrite ────────────────────────

Deno.test("I-1 each RPC still INSERTs exactly ONE ticket_types row", () => {
  for (const [name, body] of [
    ["create", createBody],
    ["publish", publishBody],
  ] as const) {
    const inserts = body.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
    assertEquals(inserts.length, 1, `${name} must INSERT exactly one ticket_types row (I-1)`);
  }
});
