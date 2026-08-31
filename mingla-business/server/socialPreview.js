/* global __dirname, Buffer */

const fs = require("node:fs");
const path = require("node:path");

const React = require("react");
const { isAllowedPublicPoster, s6CardCss, wordmarkSource } = require("./cardIdentityRenderer");
const { selectSharedCardFacts } = require("@mingla/card-identity");
const { SHARED_CARD_PROXY_HEADER } = require("./sharedCardProxyAuth");
const { contentShareOneLink } = require("./contentShareService");
const { buildSharePortraitUrl, selectPreviewFacts, statusLabel, weekdayForShareTimezone, openStateForHours } = require("../../packages/sharing");

const PUBLIC_ORIGIN = (
  process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL ||
  "https://host.usemingla.com"
).replace(/\/+$/, "");

// issue #2879 — these now live in ./supabaseRpc so api/event-checkout-bundle.js
// can reach them without requiring this module, which drags in React and the
// OG-card renderer. One owner, imported here rather than duplicated.
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  requestRpcJson,
} = require("./supabaseRpc");
const EXPLORER_PUBLIC_ORIGIN = "https://usemingla.com";

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

const todayForShareTimezone=weekdayForShareTimezone;

const truncate = (value, max) => {
  const text = asText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
};

const textLength = (value) => asText(value).length;

const titleFitForLength = (length, isBrand) => {
  if (length > 74) {
    return {
      titleFontSize: isBrand ? 48 : 46,
      titleMaxChars: isBrand ? 70 : 66,
      titleMaxLines: 3,
      titleMaxHeight: 142,
      titleLineHeight: 0.98,
    };
  }
  if (length > 52) {
    return {
      titleFontSize: isBrand ? 54 : 52,
      titleMaxChars: isBrand ? 64 : 60,
      titleMaxLines: 3,
      titleMaxHeight: 154,
      titleLineHeight: 0.96,
    };
  }
  if (length > 36) {
    return {
      titleFontSize: isBrand ? 62 : 58,
      titleMaxChars: isBrand ? 58 : 54,
      titleMaxLines: 2,
      titleMaxHeight: 120,
      titleLineHeight: 0.96,
    };
  }
  return {
    titleFontSize: isBrand ? 76 : 70,
    titleMaxChars: 54,
    titleMaxLines: 2,
    titleMaxHeight: isBrand ? 146 : 134,
    titleLineHeight: 0.94,
  };
};

const buildOgTextFit = ({
  cardKind = "event",
  title,
  subtitle,
  primaryChip = "",
  secondaryChip = "",
  accentLabel = "",
}) => {
  const isBrand = cardKind === "brand";
  const titleFit = titleFitForLength(textLength(title), isBrand);
  const subtitleMaxChars = titleFit.titleMaxLines >= 3 ? 72 : 96;
  const secondaryChipMaxChars = titleFit.titleMaxLines >= 3 ? 42 : 54;
  return {
    ...titleFit,
    titleText: truncate(title, titleFit.titleMaxChars),
    subtitleText: truncate(subtitle, subtitleMaxChars),
    primaryChipText: truncate(primaryChip, 42),
    secondaryChipText: truncate(secondaryChip, secondaryChipMaxChars),
    accentText: truncate(accentLabel, titleFit.titleMaxLines >= 3 ? 34 : 44),
    subtitleMaxChars,
    subtitleMaxLines: titleFit.titleMaxLines >= 3 ? 2 : 2,
    subtitleMaxHeight: titleFit.titleMaxLines >= 3 ? 64 : 72,
    primaryChipMaxChars: 42,
    secondaryChipMaxChars,
    chipMaxHeight: 50,
    contentMaxHeight: 492,
  };
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

const brandSlug = (row) => row?.slug || row?.brand_slug || "";

const brandName = (row) => row?.name || row?.brand_name || "Mingla";

const brandDescriptionText = (row) => row?.description || row?.brand_description || "";

const brandProfilePhotoUrl = (row) =>
  row?.profile_photo_url || row?.brand_profile_photo_url || null;

const brandPublicPath = (row) => `/b/${encodeURIComponent(brandSlug(row))}`;

const eventPublicUrl = (row) => `${PUBLIC_ORIGIN}${eventPublicPath(row)}`;

const brandPublicUrl = (row) => `${PUBLIC_ORIGIN}${brandPublicPath(row)}`;

const eventOgFallbackUrl = (row) =>
  `${PUBLIC_ORIGIN}/og/event/${encodeURIComponent(row.id)}.png`;

const brandOgFallbackUrl = (row) =>
  `${PUBLIC_ORIGIN}/og/brand/${encodeURIComponent(brandSlug(row))}.png`;

const tripPublicPath = (row) =>
  `/t/${encodeURIComponent(row.brand_slug)}/${encodeURIComponent(row.slug)}`;

const tripPublicUrl = (row) => `${PUBLIC_ORIGIN}${tripPublicPath(row)}`;

const experiencePublicPath = (row) =>
  `/exp/${encodeURIComponent(row.brand_slug)}/${encodeURIComponent(row.slug)}`;

const experiencePublicUrl = (row) => `${PUBLIC_ORIGIN}${experiencePublicPath(row)}`;

const tripOgFallbackUrl = (row) =>
  `${PUBLIC_ORIGIN}/og/trip/${encodeURIComponent(row.id)}.png`;

const tripImageUrl = (row) => tripCoverUrl(row) ? tripOgFallbackUrl(row) : "";

const experienceImageUrl = (row) => eventCoverUrl(row) || "";

const eventImageUrl = (row) => eventCoverUrl(row) ? eventOgFallbackUrl(row) : "";

const brandImageUrl = (row) =>
  (isAbsoluteHttpUrl(brandProfilePhotoUrl(row)) || isAbsoluteHttpUrl(row?.cover_media_url))
    ? brandOgFallbackUrl(row) : "";

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

const fetchSharedCardSnapshot = async (shareId) => {
  if (!/^[a-f0-9]{36}$/.test(asText(shareId))) return { status: 404, snapshot: null };
  const proxySecret = process.env.SHARED_CARD_PROXY_SECRET;
  if (typeof proxySecret !== "string" || proxySecret.length === 0) {
    return { status: 503, snapshot: null };
  }
  const response = await fetch(`${SUPABASE_URL}/functions/v1/shared-card?shareId=${encodeURIComponent(shareId)}`, {
    redirect: "manual",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      [SHARED_CARD_PROXY_HEADER]: proxySecret,
    },
  });
  if (response.status === 410) return { status: 410, snapshot: null };
  if (!response.ok) return { status: response.status, snapshot: null };
  const body = await response.json();
  return { status: 200, snapshot: body?.snapshot ?? null, appUrl: body?.appUrl ?? null, canonicalUrl: body?.canonicalUrl ?? null };
};

