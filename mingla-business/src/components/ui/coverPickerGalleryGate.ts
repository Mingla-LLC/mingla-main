/**
 * coverPickerGalleryGate — issue #3280 [cover sheet stale state].
 *
 * The "Additional photos" gallery used to be blocked for the entire life of a
 * cover-VIDEO job. Two sites carried the term: the `addGalleryPhoto` guard and
 * the `AdditionalPhotosSection` `disabled` prop. Both were an accidental
 * copy-paste of the cover-path guard, where blocking IS correct, onto a path
 * whose own comment two lines above says it is "Independent of the primary
 * cover — does NOT touch it". The gallery uploads into the
 * `event_covers`/`brand_covers` storage buckets; the video job rides Bunny/TUS.
 * They share no transport, no lock and no row, so there was never a conflict to
 * guard against. The block reached a `Pressable` whose style array had no
 * disabled variant, so the tile looked fully enabled and did nothing — a dead
 * tap (Constitution rule 1) that also failed silently (rule 3).
 *
 * The rule now lives here, in one place, as a pure predicate. It deliberately
 * accepts NO video argument: there is no video state that can legitimately
 * block adding a photo, and a parameter that does not exist cannot be passed by
 * a future copy-paste.
 *
 * Lives beside CoverPicker rather than inside it for the same reason
 * `coverPickerElapsed.ts` and `coverPickerSelection.ts` do: CoverPicker.tsx
 * pulls in expo-video / expo-image-picker / react-native-video-trim and cannot
 * be mounted under jest, so logic that must be tested for real is split out.
 */

export type GalleryAddState = {
  /** A gallery photo upload is already in flight. */
  uploading: boolean;
  /** The whole picker is locked by its host (saving, read-only, no permission). */
  disabled: boolean;
  /** The gallery already holds the maximum number of extra photos. */
  atCap: boolean;
};

/**
 * True iff tapping "Add photo" can do real work right now. The only three
 * things that legitimately block it are a photo upload already running, a
 * host-locked picker, and a full gallery.
 */
export const canAddGalleryPhoto = ({ uploading, disabled, atCap }: GalleryAddState): boolean =>
  !uploading && !disabled && !atCap;

/**
 * The human-readable reason the add tile is unavailable, or null when it is
 * available. Every blocked state returns a sentence — a blocked control that
 * cannot say why is the defect this issue is about.
 */
export const galleryAddBlockedReason = ({
  uploading,
  disabled,
  atCap,
}: GalleryAddState): string | null => {
  if (uploading) return "Finishing the current photo upload.";
  if (atCap) return "You have added the maximum number of extra photos.";
  if (disabled) return "Photos cannot be changed right now.";
  return null;
};
