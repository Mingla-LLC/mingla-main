// #426 G1 / mirrors issue #2879 A — cached experience public-read endpoint.
//
// Same contract as event-checkout-bundle.js: s-maxage=5, no SWR, no-store on
// errors. Wraps `pg_public_experience_by_slug`. Do NOT CDN publicSearchDocument
// HTML (#2986).
const { requestRpcJson } = require("../server/supabaseRpc");
const { withBuyGateAnswers } = require("../server/buyGateAnswers");

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

module.exports = async function experienceCheckoutBundleHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const experienceSlug = firstQueryValue(req.query.experienceSlug);

  const bySlug =
    typeof brandSlug === "string" &&
    SLUG.test(brandSlug) &&
    typeof experienceSlug === "string" &&
    SLUG.test(experienceSlug);

  if (!bySlug) {
    send(res, 400, { error: "bad_request" }, false);
    return;
  }

  try {
    const data = await requestRpcJson("pg_public_experience_by_slug", {
      p_brand_slug: brandSlug,
      p_experience_slug: experienceSlug,
    });

    if (data === null || data === undefined) {
      send(res, 404, { error: "not_found" }, true);
      return;
    }

    // #4518 — only checkoutAccessMode: the experience RPC already carries a
    // server-computed `bookable`, so brandCanCollect is never added here.
    send(res, 200, await withBuyGateAnswers(data, { brandCanCollect: false }), true);
  } catch {
    send(res, 502, { error: "upstream_unavailable" }, false);
  }
};