const localDateFromInstant = (instant, timeZone) => {
  const parsed = new Date(asText(instant));
  if (Number.isNaN(parsed.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: asText(timeZone, "UTC"),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return values.year && values.month && values.day
      ? `${values.year}-${values.month}-${values.day}`
      : "";
  } catch {
    return "";
  }
};

const galleryPreviewImage = (gallery) => {
  if (!Array.isArray(gallery)) return null;
  for (const item of gallery) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const mediaType = asText(item.type || item.kind || item.mediaType || item.media_type).toLowerCase();
    const url = asText(item.url);
    if (["video", "gif", "animated"].includes(mediaType) || !isAbsoluteHttpUrl(url)) continue;
    if (["image", "photo"].includes(mediaType) || /\.(?:avif|jpe?g|png|webp)(?:$|\?)/i.test(url)) return url;
  }
  return null;
};

const fetchContentShare = async (code) => {
  if (!/^[0-9A-Za-z]{16}$/.test(asText(code))) return { status: 404, contentShare: null };
  const proxySecret = process.env.SHARED_CARD_PROXY_SECRET;
  if (typeof proxySecret !== "string" || proxySecret.length === 0) return { status: 503, contentShare: null };
  const response = await fetch(`${SUPABASE_URL}/functions/v1/shared-card?code=${encodeURIComponent(code)}`, {
    redirect: "manual",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, [SHARED_CARD_PROXY_HEADER]: proxySecret },
  });
  if (response.status === 410) return { status: 410, contentShare: null };
  if (!response.ok) return { status: response.status, contentShare: null };
  const body = await response.json();
  const referralCode=typeof body?.privateInstallAttribution?.referralCode==="string"&&/^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/.test(body.privateInstallAttribution.referralCode)
    ? body.privateInstallAttribution.referralCode:"";
  return { status:200,contentShare:body?.contentShare??null,installAttribution:referralCode?{referralCode}:null };
};

const fetchContentShareVersion = async (code, version) => {
  if (!/^[0-9A-Za-z]{16}$/.test(asText(code)) || !Number.isSafeInteger(version) || version < 1) {
    return { status: 404, contentShare: null };
  }
  const proxySecret = process.env.SHARED_CARD_PROXY_SECRET;
  if (typeof proxySecret !== "string" || proxySecret.length === 0) return { status: 503, contentShare: null };
  const response = await fetch(`${SUPABASE_URL}/functions/v1/shared-card?code=${encodeURIComponent(code)}&version=${version}`, {
    redirect: "manual",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, [SHARED_CARD_PROXY_HEADER]: proxySecret },
  });
  if (response.status === 410) return { status: 410, contentShare: null };
  if (!response.ok) return { status: response.status, contentShare: null };
  const body = await response.json();
  return { status: 200, contentShare: body?.contentShare ?? null };
};

const contentSharePosterUrl = (contentShare) => {
  const media = contentShare?.media;
  if (!media || typeof media !== "object") return "";
  const candidate = media.kind === "photo" ? (media.posterUrl || media.url) : media.posterUrl;
  return isAbsoluteHttpUrl(candidate) && isAllowedPublicPoster(candidate) ? candidate : "";
};

const renderContentShareDetails = (contentShare) => {
  const details = contentShare?.publicDetails && typeof contentShare.publicDetails === "object" ? contentShare.publicDetails : {};
  const facts = contentShare?.facts || {};
  if (facts.kind === "curated" && Array.isArray(details.stops) && details.stops.length) {
    return `<section aria-labelledby="stops-heading"><h2 id="stops-heading">Stops</h2><ol class="detail-list">${details.stops.map((stop) => `<li><strong>${escapeHtml(stop?.title)}</strong>${asText(stop?.category || stop?.area) ? `<span>${escapeHtml(stop.category || stop.area)}</span>` : ""}</li>`).join("")}</ol></section>`;
  }
  if (facts.kind === "place") {
    const links = [
      isAbsoluteHttpUrl(details.directionsUrl) ? `<a class="detail-link" data-share-destination="directions" href="${escapeHtml(details.directionsUrl)}" rel="nofollow noopener">Directions</a>` : "",
      isAbsoluteHttpUrl(details.website) ? `<a class="detail-link" data-share-destination="website" href="${escapeHtml(details.website)}" rel="nofollow noopener">Website</a>` : "",
      asText(details.phone) ? `<a class="detail-link" data-share-destination="call" href="tel:${escapeHtml(details.phone.replace(/[^+0-9]/g, ""))}">Call</a>` : "",
    ].filter(Boolean).join("");
    return `${asText(details.address) ? `<section><h2>Address</h2><p>${escapeHtml(details.address)}</p></section>` : ""}${links ? `<div class="detail-actions">${links}</div>` : ""}`;
  }
  if (Array.isArray(details.occurrences) && details.occurrences.length) {
    return `<section aria-labelledby="dates-heading"><h2 id="dates-heading">Dates</h2><ul class="detail-list">${details.occurrences.map((item) => `<li><time datetime="${escapeHtml(item.startAt)}">${escapeHtml(item.startAt)}</time></li>`).join("")}</ul></section>`;
  }
  if (facts.kind === "brand" && Array.isArray(details.offerings) && details.offerings.length) {
    return `<section aria-labelledby="offerings-heading"><h2 id="offerings-heading">Upcoming</h2><ul class="detail-list">${details.offerings.map((item) => `<li><a data-share-destination="view_offering" href="${PUBLIC_ORIGIN}/${item.kind === "trip" ? "t" : item.kind === "experience" ? "exp" : "e"}/${encodeURIComponent(item.brandSlug)}/${encodeURIComponent(item.eventSlug)}">${escapeHtml(item.title)}</a></li>`).join("")}</ul></section>`;
  }
  return "";
};

const contentShareBusinessDestination = (contentShare) => {
  const factsKind = asText(contentShare?.facts?.kind);
  const destination = contentShare?.destination;
  if (!destination || typeof destination !== "object" || Array.isArray(destination)
    || asText(destination.kind) !== factsKind) return null;
  const segment = (value) => {
    const text = asText(value);
    return text && text.length <= 256 ? encodeURIComponent(text) : "";
  };
  const brand = segment(destination.brandSlug);
  const event = segment(destination.eventSlug);
  const venue = segment(destination.venueSlug);
  const path = factsKind === "event" || factsKind === "rsvp_event"
    ? brand && event ? `/e/${brand}/${event}` : ""
    : factsKind === "trip"
      ? brand && event ? `/t/${brand}/${event}` : ""
      : factsKind === "experience"
        ? brand && event ? `/exp/${brand}/${event}` : ""
        : factsKind === "venue"
          ? brand && venue ? `/b/${brand}/v/${venue}` : ""
          : factsKind === "brand" && brand ? `/b/${brand}` : "";
  if (!path || asText(destination.webPath, "") !== path) return null;
  return `${PUBLIC_ORIGIN}${path}`;
};

