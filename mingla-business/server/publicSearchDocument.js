const { requestRpcJson } = require("./supabaseRpc");

const PUBLIC_HOST_ORIGIN = "https://host.usemingla.com";
const APEX_ORGANIZATION_ID = "https://usemingla.com/#organization";
const ROUTE_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const ENTITY_KINDS = new Set(["event", "trip", "experience", "brand", "venue"]);
const INDEXABLE_STATE = "search_ready";
const VISIBLE_NOINDEX_STATES = new Set(["public_noindex", "stale", "expired_archived"]);
const ATTRIBUTION_KEYS = /^(?:utm_(?:source|medium|campaign|content|term)|gclid|gbraid|wbraid|fbclid|msclkid|af_[a-z0-9_]+|site_attribution)$/;

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const escapeJsonForHtml = (value) => JSON.stringify(value)
  .replace(/&/g, "\\u0026")
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const text = (value, fallback = "") => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const truncate = (value, maximum) => {
  const candidate = text(value);
  if (candidate.length <= maximum) return candidate;
  return `${candidate.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
};

const safeHttpsUrl = (value) => {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const safeIsoDate = (value) => {
  const candidate = text(value);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

const firstQueryValue = (value) => Array.isArray(value) ? value[0] : value;

const validSegment = (value) => typeof value === "string" && ROUTE_SEGMENT.test(value);

const buildPublicPath = (kind, slugs) => {
  if (!ENTITY_KINDS.has(kind) || !Array.isArray(slugs) || slugs.some((slug) => !validSegment(slug))) {
    return null;
  }
  if (kind === "brand" && slugs.length === 1) return `/b/${slugs[0]}`;
  if (kind === "venue" && slugs.length === 2) return `/b/${slugs[0]}/v/${slugs[1]}`;
  if (kind === "event" && slugs.length === 2) return `/e/${slugs[0]}/${slugs[1]}`;
  if (kind === "trip" && slugs.length === 2) return `/t/${slugs[0]}/${slugs[1]}`;
  if (kind === "experience" && slugs.length === 2) return `/exp/${slugs[0]}/${slugs[1]}`;
  return null;
};

const attributionQueryFromRequest = (req) => {
  try {
    const requestUrl = new URL(text(req?.url, "/"), PUBLIC_HOST_ORIGIN);
    const kept = new URLSearchParams();
    for (const [key, value] of requestUrl.searchParams) {
      if (ATTRIBUTION_KEYS.test(key) && value.length <= 512) kept.append(key, value);
    }
    const serialized = kept.toString();
    return serialized ? `?${serialized}` : "";
  } catch {
    return "";
  }
};

const labelForKind = (kind) => ({
  event: "Event",
  trip: "Trip",
  experience: "Experience",
  brand: "Host",
  venue: "Venue",
})[kind] || "Page";

const lifecycleNotice = (state, facts) => {
  if (state === "stale") return "This page is visible, but Mingla is rechecking its details before it can appear in search.";
  if (state === "expired_archived") {
    return facts.status === "cancelled"
      ? "This offering was cancelled. Booking is no longer available."
      : "This offering has ended. Booking is no longer available.";
  }
  return "";
};

const actionForFacts = (facts, state, canonicalPath, attributionQuery) => {
  if (state === "expired_archived" || ["ended", "cancelled"].includes(text(facts.status))) return null;
  if (facts.actionAvailable !== true) return null;
  if (facts.kind === "event" && facts.eventType === "rsvp") return { href: `${canonicalPath}${attributionQuery}#rsvp`, label: "RSVP" };
  if (facts.kind === "event") return { href: `/checkout/${encodeURIComponent(facts.id)}${attributionQuery}`, label: "Get tickets" };
  if (facts.kind === "trip") return { href: `/checkout-trip/${encodeURIComponent(facts.id)}${attributionQuery}`, label: "Reserve this trip" };
  if (facts.kind === "experience") return { href: `/checkout-experience/${encodeURIComponent(facts.id)}${attributionQuery}`, label: "Reserve this experience" };
  return null;
};

