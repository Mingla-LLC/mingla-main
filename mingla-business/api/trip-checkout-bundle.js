// #426 G1 / mirrors issue #2879 A — cached trip public-read endpoint.
//
// Same contract as event-checkout-bundle.js: s-maxage=5, no SWR, no-store on
// errors. Wraps the canonical SECURITY DEFINER RPC `pg_public_trip_by_slug`.
// Do NOT CDN publicSearchDocument HTML (#2986).
const { requestRpcJson } = require("../server/supabaseRpc");

const firstQueryValue = (value) => (Array.isArray(value) ? value[0] : value);

const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/i;
const CACHE_SECONDS = 5;

const send = (res, status, body, cacheable) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader(
    "cache-control",
    cacheable
      ? `public, max-age=0, s-maxage=${CACHE_SECONDS}`
      : "no-store",
  );
  res.end(JSON.stringify(body));
};

module.exports = async function tripCheckoutBundleHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const tripSlug = firstQueryValue(req.query.tripSlug);

  const bySlug =
    typeof brandSlug === "string" &&
    SLUG.test(brandSlug) &&
    typeof tripSlug === "string" &&
    SLUG.test(tripSlug);

  if (!bySlug) {
    send(res, 400, { error: "bad_request" }, false);
    return;
  }

  try {
    const data = await requestRpcJson("pg_public_trip_by_slug", {
      p_brand_slug: brandSlug,
      p_event_slug: tripSlug,
    });

    if (data === null || data === undefined) {
      send(res, 404, { error: "not_found" }, true);
      return;
    }

    send(res, 200, data, true);
  } catch {
    send(res, 502, { error: "upstream_unavailable" }, false);
  }
};
