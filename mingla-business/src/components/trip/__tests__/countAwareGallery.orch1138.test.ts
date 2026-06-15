/**
 * T-5 / T-6 — CountAwareGallery layout selection (ORCH-1138 A2).
 *
 * The count-aware gallery picks 1=full / 2=split / 3+=slider, and renders
 * NOTHING for an empty media list (Constitution #9 — no empty frame). The pure
 * selector lives in @mingla/offering-rendering/galleryLayout (RN-free) so it is
 * unit-testable without mounting React Native.
 *
 * fails-on-revert: changing the count thresholds (e.g. making 2 → "slider")
 * flips T-5; making 0 → "one" flips T-6. Owner: mingla-implementor.
 *
 * Imported by relative path — galleryLayout.ts has zero RN/runtime imports, so
 * it resolves under the node/ts-jest config without the @mingla path alias.
 */

import { describe, expect, test } from "@jest/globals";

import { pickGalleryLayout } from "../../../../../packages/offering-rendering/galleryLayout";

describe("T-5 ORCH-1138 — count-aware gallery layout", () => {
  test("1 item → full-width", () => {
    expect(pickGalleryLayout(1)).toBe("one");
  });
  test("2 items → split", () => {
    expect(pickGalleryLayout(2)).toBe("two");
  });
  test("3 items → slider", () => {
    expect(pickGalleryLayout(3)).toBe("slider");
  });
  test("5 items → slider", () => {
    expect(pickGalleryLayout(5)).toBe("slider");
  });
});

describe("T-6 ORCH-1138 — empty gallery renders nothing", () => {
  test("0 items → none (zero nodes)", () => {
    expect(pickGalleryLayout(0)).toBe("none");
  });
  test("negative/garbage count → none (never fabricates a tile)", () => {
    expect(pickGalleryLayout(-1)).toBe("none");
  });
});