const renderContentShareHtml = (contentShare, installAttribution = null) => {
  const facts = contentShare?.facts && typeof contentShare.facts === "object" ? contentShare.facts : {};
  const code = asText(contentShare?.shortCode);
  const installReferralCode=typeof installAttribution?.referralCode==="string"&&/^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/.test(installAttribution.referralCode)
    ? installAttribution.referralCode:"";
  const canonicalUrl = `${EXPLORER_PUBLIC_ORIGIN}/s/${encodeURIComponent(code)}`;
  const title = asText(facts.title) || "Mingla";
  const currentOpenState=openStateForHours(facts.hours,facts.timezone);
  const previewFacts = selectPreviewFacts(currentOpenState?{...facts,openState:currentOpenState}:facts, 8);
  const description = asText(facts.description) || previewFacts.join(" · ") || `Open ${title} on Mingla.`;
  // Still the gate for the page body's MOTION layer: a video or GIF only gets
  // its animated element when there is a real poster behind it. #2589 detaches
  // only the og:image tag from this, never the motion.
  const posterUrl = contentSharePosterUrl(contentShare);
  /**
   * #2589 — `og:image` is emitted for EVERY share, covered or not.
   *
   * The portrait URL used to be gated on a usable poster, so a coverless
   * offering shipped an HTML page with no image block at all and the link
   * previewed as a bare URL — the exact hole the fallback card exists to close.
   * The image route now always has a card to serve, so the tag is always
   * truthful. It is still built inside a guard because `buildSharePortraitUrl`
   * throws on a malformed code or version, and this page must not 500 over a
   * meta tag.
   */
  const imageUrl = (() => {
    try { return buildSharePortraitUrl(code, Number(contentShare?.version)); }
    catch { return ""; }
  })();
  const alt = `${({place:"Place",curated:"Curated plan",event:"Event",rsvp_event:"RSVP event",trip:"Trip",experience:"Experience",venue:"Venue",brand:"Brand"})[facts.kind] || "Mingla"}: ${title}. ${previewFacts.slice(0, 3).join(". ")}`.trim();
  const status = statusLabel(facts.status);
  const terminal = ["sold_out", "ended", "cancelled", "rsvp_closed", "date_tbd", "dates_tbd"].includes(facts.status);
  const publicDetails = contentShare?.publicDetails && typeof contentShare.publicDetails === "object" ? contentShare.publicDetails : {};
  const analyticsKind=["place","curated","event","rsvp_event","trip","experience","venue","brand"].includes(facts.kind)?facts.kind:"place";
  const offeringActionEligible = !["event", "rsvp_event", "trip", "experience"].includes(facts.kind) || publicDetails.actionEligible === true;
  const businessDestination = contentShareBusinessDestination(contentShare);
  const offeringHref = ["event", "rsvp_event", "trip", "experience"].includes(facts.kind)
    ? businessDestination || "" : "";
  const transactionLabels={event:"Buy tickets",rsvp_event:"RSVP",trip:"Book trip",experience:"Book experience"};
  const viewLabels={event:"View event",rsvp_event:"View RSVP event",trip:"View trip",experience:"View experience"};
  const actionCodes={"Buy tickets":"buy_tickets",RSVP:"rsvp","Book trip":"book_trip","Book experience":"book_experience","View event":"view_event","View RSVP event":"view_rsvp_event","View trip":"view_trip","View experience":"view_experience","View venue":"view_venue","View brand":"view_brand"};
  const action = offeringHref ? {label:!terminal&&offeringActionEligible?transactionLabels[facts.kind]:viewLabels[facts.kind],href:offeringHref}
    : facts.kind === "venue" && businessDestination ? {label:"View venue",href:businessDestination}
    : facts.kind === "brand" && businessDestination ? {label:"View brand",href:businessDestination}: null;
  const hours = Array.isArray(facts.hours) ? facts.hours.filter((row) => row && typeof row.day === "string" && typeof row.label === "string") : [];
  const today=todayForShareTimezone(facts.timezone);
  const hoursHtml = hours.length ? `<section aria-labelledby="hours-heading"><h2 id="hours-heading">Hours</h2><ul class="hours">${hours.map((row)=>{const isToday=row.day===today;return `<li${isToday ? ' class="today"' : ""}><strong>${escapeHtml(row.day)}</strong><span>${escapeHtml(row.label)}</span>${isToday?'<em>Today</em>':row.special ? `<em>${escapeHtml(row.special)}</em>`:""}</li>`}).join("")}</ul></section>` : "";
  const media = contentShare?.media || {};
  // Moving media never redraws the identity system. These two clipped copies of
  // the exact immutable portrait keep the measured wordmark/title/plate/slivers
  // visible above motion, byte-for-byte, without mounting an unmeasured plate.
  const motionIdentity = `<img class="portrait-identity-overlay identity-wordmark" src="${escapeHtml(imageUrl)}" alt="" aria-hidden="true" /><img class="portrait-identity-overlay identity-bottom" src="${escapeHtml(imageUrl)}" alt="" aria-hidden="true" />`;
  const videoMoving = media.kind === "video" && posterUrl && isAllowedPublicPoster(media.url) ? `<video class="share-motion" muted playsinline loop preload="none" poster="${escapeHtml(imageUrl)}" data-source="${escapeHtml(media.url)}"></video>${motionIdentity}<button class="media-control play-control" type="button" aria-label="Play video">▶</button><button class="media-control sound-control" type="button" aria-label="Unmute video">Muted</button>` : "";
  const gifMoving = media.kind === "gif" && posterUrl && isAllowedPublicPoster(media.url) ? `<img class="share-motion gif-motion" alt="" data-source="${escapeHtml(media.url)}" />${motionIdentity}<button class="media-control play-control" type="button" aria-label="Play animation">▶</button>` : "";
  const moving=videoMoving||gifMoving;
  const portrait = imageUrl ? `<div class="portrait"><img class="portrait-poster" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" />${moving}</div>` : "";
  const script = videoMoving ? `<script>(()=>{const v=document.querySelector('.share-motion'),p=document.querySelector('.play-control'),m=document.querySelector('.sound-control');if(!v||!p||!m)return;v.muted=true;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,save=!!navigator.connection?.saveData;const load=()=>{v.hidden=false;if(!v.src)v.src=v.dataset.source};const reset=()=>{v.pause();v.hidden=true;v.removeAttribute('src');v.load();p.textContent='▶';p.setAttribute('aria-label','Play video')};p.addEventListener('click',()=>{load();if(v.paused){v.play().then(()=>{p.textContent='Ⅱ';p.setAttribute('aria-label','Pause video')}).catch(reset)}else reset()});m.addEventListener('click',()=>{load();v.muted=!v.muted;m.textContent=v.muted?'Muted':'Sound';m.setAttribute('aria-label',v.muted?'Unmute video':'Mute video')});new IntersectionObserver(([e])=>{if(!e.isIntersecting)reset()}).observe(v);document.addEventListener('visibilitychange',()=>{if(document.hidden)reset()});v.addEventListener('error',reset);if(!reduced&&!save){load();v.play().catch(reset)}})()</script>`
    : gifMoving ? `<script>(()=>{const g=document.querySelector('.gif-motion'),p=document.querySelector('.play-control');if(!g||!p)return;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,save=!!navigator.connection?.saveData;let playing=false;const stop=()=>{playing=false;g.hidden=true;g.removeAttribute('src');p.textContent='▶';p.setAttribute('aria-label','Play animation')};const play=()=>{g.hidden=false;g.src=g.dataset.source;playing=true;p.textContent='Ⅱ';p.setAttribute('aria-label','Pause animation')};p.addEventListener('click',()=>playing?stop():play());new IntersectionObserver(([e])=>{if(!e.isIntersecting)stop();else if(!reduced&&!save)play()}).observe(g);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});g.addEventListener('error',stop);if(!reduced&&!save)play()})()</script>` : "";
  const analyticsScript=`<script>(()=>{const record=(event,action)=>{try{const consent=JSON.parse(localStorage.getItem('mingla_consent_v1')||'null');if(consent?.choice!=='granted'&&consent?.value!=='granted')return;const payload={event,code:${JSON.stringify(code)},version:${Number(contentShare.version)},kind:${JSON.stringify(analyticsKind)}};if(action)payload.action=action;navigator.sendBeacon('/api/content-share-analytics',JSON.stringify(payload))}catch{}};record('share_public_page_viewed');document.querySelector('[data-share-install]')?.addEventListener('click',()=>record('share_install_cta_opened'));document.querySelectorAll('[data-share-destination]').forEach((node)=>node.addEventListener('click',()=>record('share_destination_action',node.dataset.shareDestination)))})()</script>`;
  const continuationScript = businessDestination
    ? `<script>window.location.replace(${JSON.stringify(businessDestination).replace(/</g, "\\u003c")})</script>` : "";
  return pageShell({ title: `${title} on Mingla`, description, canonicalUrl, imageUrl, imageType:"image/jpeg", imageWidth:1080, imageHeight:1350, imageAlt:alt, type: "article", siteName: "Mingla", headerVariant: "mingla", showHeader:false, trustedHeadHtml: continuationScript,
    body: `<style>.page{max-width:1120px;padding:32px}.content-share{display:grid;grid-template-columns:${portrait ? "min(432px,40vw) minmax(0,560px)" : "minmax(0,720px)"};gap:48px;align-items:start}.portrait{position:relative;width:100%;aspect-ratio:4/5;border-radius:32px;overflow:hidden;background:#0C0E12}.portrait-poster,.share-motion,.portrait-identity-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.share-motion{z-index:1}.portrait-identity-overlay{z-index:2;pointer-events:none}.identity-wordmark{clip-path:inset(0 55% 80% 0)}.identity-bottom{clip-path:inset(48% 0 0 0)}.media-control{position:absolute;z-index:3;top:24px;min-width:44px;height:44px;border:2px solid #FFF7EF;border-radius:22px;background:#0C0E12;color:#FFF7EF;font-size:14px}.play-control{right:24px;width:44px;font-size:18px}.sound-control{right:76px;padding:0 12px}.eyebrow{font-size:14px;text-transform:none;color:#FFF7EF}.status{display:inline-block;margin-left:8px;padding:4px 9px;border-radius:99px;background:#FFF7EF;color:#0C0E12;font-weight:700}.facts{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}.facts li{padding:7px 10px;border:1px solid rgba(255,255,255,.42);border-radius:99px}.actions,.detail-actions{display:flex;flex-wrap:wrap;gap:12px}.detail-link{display:inline-flex;min-height:44px;align-items:center;color:#FFF7EF}.detail-list li{margin:10px 0}.detail-list li span{display:block;color:rgba(255,255,255,.72)}.secondary{background:transparent;color:#FFF7EF;border:2px solid #FFF7EF}.hours{list-style:none;padding:0}.hours li{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:8px 0}.hours .today{font-weight:800}.hours em{grid-column:2;font-size:14px}.content-share h1{font-size:clamp(36px,6vw,64px);line-height:1}.content-share h2{margin-top:32px}@media(max-width:759px){.page{padding:16px}.content-share{grid-template-columns:1fr;gap:24px}.portrait{max-width:432px;margin:auto}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}</style><section class="content-share">${portrait}<div><p class="eyebrow">${escapeHtml(({place:"Place",curated:"Curated plan",event:"Event",rsvp_event:"RSVP event",trip:"Trip",experience:"Experience",venue:"Venue",brand:"Brand"})[facts.kind] || "Mingla")}${status ? `<span class="status">● ${escapeHtml(status)}</span>`:""}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><ul class="facts">${previewFacts.map((fact)=>`<li>${escapeHtml(fact)}</li>`).join("")}</ul><div class="actions">${action ? `<a class="cta" data-share-destination="${actionCodes[action.label]}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`:""}<a class="cta secondary" data-share-install href="${escapeHtml(contentShareOneLink(code,installReferralCode))}">Open or get Mingla</a></div>${renderContentShareDetails(contentShare)}${hoursHtml}</div></section>${script}${analyticsScript}` });
};

const directEventBundleToPreviewRow = (payload) => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const brand = payload.brand !== null && typeof payload.brand === "object" && !Array.isArray(payload.brand)
    ? payload.brand : {};
  const id = asText(payload.id);
  const eventSlug = asText(payload.eventSlug);
  const brandSlugValue = asText(payload.brandSlug);
  const title = asText(payload.name);
  const coverGallery = Array.isArray(payload.coverGallery) ? payload.coverGallery : [];
  const primaryCoverType = asText(payload.coverMediaType).toLowerCase();
  const primaryCoverUrl = asText(payload.coverMediaUrl);
  const previewCoverUrl = primaryCoverType === "video"
    ? galleryPreviewImage(coverGallery)
    : primaryCoverUrl;
  const previewCoverType = primaryCoverType === "video" && previewCoverUrl ? "image" : primaryCoverType;
  const eventLocalDate = localDateFromInstant(payload.masterStartAt, payload.timezone);
  if (!id || !eventSlug || !brandSlugValue || !title) return null;
  return {
    id,
    brand_id: asText(payload.brandId),
    brand_slug: brandSlugValue,
    brand_name: asText(brand.name, "Mingla"),
    brand_description: "",
    brand_profile_photo_url: asText(brand.profilePhotoUrl) || null,
    title,
    description: asText(payload.description),
    slug: eventSlug,
    event_type: "event",
    location_text: asText(payload.venueName),
    is_online: payload.isOnline === true,
    cover_media_url: previewCoverUrl || null,
    cover_media_type: previewCoverType || null,
    cover_media_credit: asText(payload.coverMediaCredit) || null,
    cover_media_gallery: coverGallery,
    status: asText(payload.status),
    master_start_at: asText(payload.masterStartAt) || null,
    master_end_at: asText(payload.masterEndAt) || null,
    master_timezone: asText(payload.timezone) || null,
    city: asText(payload.city) || null,
    public_theme: {
      business_event: {
        when: { date: eventLocalDate },
      },
    },
  };
};

const fetchRsvpFallback = async (searchParams) => {
  const rows = await requestJson("business_public_events_view", {
    select: "*",
    ...searchParams,
    event_type: "eq.rsvp",
    limit: "1",
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const fetchPublicEventBySlug = async (brandSlug, eventSlug) => {
  const direct = directEventBundleToPreviewRow(await requestRpcJson("pg_direct_event_checkout_bundle", {
    p_event_id: null,
    p_brand_slug: brandSlug,
    p_event_slug: eventSlug,
  }));
  if (direct) return direct;
  return fetchRsvpFallback({ brand_slug: `eq.${brandSlug}`, slug: `eq.${eventSlug}` });
};

const fetchPublicEventById = async (eventId) => {
  const direct = directEventBundleToPreviewRow(await requestRpcJson("pg_direct_event_checkout_bundle", {
    p_event_id: eventId,
    p_brand_slug: null,
    p_event_slug: null,
  }));
  if (direct) return direct;
  return fetchRsvpFallback({ id: `eq.${eventId}` });
};

const fetchPublicBrandEvents = async (brandSlug) => {
  const eventRows = await requestJson("business_public_events_view", {
    select: "*",
    brand_slug: `eq.${brandSlug}`,
    order: "published_at.desc.nullslast",
  });
  return Array.isArray(eventRows) ? eventRows : [];
};

const fetchPublicBrandBySlug = async (brandSlug) => {
  const claimedRows = await requestJson("claimed_venues_public_view", {
    select: "*",
    slug: `eq.${brandSlug}`,
    limit: "1",
  });
  const events = await fetchPublicBrandEvents(brandSlug);
  if (Array.isArray(claimedRows) && claimedRows.length > 0) {
    return {
      brand: claimedRows[0],
      venue: claimedRows[0],
      events,
    };
  }

  const brandRows = await requestJson("business_public_brands_view", {
    select: "*",
    slug: `eq.${brandSlug}`,
    limit: "1",
  });
  if (!Array.isArray(brandRows) || brandRows.length === 0) return null;
  return {
    brand: brandRows[0],
    venue: null,
    events,
  };
};

const fetchPublicVenueBySlug = async (brandSlugValue, venueSlug) => {
  const rows = await requestJson("venue_public_view", {
    select: "*", brand_slug: `eq.${brandSlugValue}`, slug: `eq.${venueSlug}`, limit: "1",
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const venue = rows[0];
  const events = await fetchPublicBrandEvents(brandSlugValue);
  return { brand: { ...venue, description: venue.pitch, profile_photo_url: venue.cover_media_url }, venue, events, canonicalBrandSlug: brandSlugValue };
};

const isTripRow = (row) => {
  if (row === null || typeof row !== "object") return false;
  const theme =
    row.public_theme !== null &&
    typeof row.public_theme === "object" &&
    !Array.isArray(row.public_theme)
      ? row.public_theme
      : {};
  return (
    theme.business_trip !== null &&
    typeof theme.business_trip === "object" &&
    !Array.isArray(theme.business_trip)
  );
};

const fetchPublicTripBySlug = async (brandSlug, tripSlug) => {
  const rows = await requestJson("business_public_events_view", {
    select: "*",
    brand_slug: `eq.${brandSlug}`,
    slug: `eq.${tripSlug}`,
    limit: "1",
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  return isTripRow(row) ? row : null;
};

const fetchPublicTripById = async (tripId) => {
  const rows = await requestJson("business_public_events_view", {
    select: "*",
    id: `eq.${tripId}`,
    limit: "1",
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  return isTripRow(row) ? row : null;
};

const fetchPublicExperienceBySlug = async (brandSlug, experienceSlug) => {
  const rows = await requestJson("business_public_events_view", {
    select: "*",
    brand_slug: `eq.${brandSlug}`,
    slug: `eq.${experienceSlug}`,
    event_type: "eq.experience",
    limit: "1",
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
};

const eventDescription = (row) =>
  truncate(
    row.description ||
      `Get tickets for ${row.title} by ${row.brand_name} on Mingla.`,
    200,
  );

const tripDescription = (row) =>
  truncate(
    row.description ||
      `Reserve your spot on ${row.title} by ${row.brand_name} on Mingla.`,
    200,
  );

const experienceDescription = (row) =>
  truncate(
    row.description ||
      `Reserve ${row.title} by ${row.brand_name} on Mingla.`,
    200,
  );

const brandDescription = (row, count) =>
  truncate(
    brandDescriptionText(row) ||
      `Discover ${count} event${count === 1 ? "" : "s"} from ${brandName(row)} on Mingla.`,
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

const buildEventOgCardProps = (row) => {
  const title = row?.title || "Mingla event";
  const subtitle =
    row?.description ||
    (row?.brand_name ? `Hosted by ${row.brand_name}` : "Discover events on Mingla.");
  const kicker = row?.brand_name || "Mingla";
  const dateLabel =
    row !== null && row !== undefined
      ? formatDate(eventDate(row))
      : "Date to be announced";
  const locationLabel =
    row !== null && row !== undefined ? eventLocationLabel(row) : "";
  return {
    cardKind: "event",
    title,
    subtitle,
    kicker,
    coverUrl: row !== null && row !== undefined ? eventCoverUrl(row) : null,
    dateLabel,
    locationLabel,
    textFit: buildOgTextFit({
      cardKind: "event",
      title,
      subtitle,
      primaryChip: dateLabel,
      secondaryChip: locationLabel,
      accentLabel: kicker,
    }),
  };
};

const tripBusinessThemeBlock = (row) => {
  if (row === null || typeof row !== "object") return {};
  const theme =
    row.public_theme !== null &&
    typeof row.public_theme === "object" &&
    !Array.isArray(row.public_theme)
      ? row.public_theme
      : {};
  return theme.business_trip !== null &&
    typeof theme.business_trip === "object" &&
    !Array.isArray(theme.business_trip)
    ? theme.business_trip
    : {};
};

const tripStartIso = (row) => {
  const bt = tripBusinessThemeBlock(row);
  return typeof bt.startAt === "string" ? bt.startAt : "";
};

const tripEndIso = (row) => {
  const bt = tripBusinessThemeBlock(row);
  return typeof bt.endAt === "string" ? bt.endAt : "";
};

const tripDestinationLabel = (row) => {
  const bt = tripBusinessThemeBlock(row);
  return typeof bt.destinationLocationText === "string"
    ? bt.destinationLocationText
    : "";
};

const formatTripDate = (value) => {
  const iso = asText(value);
  if (iso.length === 0) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
};

const tripDateLabel = (row) => {
  const startLabel = formatTripDate(tripStartIso(row));
  const endLabel = formatTripDate(tripEndIso(row));
  if (startLabel.length === 0) return "Dates to be announced";
  if (endLabel.length === 0 || endLabel === startLabel) return startLabel;
  return `${startLabel} - ${endLabel}`;
};

const tripCoverUrl = (row) =>
  isAbsoluteHttpUrl(row.cover_media_url) && row.cover_media_type !== "video"
    ? row.cover_media_url
    : null;

const buildTripOgCardProps = (row) => {
  const title = row?.title || "Mingla trip";
  const subtitle =
    row?.description ||
    (row?.brand_name
      ? `Hosted by ${row.brand_name}`
      : "Discover trips on Mingla.");
  const kicker = row?.brand_name || "Mingla";
  const dateLabel =
    row !== null && row !== undefined
      ? tripDateLabel(row)
      : "Dates to be announced";
  const locationLabel =
    row !== null && row !== undefined ? tripDestinationLabel(row) : "";
  return {
    cardKind: "event",
    title,
    subtitle,
    kicker,
    coverUrl: row !== null && row !== undefined ? tripCoverUrl(row) : null,
    dateLabel,
    locationLabel,
    textFit: buildOgTextFit({
      cardKind: "event",
      title,
      subtitle,
      primaryChip: dateLabel,
      secondaryChip: locationLabel,
      accentLabel: kicker,
    }),
  };
};

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

const normalizeBrandPreviewInput = (input) => {
  if (Array.isArray(input)) {
    return { brand: input[0] ?? null, venue: null, events: input };
  }
  if (input !== null && typeof input === "object") {
    return {
      brand: input.brand ?? null,
      venue: input.venue ?? null,
      events: Array.isArray(input.events) ? input.events : [],
    };
  }
  return { brand: null, venue: null, events: [] };
};

const brandListingTitle = (brandRow, venueRow) => {
  const name = brandName(brandRow);
  const city =
    venueRow !== null &&
    typeof venueRow === "object" &&
    typeof venueRow.city === "string" &&
    venueRow.city.trim().length > 0
      ? venueRow.city.trim()
      : null;
  return city !== null ? `${name} · ${city}` : name;
};

const brandSeoTitle = (brandRow, venueRow) =>
  `${brandListingTitle(brandRow, venueRow)} on Mingla`;

const buildBrandOgCardProps = (input) => {
  const { brand, events, venue } = normalizeBrandPreviewInput(input);
  const featureEvent = chooseBrandFeatureEvent(events);
  const eventCount = events.length;
  const eventCountLabel = `${eventCount} event${eventCount === 1 ? "" : "s"}`;
  const featureDate =
    featureEvent !== null ? formatDate(eventDate(featureEvent)) : "";
  const nextEventLabel =
    featureEvent !== null && asText(featureEvent.title).length > 0
      ? `${truncate(featureEvent.title, 52)}${featureDate.length > 0 ? ` - ${featureDate}` : ""}`
      : "";
  const coverUrl =
    brand !== null && isAbsoluteHttpUrl(brandProfilePhotoUrl(brand))
      ? brandProfilePhotoUrl(brand)
      : brand !== null &&
          isAbsoluteHttpUrl(brand.cover_media_url) &&
          brand.cover_media_type !== "video"
        ? brand.cover_media_url
      : featureEvent !== null
        ? eventCoverUrl(featureEvent)
        : null;

  const title =
    brand !== null ? brandListingTitle(brand, venue) : "Mingla";
  const subtitle =
    (brand !== null ? brandDescriptionText(brand) : "") ||
    (brand
      ? `Discover events from ${brandName(brand)} on Mingla.`
      : "Create and share events on Mingla.");
  const kicker = "Mingla";

  return {
    cardKind: "brand",
    title,
    subtitle,
    kicker,
    coverUrl,
    eventCountLabel,
    nextEventLabel,
    textFit: buildOgTextFit({
      cardKind: "brand",
      title,
      subtitle,
      primaryChip: eventCountLabel,
      secondaryChip: nextEventLabel,
      accentLabel: kicker,
    }),
  };
};

const pageShell = ({ title, description, canonicalUrl, imageUrl, imageType = "image/png", imageWidth = 1200, imageHeight = 630, imageAlt = "", type, body, siteName = "Mingla", headerVariant = "mingla", showHeader = true, trustedHeadHtml = "" }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:site_name" content="${escapeHtml(siteName)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="${escapeHtml(type)}" />
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />\n  <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />\n  <meta property="og:image:type" content="${escapeHtml(imageType)}" />\n  <meta property="og:image:width" content="${Number(imageWidth)}" />\n  <meta property="og:image:height" content="${Number(imageHeight)}" />\n  <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />` : ""}
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />\n  <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />` : ""}
  <link rel="icon" href="${headerVariant === "mingla" ? wordmarkSource() : LOGO_PUBLIC_PATH}" />
  ${trustedHeadHtml}
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #050505; color: #fff7ef; }
    .page { max-width: 1040px; margin: 0 auto; padding: 34px 20px 52px; }
    .brand { display: flex; align-items: center; gap: 14px; color: #f47c20; font-weight: 800; letter-spacing: .02em; text-decoration: none; }
    .brand img { width: 72px; height: 72px; object-fit: contain; }
    .brand.mingla-wordmark-pill { display: inline-flex; width: fit-content; padding: 10px 18px; border-radius: 999px; background: #fff7ef; }
    .brand.mingla-wordmark-pill img { width: 91px; height: 32px; object-fit: contain; }
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
    ${showHeader ? (headerVariant === "mingla" ? `<a class="brand mingla-wordmark-pill" href="${EXPLORER_PUBLIC_ORIGIN}" aria-label="Mingla"><img src="${wordmarkSource()}" alt="Mingla" /></a>` : `<a class="brand" href="${PUBLIC_ORIGIN}" aria-label="Mingla Host">
      <img src="${LOGO_PUBLIC_PATH}" alt="" />
      <span>Mingla Host</span>
    </a>`) : ""}
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

const renderTripHtml = (row) => {
  const title = `${row.title} by ${row.brand_name} | Mingla`;
  const description = tripDescription(row);
  const canonicalUrl = tripPublicUrl(row);
  const imageUrl = tripImageUrl(row);
  const location = tripDestinationLabel(row);
  const dateLabel = tripDateLabel(row);
  const media =
    isAbsoluteHttpUrl(row.cover_media_url) && row.cover_media_type !== "video"
      ? `<img class="media" src="${escapeHtml(row.cover_media_url)}" alt="${escapeHtml(row.title)} trip cover" />`
      : `<img class="media" src="${escapeHtml(tripOgFallbackUrl(row))}" alt="${escapeHtml(row.title)} trip preview" />`;

  return pageShell({
    title,
    description,
    canonicalUrl,
    imageUrl,
    type: "website",
    body: `<section class="hero has-media">
      <div>
        <h1>${escapeHtml(row.title)}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="meta">
          <span class="pill">${escapeHtml(row.brand_name)}</span>
          <span class="pill">${escapeHtml(dateLabel)}</span>
          ${location ? `<span class="pill">${escapeHtml(location)}</span>` : ""}
        </div>
        <a class="cta" href="${escapeHtml(canonicalUrl)}">View trip</a>
      </div>
      ${media}
    </section>`,
  });
};

const renderExperienceHtml = (row) => {
  const title = `${row.title} by ${row.brand_name} | Mingla`;
  const description = experienceDescription(row);
  const canonicalUrl = experiencePublicUrl(row);
  const imageUrl = experienceImageUrl(row);
  const location = asText(row.location_text);
  const media = imageUrl
    ? `<img class="media" src="${escapeHtml(row.cover_media_url)}" alt="${escapeHtml(row.title)} experience cover" />`
    : "";

  return pageShell({
    title,
    description,
    canonicalUrl,
    imageUrl,
    type: "website",
    body: `<section class="hero${media ? " has-media" : ""}">
      <div>
        <h1>${escapeHtml(row.title)}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="meta">
          <span class="pill">${escapeHtml(row.brand_name)}</span>
          ${location ? `<span class="pill">${escapeHtml(location)}</span>` : ""}
        </div>
        <a class="cta" href="${escapeHtml(canonicalUrl)}">View experience</a>
      </div>
      ${media}
    </section>`,
  });
};

const renderBrandHtml = (input) => {
  const { brand, events, venue } = normalizeBrandPreviewInput(input);
  const row = brand ?? events[0];
  const title = brandSeoTitle(row, venue);
  const description = brandDescription(row, events.length);
  const canonicalUrl = brandPublicUrl(row);
  const imageUrl = brandImageUrl(row);
  const isVerifiedVenue =
    venue !== null &&
    typeof venue === "object" &&
    venue.kind === "physical";
  const cards = events
    .slice(0, 8)
    .map(
      (event) => `<a class="card" href="${escapeHtml(eventPublicPath(event))}">
        <strong>${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(eventDescription(event))}</span>
      </a>`,
    )
    .join("") ||
    (isVerifiedVenue
      ? `<div class="card"><strong>No upcoming events from this venue</strong><span>Check back soon for events from ${escapeHtml(brandName(row))}.</span></div>`
      : `<div class="card"><strong>No upcoming events yet</strong><span>Check back soon for new events from ${escapeHtml(brandName(row))}.</span></div>`);

  return pageShell({
    title,
    description,
    canonicalUrl,
    imageUrl,
    type: "profile",
    body: `<section class="hero">
      <div>
        <h1>${escapeHtml(brandName(row))}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="meta">
          <span class="pill">${events.length} event${events.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </section>
    <section class="grid">${cards}</section>`,
  });
};

const renderVenueHtml = (input) => {
  const { brand, venue, events, canonicalBrandSlug } = input;
  const title = brandSeoTitle(brand, venue);
  const description = brandDescription(brand, events.length);
  const canonicalUrl = `${PUBLIC_ORIGIN}/b/${encodeURIComponent(canonicalBrandSlug)}/v/${encodeURIComponent(venue.slug)}`;
  const imageUrl = brandImageUrl(venue)
    ? `${PUBLIC_ORIGIN}/og/venue/${encodeURIComponent(canonicalBrandSlug)}/${encodeURIComponent(venue.slug)}.png`
    : "";
  return pageShell({ title, description, canonicalUrl, imageUrl, type: "profile", body: `<section class="hero"><div><h1>${escapeHtml(brandName(venue))}</h1><p>${escapeHtml(description)}</p><div class="meta">${venue.city ? `<span class="pill">${escapeHtml(venue.city)}</span>` : ""}<span class="pill">${events.length} event${events.length === 1 ? "" : "s"}</span></div></div></section>` });
};

const sendHtml = (res, html, statusCode = 200) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=3600");
  res.end(html);
};

const setSharedNoStore = (res) => {
  res.setHeader("cache-control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("cdn-cache-control", "no-store");
  res.setHeader("vercel-cdn-cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("expires", "0");
};

const sendSharedHtml = (res, html, statusCode = 200) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  setSharedNoStore(res);
  res.end(html);
};

const sendSharedPng = (res, buffer) => {
  res.statusCode = 200;
  res.setHeader("content-type", "image/png");
  setSharedNoStore(res);
  res.end(buffer);
};

const LEGACY_HOUR_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const legacyClockLabel = (hour, minute) => {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
};
const normalizeLegacyHours = (value) => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    const semantic = value.flatMap((row) => row && typeof row.day === "string" && typeof row.label === "string"
      ? [{ day: asText(row.day), label: asText(row.label) }] : []);
    return semantic.length === 7 ? semantic : [];
  }
  const descriptions = Array.isArray(value.weekdayDescriptions) ? value.weekdayDescriptions
    : Array.isArray(value.weekday_text) ? value.weekday_text : null;
  if (descriptions) {
    const rows = descriptions.flatMap((line) => {
      if (typeof line !== "string") return [];
      const match = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday):\s*(.+)$/i.exec(line.trim());
      if (!match) return [];
      const day = LEGACY_HOUR_DAYS.find((candidate) => candidate.toLowerCase() === match[1].toLowerCase());
      const label = asText(match[2]);
      return day && label && !/\[object Object\]|OpenNow:|Periods:/i.test(label) ? [{ day, label }] : [];
    });
    return rows.length === 7 ? rows : [];
  }
  if (!Array.isArray(value.periods)) return [];
  const byDay = new Map(LEGACY_HOUR_DAYS.map((day) => [day, []]));
  for (const period of value.periods) {
    const open = period && typeof period.open === "object" ? period.open : null;
    const close = period && typeof period.close === "object" ? period.close : null;
    if (!open || !Number.isInteger(open.day) || open.day < 0 || open.day > 6) return [];
    const day = LEGACY_HOUR_DAYS[open.day];
    const openLabel = legacyClockLabel(open.hour, open.minute);
    if (!openLabel) return [];
    const closeLabel = close ? legacyClockLabel(close.hour, close.minute) : "";
    const label = closeLabel ? `${openLabel}–${closeLabel}` : "Open 24 hours";
    byDay.get(day).push(label);
  }
  return LEGACY_HOUR_DAYS.map((day) => ({ day, label: byDay.get(day).length ? byDay.get(day).join(", ") : "Closed" }));
};
const renderLegacyHours = (value, timezone) => {
  const rows = normalizeLegacyHours(value);
  if (rows.length !== 7) return "";
  const today = asText(timezone) ? todayForShareTimezone(timezone) : "";
  return `<details><summary>Hours</summary><ul class="legacy-hours">${rows.map((row) => {
    const isToday = row.day === today;
    return `<li${isToday ? ' class="today"' : ""}><strong>${escapeHtml(row.day)}</strong><span>${escapeHtml(row.label)}</span>${isToday ? "<em>Today</em>" : ""}</li>`;
  }).join("")}</ul></details>`;
};

const renderSharedCardHtml = (snapshot, appUrl, preferredCanonicalUrl = null) => {
  const canonicalUrl = isAbsoluteHttpUrl(preferredCanonicalUrl) ? preferredCanonicalUrl : `${EXPLORER_PUBLIC_ORIGIN}/p/${encodeURIComponent(snapshot.share_id)}`;
  const imageUrl = snapshot.cover_url
    ? `${EXPLORER_PUBLIC_ORIGIN}/og/share/${encodeURIComponent(snapshot.share_id)}.png`
    : "";
  const metadata = snapshot.metadata && typeof snapshot.metadata === "object" ? snapshot.metadata : {};
  // selectSharedCardFacts is the sole selector for
  // [metadata.category, metadata.location, metadata.price, metadata.duration].
  const facts = selectSharedCardFacts(metadata);
  const description = facts.join(" · ") || `Open ${snapshot.title} on Mingla.`;
  const slivers = snapshot.kind === "curated" ? '<i class="share-curated-sliver one"></i><i class="share-curated-sliver two"></i>' : "";
  const legacyKind = snapshot.kind === "curated" ? "Curated plan" : "Place";
  const hero = snapshot.cover_url
    ? `<div class="share-cover"><img class="share-cover-image" src="${escapeHtml(snapshot.cover_url)}" alt="${escapeHtml(`${legacyKind}: ${snapshot.title}`)}"><span class="share-identity-pill" aria-hidden="true"><img src="${wordmarkSource()}" alt=""></span>${slivers}<div class="share-title">${escapeHtml(snapshot.title)}</div><div class="share-plate"><span class="share-plate-kind">${legacyKind}</span><span class="share-plate-facts">${escapeHtml(facts.join(" · "))}</span></div></div>`
    : `<section class="coverless-information" aria-labelledby="shared-title"><p>${legacyKind}</p><h1 id="shared-title">${escapeHtml(snapshot.title)}</h1>${facts.length ? `<p class="coverless-facts">${escapeHtml(facts.join(" · "))}</p>` : ""}</section>`;
  const stopTitles = snapshot.kind === "curated" && Array.isArray(snapshot.stops)
    ? snapshot.stops.map((s) => asText(s?.title)).filter(Boolean)
    : [];
  const stops = stopTitles.length > 0
    ? `<ol>${stopTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ol>`
    : "";
  const realDescription = asText(metadata.description);
  const hours = renderLegacyHours(metadata.hours, metadata.timezone);
  const actions = [[metadata.mapUrl, "Directions"], [metadata.website, "Website"], [metadata.phone ? `tel:${metadata.phone}` : "", "Call"]].filter(([href]) => typeof href === "string" && href).map(([href, label]) => `<a class="fact-action" href="${escapeHtml(href)}">${label}</a>`).join("");
  const imageAlt = imageUrl ? `${legacyKind}: ${snapshot.title}. ${facts.slice(0, 3).join(". ")}`.trim() : "";
  return pageShell({ title: `${snapshot.title} on Mingla`, description, canonicalUrl, imageUrl, imageWidth:1080, imageHeight:1350, imageAlt, type: "article", siteName: "Mingla", headerVariant:"mingla", showHeader:false, body: `<main class="share-page">${hero}<section class="share-details">${realDescription ? `<p>${escapeHtml(realDescription)}</p>` : ""}${stops}${hours}${actions ? `<nav class="fact-actions">${actions}</nav>` : ""}<a class="open-app" href="${escapeHtml(appUrl)}">Open in Mingla</a></section></main><style>.share-page{max-width:980px;margin:28px auto;padding:0 16px}${s6CardCss()}.share-page .share-details{max-width:390px;margin:20px auto}.coverless-information{max-width:560px;padding:28px;border:1px solid rgba(255,247,239,.28);border-radius:24px;background:#0C0E12}.coverless-information p{margin:0 0 10px;font-size:14px}.coverless-information h1{font-size:clamp(36px,7vw,64px);line-height:1}.coverless-information ul,.legacy-hours{list-style:none;padding:0}.coverless-information li{display:inline-flex;margin:4px;padding:7px 10px;border:1px solid rgba(255,247,239,.32);border-radius:999px}.legacy-hours li{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:8px 0}.legacy-hours .today{font-weight:800}.legacy-hours em{grid-column:2;font-size:14px}.fact-actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.fact-action{color:#fff7ef}.open-app{display:block;padding:14px 20px;border-radius:999px;background:#eb7825;color:#fff;text-align:center;text-decoration:none;font-weight:800}@media(min-width:760px){.share-page{display:grid;grid-template-columns:${snapshot.cover_url ? "390px 1fr" : "minmax(0,560px) minmax(0,390px)"};gap:44px;align-items:center;min-height:80vh}.share-page .share-details{margin:0;max-width:460px}}</style>` });
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
  const accentLabel = isBrand ? "Mingla" : truncate(kicker, 44);
  const textFit = buildOgTextFit({
    cardKind,
    title,
    subtitle,
    primaryChip,
    secondaryChip,
    accentLabel,
  });
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
            gap: "13px",
            padding: "64px 70px",
            width: "642px",
            maxHeight: `${textFit.contentMaxHeight}px`,
            overflow: "hidden",
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
                    maxHeight: `${textFit.chipMaxHeight}px`,
                    overflow: "hidden",
                  },
                },
                textFit.primaryChipText,
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
                    maxHeight: `${textFit.chipMaxHeight}px`,
                    overflow: "hidden",
                  },
                },
                textFit.secondaryChipText,
              )
            : null,
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: `${textFit.titleFontSize}px`,
              lineHeight: textFit.titleLineHeight,
              fontWeight: 900,
              letterSpacing: "0",
              maxWidth: "610px",
              maxHeight: `${textFit.titleMaxHeight}px`,
              overflow: "hidden",
            },
          },
          textFit.titleText,
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
              maxHeight: `${textFit.subtitleMaxHeight}px`,
              overflow: "hidden",
            },
          },
          textFit.subtitleText,
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
          textFit.accentText,
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
        "host.usemingla.com",
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
  buildTripOgCardProps,
  buildOgTextFit,
  directEventBundleToPreviewRow,
  escapeHtml,
  eventDescription,
  eventImageUrl,
  eventPublicUrl,
  experienceDescription,
  experienceImageUrl,
  experiencePublicUrl,
  fetchPublicBrandBySlug,
  fetchPublicEventById,
  fetchPublicEventBySlug,
  fetchPublicExperienceBySlug,
  fetchPublicTripById,
  fetchPublicTripBySlug,
  fetchPublicVenueBySlug,
  fetchSharedCardSnapshot,
  fetchContentShare,
  fetchContentShareVersion,
  contentSharePosterUrl,
  contentShareBusinessDestination,
  firstQueryValue,
  renderBrandHtml,
  renderEventHtml,
  renderExperienceHtml,
  renderTripHtml,
  renderVenueHtml,
  renderSharedCardHtml,
  normalizeLegacyHours,
  renderContentShareHtml,
  renderNotFoundHtml,
  renderOgPng,
  sendHtml,
  sendSharedHtml,
  sendSharedPng,
  setSharedNoStore,
  sendPng,
  tripDescription,
  tripImageUrl,
  tripPublicUrl,
  todayForShareTimezone,
};
