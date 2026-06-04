// ORCH-1067 — TESTER adversarial regression suite.
// Attacks a DIFFERENT angle than the implementor's happy-path tests
// (T-1067-01..06 in bouncer.test.ts). Those prove the skip works for the exact
// 'business_authored' string and that Google-seeded / absent-provenance rows
// still fire B7. This suite proves the skip does NOT LEAK:
//
//   1. NEAR-MISS PROVENANCE STRINGS must STILL fire B7 through the full bounce()
//      path — a hyphenated 'business-authored', concatenated 'businessauthored',
//      uppercase 'BUSINESS_AUTHORED', whitespace-padded ' business_authored ',
//      and 'claim_existing' (the other authoring provenance) must NOT skip B7.
//      Only the exact literal 'business_authored' skips. (Guards against a future
//      `.includes()` / `.startsWith()` / case-insensitive broadening of the
//      predicate — locks SPEC §7 L3 "narrowest correct predicate".)
//
//   2. DOUBLE-EFFECT: a business_authored row that ALSO has Google photos behaves
//      IDENTICALLY to a Google-seeded row with photos — servable, reasons=[],
//      no double-counting, no interaction between the skip and hasGooglePhotos.
//
//   3. CROSS-PASS LEAK on a near-miss: a near-miss-provenance row with no stored
//      photos fails B7 in BOTH passes (the skip never fires) AND additionally
//      fails B8 only in the final pass — proving near-miss rows get the full,
//      unmodified two-pass treatment (parity is not perturbed by the predicate).
//
// Run: deno test --no-check --allow-read --allow-env \
//        supabase/functions/_shared/__tests__/bouncer_orch1067_adversarial.test.ts
//
// fails-on-revert: removing the `!isBusinessAuthored(place) &&` guard at the B7
// push site makes ADV-04 (double-effect-vs-exact-string equivalence) fail
// because the exact-string business_authored row WITHOUT Google photos would
// then ALSO become servable, breaking the asserted asymmetry. (The near-miss
// tests stay green on revert by construction — they're regression anchors for
// the predicate's exactness, which is why ADV-04 is the load-bearing revert
// proof in this file; the bouncer.test.ts T-1067-01/05 remain the primary
// revert anchors for the skip itself.)

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { bounce, isBusinessAuthored, type PlaceRow } from '../bouncer.ts';

// A fully-clean A_COMMERCIAL row EXCEPT it has no Google photos. Everything else
// passes (website own-domain, hours, stored photos present). So the ONLY thing
// that can change the verdict is whether B7 fires — making this the perfect
// probe for "did the provenance string skip B7?".
function noGooglePhotosBase(overrides: Partial<PlaceRow> = {}): PlaceRow {
  return {
    id: 'adv-id',
    name: 'Adversarial Venue',
    lat: 35.78,
    lng: -78.65,
    types: ['restaurant'],
    business_status: 'OPERATIONAL',
    website: 'https://realvenue.example',
    opening_hours: { monday: '9-5' },
    photos: [], // NO Google photos → B7 fires unless skipped
    stored_photo_urls: ['https://storage.example/p1.jpg'],
    review_count: 0,
    rating: null,
    ...overrides,
  };
}

// ─── 1. Near-miss provenance strings must STILL fire B7 ────────────────────

const NEAR_MISS_VALUES = [
  'business-authored',   // hyphen instead of underscore
  'businessauthored',    // no separator
  'BUSINESS_AUTHORED',   // uppercase
  'Business_Authored',   // mixed case
  ' business_authored ', // leading/trailing whitespace
  'business_authored ',  // trailing space only
  'business_authored\n', // trailing newline
  'claim_existing',      // a real OTHER authoring provenance — must NOT skip
  'business_authored_v2',// suffix
  'pre_business_authored',// prefix
];

Deno.test('ORCH-1067 ADV-01: near-miss / typo provenance strings STILL fire B7 (only exact business_authored skips)', () => {
  for (const fv of NEAR_MISS_VALUES) {
    const verdict = bounce(noGooglePhotosBase({ fetched_via: fv }));
    assertEquals(
      verdict.reasons.includes('B7:no_google_photos'),
      true,
      `fetched_via=${JSON.stringify(fv)} must NOT skip B7 (only the exact literal 'business_authored' skips), got reasons=${JSON.stringify(verdict.reasons)}`,
    );
    assertEquals(
      verdict.is_servable,
      false,
      `fetched_via=${JSON.stringify(fv)} must remain non-servable (B7 fires)`,
    );
    // And the predicate itself rejects them:
    assertEquals(isBusinessAuthored(noGooglePhotosBase({ fetched_via: fv })), false);
  }
});

