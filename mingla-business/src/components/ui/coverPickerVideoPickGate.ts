/**
 * coverPickerVideoPickGate — issue #3485 [no escape hatch from a stuck cover
 * upload].
 *
 * Filmed on a Release build (2026-09-20): a cover video sat in "Processing
 * video…" for 32 minutes because the provider never started encoding it. The
 * host tapped Replace → "Choose replacement" twice. No picker opened, no notice
 * appeared, nothing changed. `pickVideoCover` returned at its first line:
 *
 *   if (uploading || galleryUploading || disabled ||
 *       (lockedVideoOperation && !replacing && !resumingDetachedWeb)) return;
 *
 * `replacing` bypassed `lockedVideoOperation` — and then `uploading` blocked it
 * anyway. That flag is not "an OS picker is open": `pickVideoCover` sets it,
 * then awaits `videoUpload.start`, which awaits the intent, the transfer, the
 * acknowledgement AND the processing watch. So in the very session that picked
 * the clip, `uploading` is held true for the WHOLE job — up to the ten-minute
 * watch deadline — and it is exactly a long job that a host needs to escape
 * from. (`coverPickerGalleryGate.ts` documents the same flag defeating the
 * Additional-photos tile for the same reason, in #3280.)
 *
 * So the busy question splits in two, and only one half may block a replace:
 *
 *   PICK/PREPARE — the OS picker is open, or a clip is being trimmed, measured
 *   and handed onward. Two concurrent picker launches, and a pick during the
 *   native trim editor's hand-off to a fresh sheet, are real races and stay
 *   blocked. This is `videoPickInFlight`, a flag whose life is the pick itself.
 *
 *   UPLOAD/PROCESSING — bytes are moving, or the provider is encoding. The job
 *   is durable server-side, `videoUpload.replace` supersedes it by design, and
 *   a host watching a stalled card has no other way out (Cancel discards the
 *   cover). A replace goes through.
 *
 * And nothing refuses silently. Every blocked path returns the sentence the
 * sheet shows through `setVideoPickNotice` — an enabled, hit-testable button
 * that does nothing is Constitution rule 1 (no dead taps) and rule 3 (no silent
 * failures), which is how this shipped.
 *
 * Lives beside CoverPicker rather than inside it for the reason
 * `coverPickerGalleryGate.ts`, `coverPickerElapsed.ts` and
 * `coverPickerSelection.ts` do: CoverPicker.tsx pulls in expo-video /
 * expo-image-picker / react-native-video-trim and cannot be mounted under jest,
 * so a rule that must be tested for real is split out. PURE by contract — no
 * React, no React Native, type-only imports.
 */

import type { NativeEditorNotice } from "./coverPickerNativeEditorReturn";

export type VideoPickGateState = {
  /**
   * A pick/prepare is running in this sheet RIGHT NOW: the OS video picker is
   * open, or its clip is being trimmed, measured and handed to the upload hook.
   * Narrow on purpose — it is cleared the moment the file becomes the hook's
   * problem, so it never covers the upload or the encode.
   */
  videoPickInFlight: boolean;
  /**
   * A photo is being uploaded into Additional photos. Seconds, not minutes —
   * owned by `galleryAdd`, which sets and clears it around one upload.
   */
  galleryUploading: boolean;
  /**
   * The picker-wide `uploading` flag: an image/GIF cover upload, OR the video
   * pick that holds it for its entire processing window. A REPLACE ignores it
   * (see the header); a fresh pick does not.
   */
  coverUploading: boolean;
  /** The whole picker is locked by its host (saving, read-only, no permission). */
  disabled: boolean;
  /**
   * A cover video operation owns the cover: the picker's `lockedVideoOperation`
   * (a job in flight, or ready but not yet saved).
   */
  videoLocked: boolean;
  /** This tap came from Replace → "Choose replacement" on the status card. */
  replacing: boolean;
  /** Web only: the host is resuming a `detached` job by picking again. */
  resumingDetachedWeb: boolean;
};

/**
 * The sentence the sheet must show instead of opening the picker, or null when
 * the pick may proceed. Ordered most-specific first: the flag that is about to
 * clear on its own gets to explain itself before the broad host lock does.
 */
export const videoPickRefusal = ({
  videoPickInFlight,
  galleryUploading,
  coverUploading,
  disabled,
  videoLocked,
  replacing,
  resumingDetachedWeb,
}: VideoPickGateState): NativeEditorNotice | null => {
  // A second picker launch, or a pick landing in the middle of the native trim
  // editor's hand-off. Both are races, and both end on their own.
  if (videoPickInFlight) {
    return {
      tone: "info",
      text: "Still working on the video you just chose — try again in a moment.",
    };
  }
  // A gallery photo upload is seconds long, and a cover action waits for it so
  // a cover emit and a gallery commit are never both in flight (#3280).
  if (galleryUploading) {
    return {
      tone: "info",
      text: replacing
        ? "Finishing the last photo upload — try Replace again in a moment."
        : "Finishing the last photo upload — try again in a moment.",
    };
  }
  // The picker-wide flag. A replace is allowed straight through it: for the
  // video flow it IS the in-flight job, which is what the host is escaping.
  if (coverUploading && !replacing) {
    return {
      tone: "info",
      text: "Finishing the current cover upload — try again in a moment.",
    };
  }
  // A job already owns the cover, and this is not the replace path. Used to be
  // the same bare `return`: the host was told nothing and the Replace button is
  // right there.
  if (videoLocked && !replacing && !resumingDetachedWeb) {
    return {
      tone: "info",
      text: "A cover video is already being added — use Replace to swap it.",
    };
  }
  if (disabled) {
    return { tone: "info", text: "The cover can’t be changed right now." };
  }
  return null;
};

/** True iff the pick may open the OS picker now. */
export const canPickVideoCover = (state: VideoPickGateState): boolean =>
  videoPickRefusal(state) === null;
