#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const GOGI_BRAND_ID = "733bc470-45e1-4684-8896-acd7e26074ff";
export const GOGI_CONFIGURED_BY = "1f3d2ddf-b741-4e2f-8884-d7222a660c7e";
export const GOGI_SOURCE = "gogi-ingest-brief-2026-08-27";
export const CMS_ORIGIN = "https://studio.sites.usemingla.com";

const STUDIO_COOKIE = "__Host-mingla_studio";
const STUDIO_CSRF_COOKIE = "__Host-mingla_studio_csrf";
const CANONICAL_URL = "https://gogi.sites.usemingla.com";
const MAX_BYTES = 20 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

// Content authority: Engineering Blueprint/somethingelse/content/gogi-lagos/
// INGEST_BRIEF.md, captured 2026-08-27. Keep this object factual and free of
// the demo's payment, WhatsApp, reservation, endorsement, and provider copy.
export const GOGI_SEED_COPY = Object.freeze({
  displayName: "gögi",
  heading: "Where Lagos Comes to Eat",
  description:
    "A 24/7 food house at 69 Admiralty Way, Lekki Phase 1, Lagos. Day or night, open for a bite.",
  address: "69 Admiralty Way, Lekki Phase 1, Lagos",
  phoneDisplay: "0912 711 7528",
  phoneHref: "tel:+2349127117528",
  hoursSummary: "Open 24 hours, 7 days",
  colors: Object.freeze({
    background: "#1c1c1e",
    foreground: "#f0eee9",
    accent: "#cda052",
  }),
});

export class SeedError extends Error {
  constructor(code) {
    super(code);
    this.name = "SeedError";
    this.code = code;
  }
}

function fail(code) {
  throw new SeedError(code);
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function relationId(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return typeof value.id === "string" || typeof value.id === "number"
      ? String(value.id)
      : "";
  }
  return "";
}

