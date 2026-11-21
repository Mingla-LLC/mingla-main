/**
 * #4514 — the brand header's data, from the host app's Brand (pure). The header
 * itself is drawn by `@mingla/form-rendering` (BrandHeader), loaded through the
 * one lazy owner (`components/checkout/intake/formRenderingPrimitives`).
 * Read live from the brand, never stored on the form.
 */

import type { BrandHeaderData } from "@mingla/form-rendering";

import type { Brand } from "../types/brand";

export function brandFormHeaderData(brand: Brand | null): BrandHeaderData {
  if (brand === null) {
    return { displayName: "", photo: null, coverUrl: null, accent: null, coverHue: 25 };
  }
  const coverUrl =
    brand.coverMediaType === "video" || brand.coverMediaType === "gif"
      ? brand.coverMediaPosterUrl ?? null
      : brand.coverMediaUrl ?? null;
  return {
    displayName: brand.displayName,
    photo: brand.photo !== undefined && brand.photo.length > 0 ? brand.photo : null,
    coverUrl,
    accent: null,
    coverHue: brand.coverHue,
  };
}
