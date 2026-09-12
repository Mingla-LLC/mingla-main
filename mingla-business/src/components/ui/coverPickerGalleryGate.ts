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
