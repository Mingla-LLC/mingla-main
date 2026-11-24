/**
 * issue #3281 S2 — the public add-on list's pure half (no React): which add-ons
 * a public page lists and how their prices read. The block
 * (OfferingAddOnsBlock.tsx) renders these.
 *
 * It reads only the display fields of the reader's item and imports nothing
 * from the cart (ticketExtrasCart owns what a buyer may pick), so the public
 * block's on-use chunk shares no module with the checkout picker's.
 */

import { withCurrencyGlyph } from "./currencyGlyph.ts";

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

const wholeAtLeast = (value: unknown, min: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min ? value : null;

/** The add-ons a public page lists: shown ones only, in the reader's order. */
export function publicAddOnChips(raw: unknown): OfferingAddOnChip[] {
  if (!Array.isArray(raw)) return [];
  const chips: OfferingAddOnChip[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") continue;
    const priceCents = wholeAtLeast(item.priceCents, 0);
    if (priceCents === null || wholeAtLeast(item.maxPerTicket, 1) === null) continue;
    if (item.showOnPublicPage === false) continue;
    let remaining: number | Record<string, number> | null = null;
    if (item.isUnlimited !== true) {
      if (typeof item.remaining === "number") {
        remaining = item.remaining;
      } else if (isRecord(item.remaining)) {
        const byDate: Record<string, number> = {};
        for (const key of Object.keys(item.remaining)) {
          const n = item.remaining[key];
          if (typeof n === "number") byDate[key] = n;
        }
        remaining = byDate;
      } else {
        remaining = 0; // a limited add-on whose count can't be read is not offered
      }
    }
    const thumb = item.photoThumbPath;
    chips.push({
      id: item.id,
      name: item.name,
      priceAllInCents: wholeAtLeast(item.priceAllInCents, 0) ?? priceCents,
      soldOut: noneLeft(remaining),
      photoThumbPath: typeof thumb === "string" && thumb.length > 0 ? thumb : null,
    });
  }
  return chips;
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
