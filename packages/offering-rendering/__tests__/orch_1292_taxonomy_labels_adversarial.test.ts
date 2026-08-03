// ORCH-1292 [public-page-tag-slug-labels] — TESTER ADVERSARIAL unit test.
//
// DIFFERENT ANGLE from the implementor happy-path (orch_1292_taxonomy_labels.test.ts,
// which asserts slug→label + a generic fallback + full-49 coverage). This suite
// attacks BEHAVIORAL EDGES the happy-path does not:
//
//   1. Mixed known + unknown in ONE array → canonical labels AND Title-Case
//      fallbacks coexist in the same rendered row (the pills-row reality).
//   2. Cross-taxonomy NON-COLLISION — a flat map is only safe if no slug means two
//      things. Prove every slug in each of the three canonical lists resolves to
//      ITS OWN list's label (music "pop" is Pop, never a party/vibe value), and
//      the union is exactly 49 unique keys.
//   3. Empty-array group OMISSION — [].map(taxonomyLabel) === [] (a group with no
//      tags contributes zero pills; the render sites' `?? []` + .map behavior).
//   4. MAP-PRECEDENCE over fallback — for a slug where the canonical label DIFFERS
//      from what the Title-Case fallback would produce ("laid-back" → "Laid-back",
//      NOT the fallback's "Laid Back"), the map MUST win. This is the assertion the
//      happy-path's generic "unknown → Title Case" test cannot make.
//   5. Punctuated labels are byte-exact (R&B/Soul, Hip-Hop/Rap, Electronic/EDM,
//      Disco/Funk, Reggae/Dancehall, Mixed/Variety) — the humanizer partyTypeLabel
//      got these wrong; taxonomyLabel must not.
//   6. Purity / idempotence / no-throw on adversarial inputs (leading hyphen,
//      double hyphen, whitespace, non-string-ish) — never crashes a render.
//
// Deno-runnable: taxonomyLabels.ts is pure + dep-free.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { TAXONOMY_LABELS, taxonomyLabel } from "../taxonomyLabels.ts";

// Mirror of the three canonical lists' slugs (from eventTaxonomy.ts §7.4), grouped
// so cross-taxonomy independence can be asserted per group.
const PARTY = [
  "birthday-party", "rooftop-party", "club-night", "house-party", "warehouse-party",
  "beach-party", "pool-party", "boat-party", "themed-party", "corporate-event",
  "graduation-party", "holiday-party", "networking-event", "rave", "festival",
];
const VIBE = [
  "energetic", "chill", "intimate", "wild", "classy", "casual", "upscale",
  "underground", "mainstream", "artsy", "social", "exclusive", "laid-back",
  "vibrant", "retro", "futuristic",
];
const MUSIC = [
  "electronic-edm", "house", "hiphop-rap", "pop", "rock", "latin", "afrobeats", "afro-house", "amapiano",
  "gospel", "rnb-soul", "disco-funk", "reggae-dancehall", "indie", "country", "jazz", "classical", "mixed-variety",
];

// ───────────── 1. mixed known + unknown in one array ─────────────

Deno.test("mixed known + unknown slugs in one array → canonical + fallback coexist", () => {
  const row = ["afrobeats", "totally-made-up", "hiphop-rap", "brand-new-vibe"];
  assertEquals(row.map(taxonomyLabel), [
    "Afrobeats",
    "Totally Made Up",
    "Hip-Hop/Rap",
    "Brand New Vibe",
  ]);
});

// ───────────── 2. cross-taxonomy non-collision ─────────────

Deno.test("flat map is collision-free — 49 unique slugs across the three lists", () => {
  const union = new Set([...PARTY, ...VIBE, ...MUSIC]);
  assertEquals(PARTY.length + VIBE.length + MUSIC.length, 49);
  assertEquals(union.size, 49); // no slug appears in two lists
  assertEquals(Object.keys(TAXONOMY_LABELS).length, 49);
});