const priceLabel = (facts) => {
  if (facts.actionAvailable !== true || !Number.isSafeInteger(facts.priceCents) || facts.priceCents < 0) return "";
  if (facts.isFree === true || facts.priceCents === 0) return "Free";
  const currency = text(facts.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return "";
  try {
    return `From ${new Intl.NumberFormat("en", { style: "currency", currency }).format(facts.priceCents / 100)}`;
  } catch {
    return `From ${currency} ${(facts.priceCents / 100).toFixed(2)}`;
  }
};

const displayDate = (value, timezone) => {
  const candidate = safeIsoDate(value);
  if (!candidate) return "";
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: text(timezone, "UTC"),
    }).format(new Date(candidate));
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })
      .format(new Date(candidate));
  }
};

const visibleDescription = (facts) => truncate(
  text(facts.description) || `Discover ${text(facts.title, labelForKind(facts.kind))} on Mingla.`,
  200,
);

const documentTitle = (facts) => {
  const title = text(facts.title, labelForKind(facts.kind));
  const brand = text(facts.brandName);
  return truncate(brand && brand !== title ? `${title} by ${brand} | Mingla` : `${title} | Mingla`, 70);
};

const breadcrumbSchema = (facts, canonicalUrl) => ({
  "@type": "BreadcrumbList",
  "@id": `${canonicalUrl}#breadcrumbs`,
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Mingla", item: "https://usemingla.com/" },
    { "@type": "ListItem", position: 2, name: labelForKind(facts.kind), item: canonicalUrl },
  ],
});

const entitySchema = (facts, canonicalUrl) => {
  const base = {
    "@id": `${canonicalUrl}#entity`,
    url: canonicalUrl,
    name: text(facts.title),
    description: visibleDescription(facts),
  };
  const image = safeHttpsUrl(facts.imageUrl);
  if (image) base.image = image;

  if (facts.kind === "event") {
    const startDate = safeIsoDate(facts.startAt);
    const endDate = safeIsoDate(facts.endAt);
    const locationName = text(facts.location) || text(facts.city);
    return {
      ...base,
      "@type": "Event",
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: facts.isOnline === true
        ? "https://schema.org/OnlineEventAttendanceMode"
        : "https://schema.org/OfflineEventAttendanceMode",
      ...(facts.isOnline === true
        ? { location: { "@type": "VirtualLocation", name: "Online" } }
        : locationName ? { location: { "@type": "Place", name: locationName } } : {}),
      organizer: { "@type": "Organization", name: text(facts.brandName), url: `${PUBLIC_HOST_ORIGIN}/b/${encodeURIComponent(text(facts.brandSlug))}` },
    };
  }
  if (facts.kind === "trip") {
    return {
      ...base,
      "@type": "TouristTrip",
      provider: { "@id": APEX_ORGANIZATION_ID },
      ...(text(facts.destination) ? {
        itinerary: {
          "@type": "ItemList",
          itemListElement: [{ "@type": "ListItem", position: 1, name: text(facts.destination) }],
        },
      } : {}),
    };
  }
  if (facts.kind === "experience") {
    return {
      ...base,
      "@type": "Service",
      provider: { "@type": "Organization", name: text(facts.brandName), url: `${PUBLIC_HOST_ORIGIN}/b/${encodeURIComponent(text(facts.brandSlug))}` },
      ...(text(facts.city) ? { areaServed: text(facts.city) } : {}),
    };
  }
  if (facts.kind === "brand") {
    return { ...base, "@type": "Organization", parentOrganization: { "@id": APEX_ORGANIZATION_ID } };
  }
  return {
    ...base,
    "@type": "LocalBusiness",
    parentOrganization: { "@type": "Organization", name: text(facts.brandName) },
    ...(text(facts.city) || text(facts.countryCode) ? {
      address: {
        "@type": "PostalAddress",
        ...(text(facts.city) ? { addressLocality: text(facts.city) } : {}),
        ...(text(facts.countryCode) ? { addressCountry: text(facts.countryCode) } : {}),
      },
    } : {}),
  };
};

const jsonLdFor = (facts, canonicalUrl) => ({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": APEX_ORGANIZATION_ID, name: "Mingla", url: "https://usemingla.com/" },
    entitySchema(facts, canonicalUrl),
    breadcrumbSchema(facts, canonicalUrl),
  ],
});

