/* global __dirname, Buffer */

const fs = require("node:fs");
const path = require("node:path");

const React = require("react");

const DEFAULT_SUPABASE_URL = "https://gqnoajqerqhnvulmnyvv.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJn" +
  "cW5vYWpxZXJxaG52dWxtbnl2diIsInJvbGUiOiJhbm9uIiwiaWF0" +
  "IjoxNzU3NTA1MjcyLCJleHAiOjIwNzMwODEyNzJ9.p4yi9yD2RWf" +
  "J2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo";

const PUBLIC_ORIGIN = (
  process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL ||
  "https://business.usemingla.com"
).replace(/\/+$/, "");

const SUPABASE_URL = (
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  DEFAULT_SUPABASE_URL
).replace(/\/+$/, "");

const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY;

const LOGO_PUBLIC_PATH = "/brand/mingla-business-logo.png";
const LOGO_FILE_PATH = path.join(
  __dirname,
  "..",
  "public",
  "brand",
  "mingla-business-logo.png",
);

const logoImageSource = () => {
  if (!fs.existsSync(LOGO_FILE_PATH)) {
    return `${PUBLIC_ORIGIN}${LOGO_PUBLIC_PATH}`;
  }
  return `data:image/png;base64,${fs.readFileSync(LOGO_FILE_PATH).toString("base64")}`;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

const asText = (value, fallback = "") => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const truncate = (value, max) => {
  const text = asText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
};

const isAbsoluteHttpUrl = (value) => {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const eventPublicPath = (row) =>
  `/e/${encodeURIComponent(row.brand_slug)}/${encodeURIComponent(row.slug)}`;

const brandPublicPath = (row) => `/b/${encodeURIComponent(row.brand_slug)}`;

const eventPublicUrl = (row) => `${PUBLIC_ORIGIN}${eventPublicPath(row)}`;

const brandPublicUrl = (row) => `${PUBLIC_ORIGIN}${brandPublicPath(row)}`;

const eventOgFallbackUrl = (row) =>
  `${PUBLIC_ORIGIN}/og/event/${encodeURIComponent(row.id)}.png`;

const brandOgFallbackUrl = (row) =>
  `${PUBLIC_ORIGIN}/og/brand/${encodeURIComponent(row.brand_slug)}.png`;

const eventImageUrl = (row) => {
  if (isAbsoluteHttpUrl(row.cover_media_url) && row.cover_media_type !== "video") {
    return row.cover_media_url;
  }
  return eventOgFallbackUrl(row);
};

const brandImageUrl = (row) => {
  if (isAbsoluteHttpUrl(row.brand_profile_photo_url)) {
    return row.brand_profile_photo_url;
  }
  return brandOgFallbackUrl(row);
};

const requestJson = async (pathname, searchParams) => {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${pathname}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase public preview read failed: ${response.status}`);
  }

  return response.json();
};

const fetchPublicEventBySlug = async (brandSlug, eventSlug) => {
  const rows = await requestJson("business_public_events_view", {
    select: "*",
    brand_slug: `eq.${brandSlug}`,
    slug: `eq.${eventSlug}`,
    limit: "1",
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const fetchPublicEventById = async (eventId) => {
  const rows = await requestJson("business_public_events_view", {
    select: "*",
    id: `eq.${eventId}`,
    limit: "1",
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const fetchPublicBrandBySlug = async (brandSlug) => {
  const rows = await requestJson("business_public_events_view", {
    select: "*",
    brand_slug: `eq.${brandSlug}`,
    order: "published_at.desc.nullslast",
  });
  return Array.isArray(rows) ? rows : [];
};

const eventDescription = (row) =>
  truncate(
    row.description ||
      `Get tickets for ${row.title} by ${row.brand_name} on Mingla.`,
    200,
  );

const brandDescription = (row, count) =>
  truncate(
    row.brand_description ||
      `Discover ${count} event${count === 1 ? "" : "s"} from ${row.brand_name} on Mingla.`,
    200,
  );

const eventDate = (row) => {
  const theme =
    row.public_theme !== null &&
    typeof row.public_theme === "object" &&
    !Array.isArray(row.public_theme)
      ? row.public_theme
      : {};
  const businessEvent =
    theme.business_event !== null &&
    typeof theme.business_event === "object" &&
    !Array.isArray(theme.business_event)
      ? theme.business_event
      : {};
  const when =
    businessEvent.when !== null &&
    typeof businessEvent.when === "object" &&
    !Array.isArray(businessEvent.when)
      ? businessEvent.when
      : {};
  return asText(when.date, "");
};

const formatDate = (value) => {
  const date = asText(value);
  if (date.length === 0) return "Date to be announced";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
};

const pageShell = ({ title, description, canonicalUrl, imageUrl, type, body }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:site_name" content="Mingla Business" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="${escapeHtml(type)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <link rel="icon" href="${LOGO_PUBLIC_PATH}" />
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #050505; color: #fff7ef; }
    .page { max-width: 1040px; margin: 0 auto; padding: 34px 20px 52px; }
    .brand { display: flex; align-items: center; gap: 14px; color: #f47c20; font-weight: 800; letter-spacing: .02em; text-decoration: none; }
    .brand img { width: 72px; height: 72px; object-fit: contain; }
    .hero { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; margin-top: 28px; }
    .media { width: 100%; aspect-ratio: 16 / 9; border-radius: 24px; object-fit: cover; background: linear-gradient(135deg, #1a1410, #f47c20); border: 1px solid rgba(244, 124, 32, .22); }
    h1 { margin: 0; font-size: clamp(42px, 8vw, 82px); line-height: .92; letter-spacing: 0; }
    p { color: #ead7c7; font-size: 20px; line-height: 1.55; max-width: 760px; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0; color: #f8dfc7; }
    .pill { border: 1px solid rgba(244, 124, 32, .32); border-radius: 999px; padding: 10px 14px; background: rgba(244, 124, 32, .12); }
    .cta { display: inline-flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 24px; border-radius: 999px; background: #f47c20; color: #090909; font-weight: 800; text-decoration: none; }
    .grid { display: grid; gap: 16px; margin-top: 26px; }
    .card { border: 1px solid rgba(244, 124, 32, .18); border-radius: 18px; padding: 18px; background: rgba(255,255,255,.055); color: inherit; text-decoration: none; }
    .card strong { display: block; font-size: 22px; margin-bottom: 6px; }
    @media (min-width: 840px) { .hero.has-media { grid-template-columns: .92fr 1.08fr; align-items: center; } }
  </style>
</head>
<body>
  <main class="page">
    <a class="brand" href="${PUBLIC_ORIGIN}" aria-label="Mingla Business">
      <img src="${LOGO_PUBLIC_PATH}" alt="" />
      <span>Mingla Business</span>
    </a>
    ${body}
  </main>
</body>
</html>`;

const renderEventHtml = (row) => {
  const title = `${row.title} by ${row.brand_name} | Mingla`;
  const description = eventDescription(row);
  const canonicalUrl = eventPublicUrl(row);
  const imageUrl = eventImageUrl(row);
  const location = asText(row.location_text, row.is_online ? "Online" : "");
  const media =
    isAbsoluteHttpUrl(row.cover_media_url) && row.cover_media_type !== "video"
      ? `<img class="media" src="${escapeHtml(row.cover_media_url)}" alt="${escapeHtml(row.title)} event cover" />`
      : `<img class="media" src="${escapeHtml(eventOgFallbackUrl(row))}" alt="${escapeHtml(row.title)} event preview" />`;

  return pageShell({
    title,
    description,
    canonicalUrl,
    imageUrl,
    type: "event",
    body: `<section class="hero has-media">
      <div>
        <h1>${escapeHtml(row.title)}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="meta">
          <span class="pill">${escapeHtml(row.brand_name)}</span>
          <span class="pill">${escapeHtml(formatDate(eventDate(row)))}</span>
          ${location ? `<span class="pill">${escapeHtml(location)}</span>` : ""}
        </div>
        <a class="cta" href="${escapeHtml(`${PUBLIC_ORIGIN}/checkout/${encodeURIComponent(row.id)}`)}">Get tickets</a>
      </div>
      ${media}
    </section>`,
  });
};

const renderBrandHtml = (rows) => {
  const row = rows[0];
  const title = `${row.brand_name} on Mingla`;
  const description = brandDescription(row, rows.length);
  const canonicalUrl = brandPublicUrl(row);
  const imageUrl = brandImageUrl(row);
  const cards = rows
    .slice(0, 8)
    .map(
      (event) => `<a class="card" href="${escapeHtml(eventPublicPath(event))}">
        <strong>${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(eventDescription(event))}</span>
      </a>`,
    )
    .join("");

  return pageShell({
    title,
    description,
    canonicalUrl,
    imageUrl,
    type: "profile",
    body: `<section class="hero">
      <div>
        <h1>${escapeHtml(row.brand_name)}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="meta">
          <span class="pill">@${escapeHtml(row.brand_slug)}</span>
          <span class="pill">${rows.length} event${rows.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </section>
    <section class="grid">${cards}</section>`,
  });
};

const sendHtml = (res, html, statusCode = 200) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=3600");
  res.end(html);
};

const renderNotFoundHtml = (title) =>
  pageShell({
    title,
    description: "This Mingla page could not be found.",
    canonicalUrl: PUBLIC_ORIGIN,
    imageUrl: `${PUBLIC_ORIGIN}/og/brand/mingla.png`,
    type: "website",
    body: `<section class="hero"><div><h1>${escapeHtml(title)}</h1><p>This Mingla page could not be found.</p></div></section>`,
  });

const renderOgPng = async ({ title, subtitle, kicker, coverUrl }) => {
  const { ImageResponse } = await import("@vercel/og");
  const cover = isAbsoluteHttpUrl(coverUrl) ? coverUrl : null;
  const response = new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          width: "1200px",
          height: "630px",
          display: "flex",
          position: "relative",
          background: "#050505",
          color: "#fff7ef",
          fontFamily: "Inter, Arial, sans-serif",
          overflow: "hidden",
        },
      },
      cover
        ? React.createElement("img", {
            src: cover,
            style: {
              position: "absolute",
              inset: 0,
              width: "1200px",
              height: "630px",
              objectFit: "cover",
            },
          })
        : null,
      React.createElement("div", {
        style: {
          position: "absolute",
          inset: 0,
          background: cover
            ? "linear-gradient(90deg, rgba(5,5,5,.94) 0%, rgba(5,5,5,.72) 58%, rgba(235,120,37,.9) 100%)"
            : "linear-gradient(135deg, #050505 0%, #1b120c 58%, #eb7825 100%)",
        },
      }),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "22px",
            padding: "66px 64px",
            width: "770px",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              color: "#f47c20",
              fontSize: "32px",
              fontWeight: 800,
              letterSpacing: "1px",
            },
          },
          truncate(kicker, 48),
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: "72px",
              lineHeight: 0.96,
              fontWeight: 900,
              letterSpacing: "-1px",
            },
          },
          truncate(title, 62),
        ),
        React.createElement(
          "div",
          {
            style: {
              color: "#ead7c7",
              fontSize: "34px",
              lineHeight: 1.25,
              fontWeight: 500,
            },
          },
          truncate(subtitle, 118),
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            right: "54px",
            top: "110px",
            width: "300px",
            height: "300px",
            borderRadius: "48px",
            background: "rgba(0,0,0,.64)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          },
        },
        React.createElement("img", {
          src: logoImageSource(),
          style: {
            width: "250px",
            height: "250px",
            objectFit: "contain",
          },
        }),
      ),
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            right: "72px",
            bottom: "64px",
            color: "#090909",
            fontSize: "30px",
            fontWeight: 900,
          },
        },
        "business.usemingla.com",
      ),
    ),
    { width: 1200, height: 630 },
  );
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const sendPng = (res, buffer) => {
  res.statusCode = 200;
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=86400");
  res.end(buffer);
};

const firstQueryValue = (value) => (Array.isArray(value) ? value[0] : value);

module.exports = {
  PUBLIC_ORIGIN,
  brandDescription,
  brandImageUrl,
  brandPublicUrl,
  escapeHtml,
  eventDescription,
  eventImageUrl,
  eventPublicUrl,
  fetchPublicBrandBySlug,
  fetchPublicEventById,
  fetchPublicEventBySlug,
  firstQueryValue,
  renderBrandHtml,
  renderEventHtml,
  renderNotFoundHtml,
  renderOgPng,
  sendHtml,
  sendPng,
};
