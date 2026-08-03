// ORCH-1292 [public-page-tag-slug-labels] — taxonomyLabel / TAXONOMY_LABELS
// regression (implementor-owned happy-path). Deno-runnable: taxonomyLabels.ts is
// pure + dep-free (no RN imports), mirroring orch_1157_rsvp_momentum.test.ts.
//
// Covers SPEC §7.6a:
//   - Seth's 7 example slugs → their exact canonical labels.
//   - A representative slug per taxonomy (party / vibe / music) → canonical label.
//   - An UNKNOWN slug → Title-Case fallback (every word capitalized), never raw kebab.
//   - Empty string → empty string (no throw).
//   - TAXONOMY_LABELS covers all 49 canonical {slug,label} pairs (verbatim from
//     supabase/functions/_shared/eventTaxonomy.ts; the drift gate
//     orch-1292-taxonomy-label-parity.mjs keeps this list honest against canonical).
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - revert taxonomyLabel to return the raw slug (drop the TAXONOMY_LABELS lookup)
//     → every canonical-label assertion below flips (e.g. "pool-party" !== "Pool Party").
//   - drop/rename any TAXONOMY_LABELS pair → the 49-pair coverage loop fails, and the
//     CI drift gate (orch-1292-taxonomy-label-parity.mjs) fails independently.
//   NOTE (issue #857): MUSIC_GENRES 14 -> 18 (added house/afro-house/amapiano/gospel),
//   so the coverage count is now 49 (15 party + 16 vibe + 18 music).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { TAXONOMY_LABELS, taxonomyLabel } from "../taxonomyLabels.ts";

// ─────────────────────── Seth's 7 example slugs ───────────────────────

Deno.test("Seth's 7 example slugs resolve to their exact canonical labels", () => {
  assertEquals(taxonomyLabel("laid-back"), "Laid-back"); // VIBE
  assertEquals(taxonomyLabel("exclusive"), "Exclusive"); // VIBE
  assertEquals(taxonomyLabel("pool-party"), "Pool Party"); // PARTY
  assertEquals(taxonomyLabel("afrobeats"), "Afrobeats"); // MUSIC
  assertEquals(taxonomyLabel("hiphop-rap"), "Hip-Hop/Rap"); // MUSIC (punctuated)
  assertEquals(taxonomyLabel("pop"), "Pop"); // MUSIC
  assertEquals(taxonomyLabel("rnb-soul"), "R&B/Soul"); // MUSIC (punctuated)
});

// ─────────────────── representative slug per taxonomy ───────────────────

Deno.test("a representative slug from each taxonomy maps to its canonical label", () => {
  // PARTY_TYPES
  assertEquals(taxonomyLabel("pool-party"), "Pool Party");
  assertEquals(taxonomyLabel("rooftop-party"), "Rooftop Party");
  assertEquals(taxonomyLabel("rave"), "Rave");
  // VIBE_TAGS
  assertEquals(taxonomyLabel("laid-back"), "Laid-back");
  assertEquals(taxonomyLabel("energetic"), "Energetic");
  // MUSIC_GENRES (incl. the punctuated ones the humanizer got wrong)
  assertEquals(taxonomyLabel("hiphop-rap"), "Hip-Hop/Rap");
  assertEquals(taxonomyLabel("rnb-soul"), "R&B/Soul");
  assertEquals(taxonomyLabel("electronic-edm"), "Electronic/EDM");
  assertEquals(taxonomyLabel("mixed-variety"), "Mixed/Variety");
});

// ─────────────────────── unknown slug → fallback ───────────────────────

Deno.test("an unknown slug Title-Cases every word (never raw kebab)", () => {
  assertEquals(taxonomyLabel("unknown-future-slug"), "Unknown Future Slug");
  assertEquals(taxonomyLabel("single"), "Single");
  assertEquals(taxonomyLabel("two-words"), "Two Words");
  // the fallback capitalizes EVERY word (not just the first, unlike partyTypeLabel).
  const out = taxonomyLabel("brand-new-vibe");
  assertEquals(out, "Brand New Vibe");
  assert(!out.includes("-"), "fallback must not leave raw kebab hyphens");
});

