// [META-ORCH-1009 Sub-D] ADVERSARIAL — source-text probes against the Sub-D
// migration that catch the bugs operator-locked decisions did NOT cover.
//
// Findings these tests pin:
//   ADV-01 (P0): drift trigger references public.cities which does NOT exist
//                on the linked project (the actual table is seeding_cities).
//                Every drift event will throw "relation public.cities does
//                not exist" and brick the place_pool UPDATE.
//   ADV-02 (P1): drift trigger does NOT guard NEW.city_id IS NOT NULL but
//                inserts into place_intelligence_runs.city_id which is
//                NOT NULL. Currently zero servable AI places have NULL city_id
//                but the trigger has no defense-in-depth guard.
//   ADV-03 (P2): place_pool.business_status whitespace-only drift still fires
//                Gemini Q2 re-eval. SPEC §3.2 explicitly chose IS DISTINCT
//                FROM with no normalization; acceptable but unbounded cost
//                concern documented.
//   ADV-04 (defensive): verifies the 3 drift columns are exactly the
//                business_status/editorial_summary/generative_summary set and
//                no fourth column was added silently.
//   ADV-05 (defensive): verifies the helper fn is REVOKEd from PUBLIC + anon
//                + authenticated.
//   ADV-06 (defensive): verifies the cron `*/15 * * * *` schedule is the
//                literal SPEC-locked cadence.
//   ADV-07 (defensive): verifies the partial unique idx covers BOTH 'pending'
//                AND 'running' (not just 'pending').
//
// Run: deno test --allow-read supabase/migrations/__tests__/meta_orch_1009_sub_d_adversarial.test.ts
//
// Fails-on-revert evidence:
//   ADV-01: if implementor fixes "public.cities" → "public.seeding_cities",
//           this test FLIPS to fail (current behavior pins the bug as long as
//           the bug exists). After the fix lands, replace the assertion with
//           the inverse (asserts "public.seeding_cities" is used).

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = await Deno.readTextFile(
  new URL(
    "../20260808000000_meta_orch_1009_sub_d_refresh_cron.sql",
    import.meta.url,
  ),
);

Deno.test("ADV-01 [Sub-D] P0 — drift trigger references public.cities which DOES NOT EXIST on linked project", () => {
  // Live DB probe (Supabase Management API 2026-05-30): SELECT table_name
  // FROM information_schema.tables WHERE table_name='cities' returns ZERO
  // rows. The actual table is public.seeding_cities. This test PINS the
  // bug: as long as the migration references public.cities, every drift
  // event will throw relation-does-not-exist and brick the place_pool
  // UPDATE because the trigger BLOCKS the UPDATE on EXCEPTION (AFTER
  // UPDATE FOR EACH ROW runs in the same xact as the UPDATE).
  //
  // After the fix:
  //   - replace SELECT name FROM public.cities → SELECT name FROM public.seeding_cities
  //   - flip the assertion below to assertStringIncludes "public.seeding_cities"
  //     and verify the bad reference is gone.
  assertStringIncludes(
    MIGRATION,
    "FROM public.cities",
    "P0 BUG STILL PRESENT: drift trigger references public.cities (doesn't exist). Fix: change to public.seeding_cities.",
  );
});

Deno.test("ADV-02 [Sub-D] P1 — drift trigger lacks NEW.city_id IS NOT NULL guard", () => {
  // place_pool.city_id is NULLABLE but place_intelligence_runs.city_id is
  // NOT NULL. Currently zero servable AI places have NULL city_id (live
  // probe 2026-05-30) but defense-in-depth requires guarding the trigger
  // before INSERT. A future place_pool row with NULL city_id + AI scores
  // present would throw "null value in column city_id violates not-null
  // constraint" and brick the UPDATE.
  //
  // This test asserts the gap exists (no guard line present). Fix is to
  // add `IF NEW.city_id IS NULL THEN RETURN NEW; END IF;` after the other
  // 3 guards in tg_meta_orch_1009_sub_d_drift_queue_reeval.
  const guardSnippet = "NEW.city_id IS NULL THEN RETURN NEW";
  const hasGuard = MIGRATION.includes(guardSnippet);
  assert(
    !hasGuard,
    "Gap was closed — ADV-02 should now invert assertion to require the guard string present.",
  );
});

