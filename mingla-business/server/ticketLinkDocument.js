const { browserRuntimeScript } = require("./publicSearchBrowserRuntime");
const { publicDocumentCsp } = require("./publicSearchDocument");
const {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} = require("./supabaseRpc");

const PUBLIC_ORIGIN = "https://host.usemingla.com";
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

const firstQueryValue = (value) => Array.isArray(value) ? value[0] : value;

const safeImage = (value) => {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const previewTicketLink = async (token) => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ticket-link-public`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ op: "preview", token }),
  });
  if (!response.ok) throw new Error("ticket link preview unavailable");
  return response.json();
};

const documentFor = (token, preview) => {
  const active = preview && preview.state === "active";
  const eventTitle = active && typeof preview.eventTitle === "string"
    ? preview.eventTitle.trim()
    : "Private invitation";
  const brandName = active && typeof preview.brandName === "string"
    ? preview.brandName.trim()
    : "Mingla";
  const title = active ? `${eventTitle} · Private invitation | Mingla` : "Private invitation | Mingla";
  const description = active
    ? preview.kind === "guest_list"
      ? `${brandName} invited you to join the guest list for ${eventTitle}.`
      : `${brandName} shared private ticket access for ${eventTitle}.`
    : "Open this private Mingla invitation to see whether it is still available.";
  const image = active ? safeImage(preview.ogImageUrl) : "";
  const canonicalUrl = `${PUBLIC_ORIGIN}/g/${encodeURIComponent(token)}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<meta name="referrer" content="no-referrer" />
<meta property="og:site_name" content="Mingla" /><meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ""}
<style id="mingla-public-document-style">:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#0c0e12;color:#fff}*{box-sizing:border-box}body{margin:0;background:#0c0e12}.shell{min-height:100vh;display:grid;place-items:center;padding:28px}.card{max-width:560px;text-align:center;padding:34px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(255,255,255,.05)}.mark{color:#ff8b55;font-size:.78rem;font-weight:800;letter-spacing:.15em;text-transform:uppercase}h1{margin:12px 0;font-size:clamp(2rem,7vw,4rem);line-height:1}p{margin:0;color:#c9c6c2;line-height:1.55}</style>
</head><body><div id="root"><main class="shell"><section class="card"><div class="mark">Private Mingla link</div><h1>${escapeHtml(eventTitle)}</h1><p>${escapeHtml(description)}</p><p id="mingla-runtime-status" role="status" aria-live="polite"></p></section></main></div>
<script>${browserRuntimeScript(canonicalUrl)}</script></body></html>`;
};

const setHeaders = (res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("cdn-cache-control", "no-store");
  res.setHeader("vercel-cdn-cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-security-policy", publicDocumentCsp());
};

const handleTicketLinkDocument = async (req, res) => {
  const method = String(req.method || "GET").toUpperCase();
  setHeaders(res);
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end(method === "HEAD" ? "" : "Method not allowed");
    return;
  }
  const token = firstQueryValue(req.query.token);
  if (typeof token !== "string" || !TOKEN.test(token)) {
    res.statusCode = 404;
    res.end(method === "HEAD" ? "" : documentFor("invalid-link-token", { state: "not_found" }));
    return;
  }
  let preview = { state: "not_found" };
  try {
    preview = await previewTicketLink(token);
  } catch {
    // The app still boots and performs its authoritative resolve. The server
    // shell stays generic so an upstream failure never exposes stale facts.
  }
  res.statusCode = 200;
  const body = documentFor(token, preview);
  res.end(method === "HEAD" ? "" : body);
};

module.exports = {
  documentFor,
  handleTicketLinkDocument,
  previewTicketLink,
};
