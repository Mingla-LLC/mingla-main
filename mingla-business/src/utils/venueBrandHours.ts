/**
 * Ve1 — helpers for `brand_hours` rows (weekday 0 = Monday … 6 = Sunday).
 */

import type { BrandHourEntry } from "../types/brand";

/** Default Mon–Sat 9am–5pm, Sun closed (product can tune copy in wizard). */
export function defaultBrandHoursWeek(): BrandHourEntry[] {
  const rows: BrandHourEntry[] = [];
  for (let w = 0; w <= 5; w++) {
    rows.push({
      weekday: w,
      openTime: "09:00",
      closeTime: "17:00",
      isClosed: false,
    });
  }
  rows.push({ weekday: 6, openTime: null, closeTime: null, isClosed: true });
  return rows;
}

/** Build JSON array for `biz_create_venue_brand_pending_review` `p_hours`. */
export function brandHoursToRpcPayload(
  entries: BrandHourEntry[],
): Array<Record<string, unknown>> {
  return entries.map((e) => ({
    weekday: e.weekday,
    open_time: e.openTime ?? "",
    close_time: e.closeTime ?? "",
    is_closed: e.isClosed,
  }));
}
