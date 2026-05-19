/**
 * Ve4 — photo cascade for public verified venue pages.
 * Operator cover + profile first; fall back to place_pool URLs when absent.
 */

export interface VenueGalleryPhotoInput {
  coverMediaUrl?: string | null;
  profilePhotoUrl?: string | null;
  poolPhotoUrls?: string[] | null;
}

const isUsableUrl = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Deduped gallery URLs in display priority order. */
export const buildVenueGalleryPhotoUrls = (
  input: VenueGalleryPhotoInput,
): string[] => {
  const urls: string[] = [];
  const push = (value: string | null | undefined): void => {
    if (!isUsableUrl(value)) return;
    const trimmed = value.trim();
    if (!urls.includes(trimmed)) urls.push(trimmed);
  };

  push(input.coverMediaUrl);
  push(input.profilePhotoUrl);
  if (urls.length > 0) return urls;

  for (const poolUrl of input.poolPhotoUrls ?? []) {
    push(poolUrl);
  }
  return urls;
};
