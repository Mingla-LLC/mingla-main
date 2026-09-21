/**
 * Issue #3485 [stuck cover video] — regression 1 of 2: there was no escape hatch
 * from a stuck cover upload.
 *
 * Filmed on a Release build (2026-09-20), creating "Highlife Live: Room + Stream".
 * A cover video sat in "Processing video…" for 32 minutes (the provider never
 * started encoding it). The host tapped Replace → "Choose replacement" twice. No
 * picker opened, no notice appeared, nothing changed. The button was enabled and
 * hit-testable — verified in the accessibility tree as
 * `Button 'Choose replacement video'`, enabled.
 *
 * `pickVideoCover` returned at its first line:
 *
 *   if (uploading || galleryUploading || disabled ||
 *       (lockedVideoOperation && !replacing && !resumingDetachedWeb)) return;
 *
 * `replacing` bypassed `lockedVideoOperation` and then `uploading` blocked it
 * anyway — and `uploading` is not "a picker is open": `pickVideoCover` sets it and
 * then awaits `videoUpload.start`, which awaits the processing watch. So the flag
 * is held for the WHOLE job, and a long job is exactly what a host needs to
 * escape. (`coverPickerGalleryGate.ts` records the same flag defeating the
 * Additional-photos tile for the same reason, in #3280.)
 *
 * Two layers, the convention this directory already uses:
 *   1. REAL LOGIC — `coverPickerVideoPickGate` is imported and exercised for
 *      real. CoverPicker.tsx pulls in expo-video / expo-image-picker /
 *      react-native-video-trim and cannot be mounted under jest (documented in
 *      `CoverPicker.selectedState.test.ts` and
 *      `coverPickerElapsed.issue3173.test.tsx`).
 *   2. SOURCE WIRING — what the call site passes, in what order it releases the
 *      pick lock, and that the notice can actually be SEEN while a job is
 *      active. Each assertion fails on reintroducing the silent return.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  canPickVideoCover,
  videoPickRefusal,
  type VideoPickGateState,
} from "../coverPickerVideoPickGate";

const UI = join(__dirname, "..");
const coverPickerSource = readFileSync(join(UI, "CoverPicker.tsx"), "utf8");
const gateSource = readFileSync(join(UI, "coverPickerVideoPickGate.ts"), "utf8");

/** Source with whole-line `//` comments removed, so prose cannot satisfy a check. */
const executable = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

/** A `useCallback` body, from its declaration to the next named declaration. */
const callbackBody = (name: string, nextName: string): string => {
  const start = coverPickerSource.indexOf(`const ${name} = useCallback(`);
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf(`const ${nextName} = useCallback(`, start);
  expect(end).toBeGreaterThan(start);
  return coverPickerSource.slice(start, end);
};

/** Nothing is busy; each test turns on exactly the flag it is about. */
const clear: VideoPickGateState = {
  videoPickInFlight: false,
  galleryUploading: false,
  coverUploading: false,
  disabled: false,
  videoLocked: false,
  replacing: false,
  resumingDetachedWeb: false,
};

/** The filmed state: a video job processing, in the session that picked it. */
const processingInThisSession = { ...clear, coverUploading: true, videoLocked: true };

