/**
 * coverPickerGalleryGate — issue #3280 [cover sheet stale state].
 *
 * "Add photo" under Additional photos was a dead tap for the whole life of a
 * cover-VIDEO job, for two stacked reasons:
 *
 *   1. `activeVideoUpload` sat in the `addGalleryPhoto` guard and in the
 *      `AdditionalPhotosSection` `disabled` prop — an accidental copy of the
 *      COVER-path guard, where blocking is correct, onto a path whose own
 *      comment says it is "Independent of the primary cover — does NOT touch
 *      it". The gallery uploads into the `event_covers`/`brand_covers` storage
 *      buckets; the video job rides Bunny/TUS. They share no transport, lock or
 *      row.
 *   2. Both sites ALSO read the picker-wide `uploading` flag, and the cover
 *      video flow holds that flag true for its entire processing window
 *      (`pickVideoCover` sets it, then awaits `videoUpload.start`, which awaits
 *      the watch). So in the very session that picked the video, the gallery
 *      stayed blocked even with (1) removed.
 *
 * The tile it silenced had no disabled styling, so it looked enabled and did
 * nothing — Constitution rule 1 (no dead taps) and rule 3 (no silent failures).
 *
 * The rule lives here as a pure predicate over the gallery's OWN state. It
 * accepts no video argument and no picker-wide upload flag: nothing about the
 * cover can legitimately stop a photo being added to the gallery, and a field
 * that does not exist cannot be wired to the wrong flag by a later edit.
 *
 * Lives beside CoverPicker rather than inside it for the same reason
 * `coverPickerElapsed.ts` and `coverPickerSelection.ts` do: CoverPicker.tsx
 * pulls in expo-video / expo-image-picker / react-native-video-trim and cannot
 * be mounted under jest, so logic that must be tested for real is split out.
 */

export type GalleryAddState = {
  /**
   * A photo is being uploaded INTO THE GALLERY right now. This is the gallery's
   * own in-flight flag — never the picker-wide `uploading`, which the cover
   * video flow holds for minutes.
   */
  galleryUploading: boolean;
  /** The whole picker is locked by its host (saving, read-only, no permission). */
  disabled: boolean;
  /** The gallery already holds the maximum number of extra photos. */
  atCap: boolean;
};

/**
 * True iff tapping "Add photo" can do real work right now. The only three
 * things that legitimately block it are a gallery photo already uploading, a
 * host-locked picker, and a full gallery.
 */
export const canAddGalleryPhoto = ({ galleryUploading, disabled, atCap }: GalleryAddState): boolean =>
  !galleryUploading && !disabled && !atCap;

/**
 * The human-readable reason the add tile is unavailable, or null when it is
 * available. Every blocked state returns a sentence that is true for that state
 * only — a blocked control that cannot say why, or says something false, is the
 * defect this issue is about.
 */
export const galleryAddBlockedReason = ({
  galleryUploading,
  disabled,
  atCap,
}: GalleryAddState): string | null => {
  if (galleryUploading) return "Available once the photo you are adding finishes uploading.";
  if (atCap) return "You have added the maximum number of extra photos.";
  if (disabled) return "Photos cannot be changed right now.";
  return null;
};

/**
 * issue #3280 — "Make cover" is the one control in Additional photos that is a
 * COVER action, not a gallery action: it emits the photo as the primary cover.
 * So it must NOT inherit the gallery's freedom from the video lock above.
 *
 * The data-loss path it closes: the host makes a photo the cover while a cover
 * video is still processing; the video job then finishes — the server
 * auto-applies it to the event's cover for a `draft_auto` event, and the
 * client's ready-emit writes it too — and the host's chosen photo is silently
 * replaced. Add, reorder and remove never touch the cover and stay unblocked.
 *
 * Deliberately a separate state type from `GalleryAddState`: the add gate must
 * never be able to see video state, and this one must.
 */
export type GalleryMakeCoverState = {
  /** The whole picker is locked by its host (saving, read-only, no permission). */
  disabled: boolean;
  /**
   * A COVER upload is in flight — the picker-wide `uploading` flag (an image or
   * GIF cover, or the video pick that holds it through processing).
   */
  coverUploading: boolean;
  /**
   * A gallery photo is uploading. Cover actions treat it as busy, as the other
   * cover buttons do, so a cover emit and a gallery commit never overlap.
   */
  galleryUploading: boolean;
  /**
   * A cover video operation owns the cover: the picker's `lockedVideoOperation`
   * (a job in flight, or ready but not yet saved).
   */
  videoLocked: boolean;
};

/** True iff "Make cover" may promote a gallery photo to the primary cover now. */
export const canMakeGalleryPhotoCover = ({
  disabled,
  coverUploading,
  galleryUploading,
  videoLocked,
}: GalleryMakeCoverState): boolean =>
  !disabled && !coverUploading && !galleryUploading && !videoLocked;

/**
 * Why "Make cover" is unavailable, or null when it is available. The video lock
 * is checked first: the video pick holds `coverUploading` for its whole
 * processing window, and in that window the video is the true reason.
 */
export const galleryMakeCoverBlockedReason = ({
  disabled,
  coverUploading,
  galleryUploading,
  videoLocked,
}: GalleryMakeCoverState): string | null => {
  if (videoLocked) return "Available when the cover video finishes.";
  if (coverUploading) return "Available once the cover upload finishes.";
  if (galleryUploading) return "Available once the photo you are adding finishes uploading.";
  if (disabled) return "The cover cannot be changed right now.";
  return null;
};
