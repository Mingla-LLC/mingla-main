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
  canMakeGalleryPhotoCover,
  galleryAddBlockedReason,
  galleryMakeCoverBlockedReason,
  type GalleryMakeCoverState,
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
    // [TEST-MOD-APPROVED #3485] This used to pin the literal one-line guard
    //   `if (uploading || galleryUploading || disabled || (lockedVideoOperation …)) return;`
    // — and #3485 proved that line wrong, so the assertion was pinning the
    // defect. `uploading` is not "a picker is open": `pickVideoCover` sets it and
    // then awaits `videoUpload.start`, which awaits the processing watch, so the
    // flag is held for the WHOLE job. Replace -> "Choose replacement" was
    // therefore a dead tap for exactly the 32-minute provider stall a host needs
    // to escape (filmed on a Release build 2026-09-20). The busy rule moved into
    // the pure `videoPickRefusal`, which lets a REPLACE past an in-flight
    // upload/encode and still blocks a second picker launch.
    //
    // #3280's own contract is unchanged and is what is asserted now: the VIDEO
    // pick still treats an in-flight gallery upload as cover-busy, and still
    // reads the picker-wide flag — they are just passed to the gate as named
    // inputs instead of OR-ed into one silent return.
    const videoGuard = callbackBody("pickVideoCover", "cancelVideoCoverUpload");
    expect(videoGuard).toContain("videoPickRefusal({");
    expect(videoGuard).toContain("galleryUploading,");
    expect(videoGuard).toContain("coverUploading: uploading,");
    expect(callbackBody("retryVideoCoverUpload", "loadTrending")).toContain("galleryUploading");
    // The Image / Video / Remove / retry buttons get the merged busy flag.
    expect(executable(coverPickerSource)).toContain("uploading={uploading || galleryUploading}");
  });

  test("a cover emit updates the cover ref before a gallery commit can re-emit it", () => {
    // [TEST-MOD-APPROVED #3318] the ordering moved, unchanged, into
    // `emitCoverWithGallery` in `coverPickerGalleryAdd.ts` (so #3318 T3 can run
    // it for real); `emitChange` delegates with the picker's own refs. Same
    // three steps, same order.
    expect(callbackBody("emitChange", "persistReadyVideo")).toContain(
      "await emitCoverWithGallery(patch, emitRefs, setLocalCover, onCoverChange);",
    );
    expect(coverPickerSource).toContain("() => ({ cover: localCoverRef, gallery: galleryRef }),");
    const moduleSource = readFileSync(join(UI, "coverPickerGalleryAdd.ts"), "utf8");
    const start = moduleSource.indexOf("export const emitCoverWithGallery = async");
    expect(start).toBeGreaterThan(-1);
    const body = executable(moduleSource.slice(start, moduleSource.indexOf("\n};", start)));
    const refSync = body.indexOf("refs.cover.current = patch;");
    const stateSet = body.indexOf("setCover(patch);");
    const parentEmit = body.indexOf("await onCoverChange({ ...patch, coverGallery: refs.gallery.current });");
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

/*
 * Issue #3280 — the regression the gallery unblock introduced, and its fix.
 *
 * "Make cover" lives INSIDE Additional photos but is a COVER action: it emits
 * the photo as the primary cover. It used the section's single `disabled` prop,
 * so when the video block left that prop, Make cover went live during a cover
 * video job. The job then finishes — the server auto-applies the video for a
 * `draft_auto` event, and the client's ready-emit writes it — and the host's
 * chosen photo is silently replaced. Make cover must keep the picker's
 * `lockedVideoOperation`; Add / Move / Remove must not gain it.
 */

const MAKE_COVER_CLEAR: GalleryMakeCoverState = {
  disabled: false,
  coverUploading: false,
  galleryUploading: false,
  videoLocked: false,
};

/** The `AdditionalPhotosSection` component definition, comments stripped. */
const additionalPhotosSectionSource = (): string => {
  const start = coverPickerSource.indexOf("const AdditionalPhotosSection: React.FC<{");
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf("const GalleryMenuItem: React.FC<{", start);
  expect(end).toBeGreaterThan(start);
  return executable(coverPickerSource.slice(start, end));
};

/** One `<GalleryMenuItem …/>` element inside the section, located by its label. */
const galleryMenuItemElement = (label: string): string => {
  const section = additionalPhotosSectionSource();
  const labelAt = section.indexOf(`label="${label}"`);
  expect(labelAt).toBeGreaterThan(-1);
  const start = section.lastIndexOf("<GalleryMenuItem", labelAt);
  expect(start).toBeGreaterThan(-1);
  const end = section.indexOf("/>", labelAt);
  expect(end).toBeGreaterThan(labelAt);
  return section.slice(start, end);
};

describe("issue #3280 Make cover keeps the cover video lock (real logic)", () => {
  test("Make cover is allowed only when nothing owns the cover, and then has no reason", () => {
    expect(canMakeGalleryPhotoCover(MAKE_COVER_CLEAR)).toBe(true);
    expect(galleryMakeCoverBlockedReason(MAKE_COVER_CLEAR)).toBeNull();
  });

  test("an active cover video operation locks Make cover, and the reason names the video", () => {
    const locked = { ...MAKE_COVER_CLEAR, videoLocked: true };
    expect(canMakeGalleryPhotoCover(locked)).toBe(false);
    const reason = galleryMakeCoverBlockedReason(locked);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/video/i);
    // The session that picked the video also holds the cover-upload flag for
    // the whole processing window; the video is still the true reason there.
    const sameSession = { ...locked, coverUploading: true };
    expect(canMakeGalleryPhotoCover(sameSession)).toBe(false);
    expect(galleryMakeCoverBlockedReason(sameSession)).toBe(reason);
  });

  test("a cover upload in flight locks Make cover with a cover-upload reason", () => {
    const uploading = { ...MAKE_COVER_CLEAR, coverUploading: true };
    expect(canMakeGalleryPhotoCover(uploading)).toBe(false);
    const reason = galleryMakeCoverBlockedReason(uploading);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/cover/i);
    expect(reason).toMatch(/upload/i);
    expect(reason).not.toMatch(/video/i);
  });

  test("a host lock and a gallery upload each lock Make cover with their own true reason", () => {
    const hostLocked = { ...MAKE_COVER_CLEAR, disabled: true };
    expect(canMakeGalleryPhotoCover(hostLocked)).toBe(false);
    expect(galleryMakeCoverBlockedReason(hostLocked)).not.toBeNull();
    expect(galleryMakeCoverBlockedReason(hostLocked)).not.toMatch(/video|upload/i);

    const galleryBusy = { ...MAKE_COVER_CLEAR, galleryUploading: true };
    expect(canMakeGalleryPhotoCover(galleryBusy)).toBe(false);
    expect(galleryMakeCoverBlockedReason(galleryBusy)).toMatch(/photo/i);
    expect(galleryMakeCoverBlockedReason(galleryBusy)).not.toMatch(/video/i);

    const reasons = new Set(
      [
        { ...MAKE_COVER_CLEAR, videoLocked: true },
        { ...MAKE_COVER_CLEAR, coverUploading: true },
        galleryBusy,
        hostLocked,
      ].map((state) => galleryMakeCoverBlockedReason(state)),
    );
    expect(reasons.size).toBe(4);
    for (const reason of reasons) expect(reason).toMatch(/^[A-Z].*\.$/);
  });

  test("the predicate and the reason agree in all 16 states", () => {
    for (let bits = 0; bits < 16; bits += 1) {
      const state: GalleryMakeCoverState = {
        disabled: (bits & 1) !== 0,
        coverUploading: (bits & 2) !== 0,
        galleryUploading: (bits & 4) !== 0,
        videoLocked: (bits & 8) !== 0,
      };
      expect(canMakeGalleryPhotoCover(state)).toBe(galleryMakeCoverBlockedReason(state) === null);
      if (state.videoLocked) expect(canMakeGalleryPhotoCover(state)).toBe(false);
    }
  });

  test("the make-cover state carries the video lock; the add state still cannot", () => {
    const typeStart = gateSource.indexOf("export type GalleryMakeCoverState = {");
    expect(typeStart).toBeGreaterThan(-1);
    const typeBody = gateSource.slice(typeStart, gateSource.indexOf("};", typeStart));
    const fields = [...typeBody.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort();
    expect(fields).toEqual(["coverUploading", "disabled", "galleryUploading", "videoLocked"]);
    // The add gate is unchanged by any video state it could be handed.
    expect(canAddGalleryPhoto({ galleryUploading: false, disabled: false, atCap: false })).toBe(true);
  });
});

describe("issue #3280 Make cover keeps the cover video lock (source wiring)", () => {
  test("the make-cover gate is fed by the picker's video lock and both busy flags", () => {
    expect(coverPickerSource).toContain(
      'const lockedVideoOperation = activeVideoUpload || projectedVideoStage.phase === "ready";',
    );
    const start = coverPickerSource.indexOf("const makeCoverGate = useMemo<GalleryMakeCoverState>(");
    expect(start).toBeGreaterThan(-1);
    const end = coverPickerSource.indexOf("const activeMediaUrl =", start);
    expect(end).toBeGreaterThan(start);
    const gate = executable(coverPickerSource.slice(start, end));
    expect(gate).toContain("videoLocked: lockedVideoOperation,");
    expect(gate).toContain("coverUploading: uploading,");
    expect(gate).toMatch(/\bgalleryUploading,/);
    expect(gate).toMatch(/\bdisabled,/);
    expect(gate).toContain("[disabled, galleryUploading, lockedVideoOperation, uploading]");
  });

  test("requestMakeCover consults the make-cover gate before the confirm and before applying", () => {
    const body = callbackBody("requestMakeCover", "pickImageOrGifCover");
    const guard = body.indexOf("if (!canMakeGalleryPhotoCover(makeCoverGate)) {");
    expect(guard).toBeGreaterThan(-1);
    const confirm = body.indexOf("setPendingMakeCoverIndex(index);");
    const apply = body.indexOf("applyMakeCover(index);");
    expect(confirm).toBeGreaterThan(guard);
    expect(apply).toBeGreaterThan(guard);
    // Never silent: the blocked branch shows the reason, then returns.
    const blocked = body.slice(guard, confirm);
    expect(blocked).toContain("galleryMakeCoverBlockedReason(makeCoverGate)");
    expect(blocked).toContain("onShowToast(reason)");
    expect(blocked).toContain("return;");
    expect(body).not.toContain("if (disabled) return;");
    expect(body).toMatch(/\[applyMakeCover, makeCoverGate, onShowToast\]/);
  });

  test("applyMakeCover refuses before it emits, so the OQ-3 confirm cannot promote a photo while locked", () => {
    const body = callbackBody("applyMakeCover", "requestMakeCover");
    const guard = body.indexOf("if (!canMakeGalleryPhotoCover(makeCoverGate)) {");
    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf("setLocalCover(patch);")).toBeGreaterThan(guard);
    expect(body.indexOf("onCoverChange(patch);")).toBeGreaterThan(guard);
    expect(body.indexOf("galleryRef.current = nextGallery;")).toBeGreaterThan(guard);
    expect(body.slice(guard, body.indexOf("const item = galleryRef.current[index];"))).toContain(
      "onShowToast(reason)",
    );
    // The confirm's only route to the cover is that guarded chokepoint.
    const element = additionalPhotosSectionElement();
    const confirmAt = element.indexOf("onConfirmMakeCover={");
    expect(confirmAt).toBeGreaterThan(-1);
    const confirmHandler = element.slice(confirmAt, element.indexOf("onCancelMakeCover=", confirmAt));
    expect(confirmHandler).toContain("applyMakeCover(idx)");
    expect(confirmHandler).not.toMatch(/onCoverChange|setLocalCover|emitChange/);
  });

  test("the section is handed a Make-cover gate separate from its shared disabled", () => {
    const element = additionalPhotosSectionElement();
    expect(element).toContain("makeCoverDisabled={!canMakeGalleryPhotoCover(makeCoverGate)}");
    expect(element).toContain("makeCoverBlockedReason={galleryMakeCoverBlockedReason(makeCoverGate)}");
  });

  test("the Make cover control uses its own gate and carries a reason hint", () => {
    const item = galleryMenuItemElement("Make cover");
    expect(item).toContain("disabled={makeCoverDisabled}");
    expect(item).not.toContain("disabled={disabled}");
    const hintAt = item.indexOf("accessibilityHint={");
    expect(hintAt).toBeGreaterThan(-1);
    const hint = item.slice(hintAt, item.indexOf("onPress=", hintAt));
    expect(hint).toContain("makeCoverDisabled");
    expect(hint).toContain("makeCoverBlockedReason");
    expect((hint.match(/"[^"]{8,}"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("the OQ-3 confirm's Replace is locked by the same gate and the banner says why", () => {
    const section = additionalPhotosSectionSource();
    const replaceId = section.indexOf('testID="cover-make-cover-confirm-replace"');
    expect(replaceId).toBeGreaterThan(-1);
    const replace = section.slice(section.lastIndexOf("<Button", replaceId), section.indexOf("/>", replaceId));
    expect(replace).toContain("disabled={makeCoverDisabled}");
    const reasonId = section.indexOf('testID="cover-make-cover-confirm-reason"');
    expect(reasonId).toBeGreaterThan(-1);
    const reasonLine = section.slice(section.lastIndexOf("makeCoverDisabled &&", reasonId), reasonId + 200);
    expect(reasonLine).toContain("makeCoverBlockedReason !== null");
    expect(reasonLine).toContain("{makeCoverBlockedReason}");
  });

  test("Move earlier, Move later and Remove stay on the shared gallery gate, with no video lock", () => {
    for (const label of ["Move earlier", "Move later", "Remove"]) {
      const item = galleryMenuItemElement(label);
      expect(item).toMatch(/disabled=\{disabled\b/);
      expect(item).not.toMatch(/makeCover|lockedVideoOperation|activeVideoUpload|videoLocked/);
    }
    // The section cannot see video state at all — only the gate it is handed.
    expect(additionalPhotosSectionSource()).not.toMatch(/lockedVideoOperation|activeVideoUpload|videoUpload\b/);
  });

  test("a disabled menu item is dimmed and forwards its hint to the pressable", () => {
    const start = coverPickerSource.indexOf("const GalleryMenuItem: React.FC<{");
    expect(start).toBeGreaterThan(-1);
    const item = coverPickerSource.slice(start, coverPickerSource.indexOf("const styles = StyleSheet.create", start));
    expect(item).toContain("accessibilityHint={accessibilityHint}");
    expect(item).toContain("accessibilityState={{ disabled }}");
    expect(item).toContain("disabled && styles.galleryMenuItemDisabled,");
    const styleAt = coverPickerSource.indexOf("galleryMenuItemDisabled: {");
    expect(styleAt).toBeGreaterThan(-1);
    const style = coverPickerSource.slice(styleAt, coverPickerSource.indexOf("}", styleAt));
    const opacity = /opacity:\s*([0-9.]+)/.exec(style);
    expect(opacity).not.toBeNull();
    expect(Number(opacity?.[1])).toBeLessThan(1);
  });
});
