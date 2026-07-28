// issue #868 [cover-gallery] — TESTER ADVERSARIAL regression (different angle).
//
// The implementor's happy-path (coverGalleryPersist.test.ts) proves independence at
// the TS mapper/service layer. This test attacks a DIFFERENT surface: the actual
// PostgreSQL publish RPCs in the migration files — the code that runs on a real
// production publish. It asserts I-PROPOSED-868-GALLERY-ADDITIVE-INDEPENDENT directly
// against the SQL text:
//
//   (A) Every publish RPC reads cover_media_gallery with a COALESCE default of
//       '[]'::jsonb — NEVER NULL (a NULL would break the array-shape CHECK + readers).
//   (B) The cover-absent null-out branch (`IF v_cover_media_url IS NULL THEN … END IF`)
//       NEVER touches the gallery — a photo gallery survives a cover-less publish
//       (coexists with any cover, incl. a video cover, or NO cover).
//   (C) The experience publish writes the gallery UNCONDITIONALLY — it is NOT gated
//       on v_has_cover (the cover-presence flag). If a regression wrapped the gallery
//       write in `CASE WHEN v_has_cover … ELSE cover_media_gallery END`, a cover-less
//       experience would silently drop its gallery. This test forbids that coupling.
//   (D) Every publish RPC actually persists the gallery in its UPDATE.
//
// FAILS-ON-REVERT: verified by the tester via targeted regressions —
//   • adding `v_cover_media_gallery := NULL;` inside the cover-absent branch → (B) FAILS.
//   • gating the experience gallery write on v_has_cover → (C) FAILS.
//   • replacing the read COALESCE default with NULL → (A) FAILS.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const here = new URL(".", import.meta.url).pathname;
const migDir = `${here}../../../supabase/migrations`;

const writeLayer = Deno.readTextFileSync(
  `${migDir}/20270116000870_issue_868_cover_gallery_write_layer.sql`,
);
const tripExp = Deno.readTextFileSync(
  `${migDir}/20270116000871_issue_868_cover_gallery_trip_exp_publish.sql`,
);
const both = `${writeLayer}\n${tripExp}`;

// (A) Read default is COALESCE(..., '[]'::jsonb) — never NULL. Flat-key RPCs
// (event/rsvp/trip) read p_draft_payload->'cover_media_gallery'; experience reads
// v_cover->'coverGallery'. Together: >= 4 COALESCE-defaulted reads.
Deno.test("(A) every publish RPC reads the gallery with a COALESCE '[]' default (never NULL)", () => {
  const flat =
    both.match(/COALESCE\(\s*p_draft_payload->'cover_media_gallery'\s*,\s*'\[\]'::jsonb\s*\)/g) ??
    [];
  const exp =
    both.match(/COALESCE\(\s*v_cover->'coverGallery'\s*,\s*'\[\]'::jsonb\s*\)/g) ?? [];
  assert(
    flat.length >= 3,
    `expected >=3 flat-key COALESCE-defaulted gallery reads (event/rsvp/trip), got ${flat.length}`,
  );
  assert(
    exp.length >= 1,
    `expected the experience RPC to read v_cover->'coverGallery' with a COALESCE default, got ${exp.length}`,
  );
});

// (B) The cover-absent null-out branch never references the gallery. This is the
// coexistence heart: nulling the cover must not null the gallery.
Deno.test("(B) the cover-absent (IF v_cover_media_url IS NULL) branch NEVER nulls the gallery", () => {
  // Find every `IF v_cover_media_url IS NULL THEN ... END IF;` block across both
  // migrations (event, rsvp, trip = 3 flat-key publish RPCs).
  const re = /IF\s+v_cover_media_url\s+IS\s+NULL\s+THEN([\s\S]*?)END\s+IF;/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(both)) !== null) blocks.push(m[1]);
  assert(
    blocks.length >= 3,
    `expected >=3 cover-absent null branches (event/rsvp/trip), found ${blocks.length}`,
  );
  for (const block of blocks) {
    assert(
      !/gallery/i.test(block),
      "cover-absent branch must NOT touch the gallery (coexistence violated): " +
        block.trim().slice(0, 120),
    );
  }
});

// (C) The experience publish writes the gallery UNCONDITIONALLY — never gated on the
// cover-presence flag v_has_cover. No line may couple the two.
Deno.test("(C) experience publish writes cover_media_gallery independent of v_has_cover", () => {
  // The gallery UPDATE assignment exists…
  assert(
    /cover_media_gallery\s*=\s*v_cover_media_gallery/.test(tripExp),
    "experience/trip publish must assign cover_media_gallery = v_cover_media_gallery",
  );
  // …and NO line couples cover_media_gallery to v_has_cover (which would drop the
  // gallery on a cover-less experience publish). Strip inline SQL comments first —
  // an explanatory `-- … not gated on v_has_cover` note is not a coupling.
  for (const raw of tripExp.split("\n")) {
    const line = raw.replace(/--.*$/, "");
    if (/cover_media_gallery/.test(line) && /v_has_cover/.test(line)) {
      throw new Error(
        "cover_media_gallery must NOT be gated on v_has_cover (independence broken): " +
          line.trim(),
      );
    }
  }
});

// (D) Every publish RPC persists the gallery in its UPDATE. Event/rsvp/trip/exp use
// `= v_cover_media_gallery`; biz_update_live_trip uses the additive CASE.
Deno.test("(D) all publish/live RPCs persist cover_media_gallery in their UPDATE", () => {
  const direct = both.match(/cover_media_gallery\s*=\s*v_cover_media_gallery/g) ?? [];
  assertEquals(
    direct.length >= 4,
    true,
    `expected >=4 direct gallery UPDATE writes (event/rsvp/trip/exp), got ${direct.length}`,
  );
  assert(
    /cover_media_gallery\s*=\s*CASE\s+WHEN\s+p_patch\s*\?\s*'cover_media_gallery'/.test(
      writeLayer,
    ),
    "biz_update_live_trip must persist the gallery via its additive CASE",
  );
});