// ───────────────────────── empty-string edge ─────────────────────────

Deno.test("empty string in → empty string out (no throw)", () => {
  assertEquals(taxonomyLabel(""), "");
});

// ─────────────────── full 49-pair canonical coverage ───────────────────

// Verbatim from supabase/functions/_shared/eventTaxonomy.ts §7.4 (drift-gated).
const CANONICAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // PARTY_TYPES (15)
  ["birthday-party", "Birthday Party"],
  ["rooftop-party", "Rooftop Party"],
  ["club-night", "Club Night"],
  ["house-party", "House Party"],
  ["warehouse-party", "Warehouse Party"],
  ["beach-party", "Beach Party"],
  ["pool-party", "Pool Party"],
  ["boat-party", "Boat Party"],
  ["themed-party", "Themed Party"],
  ["corporate-event", "Corporate Event"],
  ["graduation-party", "Graduation Party"],
  ["holiday-party", "Holiday Party"],
  ["networking-event", "Networking Event"],
  ["rave", "Rave"],
  ["festival", "Festival"],
  // VIBE_TAGS (16)
  ["energetic", "Energetic"],
  ["chill", "Chill"],
  ["intimate", "Intimate"],
  ["wild", "Wild"],
  ["classy", "Classy"],
  ["casual", "Casual"],
  ["upscale", "Upscale"],
  ["underground", "Underground"],
  ["mainstream", "Mainstream"],
  ["artsy", "Artsy"],
  ["social", "Social"],
  ["exclusive", "Exclusive"],
  ["laid-back", "Laid-back"],
  ["vibrant", "Vibrant"],
  ["retro", "Retro"],
  ["futuristic", "Futuristic"],
  // MUSIC_GENRES (18)
  ["electronic-edm", "Electronic/EDM"],
  ["house", "House"],
  ["hiphop-rap", "Hip-Hop/Rap"],
  ["pop", "Pop"],
  ["rock", "Rock"],
  ["latin", "Latin"],
  ["afrobeats", "Afrobeats"],
  ["afro-house", "Afro House"],
  ["amapiano", "Amapiano"],
  ["gospel", "Gospel"],
  ["rnb-soul", "R&B/Soul"],
  ["disco-funk", "Disco/Funk"],
  ["reggae-dancehall", "Reggae/Dancehall"],
  ["indie", "Indie"],
  ["country", "Country"],
  ["jazz", "Jazz"],
  ["classical", "Classical"],
  ["mixed-variety", "Mixed/Variety"],
];

Deno.test("TAXONOMY_LABELS covers all 49 canonical pairs, byte-exact", () => {
  assertEquals(CANONICAL_PAIRS.length, 49);
  assertEquals(Object.keys(TAXONOMY_LABELS).length, 49);
  for (const [slug, label] of CANONICAL_PAIRS) {
    assertEquals(
      TAXONOMY_LABELS[slug],
      label,
      `TAXONOMY_LABELS["${slug}"] must equal "${label}"`,
    );
    // taxonomyLabel() must return the canonical label for every canonical slug
    // (never fall through to the Title-Case fallback for a known slug).
    assertEquals(taxonomyLabel(slug), label);
  }
});

Deno.test("no canonical label is left as raw kebab-case", () => {
  for (const [slug, label] of CANONICAL_PAIRS) {
    if (slug.includes("-")) {
      // a resolved label may legitimately contain a hyphen ("Laid-back"), but it
      // must differ from the raw slug — i.e. it was resolved, not echoed.
      assert(
        taxonomyLabel(slug) !== slug,
        `"${slug}" must resolve to "${label}", not echo the raw slug`,
      );
    }
  }
});
