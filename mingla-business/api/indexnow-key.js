const configuredKey = () => {
  const value = String(process.env.INDEXNOW_KEY || "").trim();
  return /^[A-Za-z0-9-]{8,128}$/.test(value) ? value : null;
};

module.exports = function indexNowKeyHandler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.setHeader("cache-control", "private, no-store");
    res.end(method === "HEAD" ? "" : "Method not allowed");
    return;
  }
  const key = configuredKey();
  if (key === null) {
    res.statusCode = 404;
    res.setHeader("cache-control", "private, no-store");
    res.end(method === "HEAD" ? "" : "Not Found");
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=300, max-age=300");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-robots-tag", "noindex");
  res.end(method === "HEAD" ? "" : key);
};

module.exports.configuredKey = configuredKey;