const detailRows = (facts) => {
  const rows = [];
  const when = displayDate(facts.startAt, facts.timezone);
  const location = text(facts.venue) || text(facts.destination) || text(facts.location) || text(facts.city) || (facts.isOnline === true ? "Online" : "");
  if (when) rows.push(["When", when]);
  if (location) rows.push([facts.kind === "trip" ? "Destination" : "Where", location]);
  if (facts.kind === "trip" && text(facts.departure)) rows.push(["Departure", text(facts.departure)]);
  const price = priceLabel(facts);
  if (price) rows.push(["Price", price]);
  if (facts.kind === "brand" && Number.isSafeInteger(facts.eventCount)) rows.push(["Upcoming", `${facts.eventCount} event${facts.eventCount === 1 ? "" : "s"}`]);
  return rows;
};

// Exact browser runtime embedded in the no-JavaScript-safe public document.
// Kept as one owner so the shipped interaction can be executed verbatim in
// Node's synthetic-browser regression harness.
const browserRuntimeScript = (canonicalUrl) => `(function(){
  var canonical=${escapeJsonForHtml(canonicalUrl)};
  var share=document.getElementById("mingla-share");
  var shareStatus=document.getElementById("mingla-share-status");
  var fallback=document.getElementById("mingla-share-fallback");
  var fallbackInput=document.getElementById("mingla-share-fallback-input");
  var runtimeStatus=document.getElementById("mingla-runtime-status");
  function setShareStatus(message,showFallback){
    if(shareStatus)shareStatus.textContent=message;
    if(fallback)fallback.hidden=!showFallback;
  }
  function finishShare(){
    if(!share)return;
    share.disabled=false;
    share.setAttribute("aria-busy","false");
  }
  function showBootstrapFailure(){
    if(runtimeStatus)runtimeStatus.textContent="Interactive features could not load. This page and its links still work.";
  }
  if(fallbackInput){
    var selectFallback=function(){if(typeof fallbackInput.select==="function")fallbackInput.select();};
    fallbackInput.addEventListener("focus",selectFallback);
    fallbackInput.addEventListener("click",selectFallback);
  }
  if(share){
    share.addEventListener("click",async function(){
      share.disabled=true;
      share.setAttribute("aria-busy","true");
      if(typeof navigator.share==="function"){
        setShareStatus("Opening sharing options…",false);
        try{
          await navigator.share({title:document.title,url:canonical});
          setShareStatus("Shared successfully.",false);
        }catch(error){
          if(error&&error.name==="AbortError")setShareStatus("Share cancelled. Select and copy the link below if you still want to share it.",true);
          else setShareStatus("Sharing failed. Select and copy the link below.",true);
        }finally{finishShare();}
        return;
      }
      if(navigator.clipboard&&typeof navigator.clipboard.writeText==="function"){
        setShareStatus("Copying link…",false);
        try{
          await navigator.clipboard.writeText(canonical);
          setShareStatus("Link copied.",false);
        }catch(error){
          setShareStatus("Could not copy automatically. Select and copy the link below.",true);
        }finally{finishShare();}
        return;
      }
      setShareStatus("Sharing is not available here. Select and copy the link below.",true);
      finishShare();
    });
  }
  if(typeof fetch!=="function"){
    showBootstrapFailure();
    return;
  }
  fetch("/index.html",{credentials:"same-origin",headers:{"x-mingla-public-bootstrap":"1"}})
    .then(function(response){if(!response.ok)throw new Error("bootstrap_http");return response.text();})
    .then(function(html){
      if(!html)throw new Error("bootstrap_empty");
      var parsed=new DOMParser().parseFromString(html,"text/html");
      var scripts=parsed.querySelectorAll("script[src]");
      if(!scripts.length)throw new Error("bootstrap_scripts_missing");
      scripts.forEach(function(source){
        if(document.querySelector('script[data-mingla-expo="'+source.src+'"]'))return;
        var script=document.createElement("script");
        script.src=source.src;
        script.type=source.type||"text/javascript";
        script.defer=true;
        script.dataset.minglaExpo=source.src;
        document.body.appendChild(script);
      });
    }).catch(function(){showBootstrapFailure();});
})();`;

