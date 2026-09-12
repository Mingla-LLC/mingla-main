/**
 * Issue #3280 [cover sheet stale state] — implementor happy-path regression:
 * "Add photo" was a dead tap for the whole life of a cover-video job.
 *
 * Two stacked blocks, both on the GALLERY path:
 *   1. `activeVideoUpload` in the `addGalleryPhoto` guard and the
 *      `AdditionalPhotosSection` `disabled` prop — an accidental copy of the
 *      COVER-path guard (evidence on the issue: the gallery's own comment says
 *      it is "Independent of the primary cover — does NOT touch it", no issue
 *      number or rationale, and the gallery shares no transport, lock or row
 *      with the Bunny/TUS video job).
 *   2. The picker-wide `uploading` flag in the same two sites. The THIS-SESSION
 *      case is the one that matters: `pickVideoCover` sets `uploading`, then
 *      awaits `videoUpload.start`, which awaits the watch — so `uploading` is
 *      true for the entire "Processing video…" window in the sheet that picked
 *      the video. A first fix that removed only (1) still left the tile blocked,
 *      now dimmed, with a hint claiming a photo was uploading. It passed a
 *      test that checked only that `activeVideoUpload` was gone.
 *
 * Two layers, the convention this directory already uses:
 *   1. REAL LOGIC — `coverPickerGalleryGate` is imported and exercised for real.
 *      CoverPicker.tsx pulls in expo-video / expo-image-picker /
 *      react-native-video-trim and cannot be mounted under jest (documented in
 *      `CoverPicker.selectedState.test.ts` and
 *      `coverPickerElapsed.issue3173.test.tsx`).
 *   2. SOURCE WIRING — which flag each call site actually passes, asserted
 *      against the source. Each assertion fails on reintroducing either block.
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
const gateSource = readFileSync(join(UI, "coverPickerGalleryGate.ts"), "utf8");

/** Source with whole-line `//` comments removed, so prose cannot satisfy or trip a check. */
const executable = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

/** A `useCallback` body, from its declaration to the next named declaration. */
const callbackBody = (name: string, nextName: string): string => {
  const start = coverPickerSource.indexOf(`const ${name} = useCallback(`);
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf(`const ${nextName} = useCallback(`, start);
  expect(end).toBeGreaterThan(start);
  return executable(coverPickerSource.slice(start, end));
};