describe("issue #3485 video pick gate (real logic)", () => {
  test("THE BUG: Replace opens the picker while the job is uploading or processing", () => {
    const replace = { ...processingInThisSession, replacing: true };
    expect(videoPickRefusal(replace)).toBeNull();
    expect(canPickVideoCover(replace)).toBe(true);
  });

  test("Replace gets through each in-flight upload flag on its own, too", () => {
    for (const busy of [
      { ...clear, coverUploading: true, replacing: true },
      { ...clear, videoLocked: true, replacing: true },
    ]) {
      expect(canPickVideoCover(busy)).toBe(true);
    }
  });

  test("a FRESH pick in that same state is still refused — and now says why", () => {
    expect(canPickVideoCover(processingInThisSession)).toBe(false);
    const refusal = videoPickRefusal(processingInThisSession);
    expect(refusal).not.toBeNull();
    expect(refusal?.text.length).toBeGreaterThan(0);
  });

  test("two concurrent picker launches are still prevented — including for a replace", () => {
    // This is the race the deleted guard did protect: a second OS picker, or a
    // pick landing inside the native trim editor's hand-off to a fresh sheet.
    for (const replacing of [false, true]) {
      const state = { ...clear, videoPickInFlight: true, replacing };
      expect(canPickVideoCover(state)).toBe(false);
      expect(videoPickRefusal(state)?.text).toMatch(/moment/i);
    }
  });

  test("a pick in flight outranks every other reason, so the message is the true one", () => {
    const everything: VideoPickGateState = {
      videoPickInFlight: true,
      galleryUploading: true,
      coverUploading: true,
      disabled: true,
      videoLocked: true,
      replacing: true,
      resumingDetachedWeb: false,
    };
    expect(videoPickRefusal(everything)).toEqual(
      videoPickRefusal({ ...clear, videoPickInFlight: true, replacing: true }),
    );
  });

  test("a finishing gallery photo upload refuses, and names the photo rather than the video", () => {
    const refusal = videoPickRefusal({ ...clear, galleryUploading: true, replacing: true });
    expect(refusal?.text).toMatch(/photo/i);
    expect(refusal?.text).toMatch(/upload/i);
    expect(refusal?.text).not.toMatch(/video/i);
    // On the replace path the copy names the control the host just used.
    expect(refusal?.text).toContain("Replace");
    expect(videoPickRefusal({ ...clear, galleryUploading: true })?.text).not.toContain("Replace");
  });

  test("a job that owns the cover points a fresh pick at Replace instead of failing silently", () => {
    const refusal = videoPickRefusal({ ...clear, videoLocked: true });
    expect(refusal?.text).toMatch(/Replace/);
  });

  test("the web resume of a detached job is not treated as a locked cover", () => {
    expect(canPickVideoCover({ ...clear, videoLocked: true, resumingDetachedWeb: true })).toBe(true);
  });

  test("a host-locked picker refuses with its own sentence", () => {
    expect(videoPickRefusal({ ...clear, disabled: true })?.text).toMatch(/cover/i);
    expect(canPickVideoCover({ ...clear, disabled: true, replacing: true })).toBe(false);
  });

  test("nothing busy means no refusal at all", () => {
    expect(videoPickRefusal(clear)).toBeNull();
    expect(canPickVideoCover(clear)).toBe(true);
  });

  test("every refusal is a readable sentence, never a flag name, and distinct per state", () => {
    const states: VideoPickGateState[] = [
      { ...clear, videoPickInFlight: true },
      { ...clear, galleryUploading: true },
      { ...clear, galleryUploading: true, replacing: true },
      { ...clear, coverUploading: true },
      { ...clear, videoLocked: true },
      { ...clear, disabled: true },
    ];
    const texts = new Set<string>();
    for (const state of states) {
      const refusal = videoPickRefusal(state);
      expect(refusal).not.toBeNull();
      // The sheet renders info in warm type and error in semantic red; a refusal
      // that is not the host's fault must never read as an error.
      expect(refusal?.tone).toBe("info");
      expect(refusal?.text).toMatch(/^[A-Z].*[.]$/);
      for (const flag of Object.keys(clear)) expect(refusal?.text).not.toContain(flag);
      texts.add(refusal?.text ?? "");
    }
    expect(texts.size).toBe(states.length);
  });

  test("the gate is pure — no React, no React Native, nothing to mount", () => {
    expect(executable(gateSource)).not.toMatch(/from "react/);
    expect(executable(gateSource)).not.toMatch(/\buseState\b|\buseRef\b|\buseCallback\b/);
  });
});

describe("issue #3485 video pick gate (source wiring)", () => {
  const body = callbackBody("pickVideoCover", "continueVideoUploadAfterNativeEditor");

  test("the silent busy return is gone", () => {
    expect(executable(body)).not.toContain(
      "if (uploading || galleryUploading || disabled || (lockedVideoOperation",
    );
  });

  test("the guard asks the gate and SHOWS the answer in the sheet", () => {
    expect(body).toContain("const refusal = videoPickRefusal({");
    // The refused path shows the sentence and THEN returns — never the reverse,
    // and never the return on its own.
    expect(body).toMatch(
      /if \(refusal !== null\) \{\s*\n\s*setVideoPickNotice\(refusal\);\s*\n\s*return;\s*\n\s*\}/,
    );
  });

  test("the gate is asked with the narrow pick flag and the picker-wide flag kept apart", () => {
    const call = body.slice(body.indexOf("videoPickRefusal({"));
    const args = call.slice(0, call.indexOf("});") + 1);
    expect(args).toContain("videoPickInFlight: videoPickInFlightRef.current,");
    expect(args).toContain("coverUploading: uploading,");
    expect(args).toContain("galleryUploading,");
    expect(args).toContain("videoLocked: lockedVideoOperation,");
    expect(args).toContain("replacing,");
    expect(args).toContain("resumingDetachedWeb,");
  });

  test("the pick lock is RELEASED before the awaited hand-off to the upload hook", () => {
    // The load-bearing ordering. `start`/`replace` do not resolve until the
    // encode settles; a lock held across that await is the original defect in a
    // new flag.
    const release = body.indexOf("videoPickInFlightRef.current = false;");
    const handOff = body.indexOf("await videoUpload.replace(uploadFile);");
    expect(release).toBeGreaterThan(-1);
    expect(handOff).toBeGreaterThan(-1);
    expect(release).toBeLessThan(handOff);
  });

  test("the lock is taken once and released on every exit, including the fresh-sheet hand-off", () => {
    expect(body.match(/videoPickInFlightRef\.current = true;/g)).toHaveLength(1);
    // Once before the hand-off to the hook, once in the `finally`.
    expect(body.match(/videoPickInFlightRef\.current = false;/g)).toHaveLength(2);
    const finallyBlock = body.slice(body.indexOf("} finally {"));
    expect(finallyBlock).toContain("videoPickInFlightRef.current = false;");
    // The trim hand-off completes while the lock is still held.
    expect(finallyBlock.indexOf("await handOffToFreshSheet();")).toBeLessThan(
      finallyBlock.indexOf("videoPickInFlightRef.current = false;"),
    );
  });

  test("the lock is a ref on the picker, not another piece of render state", () => {
    expect(coverPickerSource).toContain("const videoPickInFlightRef = useRef(false);");
  });

  test('"Choose replacement" still reaches the pick as a replace', () => {
    expect(coverPickerSource).toContain("onReplaceVideo={() => { void pickVideoCover(true); }}");
    expect(coverPickerSource).toContain('accessibilityLabel={replacing ? "Choose replacement video"');
  });

  test("the refusal can be SEEN while a video job owns the cover", () => {
    // The notice used to live only inside the `activeVideoUpload ? null : (…)`
    // branch, which renders nothing during a job — so the sentence would have
    // been set and never shown, and the dead tap would have looked identical.
    expect(coverPickerSource).toContain(
      "{activeVideoUpload ? <VideoPickNoticeRow notice={videoPickNotice} /> : (",
    );
    expect(coverPickerSource).toContain(
      "const VideoPickNoticeRow: React.FC<{ notice: NativeEditorNotice | null }>",
    );
    // One writer for the row: both branches render the same component, and the
    // notice markup exists in exactly one place.
    expect(coverPickerSource.match(/<VideoPickNoticeRow /g)).toHaveLength(2);
    expect(coverPickerSource.match(/style={styles\.videoNoticeRow}/g)).toHaveLength(1);
  });
});