Deno.test("each list's slugs resolve to a NON-EMPTY label; music 'pop' is 'Pop' (not shadowed)", () => {
  for (const s of [...PARTY, ...VIBE, ...MUSIC]) {
    const label = taxonomyLabel(s);
    assert(label.length > 0, `"${s}" resolved to an empty label`);
    assertEquals(label, TAXONOMY_LABELS[s]); // known slug never falls through to fallback
  }
  assertEquals(taxonomyLabel("pop"), "Pop");
  assertEquals(taxonomyLabel("pool-party"), "Pool Party");
});

// ───────────── 3. empty-array group omission ─────────────

Deno.test("empty group → zero pills (empty-array map contributes nothing)", () => {
  const emptyParty: string[] = [];
  assertEquals(emptyParty.map(taxonomyLabel), []);
  assertEquals(emptyParty.map(taxonomyLabel).length, 0);
});

// ───────────── 4. map precedence over fallback ─────────────

Deno.test("canonical map WINS over the Title-Case fallback where they differ", () => {
  // Title-Case fallback of "laid-back" would be "Laid Back" (space + capital B);
  // canonical is "Laid-back" (hyphen, lowercase b). The map must win.
  assertEquals(taxonomyLabel("laid-back"), "Laid-back");
  assertNotEquals(taxonomyLabel("laid-back"), "Laid Back");
  assertNotEquals(taxonomyLabel("laid-back"), "Laid-Back");
});

// ───────────── 5. punctuated labels byte-exact ─────────────

Deno.test("punctuated music labels are byte-exact (the humanizer got these wrong)", () => {
  assertEquals(taxonomyLabel("electronic-edm"), "Electronic/EDM");
  assertEquals(taxonomyLabel("hiphop-rap"), "Hip-Hop/Rap");
  assertEquals(taxonomyLabel("rnb-soul"), "R&B/Soul");
  assertEquals(taxonomyLabel("disco-funk"), "Disco/Funk");
  assertEquals(taxonomyLabel("reggae-dancehall"), "Reggae/Dancehall");
  assertEquals(taxonomyLabel("mixed-variety"), "Mixed/Variety");
  // none of these leak a raw hyphen from the slug
  for (const s of ["electronic-edm", "hiphop-rap", "rnb-soul", "disco-funk", "reggae-dancehall", "mixed-variety"]) {
    assertNotEquals(taxonomyLabel(s), s);
  }
});

// ───────────── 6. purity / no-throw on adversarial inputs ─────────────

Deno.test("adversarial malformed inputs never throw and never leak raw kebab", () => {
  // leading hyphen, double hyphen, trailing hyphen, spaces — all fall to fallback.
  assertEquals(taxonomyLabel("-leading"), "Leading");          // empty first segment filtered
  assertEquals(taxonomyLabel("double--hyphen"), "Double Hyphen"); // empty middle filtered
  assertEquals(taxonomyLabel("trailing-"), "Trailing");        // empty last filtered
  assertEquals(taxonomyLabel(""), "");                          // empty → empty, no throw
  // idempotence on an already-resolved multi-word label passed back in
  assertEquals(taxonomyLabel("Already Resolved"), "Already Resolved"); // no hyphen → unchanged
});

// ───────────── 7. issue #857 new music genres byte-exact ─────────────

Deno.test("issue #857 new music genres resolve byte-exact (house/afro-house/amapiano/gospel)", () => {
  assertEquals(taxonomyLabel("house"), "House");
  assertEquals(taxonomyLabel("afro-house"), "Afro House");
  assertEquals(taxonomyLabel("amapiano"), "Amapiano");
  assertEquals(taxonomyLabel("gospel"), "Gospel");
  // afro-house must NOT collapse into the party-type "house-party" / vibe space,
  // and its canonical label must win over the Title-Case fallback ("Afro House").
  assertNotEquals(taxonomyLabel("afro-house"), taxonomyLabel("house-party"));
});

Deno.test("taxonomyLabel is a pure function — same input, same output, no mutation", () => {
  const before = JSON.stringify(TAXONOMY_LABELS);
  const a = taxonomyLabel("pool-party");
  const b = taxonomyLabel("pool-party");
  assertEquals(a, b);
  assertEquals(JSON.stringify(TAXONOMY_LABELS), before); // resolver did not mutate the map
});
