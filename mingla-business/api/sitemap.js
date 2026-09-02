const { requestRpcJson } = require("../server/supabaseRpc");
const { PUBLIC_HOST_ORIGIN, buildRedirectTarget } = require("../server/publicSearchDocument");

const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]);

const safeLastModified = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

const buildSitemapXml = (rows) => {
  const byPath = new Map();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
      const canonicalPath = typeof row.canonical_path === "string" ? row.canonical_path : "";
      const lastModified = safeLastModified(row.last_modified);
      if (!buildRedirectTarget(canonicalPath) || !lastModified) continue;
      const previous = byPath.get(canonicalPath);
      if (!previous || previous < lastModified) byPath.set(canonicalPath, lastModified);
    }
  }
  const entries = [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, lastModified]) => `  <url><loc>${escapeXml(`${PUBLIC_HOST_ORIGIN}${path}`)}</loc><lastmod>${escapeXml(lastModified)}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries ? `\n${entries}\n` : ""}</urlset>\n`;
};

module.exports = async function sitemapHandler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "private, no-store, max-age=0");
    res.end(method === "HEAD" ? "" : "Method not allowed");
    return;
  }
  try {
    const rows = await requestRpcJson("list_public_search_sitemap", {});
    const body = buildSitemapXml(rows);
    res.statusCode = 200;
    res.setHeader("content-type", "application/xml; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(method === "HEAD" ? "" : body);
  } catch {
    res.statusCode = 503;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "private, no-store, max-age=0");
    res.setHeader("retry-after", "60");
    res.setHeader("x-robots-tag", "noindex");
    res.end(method === "HEAD" ? "" : "Sitemap temporarily unavailable");
  }
};

module.exports.buildSitemapXml = buildSitemapXml;