const renderVisibleDocument = ({ facts, state, canonicalPath, attributionQuery = "" }) => {
  const canonicalUrl = `${PUBLIC_HOST_ORIGIN}${canonicalPath}`;
  const title = documentTitle(facts);
  const description = visibleDescription(facts);
  const image = safeHttpsUrl(facts.imageUrl);
  const indexable = state === INDEXABLE_STATE;
  const notice = lifecycleNotice(state, facts);
  const action = actionForFacts(facts, state, canonicalPath, attributionQuery);
  const rows = detailRows(facts);
  const structuredData = indexable ? jsonLdFor(facts, canonicalUrl) : null;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="${indexable ? "index,follow,max-image-preview:large" : "noindex,follow"}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:site_name" content="Mingla" />
  <meta property="og:type" content="${facts.kind === "event" ? "event" : "website"}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ""}
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ""}
  ${structuredData ? `<script type="application/ld+json">${escapeJsonForHtml(structuredData)}</script>` : ""}
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080706;color:#fff8f1}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 5%,rgba(244,124,32,.2),transparent 30rem),#080706;color:#fff8f1}
    a{color:inherit}.shell{max-width:1120px;margin:0 auto;padding:24px clamp(18px,4vw,56px) 64px}.brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font-weight:900;letter-spacing:.02em}.brand-logo{display:block;width:auto;height:42px;max-width:170px;object-fit:contain}.hero{display:grid;gap:clamp(28px,5vw,64px);align-items:center;min-height:calc(100vh - 100px);padding:52px 0}.hero.has-image{grid-template-columns:minmax(0,1fr) minmax(280px,.78fr)}.eyebrow{color:#ff9a4d;font-size:.82rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.status{display:inline-flex;margin:18px 0 0;padding:8px 12px;border:1px solid rgba(255,154,77,.42);border-radius:999px;color:#ffd5b2}.status[role="status"]{border-color:#f2b84b;color:#ffe0a0}.hero h1{margin:14px 0 18px;font-size:clamp(2.8rem,7vw,6.8rem);line-height:.92;letter-spacing:-.05em}.summary{max-width:720px;margin:0;color:#e5d5c7;font-size:clamp(1.08rem,2vw,1.35rem);line-height:1.58}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:30px 0}.fact{padding:16px;border:1px solid rgba(255,255,255,.13);border-radius:16px;background:rgba(255,255,255,.05)}.fact dt{color:#c9b8aa;font-size:.78rem;text-transform:uppercase;letter-spacing:.1em}.fact dd{margin:7px 0 0;font-weight:750}.actions{display:flex;flex-wrap:wrap;gap:12px}.cta,.share{display:inline-flex;min-height:52px;align-items:center;justify-content:center;padding:0 24px;border-radius:999px;font:inherit;font-weight:900}.cta{background:#f47c20;color:#090807;text-decoration:none}.share{border:1px solid rgba(255,255,255,.24);background:transparent;color:#fff8f1;cursor:pointer}.share:disabled{cursor:wait;opacity:.7}.share:focus-visible,.cta:focus-visible,.brand:focus-visible,.share-fallback input:focus-visible{outline:3px solid #fff;outline-offset:4px}.share-feedback{min-height:1.5rem;margin:12px 0 0;color:#ffe0a0}.share-fallback{max-width:680px;margin:12px 0 0;padding:14px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(255,255,255,.05)}.share-fallback p{margin:0 0 8px;color:#e5d5c7}.share-fallback input{width:100%;padding:10px;border:1px solid rgba(255,255,255,.24);border-radius:9px;background:#15120f;color:#fff8f1;font:inherit;user-select:all}.runtime-status{min-height:1.3rem;margin:16px 0 0;color:#f2b84b}.cover{width:100%;max-height:72vh;aspect-ratio:4/5;border-radius:30px;object-fit:cover;border:1px solid rgba(255,255,255,.14);box-shadow:0 28px 80px rgba(0,0,0,.45)}.trust{border-top:1px solid rgba(255,255,255,.12);padding-top:24px;color:#a99a8f;font-size:.9rem}@media(max-width:780px){.hero.has-image{grid-template-columns:1fr}.hero{min-height:auto;padding-top:64px}.cover{aspect-ratio:16/10;order:-1}}
  </style>
</head>
<body><div id="root">
  <main class="shell">
    <a class="brand" href="https://usemingla.com/" aria-label="Mingla home"><img class="brand-logo" src="${PUBLIC_HOST_ORIGIN}/brand/mingla-business-logo.png" alt="Mingla" /></a>
    <article class="hero${image ? " has-image" : ""}">
      <div>
        <div class="eyebrow">${escapeHtml(labelForKind(facts.kind))}${text(facts.brandName) && facts.kind !== "brand" ? ` · ${escapeHtml(facts.brandName)}` : ""}</div>
        ${notice ? `<p class="status" role="status">${escapeHtml(notice)}</p>` : ""}
        <h1>${escapeHtml(text(facts.title, labelForKind(facts.kind)))}</h1>
        <p class="summary">${escapeHtml(description)}</p>
        ${rows.length ? `<dl class="facts">${rows.map(([term, value]) => `<div class="fact"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
        <div class="actions">${action ? `<a class="cta" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>` : ""}<button class="share" id="mingla-share" type="button" aria-describedby="mingla-share-status mingla-share-fallback">Share</button></div>
        <p class="share-feedback" id="mingla-share-status" role="status" aria-live="polite">Share this page using your device or copy its canonical link.</p>
        <div class="share-fallback" id="mingla-share-fallback" hidden><p>Select and copy this canonical Mingla link:</p><input id="mingla-share-fallback-input" aria-label="Canonical Mingla link" type="text" readonly value="${escapeHtml(canonicalUrl)}" /></div>
        <p class="runtime-status" id="mingla-runtime-status" role="status" aria-live="polite"></p>
      </div>
      ${image ? `<img class="cover" src="${escapeHtml(image)}" alt="${escapeHtml(text(facts.imageAlt, `${text(facts.title)} cover image`))}" />` : ""}
    </article>
    <footer class="trust">Public facts supplied by ${escapeHtml(text(facts.brandName, "the host"))} and served from Mingla’s authoritative Host domain.</footer>
  </main></div>
  <script>${browserRuntimeScript(canonicalUrl)}</script>
</body>
</html>`;
};

const renderStatePage = ({ status, heading, message }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(heading)} | Mingla</title><meta name="robots" content="noindex,nofollow" />
<style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#080706;color:#fff8f1}.state{max-width:680px;padding:40px;text-align:center}.code{color:#f47c20;font-weight:900;letter-spacing:.16em}h1{font-size:clamp(2.6rem,7vw,5.5rem);margin:14px 0}p{color:#d7c6b8;font-size:1.2rem;line-height:1.6}a{display:inline-block;margin-top:18px;color:#ff9a4d}</style></head>
<body><main class="state"><div class="code">${status}</div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><a href="https://usemingla.com/">Explore Mingla</a></main></body></html>`;

const cacheForState = () => "private, no-store, max-age=0, must-revalidate";

const setBaseHeaders = (res, state) => {
  res.setHeader("cache-control", cacheForState(state));
  res.setHeader("cdn-cache-control", "no-store");
  res.setHeader("vercel-cdn-cache-control", "no-store");
  res.setHeader("x-robots-tag", state === "search_ready" ? "index, follow" : "noindex");
  res.setHeader("content-security-policy", "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; connect-src 'self' https://*.supabase.co https://us.i.posthog.com https://*.posthog.com https://www.google-analytics.com https://region1.google-analytics.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("x-content-type-options", "nosniff");
};

const send = (req, res, status, state, body = "", extraHeaders = {}) => {
  res.statusCode = status;
  setBaseHeaders(res, state);
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  if (!Object.keys(extraHeaders).some((key) => key.toLowerCase() === "content-type")) {
    res.setHeader("content-type", "text/html; charset=utf-8");
  }
  res.end(req.method === "HEAD" ? "" : body);
};

const normalizeResolution = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
};

const handlePublicSearchDocument = async ({ req, res, kind, slugs }) => {
  const method = text(req.method, "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    send(req, res, 405, "dependency_failure", "Method not allowed", { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
    return;
  }
  const canonicalPath = buildPublicPath(kind, slugs);
  const attributionQuery = attributionQueryFromRequest(req);
  if (!canonicalPath) {
    send(req, res, 404, "draft", renderStatePage({ status: 404, heading: "Page not found", message: "This Mingla page does not exist or is not public." }));
    return;
  }

  let resolution;
  try {
    resolution = normalizeResolution(await requestRpcJson("resolve_public_search_document", { p_path: canonicalPath }));
  } catch {
    send(req, res, 503, "dependency_failure", renderStatePage({ status: 503, heading: "Temporarily unavailable", message: "Mingla could not verify this page right now. Please try again shortly." }), { "retry-after": "60" });
    return;
  }

  if (!resolution || resolution.valid !== true || resolution.kind !== kind || resolution.integrityOk !== true) {
    send(req, res, 503, "dependency_failure", renderStatePage({ status: 503, heading: "Temporarily unavailable", message: "Mingla could not safely verify this page right now." }), { "retry-after": "60" });
    return;
  }
  if (resolution.state === "redirected") {
    const targetPath = text(resolution.redirectTargetPath);
    if (!buildRedirectTarget(targetPath)) {
      send(req, res, 503, "dependency_failure", renderStatePage({ status: 503, heading: "Temporarily unavailable", message: "Mingla could not safely verify this page right now." }), { "retry-after": "60" });
      return;
    }
    send(req, res, 308, "redirected", "", { location: `${PUBLIC_HOST_ORIGIN}${targetPath}${attributionQuery}` });
    return;
  }
  if (resolution.state === "gone") {
    send(req, res, 410, "gone", renderStatePage({ status: 410, heading: "This page is no longer available", message: "The host removed this page. Explore Mingla to find something current." }));
    return;
  }
  if (resolution.state === "draft") {
    send(req, res, 404, "draft", renderStatePage({ status: 404, heading: "Page not found", message: "This Mingla page does not exist or is not public." }));
    return;
  }
  if (!VISIBLE_NOINDEX_STATES.has(resolution.state) && resolution.state !== INDEXABLE_STATE) {
    send(req, res, 503, "dependency_failure", renderStatePage({ status: 503, heading: "Temporarily unavailable", message: "Mingla could not safely verify this page right now." }), { "retry-after": "60" });
    return;
  }
  const facts = resolution.facts;
  if (facts === null || typeof facts !== "object" || Array.isArray(facts) || facts.kind !== kind || !text(facts.id) || !text(facts.title)) {
    if (resolution.state === "expired_archived") {
      send(req, res, 200, "expired_archived", renderStatePage({ status: "ARCHIVED", heading: "This offering has ended", message: "This page is kept as a record, but booking is no longer available." }));
      return;
    }
    send(req, res, 503, "dependency_failure", renderStatePage({ status: 503, heading: "Temporarily unavailable", message: "Mingla could not safely verify this page right now." }), { "retry-after": "60" });
    return;
  }
  send(req, res, 200, resolution.state, renderVisibleDocument({ facts, state: resolution.state, canonicalPath, attributionQuery }));
};

const buildRedirectTarget = (path) => {
  if (typeof path !== "string" || path.includes("?") || path.includes("#") || path.includes("%") || path.includes("\\") || path.includes("//")) return null;
  const candidates = [
    ["event", /^\/e\/([^/]+)\/([^/]+)$/],
    ["trip", /^\/t\/([^/]+)\/([^/]+)$/],
    ["experience", /^\/exp\/([^/]+)\/([^/]+)$/],
    ["venue", /^\/b\/([^/]+)\/v\/([^/]+)$/],
    ["brand", /^\/b\/([^/]+)$/],
  ];
  for (const [kind, expression] of candidates) {
    const match = path.match(expression);
    if (match && buildPublicPath(kind, match.slice(1)) === path) return path;
  }
  return null;
};

module.exports = {
  APEX_ORGANIZATION_ID,
  PUBLIC_HOST_ORIGIN,
  attributionQueryFromRequest,
  browserRuntimeScript,
  buildPublicPath,
  buildRedirectTarget,
  firstQueryValue,
  handlePublicSearchDocument,
  jsonLdFor,
  renderVisibleDocument,
};