Deno.test('ORCH-1067 ADV-02: the EXACT literal business_authored skips B7 (control for ADV-01)', () => {
  const verdict = bounce(noGooglePhotosBase({ fetched_via: 'business_authored' }));
  assertEquals(verdict.reasons.includes('B7:no_google_photos'), false);
  assertEquals(verdict.is_servable, true);
  assertEquals(verdict.reasons, []);
});

// ─── 2. Double-effect: business_authored + Google photos ───────────────────

Deno.test('ORCH-1067 ADV-03: business_authored row that ALSO has Google photos is servable identically — no double-effect', () => {
  // Google-seeded row WITH photos (baseline).
  const googleWithPhotos = noGooglePhotosBase({
    fetched_via: 'nearby_search',
    photos: [{ name: 'g1' }],
  });
  // business_authored row that ALSO happens to carry Google photos.
  const authoredWithPhotos = noGooglePhotosBase({
    fetched_via: 'business_authored',
    photos: [{ name: 'g1' }],
  });
  const a = bounce(googleWithPhotos);
  const b = bounce(authoredWithPhotos);
  // Both servable, both reasons=[]; the skip does not interact with the presence
  // of Google photos (no double-counting, no extra reason, no flip).
  assertEquals(a.is_servable, true);
  assertEquals(b.is_servable, true);
  assertEquals(a.reasons, []);
  assertEquals(b.reasons, []);
  assertEquals(a.cluster, b.cluster);
});

// ─── 3. Load-bearing revert anchor: exact-string asymmetry ────────────────

Deno.test('ORCH-1067 ADV-04 (revert anchor): exact business_authored skips B7 but a near-miss does NOT — asymmetry breaks if the guard is removed', () => {
  const exact = bounce(noGooglePhotosBase({ fetched_via: 'business_authored' }));
  const nearMiss = bounce(noGooglePhotosBase({ fetched_via: 'business-authored' }));
  // The exact-string row must be servable (B7 skipped) while the near-miss must
  // NOT be (B7 fires). If the B7 guard is reverted, the exact row would STILL
  // fire B7 → exact.is_servable becomes false → this assertion fails.
  assertEquals(exact.is_servable, true, 'exact business_authored must be servable (B7 skipped)');
  assertEquals(nearMiss.is_servable, false, 'near-miss must remain non-servable (B7 fires)');
  assertEquals(exact.reasons.includes('B7:no_google_photos'), false);
  assertEquals(nearMiss.reasons.includes('B7:no_google_photos'), true);
});

// ─── 4. Cross-pass leak probe on a near-miss row ───────────────────────────

Deno.test('ORCH-1067 ADV-05: a near-miss-provenance row gets the FULL unmodified two-pass treatment (B7 both passes; B8 final only)', () => {
  const row = noGooglePhotosBase({
    fetched_via: 'business-authored', // near-miss → must NOT skip B7
    stored_photo_urls: [],            // no stored photos → B8 fires in final
  });
  const final = bounce(row);
  const pre = bounce(row, { skipStoredPhotoCheck: true });

  // B7 fires in BOTH passes (skip never engaged for a near-miss) — parity holds.
  assertEquals(final.reasons.includes('B7:no_google_photos'), true);
  assertEquals(pre.reasons.includes('B7:no_google_photos'), true);

  // B8 is the ONLY cross-pass difference (present in final, absent in pre) —
  // exactly the invariant-allowed delta, unperturbed by the predicate.
  assertEquals(final.reasons.includes('B8:no_stored_photos'), true);
  assertEquals(pre.reasons.includes('B8:no_stored_photos'), false);

  // Symmetric-difference check: the two passes differ ONLY by B8.
  const onlyInFinal = final.reasons.filter((r) => !pre.reasons.includes(r));
  const onlyInPre = pre.reasons.filter((r) => !final.reasons.includes(r));
  assertEquals(onlyInFinal, ['B8:no_stored_photos']);
  assertEquals(onlyInPre, []);
});