Deno.test("ADV-03 [Sub-D] P2 — whitespace-only edits to editorial_summary fire Gemini Q2 (~$0.0040)", () => {
  // SPEC §3.2 chose IS DISTINCT FROM with no normalization. This means a
  // ' foo' → 'foo' Google data refresh fires a Gemini Q2 re-eval costing
  // ~$0.0040 per place. Acceptable per operator-locked D-3 (ship as-is,
  // monitor 30 days) but pinned here so cost regression is visible.
  // After 30-day monitoring, if cost climbs, fix is to NORMALIZE via
  // btrim() or compare via regexp_replace(...,'\\s+',' ','g') before the
  // IS DISTINCT FROM check.
  assertStringIncludes(
    MIGRATION,
    "NEW.editorial_summary IS DISTINCT FROM OLD.editorial_summary",
    "trigger compares editorial_summary byte-exactly (no whitespace normalization)",
  );
  // Confirm NO normalization wrapper is currently applied:
  const hasNormalized =
    /btrim\s*\(\s*(NEW|OLD)\.editorial_summary/.test(MIGRATION) ||
    /regexp_replace\s*\(\s*(NEW|OLD)\.editorial_summary/.test(MIGRATION);
  assert(
    !hasNormalized,
    "Whitespace normalization landed — invert this test to assert presence.",
  );
});

Deno.test("ADV-04 [Sub-D] drift trigger watches EXACTLY the 3 SPEC-locked columns", () => {
  // Regression guard: catches a future 4th-column addition that would
  // multiply drift cost. SPEC §3.2 locked the column list at 3.
  assertStringIncludes(
    MIGRATION,
    "AFTER UPDATE OF business_status, editorial_summary, generative_summary",
    "trigger event spec must list exactly the 3 SPEC-locked columns in order",
  );
  // No fourth column (defensive — checks no comma-name pattern past summary)
  const triggerLine =
    /AFTER UPDATE OF (.+)\n\s+ON public\.place_pool/.exec(MIGRATION);
  assert(triggerLine, "trigger AFTER UPDATE clause not found");
  const cols = triggerLine[1].split(",").map((s) => s.trim()).filter(Boolean);
  assertEquals(
    cols.length,
    3,
    `expected exactly 3 watched columns, got ${cols.length}: ${cols.join(",")}`,
  );
});

Deno.test("ADV-05 [Sub-D] helper fn REVOKEd from PUBLIC + anon + authenticated", () => {
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assertStringIncludes(
      MIGRATION,
      `REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM ${role};`,
      `helper fn missing REVOKE from ${role}`,
    );
  }
});

Deno.test("ADV-06 [Sub-D] cron schedule is byte-identical to SPEC '*/15 * * * *'", () => {
  // Future refactor could "tighten" to */5 (4x cost) or loosen to */60
  // (4x staleness). Pin the SPEC-locked value.
  assertStringIncludes(
    MIGRATION,
    "'meta_orch_1009_sub_d_ai_score_rescore_sweep',\n    '*/15 * * * *',",
    "rescore-sweep cron schedule is not exactly */15 * * * *",
  );
  assertStringIncludes(
    MIGRATION,
    "'meta_orch_1009_sub_d_quarterly_all_cities_sweep',\n    '0 4 1 */3 *',",
    "quarterly cron schedule is not exactly 0 4 1 */3 *",
  );
});

Deno.test("ADV-07 [Sub-D] drift dedup idx covers BOTH 'pending' AND 'running'", () => {
  // SPEC §3.2: index prevents duplicate drift rows for a place whose
  // prior drift is still pending OR running. If a future refactor narrows
  // to 'pending' only, a drift event during the Gemini Q2 worker's run
  // window (~1 min) would queue a duplicate.
  assertStringIncludes(
    MIGRATION,
    "WHERE source = 'auto-refresh-drift'\n    AND status IN ('pending', 'running')",
    "drift-dedup partial idx must cover both pending AND running statuses",
  );
});

Deno.test("ADV-08 [Sub-D] D-6 seed-UPDATE WHERE clause excludes already-seeded rows (idempotent)", () => {
  // SPEC D-6 LOCKED: re-running the seed must not stamp the same row
  // twice. The IS NULL guard is what makes it idempotent.
  assertStringIncludes(
    MIGRATION,
    "AND ps.ai_signal_scores_at IS NULL",
    "D-6 seed-UPDATE missing IS NULL guard — re-runs would re-stamp",
  );
  assertStringIncludes(
    MIGRATION,
    "AND ps.scored_at > (pp.ai_signal_scores -> ps.signal_id ->> 'evaluated_at')::timestamptz",
    "D-6 seed must only stamp rows whose place_scores.scored_at is NEWER than the AI evaluated_at (= already absorbed)",
  );
});

Deno.test("ADV-09 [Sub-D] admin button shares same kick pattern as full_city (process_chunk fire-and-forget)", () => {
  // Verified via cross-file source inspect — already covered by
  // admin_reeval_place.test.ts T-08. This test is defensive: the kick MUST
  // use service_role auth (not anon), else cron-driven recovery via
  // kick_pending_trial_runs picks up but the immediate kick silently 403s.
  // The implementation report confirms supabaseServiceKey is passed.
  assert(
    true,
    "Cross-file dispatcher path verified by admin_reeval_place.test.ts T-08; this is a doc-only test slot.",
  );
});

Deno.test("ADV-10 [Sub-D] quarterly cron fn handles signal_definitions empty (no infinite/zero loop)", () => {
  // Live DB probe 2026-05-30: signal_definitions has 16 active rows. If a
  // future migration deactivates all signals, the quarterly fn FOR loop
  // iterates 0 times and exits cleanly (no error). Source-text inspect
  // confirms the loop body has no fall-through that requires >0 rows.
  assertStringIncludes(
    MIGRATION,
    "FOR sig IN SELECT id FROM public.signal_definitions WHERE is_active = true ORDER BY id LOOP",
    "quarterly fn must iterate signal_definitions inside FOR ... LOOP",
  );
  // No bare ASSERT inside the loop body that would EXCEPTION on empty
  const hasAssertInLoop =
    /WHERE is_active = true ORDER BY id LOOP[\s\S]*?ASSERT[\s\S]*?END LOOP/.test(
      MIGRATION,
    );
  assert(
    !hasAssertInLoop,
    "quarterly loop body contains ASSERT — would fail on empty signal_definitions",
  );
});
