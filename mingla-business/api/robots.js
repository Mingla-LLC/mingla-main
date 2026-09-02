const { PUBLIC_HOST_ORIGIN } = require("../server/publicSearchDocument");

const ROBOTS_BODY = `User-agent: *
Allow: /e/
Allow: /t/
Allow: /exp/
Allow: /b/
Disallow: /auth/
Disallow: /account/
Disallow: /checkout/
Disallow: /checkout-trip/
Disallow: /checkout-experience/
Disallow: /pay/
Disallow: /payment/
Disallow: /connect/
Disallow: /stripe-
Disallow: /accept-brand-invitation
Disallow: /dashboard/
Disallow: /preview/
Disallow: /share/
Disallow: /s/
Disallow: /p/
Disallow: /og/
Disallow: /api/
Disallow: /*?*

Sitemap: ${PUBLIC_HOST_ORIGIN}/sitemap.xml
`;

module.exports = function robotsHandler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "private, no-store, max-age=0");
    res.end(method === "HEAD" ? "" : "Method not allowed");
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(method === "HEAD" ? "" : ROBOTS_BODY);
};

module.exports.ROBOTS_BODY = ROBOTS_BODY;