function compact(value, key = "") {
  if (value == null) return undefined;
  if (key === "media" || key === "social_image" || key === "logo") {
    return relationId(value) || undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => compact(item)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return value;
  const result = {};
  for (const childKey of Object.keys(value).sort()) {
    const childValue = value[childKey];
    if (
      [
        "id",
        "blockName",
        "createdAt",
        "updatedAt",
        "_status",
        "tenant",
      ].includes(childKey)
    ) {
      continue;
    }
    const normalized = compact(childValue, childKey);
    if (
      normalized === undefined ||
      (Array.isArray(normalized) && normalized.length === 0) ||
      (normalized &&
        typeof normalized === "object" &&
        !Array.isArray(normalized) &&
        Object.keys(normalized).length === 0)
    ) {
      continue;
    }
    result[childKey] = normalized;
  }
  return result;
}

function equal(left, right) {
  return JSON.stringify(compact(left)) === JSON.stringify(compact(right));
}

function tenantOf(document) {
  return relationId(document?.tenant);
}

function projectPage(page) {
  return compact({
    role: page.role,
    title: page.title,
    enabled: page.enabled,
    nav_label: page.nav_label,
    nav_order: page.nav_order,
    blocks: page.blocks,
    seo: page.seo,
  });
}

function projectSettings(settings) {
  return compact({
    display_name: settings.display_name,
    short_description: settings.short_description,
    logo: settings.logo,
    background_color: settings.background_color,
    foreground_color: settings.foreground_color,
    accent_color: settings.accent_color,
    typography: settings.typography,
    canonical_url: settings.canonical_url,
    seo_title: settings.seo_title,
    seo_description: settings.seo_description,
    social_image: settings.social_image,
    analytics_consent_mode: settings.analytics_consent_mode,
  });
}

function projectNavigation(navigation) {
  return {
    pages: Array.isArray(navigation.pages)
      ? navigation.pages.map(relationId).filter(Boolean)
      : [],
  };
}

function projectFooter(footer) {
  return compact({
    address: footer.address,
    hours_summary: footer.hours_summary,
    legal_text: footer.legal_text,
    links: footer.links,
  });
}

function hours() {
  return [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].map((day) => ({ day, value: "Open 24 hours" }));
}

export function seedDocuments({ heroMediaId, homeId, contactId, tenantId }) {
  return {
    home: {
      tenant: tenantId,
      role: "home",
      title: "Home",
      enabled: true,
      nav_label: "Home",
      nav_order: 0,
      blocks: [
        {
          blockType: "hero",
          heading: GOGI_SEED_COPY.heading,
          subheading: GOGI_SEED_COPY.description,
          media: heroMediaId,
          ctas: [
            { label: "Visit us", href: "/contact" },
            { label: `Call ${GOGI_SEED_COPY.phoneDisplay}`, href: GOGI_SEED_COPY.phoneHref },
          ],
        },
        {
          blockType: "hours_location",
          heading: "Open day and night",
          address: GOGI_SEED_COPY.address,
          hours: hours(),
        },
        {
          blockType: "contact_handoff",
          heading: "Come as you are",
          body: GOGI_SEED_COPY.hoursSummary,
          label: `Call ${GOGI_SEED_COPY.phoneDisplay}`,
          href: GOGI_SEED_COPY.phoneHref,
        },
      ],
      seo: {
        title: "gögi — Where Lagos Comes to Eat",
        description: GOGI_SEED_COPY.description,
      },
    },
    contact: {
      tenant: tenantId,
      role: "contact",
      title: "Visit gögi",
      enabled: true,
      nav_label: "Visit",
      nav_order: 1,
      blocks: [
        {
          blockType: "hours_location",
          heading: "Visit gögi",
          address: GOGI_SEED_COPY.address,
          hours: hours(),
        },
        {
          blockType: "contact_handoff",
          heading: "Call gögi",
          body: GOGI_SEED_COPY.hoursSummary,
          label: GOGI_SEED_COPY.phoneDisplay,
          href: GOGI_SEED_COPY.phoneHref,
        },
      ],
      seo: {
        title: "Visit gögi in Lekki Phase 1",
        description: `${GOGI_SEED_COPY.address}. ${GOGI_SEED_COPY.hoursSummary}.`,
      },
    },
    settings: {
      tenant: tenantId,
      display_name: GOGI_SEED_COPY.displayName,
      short_description: GOGI_SEED_COPY.description,
      background_color: GOGI_SEED_COPY.colors.background,
      foreground_color: GOGI_SEED_COPY.colors.foreground,
      accent_color: GOGI_SEED_COPY.colors.accent,
      typography: "modern-sans",
      canonical_url: CANONICAL_URL,
      seo_title: "gögi — Where Lagos Comes to Eat",
      seo_description: GOGI_SEED_COPY.description,
      social_image: heroMediaId,
      analytics_consent_mode: "optional",
    },
    navigation: { tenant: tenantId, pages: [homeId, contactId] },
    footer: {
      tenant: tenantId,
      address: GOGI_SEED_COPY.address,
      hours_summary: GOGI_SEED_COPY.hoursSummary,
      legal_text: "Gogi Lagos Ltd",
      links: [
        { label: "Home", href: "/" },
        { label: "Visit", href: "/contact" },
        { label: `Call ${GOGI_SEED_COPY.phoneDisplay}`, href: GOGI_SEED_COPY.phoneHref },
      ],
    },
  };
}

function baselineSettings() {
  return {
    display_name: "Gogi Restaurant",
    typography: "editorial-serif",
    canonical_url: CANONICAL_URL,
    analytics_consent_mode: "optional",
  };
}

function baselineHome() {
  return {
    role: "home",
    title: "Home",
    enabled: true,
    nav_label: "Home",
    nav_order: 0,
  };
}

export function deterministicHeroFilename(expectedSha256, mime) {
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[mime];
  if (!extension || !SHA256.test(expectedSha256)) fail("INVALID_HERO_INPUT");
  return `gogi-pilot-hero-${expectedSha256}.${extension}`;
}

export function classifySnapshot(snapshot, input) {
  const { tenantId, heroFilename } = input;
  const pages = Array.isArray(snapshot.pages) ? snapshot.pages : [];
  const settings = Array.isArray(snapshot.settings) ? snapshot.settings : [];
  const navigation = Array.isArray(snapshot.navigation) ? snapshot.navigation : [];
  const footer = Array.isArray(snapshot.footer) ? snapshot.footer : [];
  const media = Array.isArray(snapshot.media) ? snapshot.media : [];
  const allDocuments = [...pages, ...settings, ...navigation, ...footer];
  if (
    allDocuments.some((document) => tenantOf(document) !== tenantId)
  ) {
    fail("CROSS_TENANT_RESPONSE");
  }
  if (settings.length !== 1 || navigation.length !== 1 || footer.length !== 1) {
    fail("PROVISIONING_BASELINE_MISSING");
  }
  const unexpectedPage = pages.find(
    (page) => page.role !== "home" && page.role !== "contact",
  );
  const home = pages.find((page) => page.role === "home");
  const contact = pages.find((page) => page.role === "contact") ?? null;
  if (!home || unexpectedPage || pages.filter((page) => page.role === "home").length !== 1) {
    fail("EXISTING_NON_SEED_CONTENT");
  }
  const matchingMedia = media.filter((item) => item.filename === heroFilename);
  if (matchingMedia.length > 1) fail("DUPLICATE_SEED_MEDIA");
  if (matchingMedia.length === 1 && matchingMedia[0].state !== "READY") {
    fail("EXISTING_SEED_MEDIA_NOT_READY");
  }
  const heroMediaId = matchingMedia.length === 1
    ? requiredString(String(matchingMedia[0].id || ""), "INVALID_MEDIA_RESPONSE")
    : null;
  const expected = heroMediaId
    ? seedDocuments({
        heroMediaId,
        homeId: String(home.id),
        contactId: contact ? String(contact.id) : "pending-contact",
        tenantId,
      })
    : null;
  const homeState = equal(projectPage(home), baselineHome())
    ? "baseline"
    : expected && equal(projectPage(home), projectPage(expected.home))
      ? "target"
      : "invalid";
  const contactState = contact === null
    ? "baseline"
    : expected && equal(projectPage(contact), projectPage(expected.contact))
      ? "target"
      : "invalid";
  const navigationState = equal(projectNavigation(navigation[0]), { pages: [] })
    ? "baseline"
    : expected && contact &&
        equal(projectNavigation(navigation[0]), projectNavigation(expected.navigation))
      ? "target"
      : "invalid";
  const footerState = equal(projectFooter(footer[0]), {})
    ? "baseline"
    : expected && equal(projectFooter(footer[0]), projectFooter(expected.footer))
      ? "target"
      : "invalid";
  const settingsState = equal(projectSettings(settings[0]), baselineSettings())
    ? "baseline"
    : expected && equal(projectSettings(settings[0]), projectSettings(expected.settings))
      ? "target"
      : "invalid";
  const states = {
    media: heroMediaId ? "target" : "baseline",
    home: homeState,
    contact: contactState,
    navigation: navigationState,
    footer: footerState,
    settings: settingsState,
  };
  if (Object.values(states).includes("invalid")) fail("EXISTING_NON_SEED_CONTENT");
  const actions = [];
  if (states.media === "baseline") actions.push("upload_hero_through_private_pipeline");
  if (states.home === "baseline") actions.push("update_home_draft");
  if (states.contact === "baseline") actions.push("create_contact_draft");
  if (states.navigation === "baseline") actions.push("update_navigation_draft");
  if (states.footer === "baseline") actions.push("update_footer_draft");
  if (states.settings === "baseline") actions.push("update_site_settings_draft");
  return {
    state: actions.length === 0 ? "seeded" : "reconcilable",
    actions,
    states,
    heroMediaId,
    home,
    contact,
    settings: settings[0],
    navigation: navigation[0],
    footer: footer[0],
  };
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set([
    "--site-id",
    "--brand-id",
    "--tenant-id",
    "--configured-by",
    "--hero-image",
    "--hero-sha256",
    "--source",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (values.apply === true) fail("DUPLICATE_ARGUMENT");
      values.apply = true;
      continue;
    }
    if (!allowed.has(argument)) fail("UNKNOWN_ARGUMENT");
    if (Object.prototype.hasOwnProperty.call(values, argument)) {
      fail("DUPLICATE_ARGUMENT");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("MISSING_ARGUMENT_VALUE");
    values[argument] = value;
    index += 1;
  }
  return {
    siteId: values["--site-id"],
    brandId: values["--brand-id"],
    tenantId: values["--tenant-id"],
    configuredBy: values["--configured-by"],
    heroImage: values["--hero-image"],
    heroSha256: values["--hero-sha256"],
    source: values["--source"],
    apply: values.apply === true,
  };
}

export function validateOptions(raw) {
  const options = {
    siteId: requiredString(raw.siteId, "MISSING_SITE_ID").toLowerCase(),
    brandId: requiredString(raw.brandId, "MISSING_BRAND_ID").toLowerCase(),
    tenantId: requiredString(raw.tenantId, "MISSING_TENANT_ID").toLowerCase(),
    configuredBy: requiredString(
      raw.configuredBy,
      "MISSING_CONFIGURED_BY",
    ).toLowerCase(),
    heroImage: resolve(requiredString(raw.heroImage, "MISSING_HERO_IMAGE")),
    heroSha256: requiredString(
      raw.heroSha256,
      "MISSING_HERO_SHA256",
    ).toLowerCase(),
    source: requiredString(raw.source, "MISSING_SOURCE"),
    apply: raw.apply === true,
  };
  if (![options.siteId, options.brandId, options.tenantId, options.configuredBy].every((id) => UUID.test(id))) {
    fail("INVALID_ID");
  }
  if (options.brandId !== GOGI_BRAND_ID) fail("WRONG_GOGI_BRAND");
  if (options.configuredBy !== GOGI_CONFIGURED_BY) fail("WRONG_CONFIGURED_BY");
  if (options.source !== GOGI_SOURCE) fail("UNSUPPORTED_SOURCE");
  if (!SHA256.test(options.heroSha256)) fail("INVALID_HERO_SHA256");
  return options;
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return digest.digest("hex");
}

function detectImage(bytes) {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 20 &&
    Buffer.from(bytes.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a" &&
    Buffer.from(bytes.subarray(bytes.length - 12)).toString("hex") ===
      "0000000049454e44ae426082"
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP" &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    return "image/webp";
  }
  fail("UNSUPPORTED_HERO_IMAGE");
}

export async function inspectHero(path, expectedSha256) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    fail("HERO_IMAGE_MISSING");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("HERO_IMAGE_NOT_REGULAR");
  if (metadata.size < 1 || metadata.size > MAX_BYTES) fail("HERO_IMAGE_SIZE_INVALID");
  const actualSha256 = await sha256File(path);
  if (actualSha256 !== expectedSha256) fail("HERO_SHA256_MISMATCH");
  const bytes = await readFile(path);
  const mime = detectImage(bytes);
  return {
    bytes,
    byteLength: metadata.size,
    mime,
    sha256: actualSha256,
    filename: deterministicHeroFilename(expectedSha256, mime),
  };
}

export function validateStudioSession(sessionValue, csrfValue, options, nowSeconds = Math.floor(Date.now() / 1000)) {
  const decodedValue = decodeURIComponent(requiredString(sessionValue, "MISSING_STUDIO_SESSION"));
  const [encoded, signature, extra] = decodedValue.split(".");
  if (
    !encoded ||
    !signature ||
    extra ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    fail("INVALID_STUDIO_SESSION");
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("INVALID_STUDIO_SESSION");
  }
  if (
    !claims ||
    claims.version !== 1 ||
    claims.site_id !== options.siteId ||
    claims.brand_id !== options.brandId ||
    claims.tenant_id !== options.tenantId ||
    claims.user_id !== options.configuredBy ||
    !Number.isInteger(claims.rank) ||
    claims.rank < 50 ||
    !Number.isInteger(claims.issued_at) ||
    claims.issued_at > nowSeconds + 5 ||
    !Number.isInteger(claims.absolute_expires_at) ||
    !Number.isInteger(claims.idle_expires_at) ||
    claims.absolute_expires_at <= nowSeconds ||
    claims.idle_expires_at <= nowSeconds ||
    claims.return_surface !== "web"
  ) {
    fail("STUDIO_SESSION_SCOPE_MISMATCH");
  }
  const csrf = requiredString(csrfValue, "MISSING_STUDIO_CSRF");
  if (!/^[A-Za-z0-9_-]{43}$/.test(csrf)) fail("INVALID_STUDIO_CSRF");
  return { session: decodedValue, csrf };
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    fail("CMS_RESPONSE_INVALID");
  }
  try {
    return await response.json();
  } catch {
    fail("CMS_RESPONSE_INVALID");
  }
}

