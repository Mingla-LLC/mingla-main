/**
 * Ve4 — parse `claimed_venues_public_view.hours` jsonb for UI tables.
 */

import type { BrandHourEntry } from "../types/brand";

const isHourObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Map view hours jsonb → seven weekday rows (may be fewer if incomplete). */
export const parseClaimedVenueHours = (value: unknown): BrandHourEntry[] => {
  if (!Array.isArray(value)) return [];
  const rows: BrandHourEntry[] = [];
  for (const item of value) {
    if (!isHourObject(item)) continue;
    const weekday = item.weekday;
    if (typeof weekday !== "number" || weekday < 0 || weekday > 6) continue;
    const isClosed = item.is_closed === true;
    const openRaw = item.open_time;
    const closeRaw = item.close_time;
    rows.push({
      weekday,
      isClosed,
      openTime:
        !isClosed && typeof openRaw === "string" && openRaw.length > 0
          ? openRaw
          : null,
      closeTime:
        !isClosed && typeof closeRaw === "string" && closeRaw.length > 0
          ? closeRaw
          : null,
    });
  }
  return rows.sort((a, b) => a.weekday - b.weekday);
};
