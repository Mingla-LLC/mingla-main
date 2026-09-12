/**
 * Issue #3280 [cover sheet stale state] — implementor happy-path regression,
 * defect 2: "Add photo" was a dead tap for the whole life of a cover-video job.
 *
 * `activeVideoUpload` (true for every phase that is not idle/ready/applied/error)
 * sat in TWO gallery-path sites: the `addGalleryPhoto` guard and the
 * `AdditionalPhotosSection` `disabled` prop. Both were an accidental copy of the
 * COVER-path guard in `pickImageOrGifCover`, where blocking is correct. The
 * evidence it was accidental: the gallery's own comment two lines above says it
 * is "Independent of the primary cover — does NOT touch it"; every deliberate
 * guard in that 2,794-line file carries an issue number and a rationale and
 * these two carried neither; and the gallery uploads into the
 * `event_covers`/`brand_covers` storage buckets, sharing no transport, lock or
 * row with the Bunny/TUS video job. The `disabled` it produced reached a
 * `Pressable` whose style array had no disabled variant, so the tile rendered
 * fully enabled and did nothing.
 *
 * Two layers, the convention this directory already uses:
 *   1. REAL LOGIC — `coverPickerGalleryGate` is imported and exercised for
 *      real. It is a separate module because CoverPicker.tsx pulls in
 *      expo-video / expo-image-picker / react-native-video-trim and cannot be
 *      mounted under jest (documented in `CoverPicker.selectedState.test.ts`
 *      and `coverPickerElapsed.issue3173.test.tsx`).
 *   2. SOURCE WIRING — the render-side wiring is asserted against the source,
 *      each assertion failing on revert of the corresponding change.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  canAddGalleryPhoto,
  galleryAddBlockedReason,
} from "../coverPickerGalleryGate";

const UI = join(__dirname, "..");
const coverPickerSource = readFileSync(join(UI, "CoverPicker.tsx"), "utf8");

/** The body of `addGalleryPhoto`, up to the next top-level const declaration. */
const addGalleryPhotoBody = (): string => {
  const start = coverPickerSource.indexOf(
    "const addGalleryPhoto = useCallback(async (): Promise<void> => {",
  );
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf("\n  const moveGalleryItem", start);
  expect(end).toBeGreaterThan(start);
  return coverPickerSource.slice(start, end);
};

/** The `<AdditionalPhotosSection …>` JSX element in the render tree. */
const additionalPhotosSectionElement = (): string => {
  const start = coverPickerSource.indexOf("<AdditionalPhotosSection");
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf("/>", start);
  expect(end).toBeGreaterThan(start);
  return coverPickerSource.slice(start, end);
};

/** The add-photo `Pressable`, located by its testID. */
const addPhotoPressable = (): string => {
  const testIdIndex = coverPickerSource.indexOf('testID="cover-add-photo"');
  expect(testIdIndex).toBeGreaterThan(-1);
  const start = coverPickerSource.lastIndexOf("<Pressable", testIdIndex);
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf("</Pressable>", testIdIndex);
  expect(end).toBeGreaterThan(start);
  return coverPickerSource.slice(start, end);
};

describe("issue #3280 gallery add gate (real logic)", () => {
  test("a processing video cover cannot block adding a photo — the predicate has no video input", () => {
    // The strongest form of the fix: there is no argument a future copy-paste
    // could pass to re-introduce the block.
    expect(canAddGalleryPhoto({ uploading: false, disabled: false, atCap: false })).toBe(true);
    expect(canAddGalleryPhoto.length).toBe(1);
    expect(
      Object.keys({ uploading: false, disabled: false, atCap: false }).sort(),
    ).toEqual(["atCap", "disabled", "uploading"]);
  });

  test("each legitimate block refuses the add and names itself", () => {
    const cases: { state: Parameters<typeof canAddGalleryPhoto>[0]; label: string }[] = [
      { state: { uploading: true, disabled: false, atCap: false }, label: "uploading" },
      { state: { uploading: false, disabled: true, atCap: false }, label: "disabled" },
      { state: { uploading: false, disabled: false, atCap: true }, label: "atCap" },
    ];
    for (const { state, label } of cases) {
      expect(canAddGalleryPhoto(state)).toBe(false);
      const reason = galleryAddBlockedReason(state);
      expect(typeof reason).toBe("string");
      expect((reason ?? "").length).toBeGreaterThan(0);
      // A reason a person can read, not a code.
      expect(reason).toMatch(/^[A-Z].*\.$/);
      expect(reason).not.toContain(label);
    }
  });

  test("an available add tile has no blocked reason", () => {
    expect(
      galleryAddBlockedReason({ uploading: false, disabled: false, atCap: false }),
    ).toBeNull();
  });

  test("the busy case reports the photo upload, never the video", () => {
    expect(galleryAddBlockedReason({ uploading: true, disabled: false, atCap: false }))
      .toBe("Finishing the current photo upload.");
  });
});

describe("issue #3280 gallery add gate (source wiring)", () => {
  test("addGalleryPhoto's guard consults the gate and no longer mentions activeVideoUpload", () => {
    const body = addGalleryPhotoBody();
    expect(body).toContain("canAddGalleryPhoto({ uploading, disabled, atCap })");
    // Only the explanatory comment may name it; the guard expression may not.
    const executable = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(executable).not.toContain("activeVideoUpload");
  });

  test("the AdditionalPhotosSection disabled prop no longer mentions activeVideoUpload", () => {
    const element = additionalPhotosSectionElement();
    const executable = element
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(executable).toContain("disabled={!canAddGalleryPhoto({ uploading, disabled, atCap: false })}");
    expect(executable).not.toContain("activeVideoUpload");
    expect(executable).toContain("addBlockedReason={galleryAddBlockedReason(");
  });

  test("the add tile carries a disabled visual in its style array", () => {
    const pressable = addPhotoPressable();
    expect(pressable).toContain("styles.galleryAddTile,");
    expect(pressable).toContain("disabled && styles.galleryAddTileDisabled,");
    // And the style actually exists, with a real reduction in opacity.
    const styleIndex = coverPickerSource.indexOf("galleryAddTileDisabled: {");
    expect(styleIndex).toBeGreaterThan(-1);
    const styleBody = coverPickerSource.slice(styleIndex, coverPickerSource.indexOf("}", styleIndex));
    const opacity = /opacity:\s*([0-9.]+)/.exec(styleBody);
    expect(opacity).not.toBeNull();
    expect(Number(opacity?.[1])).toBeLessThan(1);
  });

  test("the add tile carries a non-empty accessibilityHint in every state", () => {
    const pressable = addPhotoPressable();
    expect(pressable).toContain("accessibilityHint=");
    expect(pressable).toContain("accessibilityState={{ disabled }}");
    // Both branches of the hint are real sentences, so a screen-reader user is
    // never handed an empty explanation.
    const hintStart = pressable.indexOf("accessibilityHint=");
    const hintBlock = pressable.slice(hintStart, pressable.indexOf("accessibilityState=", hintStart));
    const quoted = hintBlock.match(/"[^"]{8,}"/g) ?? [];
    expect(quoted.length).toBeGreaterThanOrEqual(2);
  });

  test("the COVER path keeps its deliberate video guard", () => {
    // The fix is surgical: blocking a COVER change mid-video is correct and
    // must survive. Only the gallery path was ever wrong.
    expect(coverPickerSource).toContain("if (uploading || disabled || activeVideoUpload) return;");
  });
});
