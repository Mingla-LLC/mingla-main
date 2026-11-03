/**
 * #4238 — an ad on a dated offering (a series, a trip, an RSVP) ends by the
 * last moment anyone can still book it.
 *
 * `last_bookable_at` comes from the SQL resolver (ad_offering_destination_by_id):
 * the earliest of the last bookable date, the last ticket sale end and a
 * trip's booking deadline. Pages without it (brand, venue, site, marketing,
 * apps) are not bounded here.
 *
 * Pure: no I/O. Returns a detail code for `plan_preflight_failed`, or null.
 */

export type AdScheduleBoundError =
  | "schedule_invalid"
  | "schedule_end_required"
  | "schedule_ends_after_last_date"
  | "schedule_starts_after_last_date";

function isoMillis(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function adScheduleBoundError(
  schedule: unknown,
  destination: Record<string, unknown> | null | undefined,
): AdScheduleBoundError | null {
  const limit = isoMillis(destination?.last_bookable_at);
  if (limit === null) return null;
  const record = schedule && typeof schedule === "object" &&
      !Array.isArray(schedule)
    ? schedule as Record<string, unknown>
    : {};
  const rawStart = record.starts_at;
  const start = isoMillis(rawStart);
  if (rawStart !== undefined && rawStart !== null && start === null) {
    return "schedule_invalid";
  }
  const end = isoMillis(record.ends_at);
  if (end === null) return "schedule_end_required";
  if (end > limit) return "schedule_ends_after_last_date";
  if (start !== null && start >= limit) {
    return "schedule_starts_after_last_date";
  }
  return null;
}

/** "Sat 6 Dec" in the page's own time zone (UTC when unknown), or null. */
export function adDayLabel(
  iso: unknown,
  timezone?: unknown,
): string | null {
  const ms = isoMillis(iso);
  if (ms === null) return null;
  const zone = typeof timezone === "string" && timezone.trim()
    ? timezone.trim()
    : "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: zone,
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(ms));
  }
}

/**
 * #4238: what one ad on a dated page covers, for Ari's card:
 * "Covers all 5 dates until Sat 6 Dec", or "Covers Sat 6 Dec" for one date.
 * Null for a page without dates.
 */
export function adSeriesDatesWords(
  page: Record<string, unknown> | null | undefined,
): string | null {
  const day = adDayLabel(page?.last_bookable_at, page?.timezone);
  if (!day) return null;
  const count = Number(page?.dates_remaining);
  return Number.isFinite(count) && count > 1
    ? `Covers all ${count} dates until ${day}`
    : `Covers ${day}`;
}

/**
 * #4238: the Schedule row on Ari's ad cards, in plain words and in the
 * page's own time zone (UTC when unknown), never a raw timestamp:
 * "Starts after approval · runs until Mon 7 Dec". It names the same day as
 * the Dates row (adSeriesDatesWords) when the ad runs to the last bookable
 * moment.
 */
export function adScheduleWords(
  startsAt: unknown,
  endsAt: unknown,
  timezone?: unknown,
): string {
  const startDay = adDayLabel(startsAt, timezone);
  const endDay = adDayLabel(endsAt, timezone);
  const start = startDay ? `Starts ${startDay}` : "Starts after approval";
  const end = endDay ? `runs until ${endDay}` : "no end date";
  return `${start} · ${end}`;
}

/**
 * #4238: the end an ad on a dated page uses. No end → the last bookable
 * moment; a later end → refused in plain words. Pages without dates keep the
 * caller's end.
 */
export function adEffectiveScheduleEnd(
  endsAt: unknown,
  page: Record<string, unknown> | null | undefined,
): { ok: true; endsAt: string | null } | { ok: false; message: string } {
  const end = typeof endsAt === "string" && endsAt.trim() ? endsAt : null;
  const limit = isoMillis(page?.last_bookable_at);
  if (limit === null) return { ok: true, endsAt: end };
  if (end === null) {
    return { ok: true, endsAt: new Date(limit).toISOString() };
  }
  const endMs = isoMillis(end);
  const day = adDayLabel(page?.last_bookable_at, page?.timezone);
  if (endMs === null || endMs > limit) {
    return {
      ok: false,
      message:
        `This ad can run until ${day}, the last day people can book. Pick an earlier end date.`,
    };
  }
  return { ok: true, endsAt: end };
}

/**
 * #4238: why a page can't be promoted — the SAME reason the Host picker shows
 * on a greyed-out row (mingla-business hostAdPageUnavailableReason), so Ari
 * and the picker never disagree. Keep the two lists word-for-word in step;
 * the #4238 Deno suite reads the picker source to check.
 */
export function adPageUnavailableReason(
  page: Record<string, unknown> | null | undefined,
): string {
  const type = String(page?.page_type ?? "");
  switch (page?.availability) {
    case "draft":
      return "Not published yet.";
    case "private":
      return "This page is private, so an ad can't link to it.";
    case "unlisted":
      return type === "experience"
        ? "Unlisted experiences can't be promoted. Make it public to promote it."
        : "Unlisted trips can't be promoted. Make it public to promote it.";
    case "ended":
      return "All its dates have passed.";
    case "nothing_on_sale":
      return type === "rsvp" ? "No spots left." : "Nothing is on sale right now.";
    case "bookings_closed":
      return "Bookings are closed.";
    case "not_live":
      return "Your website isn't live yet.";
    default:
      return "Can't be promoted right now.";
  }
}

/** #4238: Ari's refusal for a page it can't promote, with the picker's reason. */
export function adPageRefusalWords(
  page: Record<string, unknown> | null | undefined,
): string {
  return `That page can't be promoted. ${adPageUnavailableReason(page)}`;
}

/**
 * #4238: the Host's own page from ads setup that Ari's arguments name.
 * Slugs compare trimmed and lower-cased, as the SQL resolver does, so a
 * differently-cased slug still gets the default end, the cap and the refusal.
 */
export function adFindSetupPage(
  pages: unknown,
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const norm = (value: unknown): string =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const type = norm(args.dest_page_type);
  const brand = norm(args.dest_brand_slug);
  const entity = norm(args.dest_entity_slug);
  if (!type || !brand) return undefined;
  return (Array.isArray(pages) ? pages : []).find(
    (page: Record<string, unknown>) =>
      page !== null && typeof page === "object" &&
      norm(page.page_type) === type &&
      norm(page.brand_slug) === brand &&
      (type === "brand" || norm(page.entity_slug) === entity),
  );
}