/** The `<AdditionalPhotosSection …/>` element in the render tree. */
const additionalPhotosSectionElement = (): string => {
  const start = coverPickerSource.indexOf("<AdditionalPhotosSection");
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf("/>", start);
  expect(end).toBeGreaterThan(start);
  return executable(coverPickerSource.slice(start, end));
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

/** The argument object of every call to `fn` in the executable source. */
const gateCallArguments = (fn: string): string[] => {
  const source = executable(coverPickerSource);
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${fn}({`, from);
    if (at === -1) break;
    const close = source.indexOf("})", at);
    expect(close).toBeGreaterThan(at);
    found.push(source.slice(at + fn.length + 1, close + 1));
    from = close;
  }
  return found;
};

/** A bare identifier match — `galleryUploading` does NOT contain `\buploading\b`. */
const PICKER_WIDE_UPLOADING = /\buploading\b/;

describe("issue #3280 gallery add gate (real logic)", () => {
  test("adding a photo is allowed when only the gallery's own state is clear", () => {
    expect(canAddGalleryPhoto({ galleryUploading: false, disabled: false, atCap: false })).toBe(true);
  });

  test("the gate's input is the gallery's own state — no video field and no picker-wide upload flag", () => {
    const typeStart = gateSource.indexOf("export type GalleryAddState = {");
    expect(typeStart).toBeGreaterThan(-1);
    const typeBody = gateSource.slice(typeStart, gateSource.indexOf("};", typeStart));
    const fields = [...typeBody.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort();
    expect(fields).toEqual(["atCap", "disabled", "galleryUploading"]);
    expect(fields).not.toContain("uploading");
    const fieldLines = executable(typeBody)
      .split("\n")
      .filter((line) => /^\s{2}\w+:/.test(line))
      .join("\n")
      .toLowerCase();
    expect(fieldLines).not.toMatch(/video|stage|phase|processing/);
  });

  test("each legitimate block refuses the add and names itself in a readable sentence", () => {
    const cases: { state: Parameters<typeof canAddGalleryPhoto>[0]; label: string }[] = [
      { state: { galleryUploading: true, disabled: false, atCap: false }, label: "galleryUploading" },
      { state: { galleryUploading: false, disabled: true, atCap: false }, label: "disabled" },
      { state: { galleryUploading: false, disabled: false, atCap: true }, label: "atCap" },
    ];
    const reasons = new Set<string>();
    for (const { state, label } of cases) {
      expect(canAddGalleryPhoto(state)).toBe(false);
      const reason = galleryAddBlockedReason(state);
      expect(typeof reason).toBe("string");
      expect(reason).toMatch(/^[A-Z].*\.$/);
      expect(reason).not.toContain(label);
      reasons.add(reason ?? "");
    }
    // Three different states, three different explanations.
    expect(reasons.size).toBe(3);
  });

  test("the gallery-uploading reason is about a photo upload, and only that state says so", () => {
    const uploadingReason = galleryAddBlockedReason({ galleryUploading: true, disabled: false, atCap: false });
    expect(uploadingReason).toMatch(/photo/i);
    expect(uploadingReason).toMatch(/upload/i);
    expect(uploadingReason).not.toMatch(/video/i);
    for (const other of [
      galleryAddBlockedReason({ galleryUploading: false, disabled: true, atCap: false }),
      galleryAddBlockedReason({ galleryUploading: false, disabled: false, atCap: true }),
    ]) {
      expect(other).not.toMatch(/upload/i);
    }
  });

  test("an available add tile has no blocked reason", () => {
    expect(
      galleryAddBlockedReason({ galleryUploading: false, disabled: false, atCap: false }),
    ).toBeNull();
  });
});

describe("issue #3280 gallery add gate (source wiring: the same-session case)", () => {
  test("the gallery has its own in-flight flag", () => {
    expect(coverPickerSource).toContain(
      "const [galleryUploading, setGalleryUploading] = useState(false);",
    );
  });

  test("every gate call passes the gallery flag — never the picker-wide `uploading`, never `activeVideoUpload`", () => {
    const calls = [
      ...gateCallArguments("canAddGalleryPhoto"),
      ...gateCallArguments("galleryAddBlockedReason"),
    ];
    // addGalleryPhoto guard + the section's disabled prop + its reason.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const args of calls) {
      expect(args).toContain("galleryUploading");
      expect(args).not.toMatch(PICKER_WIDE_UPLOADING);
      expect(args).not.toContain("activeVideoUpload");
    }
  });

  test("addGalleryPhoto gates on the gallery flag and owns it, and never touches the picker-wide flag", () => {
    const body = callbackBody("addGalleryPhoto", "moveGalleryItem");
    expect(body).toContain("canAddGalleryPhoto({ galleryUploading, disabled, atCap })");
    expect(body).not.toContain("activeVideoUpload");
    expect(body).toContain("setGalleryUploading(true);");
    expect(body).toContain("setGalleryUploading(false);");
    expect(body).not.toContain("setUploading(");
    // Its early-return guard reads no picker-wide flag either.
    const guardLine = body.split("\n").find((line) => line.includes("canAddGalleryPhoto("));
    expect(guardLine).toBeDefined();
    expect(guardLine).not.toMatch(PICKER_WIDE_UPLOADING);
  });

  test("the AdditionalPhotosSection disabled prop reads the gallery flag only", () => {
    const element = additionalPhotosSectionElement();
    expect(element).toContain("disabled={!canAddGalleryPhoto({ galleryUploading, disabled, atCap: false })}");
    expect(element).toContain("addBlockedReason={galleryAddBlockedReason({ galleryUploading, disabled, atCap: false })}");
    expect(element).not.toContain("activeVideoUpload");
    expect(element).not.toMatch(PICKER_WIDE_UPLOADING);
  });

  test("the video flow holds the picker-wide flag and never touches the gallery flag", () => {
    const body = callbackBody("pickVideoCover", "cancelVideoCoverUpload");
    // This is WHY the gallery cannot share `uploading`: the video flow sets it
    // and awaits the upload (and its watch) before clearing it.
    expect(body).toContain("setUploading(true);");
    expect(body).toContain("await videoUpload.start(uploadFile);");
    expect(body).toContain("setUploading(false);");
    expect(body).not.toContain("setGalleryUploading(");
  });

  test("cover actions treat an in-flight gallery upload as busy", () => {
    expect(callbackBody("pickImageOrGifCover", "pickVideoCover")).toContain(
      "if (uploading || galleryUploading || disabled || activeVideoUpload) return;",
    );
    expect(callbackBody("pickVideoCover", "cancelVideoCoverUpload")).toMatch(
      /if \(uploading \|\| galleryUploading \|\| disabled \|\|/,
    );
    expect(callbackBody("retryVideoCoverUpload", "loadTrending")).toContain("galleryUploading");
    // The Image / Video / Remove / retry buttons get the merged busy flag.
    expect(executable(coverPickerSource)).toContain("uploading={uploading || galleryUploading}");
  });

  test("a cover emit updates the cover ref before a gallery commit can re-emit it", () => {
    const body = callbackBody("emitChange", "persistReadyVideo");
    const refSync = body.indexOf("localCoverRef.current = patch;");
    const stateSet = body.indexOf("setLocalCover(patch);");
    const parentEmit = body.indexOf("await onCoverChange(");
    expect(refSync).toBeGreaterThan(-1);
    expect(stateSet).toBeGreaterThan(refSync);
    expect(parentEmit).toBeGreaterThan(stateSet);
  });

  test("the add tile carries a disabled visual in its style array", () => {
    const pressable = addPhotoPressable();
    expect(pressable).toContain("styles.galleryAddTile,");
    expect(pressable).toContain("disabled && styles.galleryAddTileDisabled,");
    const styleIndex = coverPickerSource.indexOf("galleryAddTileDisabled: {");
    expect(styleIndex).toBeGreaterThan(-1);
    const styleBody = coverPickerSource.slice(styleIndex, coverPickerSource.indexOf("}", styleIndex));
    const opacity = /opacity:\s*([0-9.]+)/.exec(styleBody);
    expect(opacity).not.toBeNull();
    expect(Number(opacity?.[1])).toBeLessThan(1);
  });

  test("the add tile carries a non-empty accessibilityHint in every state", () => {
    const pressable = addPhotoPressable();
    expect(pressable).toContain("accessibilityState={{ disabled }}");
    const hintStart = pressable.indexOf("accessibilityHint=");
    expect(hintStart).toBeGreaterThan(-1);
    const hintBlock = pressable.slice(hintStart, pressable.indexOf("accessibilityState=", hintStart));
    expect(hintBlock).toContain("addBlockedReason");
    const quoted = hintBlock.match(/"[^"]{8,}"/g) ?? [];
    expect(quoted.length).toBeGreaterThanOrEqual(2);
  });
});
