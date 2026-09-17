// Unlisted RSVP invite link — cached RSVP public-read endpoint.
//
// Same contract as event-checkout-bundle.js (#2879) and trip-checkout-bundle.js
// (#426): s-maxage=5, no stale-while-revalidate, no-store on errors. Wraps the
// canonical SECURITY DEFINER RPC `pg_public_rsvp_by_slug`, which answers public
// and unlisted RSVPs by exact slug and NULL for everything else (private, draft,
// unknown), so a 404 here is indistinguishable across those.
//
// The web public event page asks this only after the ticketed bundle and the
// public view have both missed, so bad-link traffic stays on the CDN instead of
// reaching the database. Do NOT CDN publicSearchDocument HTML (#2986).
const { requestRpcJson } = require("../server/supabaseRpc");

const firstQueryValue = (value) => (Array.isArray(value) ? value[0] : value);

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

module.exports = async function rsvpEventBundleHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const eventSlug = firstQueryValue(req.query.eventSlug);

  const bySlug =
    typeof brandSlug === "string" &&
    SLUG.test(brandSlug) &&
    typeof eventSlug === "string" &&
    SLUG.test(eventSlug);

  if (!bySlug) {
    send(res, 400, { error: "bad_request" }, false);
    return;
  }

  try {
    const data = await requestRpcJson("pg_public_rsvp_by_slug", {
      p_brand_slug: brandSlug,
      p_event_slug: eventSlug,
    });

    if (data === null || data === undefined) {
      send(res, 404, { error: "not_found" }, true);
      return;
    }

    send(res, 200, data, true);
  } catch {
    // Uncached, and the client falls back to calling Supabase directly.
    send(res, 502, { error: "upstream_unavailable" }, false);
  }
};
