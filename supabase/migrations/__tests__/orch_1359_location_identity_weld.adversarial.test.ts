// ORCH-1359 [guest-list-sheet-identity-display] — TESTER-authored ADVERSARIAL
// regression test (mingla-tester). DIFFERENT ANGLE from the implementor's
// happy-path suite (orch_1359_peer_guest_location.test.ts, which pins that
// location IS emitted on named rows in both branches with the right key slot).
//
// This suite attacks the OPPOSITE failure mode — a privacy-LEAK regression where
// a future edit keeps `named_location` present (so the happy-path stays green)
// but DE-COUPLES it from the identity gate, letting a city surface on a row whose
// NAME is anonymized. Proven live against prod gqnoajqerqhnvulmnyvv by this
// tester on 2026-07-11 via authed peer_list_event_guests calls on the FIFA Grill
// Night event: a private-visibility guest and a blocked-pair guest each returned
// `location: null` (private → isMinglaUser:true anon row; blocked → row excluded),
// while a public/friends guest returned the real city. This test welds that
// runtime invariant into CI so it cannot silently regress.
//
// The weld it enforces (all structural, deno-safe, no network):
//   W-1  location's CASE predicate is BYTE-IDENTICAL to display_name's, per
//        branch — location can never be gated MORE WEAKLY than the name.
//   W-2  the row's `is_named` boolean uses that SAME predicate, so
//        `isAnonymous = NOT is_named` is welded to the gate that nulls location:
//        a row flagged isAnonymous:true structurally cannot carry a non-null city.
//   W-3  the `'location'` payload value is ALWAYS the gated alias
//        `n.named_location` — never a raw `p.location` / `b.location`.
//   W-4  location is projected via `THEN p.location END` ONLY (no ungated
//        `p.location` anywhere in the function body).
//
// FAILS-ON-REVERT: loosen location's guard (e.g. drop `linked_user_id IS NOT NULL`
// or widen visibility_mode), move location out of the CASE, or emit a raw
// p.location in the payload → W-1/W-3/W-4 FAIL. Restoring the weld → PASS.
// fails-on-revert verified by this tester (see the QA report Step-0.5 / §5).
//
// Run locally (repo root):
//   deno test --allow-read supabase/migrations/__tests__/orch_1359_location_identity_weld.adversarial.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION_PATH =
  "supabase/migrations/20261229000000_orch_1359_peer_guest_location.sql";
const migration = await Deno.readTextFile(MIGRATION_PATH);

/** The [begin,end) span between two marker strings. */
function span(begin: string, end: string): string {
  const b = migration.indexOf(begin);
  const e = migration.indexOf(end);
  assert(b >= 0, `marker present: ${begin}`);
  assert(e > b, `marker present + after begin: ${end}`);
  return migration.slice(b, e);
}

const BRANCHES: Record<string, string> = {
  rsvp: span(
    "[ORCH-1338 FN-B RSVP-BRANCH-BEGIN]",
    "[ORCH-1338 FN-B RSVP-BRANCH-END]",
  ),
  ticketed: span(
    "[ORCH-1338 FN-B TICKETED-BRANCH-BEGIN]",
    "[ORCH-1338 FN-B TICKETED-BRANCH-END]",
  ),
};

const ws = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Extract the predicate P from `CASE WHEN P THEN p.<col> END`. The negative
 * lookahead binds P to the NEAREST preceding `CASE WHEN` (there are several
 * sibling CASE projections before this one). */
function casePredicate(branch: string, col: string): string {
  const m = branch.match(
    new RegExp(`CASE WHEN ((?:(?!CASE WHEN)[\\s\\S])*?) THEN p\\.${col} END`),
  );
  assert(m !== null, `CASE ... THEN p.${col} END found`);
  return ws(m[1]);
}

/** Extract the predicate P from `(P) AS is_named`, anchored on the comma that
 * ends the prior projection so the earlier `(...) AS is_mingla_user` is not
 * swallowed. */
function isNamedPredicate(branch: string): string {
  // Balanced one-level paren matcher so the nested IN ('public','friends') and
  // the earlier (...) AS is_mingla_user projection are not mis-captured.
  const m = branch.match(
    /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s+AS is_named/,
  );
  assert(m !== null, "(...) AS is_named found");
  return ws(m[1]);
}

// ── W-1 — location's guard is byte-identical to display_name's, per branch ───
Deno.test("W-1 location CASE predicate === display_name CASE predicate (no weaker gate) — both branches", () => {
  for (const [name, branch] of Object.entries(BRANCHES)) {
    const namePred = casePredicate(branch, "display_name");
    const locPred = casePredicate(branch, "location");
    assertEquals(
      locPred,
      namePred,
      `${name} branch: location must be gated by the EXACT same predicate as the name ` +
        `(a weaker/decoupled location gate leaks a city on a name-anonymized row)`,
    );
    // And it must be the real identity predicate, not some trivially-true one.
    assert(
      /linked_user_id IS NOT NULL/.test(locPred) &&
        /visibility_mode IN \('public', 'friends'\)/.test(locPred),
      `${name} branch: the shared predicate must be the linked + public/friends identity gate`,
    );
  }
});

// ── W-2 — isAnonymous is welded to the same gate that nulls location ─────────
Deno.test("W-2 isAnonymous derives from the SAME predicate that gates location (anon row ⇒ null city)", () => {
  for (const [name, branch] of Object.entries(BRANCHES)) {
    const isNamedPred = isNamedPredicate(branch);
    const locPred = casePredicate(branch, "location");
    assertEquals(
      isNamedPred,
      locPred,
      `${name} branch: is_named (hence isAnonymous = NOT is_named) must use the SAME predicate ` +
        `that gates named_location — otherwise a row could be isAnonymous:true yet carry a city`,
    );
    // The payload actually emits isAnonymous = NOT is_named alongside location.
    assert(
      /'isAnonymous',\s+NOT n\.is_named,/.test(branch),
      `${name} branch: payload emits isAnonymous as NOT n.is_named`,
    );
    assert(
      /'location',\s+n\.named_location,/.test(branch),
      `${name} branch: payload emits location as the gated alias`,
    );
  }
});

// ── W-3 — the emitted location value is ALWAYS the gated alias ───────────────
Deno.test("W-3 payload location value is n.named_location only — never a raw ungated column", () => {
  // Any 'location' key whose value is not exactly n.named_location would be a leak.
  const badValue =
    /'location',\s+(?!n\.named_location\b)[a-zA-Z_][\w.]*/g;
  const bad = migration.match(badValue) ?? [];
  assertEquals(
    bad.length,
    0,
    `every 'location' payload value must be n.named_location (gated); found: ${JSON.stringify(bad)}`,
  );
  // Both branches emit exactly one such gated key.
  assertEquals(
    (migration.match(/'location',\s+n\.named_location,/g) ?? []).length,
    2,
    "exactly two gated location payload keys (RSVP + ticketed)",
  );
});

// ── W-4 — location is only ever read inside the CASE gate (no bare p.location) ─
Deno.test("W-4 no ungated p.location anywhere in the function body", () => {
  // Every occurrence of p.location must be the guarded `THEN p.location END`.
  const total = (migration.match(/p\.location\b/g) ?? []).length;
  const guarded = (migration.match(/THEN p\.location END/g) ?? []).length;
  assertEquals(total, guarded, "every p.location sits inside a THEN p.location END gate");
  assertEquals(guarded, 2, "exactly two guarded location reads (one per branch)");
});