export class CmsSeedClient {
  constructor({ session, csrf, fetchImpl = fetch }) {
    this.session = session;
    this.csrf = csrf;
    this.fetchImpl = fetchImpl;
  }

  headers(mutating = false) {
    return {
      accept: "application/json",
      cookie: `${STUDIO_COOKIE}=${encodeURIComponent(this.session)}; ${STUDIO_CSRF_COOKIE}=${this.csrf}`,
      ...(mutating
        ? {
            "content-type": "application/json",
            origin: CMS_ORIGIN,
            "x-mingla-csrf": this.csrf,
          }
        : {}),
    };
  }

  async request(path, init = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${CMS_ORIGIN}${path}`, {
        redirect: "error",
        cache: "no-store",
        ...init,
      });
    } catch {
      fail("CMS_UNAVAILABLE");
    }
    const body = await parseJsonResponse(response);
    if (!response.ok || body?.ok === false) fail("CMS_REQUEST_REJECTED");
    return body;
  }

  async collection(slug, limit) {
    const params = new URLSearchParams({
      depth: "0",
      limit: String(limit),
      draft: "true",
    });
    const body = await this.request(`/api/${slug}?${params}`, {
      method: "GET",
      headers: this.headers(false),
    });
    if (!Array.isArray(body.docs)) fail("CMS_RESPONSE_INVALID");
    return body.docs;
  }

  async readState() {
    const [pages, settings, navigation, footer, library] = await Promise.all([
      this.collection("pages", 5),
      this.collection("site-settings", 1),
      this.collection("navigation", 1),
      this.collection("footer", 1),
      this.request("/api/mingla/media-library", {
        method: "GET",
        headers: this.headers(false),
      }),
    ]);
    if (!Array.isArray(library?.data?.media)) fail("CMS_RESPONSE_INVALID");
    return { pages, settings, navigation, footer, media: library.data.media };
  }

  async mutateCollection(method, slug, id, data) {
    const suffix = id ? `/${encodeURIComponent(id)}` : "";
    const body = await this.request(`/api/${slug}${suffix}?draft=true&depth=0`, {
      method,
      headers: this.headers(true),
      body: JSON.stringify(data),
    });
    const document = body?.doc ?? body;
    if (!document || typeof document !== "object" || !document.id) {
      fail("CMS_RESPONSE_INVALID");
    }
    return document;
  }

  updateHome(document, data) {
    return this.mutateCollection("PATCH", "pages", String(document.id), {
      ...data,
      revision: document.revision,
    });
  }

  createContact(data) {
    return this.mutateCollection("POST", "pages", null, data);
  }

  updateNavigation(document, data) {
    return this.mutateCollection("PATCH", "navigation", String(document.id), data);
  }

  updateFooter(document, data) {
    return this.mutateCollection("PATCH", "footer", String(document.id), data);
  }

  updateSettings(document, data) {
    return this.mutateCollection("PATCH", "site-settings", String(document.id), data);
  }

  async uploadHero(hero) {
    const grantEnvelope = await this.request("/api/mingla/media/upload-grants", {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        filename: hero.filename,
        content_type: hero.mime,
        bytes: hero.byteLength,
      }),
    });
    const grant = grantEnvelope?.data;
    const mediaId = String(grant?.media_id || "");
    if (!UUID.test(mediaId) || typeof grant?.upload_url !== "string") {
      fail("MEDIA_GRANT_INVALID");
    }
    const uploadUrl = new URL(grant.upload_url);
    if (
      uploadUrl.protocol !== "https:" ||
      !uploadUrl.hostname.endsWith(".storage.supabase.co") ||
      !uploadUrl.pathname.startsWith(
        "/storage/v1/s3/sites-media-quarantine/quarantine/",
      )
    ) {
      fail("MEDIA_GRANT_INVALID");
    }
    const requiredHeaders = grant.required_headers;
    if (
      !requiredHeaders ||
      typeof requiredHeaders !== "object" ||
      Array.isArray(requiredHeaders) ||
      requiredHeaders["content-type"] !== hero.mime ||
      requiredHeaders["if-none-match"] !== "*" ||
      requiredHeaders["x-amz-content-sha256"] !== "UNSIGNED-PAYLOAD" ||
      Object.keys(requiredHeaders).some(
        (key) =>
          !["content-type", "if-none-match", "x-amz-content-sha256"].includes(
            key.toLowerCase(),
          ),
      )
    ) {
      fail("MEDIA_GRANT_INVALID");
    }
    let upload;
    try {
      upload = await this.fetchImpl(uploadUrl, {
        method: "PUT",
        headers: requiredHeaders,
        body: hero.bytes,
        redirect: "error",
      });
    } catch {
      fail("MEDIA_UPLOAD_FAILED");
    }
    if (!upload.ok) fail("MEDIA_UPLOAD_FAILED");
    const completed = await this.request(
      `/api/mingla/media/${encodeURIComponent(mediaId)}/complete`,
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ checksum: hero.sha256, bytes: hero.byteLength }),
      },
    );
    if (completed?.data?.state !== "READY" || completed?.data?.media_id !== mediaId) {
      fail("MEDIA_PROCESSING_FAILED");
    }
    return mediaId;
  }
}

export async function reconcileSeed(client, options, hero) {
  let snapshot = await client.readState();
  let plan = classifySnapshot(snapshot, {
    tenantId: options.tenantId,
    heroFilename: hero.filename,
  });
  if (!options.apply || plan.state === "seeded") {
    return {
      mode: options.apply ? "apply" : "dry-run",
      state: plan.state,
      actions: plan.actions,
      changed: false,
    };
  }
  let heroMediaId = plan.heroMediaId;
  if (!heroMediaId) {
    heroMediaId = await client.uploadHero(hero);
    snapshot = await client.readState();
    plan = classifySnapshot(snapshot, {
      tenantId: options.tenantId,
      heroFilename: hero.filename,
    });
    if (plan.heroMediaId !== heroMediaId) fail("MEDIA_READBACK_MISMATCH");
  }
  let home = plan.home;
  let contact = plan.contact;
  let target = seedDocuments({
    heroMediaId,
    homeId: String(home.id),
    contactId: contact ? String(contact.id) : "pending-contact",
    tenantId: options.tenantId,
  });
  if (plan.states.home === "baseline") {
    home = await client.updateHome(home, target.home);
  }
  if (plan.states.contact === "baseline") {
    contact = await client.createContact(target.contact);
  }
  if (!contact?.id) fail("CONTACT_READBACK_MISSING");
  target = seedDocuments({
    heroMediaId,
    homeId: String(home.id),
    contactId: String(contact.id),
    tenantId: options.tenantId,
  });
  if (plan.states.navigation === "baseline") {
    await client.updateNavigation(plan.navigation, target.navigation);
  }
  if (plan.states.footer === "baseline") {
    await client.updateFooter(plan.footer, target.footer);
  }
  if (plan.states.settings === "baseline") {
    await client.updateSettings(plan.settings, target.settings);
  }
  const finalSnapshot = await client.readState();
  const finalPlan = classifySnapshot(finalSnapshot, {
    tenantId: options.tenantId,
    heroFilename: hero.filename,
  });
  if (finalPlan.state !== "seeded") fail("SEED_READBACK_MISMATCH");
  return { mode: "apply", state: "seeded", actions: [], changed: true };
}

export async function run(argv, environment = process.env, dependencies = {}) {
  const options = validateOptions(parseArgs(argv));
  const hero = await inspectHero(options.heroImage, options.heroSha256);
  const credentials = validateStudioSession(
    environment.MINGLA_SITES_SEED_STUDIO_COOKIE,
    environment.MINGLA_SITES_SEED_STUDIO_CSRF,
    options,
  );
  const client = dependencies.client ?? new CmsSeedClient({
    ...credentials,
    fetchImpl: dependencies.fetchImpl ?? fetch,
  });
  const result = await reconcileSeed(client, options, hero);
  return {
    ok: true,
    ...result,
    site_id: options.siteId,
    brand_id: options.brandId,
    tenant_id: options.tenantId,
    source: options.source,
    hero_sha256: options.heroSha256,
  };
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof SeedError ? error.code : "SEED_OPERATOR_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
