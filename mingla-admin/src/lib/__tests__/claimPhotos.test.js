// META-ORCH-1062 Phase 1 — regression test for the admin claim-review photo
// gallery merge. The old ClaimsPage rendered ONLY the single cover_media_url as
// a text link "Open image" — the 5–20 venue gallery + the deck stored photos
// were not shown at all, so an admin could not vet the venue's photos (defect
// 1062-D). collectClaimPhotos merges cover + stored_photo_urls +
// business_gallery_urls into one deduped, ordered, falsy-filtered list for the
// inline gallery + PhotoLightbox.
//
// fails-on-revert: revert collectClaimPhotos to `return coverUrl ? [coverUrl] : []`
// (the old cover-only behavior) and the "merges all three sources" assertion FAILS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { collectClaimPhotos } from "../claimPhotos.js";

test("META-ORCH-1062: merges cover + stored + gallery (the old code showed cover only)", () => {
  const bundle = {
    place_pool: {
      stored_photo_urls: ["s1", "s2"],
      business_gallery_urls: ["g1", "g2", "g3"],
    },
  };
  const out = collectClaimPhotos(bundle, "cover");
  assert.deepEqual(out, ["cover", "s1", "s2", "g1", "g2", "g3"]);
  assert.equal(out.length, 6, "must include all three sources, not just the cover");
});

test("META-ORCH-1062: dedupes while preserving first-seen order", () => {
  const bundle = {
    place_pool: {
      stored_photo_urls: ["a", "b"],
      business_gallery_urls: ["b", "c", "a"],
    },
  };
  assert.deepEqual(collectClaimPhotos(bundle, "a"), ["a", "b", "c"]);
});

test("META-ORCH-1062: drops null/empty/non-string entries", () => {
  const bundle = {
    place_pool: {
      stored_photo_urls: ["s1", "", null, 42],
      business_gallery_urls: undefined,
    },
  };
  assert.deepEqual(collectClaimPhotos(bundle, null), ["s1"]);
});

test("META-ORCH-1062: zero photos → empty array (empty-state path)", () => {
  assert.deepEqual(collectClaimPhotos(null, null), []);
  assert.deepEqual(collectClaimPhotos({ place_pool: null }, ""), []);
});
