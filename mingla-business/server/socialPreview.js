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

const eventLocationLabel = (row) =>
  asText(row.location_text, row.is_online ? "Online" : "");

const eventCoverUrl = (row) =>
  isAbsoluteHttpUrl(row.cover_media_url) && row.cover_media_type !== "video"
    ? row.cover_media_url
    : null;

const buildEventOgCardProps = (row) => ({
  cardKind: "event",
  title: row?.title || "Mingla event",
  subtitle:
    row?.description ||
    (row?.brand_name ? `Hosted by ${row.brand_name}` : "Discover events on Mingla."),
  kicker: row?.brand_name || "Mingla Business",
  coverUrl: row !== null && row !== undefined ? eventCoverUrl(row) : null,
  dateLabel: row !== null && row !== undefined ? formatDate(eventDate(row)) : "Date to be announced",
  locationLabel: row !== null && row !== undefined ? eventLocationLabel(row) : "",
});

const parseEventDateValue = (row) => {
  const date = eventDate(row);
  if (date.length === 0) return null;
  const time = new Date(`${date}T00:00:00.000Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

const chooseBrandFeatureEvent = (rows) => {
  const dated = rows
    .map((row) => ({ row, time: parseEventDateValue(row) }))
    .filter((item) => item.time !== null && item.row.status !== "cancelled");
  const active = dated.filter((item) => item.row.status !== "ended");
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const upcoming = active.filter((item) => item.time >= todayUtc);
  const candidates =
    upcoming.length > 0 ? upcoming : active.length > 0 ? active : dated;
  if (candidates.length === 0) return rows[0] ?? null;
  return candidates.sort((a, b) => a.time - b.time)[0].row;
};

const buildBrandOgCardProps = (rows) => {
  const brand = rows[0] ?? null;
  const featureEvent = chooseBrandFeatureEvent(rows);
  const eventCount = rows.length;
  const eventCountLabel = `${eventCount} event${eventCount === 1 ? "" : "s"}`;
  const featureDate =
    featureEvent !== null ? formatDate(eventDate(featureEvent)) : "";
  const nextEventLabel =
    featureEvent !== null && asText(featureEvent.title).length > 0
      ? `${truncate(featureEvent.title, 52)}${featureDate.length > 0 ? ` - ${featureDate}` : ""}`
      : "";
  const coverUrl =
    brand !== null && isAbsoluteHttpUrl(brand.brand_profile_photo_url)
      ? brand.brand_profile_photo_url
      : featureEvent !== null
        ? eventCoverUrl(featureEvent)
        : null;

  return {
    cardKind: "brand",
    title: brand?.brand_name || "Mingla Business",
    subtitle:
      brand?.brand_description ||
      (brand
        ? `Discover events from ${brand.brand_name} on Mingla.`
        : "Create and share events on Mingla."),
    kicker: "Mingla Business",
    coverUrl,
    eventCountLabel,
    nextEventLabel,
  };
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

const renderOgPng = async ({
  title,
  subtitle,
  kicker,
  coverUrl,
  cardKind = "event",
  dateLabel = "",
  locationLabel = "",
  eventCountLabel = "",
  nextEventLabel = "",
}) => {
  const { ImageResponse } = await import("@vercel/og");
  const cover = isAbsoluteHttpUrl(coverUrl) ? coverUrl : null;
  const isBrand = cardKind === "brand";
  const primaryChip = isBrand ? eventCountLabel : dateLabel;
  const secondaryChip = isBrand ? nextEventLabel : locationLabel;
  const label = isBrand ? "Featured brand" : "Featured event";
  const accentLabel = isBrand ? "Mingla Business" : truncate(kicker, 44);
  const response = new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          width: "1200px",
          height: "630px",
          display: "flex",
          position: "relative",
          background: "linear-gradient(135deg, #fff7ef 0%, #ffe3c8 46%, #f47c20 100%)",
          color: "#16110d",
          fontFamily: "Inter, Arial, sans-serif",
          overflow: "hidden",
        },
      },
      cover
        ? React.createElement("img", {
            src: cover,
            style: {
              position: "absolute",
              right: "54px",
              top: "64px",
              width: "396px",
              height: "438px",
              objectFit: "cover",
              borderRadius: "40px",
            },
          })
        : null,
      React.createElement("div", {
        style: {
          position: "absolute",
          inset: 0,
          background: cover
            ? "linear-gradient(90deg, rgba(255,247,239,.99) 0%, rgba(255,247,239,.97) 54%, rgba(255,227,200,.68) 72%, rgba(244,124,32,.26) 100%)"
            : "radial-gradient(circle at 88% 19%, rgba(255,255,255,.54) 0%, rgba(255,255,255,0) 25%), linear-gradient(135deg, #fff7ef 0%, #ffe3c8 55%, #f47c20 100%)",
        },
      }),
      React.createElement("div", {
        style: {
          position: "absolute",
          right: "-120px",
          bottom: "-170px",
          width: "470px",
          height: "470px",
          borderRadius: "235px",
          background: "rgba(159,70,14,.18)",
        },
      }),
      React.createElement("div", {
        style: {
          position: "absolute",
          left: "42px",
          top: "42px",
          right: "42px",
          bottom: "42px",
          borderRadius: "48px",
          border: "2px solid rgba(244,124,32,.20)",
          background: "rgba(255,250,243,.58)",
        },
      }),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            padding: "70px 70px",
            width: "642px",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "16px",
              color: "#9a430d",
              fontSize: "24px",
              fontWeight: 800,
              letterSpacing: "0.8px",
            },
          },
          React.createElement("div", {
            style: {
              width: "46px",
              height: "6px",
              borderRadius: "999px",
              background: "#f47c20",
            },
          }),
          label,
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
            },
          },
          primaryChip
            ? React.createElement(
                "div",
                {
                  style: {
                    padding: "10px 16px",
                    borderRadius: "999px",
                    background: "#16110d",
                    color: "#fff7ef",
                    fontSize: "23px",
                    fontWeight: 900,
                  },
                },
                truncate(primaryChip, 46),
              )
            : null,
          secondaryChip
            ? React.createElement(
                "div",
                {
                  style: {
                    padding: "10px 16px",
                    borderRadius: "999px",
                    background: "rgba(244,124,32,.18)",
                    color: "#5e2609",
                    fontSize: "22px",
                    fontWeight: 800,
                    maxWidth: "470px",
                  },
                },
                truncate(secondaryChip, 54),
              )
            : null,
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: isBrand ? "76px" : "70px",
              lineHeight: 0.94,
              fontWeight: 900,
              letterSpacing: "0",
              maxWidth: "610px",
            },
          },
          truncate(title, 54),
        ),
        React.createElement(
          "div",
          {
            style: {
              color: "#4a2b19",
              fontSize: "28px",
              lineHeight: 1.25,
              fontWeight: 600,
              maxWidth: "570px",
            },
          },
          truncate(subtitle, 96),
        ),
        React.createElement(
          "div",
          {
            style: {
              marginTop: "8px",
              color: "#9a430d",
              fontSize: "25px",
              fontWeight: 900,
            },
          },
          accentLabel,
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            right: "78px",
            top: cover ? "390px" : "106px",
            width: cover ? "212px" : "318px",
            height: cover ? "128px" : "318px",
            borderRadius: cover ? "30px" : "46px",
            background: "#fffaf3",
            boxShadow: "0 24px 70px rgba(22,17,13,.20)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid rgba(244,124,32,.24)",
          },
        },
        React.createElement("img", {
          src: logoImageSource(),
          style: {
            width: cover ? "176px" : "250px",
            height: cover ? "96px" : "250px",
            objectFit: "contain",
          },
        }),
      ),
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            right: "78px",
            bottom: "72px",
            color: "#5e2609",
            fontSize: "26px",
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
  buildBrandOgCardProps,
  buildEventOgCardProps,
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
