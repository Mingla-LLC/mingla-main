// issue #2879 A — the cached read endpoint.
//
// WHY THIS EXISTS. Every visitor's browser called
// `pg_direct_event_checkout_bundle` on Supabase directly, so 100k people
// opening an event link was 100k database round trips. Page views arrive
// BEFORE reservations and outnumber them, so this is the larger of the two
// volume problems — and unlike the reservation path it was completely
// unprotected.
//
// The HTML shell is already static (this app is an `expo export -p web`
// build). It was never the page that was expensive; it was this one call.
//
// FIVE SECONDS, and no `stale-while-revalidate`. The protection is not linear
// in TTL — at 830 views/sec a 5 s cache takes the database from 830 calls/sec
// to 0.2, and a longer window buys a rounding error while costing real
// accuracy. `stale-while-revalidate` would shield against an origin stampede
// but pushes worst-case staleness past the 5 s that was actually agreed, so it
// is deliberately absent until the #2491 §2.7 load test says it is needed.
//
// THIS DOES NOT MAKE ANYTHING LESS ACCURATE. The checkout screen fetches
// `remaining` once on mount and never refreshes it, so today a page left open
// for ten minutes shows a ten-minute-old number. This makes that staleness
// BOUNDED for the first time.
//
// AND NOBODY CAN BUY A TICKET THAT IS NOT THERE. This is the browsing read.
// The reservation path re-checks capacity exactly, under a row lock, in
// `issue_1930_ticket_checkout_create_session_base`. A cached `remaining` can
// only ever cause the pre-existing race — see "2 left", tap, be refused —
// which two simultaneous buyers already produce today.
const { requestRpcJson } = require("../server/supabaseRpc");

// Vercel gives repeated query keys as arrays. Inlined rather than imported from
// socialPreview for the same reason requestRpcJson was extracted: this handler
// must not pull a React renderer into its cold start.
const firstQueryValue = (value) => (Array.isArray(value) ? value[0] : value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mirrors the slug charset the publish path emits. Shape validation, not an
// allowlist: the RPC is SECURITY DEFINER, so nothing unvalidated reaches it.
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/i;

const CACHE_SECONDS = 5;

const send = (res, status, body, cacheable) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader(
    "cache-control",
    cacheable
      ? `public, max-age=0, s-maxage=${CACHE_SECONDS}`
      // An error must never be cached: a 5 s outage would otherwise be served
      // to everyone for 5 s after it ended.
      : "no-store",
  );
  res.end(JSON.stringify(body));
};

module.exports = async function eventCheckoutBundleHandler(req, res) {
  const eventId = firstQueryValue(req.query.eventId);
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const eventSlug = firstQueryValue(req.query.eventSlug);

  const byId = typeof eventId === "string" && UUID.test(eventId);
  const bySlug =
    typeof brandSlug === "string" && SLUG.test(brandSlug) &&
    typeof eventSlug === "string" && SLUG.test(eventSlug);

  // Exactly one addressing mode. Accepting both would let a caller pin an id
  // and a slug that disagree, and the RPC would silently pick one.
  if (byId === bySlug) {
    send(res, 400, { error: "bad_request" }, false);
    return;
  }

  try {
    const data = await requestRpcJson("pg_direct_event_checkout_bundle", {
      p_event_id: byId ? eventId : null,
      p_brand_slug: bySlug ? brandSlug : null,
      p_event_slug: bySlug ? eventSlug : null,
    });

    if (data === null || data === undefined) {
      // The reader returning null means "not visible to anonymous". Cached
      // like a hit, because a bad or unpublished link under a crowd is exactly
      // the traffic this endpoint exists to absorb. Five seconds is also the
      // longest a newly published event stays invisible.
      send(res, 404, { error: "not_found" }, true);
      return;
    }

    send(res, 200, data, true);
  } catch {
    // Uncached, and the client falls back to calling Supabase directly, so an
    // outage here degrades to today's behaviour rather than to a broken page.
    send(res, 502, { error: "upstream_unavailable" }, false);
  }
};
