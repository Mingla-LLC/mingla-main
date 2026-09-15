/**
 * issue #3280 — the cover sheet comes back as a FRESH sheet after the native
 * trim editor.
 *
 * WHY: the cover sheet is a native iOS modal (`SheetMobile` renders React
 * Native's `<Modal>`). A clip over the 15 s ceiling opens `react-native-video-
 * trim`, which presents its own view controller — plus a save dialog and a
 * progress alert — ON TOP of that modal and dismisses them after it has already
 * told JavaScript the trim finished. In the run that showed the bug, JavaScript
 * then did everything right (upload, processing, applied, draft saved) and the
 * open sheet never showed any of it; closing and reopening the sheet — a brand
 * new native modal — showed "Video cover added" at once. The run that rendered
 * correctly never went through the trim editor.
 *
 * So after the editor has been shown, the picker no longer carries on inside the
 * native window the editor was stacked on. It hands what it has to its sheet
 * (the clip to upload, any message, any failed Additional photos), the sheet
 * closes, and a fresh sheet continues from the hand-off — the same path as a
 * host who opens the sheet and picks a short clip, which renders correctly.
 *
 * PURE by contract (no React, no React Native, type-only imports) so the sheet
 * can import it without pulling the lazy picker into the web boot chunk.
 */

import type { EventCoverVideoUploadFile } from "../../hooks/useEventCoverVideoUpload";
import type { GalleryAddHandOffEntry } from "./coverPickerGalleryAdd";

/** The in-sheet video message (`CoverPicker`'s inline notice). */
export type NativeEditorNotice = { tone: "info" | "error"; text: string };

/** What a picker hands to the fresh sheet after the native editor closed. */
export type NativeEditorCarry = {
  /** Unique per hand-off; the fresh picker consumes each id once. */
  id: number;
  /**
   * The picker instance that handed off. It never consumes its own carry — the
   * whole point is that a NEW native window continues. The sheet clears this
   * only when it could not replace the old window (see `releaseCarryOwner`).
   */
  handedOffBy: object | null;
  /** The message the old sheet would have shown ("No video added…", an error). */
  notice: NativeEditorNotice | null;
  /** The trimmed clip, validated and ready to start (or replace) the upload. */
  upload: { file: EventCoverVideoUploadFile; replacing: boolean } | null;
  /** issue #3318 — failed Additional photos keep their tile and Retry. */
  failedGalleryPhotos: readonly GalleryAddHandOffEntry[];
};

/**
 * How long the sheet waits, after its content has unmounted, before it presents
 * again. Equal to #1360's `DEFER_SETTLE_MS` (the Sheet's 280 ms unmount window,
 * the Modal's 200 ms, whichever is longer, plus 60 ms) — the repo's settle for
 * presenting a native modal after another has closed. Kept as a literal here so
 * the sheet does not import the Sheet/Modal primitives through that helper; a
 * test pins the two equal.
 */
export const NATIVE_EDITOR_RETURN_SETTLE_MS = 340;

let nextCarryId = 1;

export const nextNativeEditorCarryId = (): number => {
  const id = nextCarryId;
  nextCarryId += 1;
  return id;
};

/**
 * Only iOS, and only a picker whose sheet can present it again. The defect was
 * seen on iOS, where the sheet is a presented view controller; Android and web
 * keep today's in-place flow (web never shows the native editor at all).
 */
export const returnsThroughFreshSheet = (
  platformOS: string,
  sheetCanRepresent: boolean,
): boolean => platformOS === "ios" && sheetCanRepresent;

/**
 * Whether the fresh picker may act on a carry now. A clip upload waits until the
 * picker's own mount-time reconnect has finished (`reattaching` is over), so it
 * starts exactly like a host picking a clip in a freshly opened sheet — never
 * racing the reconnect for the same job. `armed` is set by the picker's first
 * effect, in the same batch as the reconnect's first stage, so a render where
 * `armed` is true never shows a reconnect that has not started yet.
 */
export const canContinueAfterNativeEditor = (input: {
  armed: boolean;
  videoPhase: string;
  hasUpload: boolean;
}): boolean =>
  input.armed && (!input.hasUpload || input.videoPhase !== "reattaching");

/** Lets any picker consume a carry (the old window was never replaced). */
export const releaseCarryOwner = (carry: NativeEditorCarry): NativeEditorCarry => ({
  ...carry,
  handedOffBy: null,
});

/** A dropped carry frees the failed photos' files (web object URLs). */
export const discardNativeEditorCarry = (carry: NativeEditorCarry): void => {
  for (const photo of carry.failedGalleryPhotos) {
    try {
      photo.asset.release?.();
    } catch {
      // Freeing a preview must never break closing the sheet.
    }
  }
};
