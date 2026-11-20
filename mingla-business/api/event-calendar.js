// issue #4420 (C1) — GET /e/:brandSlug/:eventSlug/calendar.ics
//
// WHY THIS EXISTS. "Add to calendar" used to build the .ics file inside the page
// and click a hidden download link. Instagram, TikTok and Facebook's in-app
// browsers ignore downloads, and iPhone Safari saves the file instead of opening
// Calendar. iOS only shows its own "Add event" screen for a real https address
// served as text/calendar, so the chooser's Apple and "Other calendar" rows open
// THIS address.
//
// ONE OWNER OF THE FILE. The entry rules and the ICS text come from
// packages/offering-rendering/offeringCalendar.cjs, the same module the page
// uses for its Google and Outlook links. Nothing about the file is rebuilt here.
//
// WHAT IT SERVES. Only what the public page itself shows, read anonymously
// through the same public RPCs as the page (the ticketed bundle, then the
// unlisted/public RSVP reader). Those readers return NULL for drafts, private
// and unpublished events, so a 404 here is indistinguishable across them. 404
// also when there is no single real start AND end (no end time, multi-date
// runs, cancelled or ended events: Constitution 9, never invent a duration).
// The LOCATION is left out when the street is hidden until purchase, by the same
// rule as the page: hidden => the venue name only, never the address.
const { requestRpcJson } = require("../server/supabaseRpc");
const {
  offeringCalendarEntry,
  offeringCalendarIcs,
  offeringCalendarLocation,
} = require("../../packages/offering-rendering/offeringCalendar.cjs");

const firstQueryValue = (value) => (Array.isArray(value) ? value[0] : value);

// Mirrors the slug charset the publish path emits (see rsvp-event-bundle.js).
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/i;
const PUBLIC_ORIGIN = "https://host.usemingla.com";
// Same short public cache as the sibling public reads: a changed time shows
// within seconds, and a crowd tapping "Add to calendar" never reaches the DB.
const CACHE_SECONDS = 5;

const send = (res, status, body, headers) => {
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(body);
};

const notFound = (res) =>
  send(res, 404, "Not found\n", {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
  });

const text = (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

// A single dated, still-bookable event only. The page offers the action under
// the same conditions (one date, current sale).
const isSingleOpenDate = (data) => {
  if (data.status === "cancelled" || data.status === "ended" || data.status === "draft") return false;
  if (data.isMultiDate === true) return false;
  if (Array.isArray(data.occurrences) && data.occurrences.length > 1) return false;
  return true;
};

module.exports = async function eventCalendarHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const eventSlug = firstQueryValue(req.query.eventSlug);
  if (
    typeof brandSlug !== "string" || !SLUG.test(brandSlug) ||
    typeof eventSlug !== "string" || !SLUG.test(eventSlug)
  ) {
    return notFound(res);
  }

  let data;
  try {
    data = await requestRpcJson("pg_direct_event_checkout_bundle", {
      p_event_id: null,
      p_brand_slug: brandSlug,
      p_event_slug: eventSlug,
    });
    if (data === null || data === undefined) {
      data = await requestRpcJson("pg_public_rsvp_by_slug", {
        p_brand_slug: brandSlug,
        p_event_slug: eventSlug,
      });
    }
  } catch {
    // Never cached: a short outage must not outlive itself.
    return send(res, 502, "Calendar is temporarily unavailable\n", {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
  }

  if (data === null || typeof data !== "object" || !isSingleOpenDate(data)) return notFound(res);

  const eventId = text(data.id);
  const hidden = data.hideAddressUntilTicket === true;
  const venueName = text(data.venueName);
  // The page's rule, one owner: hidden => venue name only; else venue + address.
  const location = offeringCalendarLocation({ venueName, address: text(data.address), addressHidden: hidden });
  const pagePath = `/e/${encodeURIComponent(brandSlug)}/${encodeURIComponent(eventSlug)}`;
  const entry = eventId === null
    ? null
    : offeringCalendarEntry({
        title: text(data.name) ?? "",
        startIso: data.masterStartAt,
        endIso: data.masterEndAt,
        location,
        url: `${PUBLIC_ORIGIN}${pagePath}`,
      });
  if (entry === null) return notFound(res);

  send(res, 200, offeringCalendarIcs(entry, `${eventId}@usemingla.com`), {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": `inline; filename="${eventSlug}.ics"`,
    "cache-control": `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
    "x-robots-tag": "noindex",
  });
};
