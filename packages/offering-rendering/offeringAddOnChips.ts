/**
 * issue #3281 S2 — the public add-on list's pure half (no React): which add-ons
 * a public page lists and how their prices read. The block
 * (OfferingAddOnsBlock.tsx) renders these.
 */

import { withCurrencyGlyph } from "./currencyGlyph.ts";
import { parsePublicTicketExtras } from "./ticketExtrasCart.ts";

export interface OfferingAddOnChip {
  id: string;
  name: string;
  /** Server all-in per unit, minor units; 0 is free. */
  priceAllInCents: number;
  soldOut: boolean;
  photoThumbPath: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const noneLeft = (remaining: number | Record<string, number> | null): boolean => {
  if (remaining === null) return false;
  if (typeof remaining === "number") return remaining <= 0;
  const counts = Object.values(remaining);
  return counts.length > 0 && counts.every((n) => n <= 0);
};

/** The add-ons a public page lists: shown ones only, in the reader's order. */
export function publicAddOnChips(raw: unknown): OfferingAddOnChip[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of raw) {
    if (isRecord(item) && typeof item.id === "string") byId.set(item.id, item);
  }
  const chips: OfferingAddOnChip[] = [];
  for (const extra of parsePublicTicketExtras(raw)) {
    const source = byId.get(extra.id);
    if (source === undefined || source.showOnPublicPage === false) continue;
    const thumb = source.photoThumbPath;
    chips.push({
      id: extra.id,
      name: extra.name,
      priceAllInCents: extra.priceAllInCents,
      soldOut: noneLeft(extra.remaining),
      photoThumbPath: typeof thumb === "string" && thumb.length > 0 ? thumb : null,
    });
  }
  return chips;
}

/** What a page passes to show add-ons; absent (the default) shows none. */
export interface OfferingAddOnsDisplay {
  /** The stored thumbnail's public URL, or null to show no image. */
  photoUrl?: (path: string) => string | null;
}

/** Minor units in the offering's currency, with the house glyph rule. */
export const formatAddOnMoney = (minor: number, currency: string | null): string => {
  const code = (currency ?? "").trim().toUpperCase();
  if (code.length !== 3) return (minor / 100).toFixed(2);
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(minor / 100),
      code,
    );
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
};
