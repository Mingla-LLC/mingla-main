#!/usr/bin/env node
// #2829 W7b — build the travel pilot brand's site on the LOCAL stack from the
// brand's own source, exactly as an owner would: Mingla trips in Core, her
// past trips through the historical import, her reviews through the review
// import, and the site through Studio's own REST API, then validate and
// publish through brand-site-control.
//
//   node scripts/sites/local/seed-young-and-stamped.mjs [--skip-core] [--skip-publish] [--reupload-media]
//
// Her content, copy, photos and film are read at RUN TIME from YS_SOURCE_DIR
// (read-only) and are NEVER committed: this file and lib/brand-seed-transform.mjs
// hold only the mapping. Intermediates (the recorded seed, the history records
// and mapping, the run summary) go to YS_PRIVATE_DIR, outside the repository.
//
// Needs: the local stack (start-local-sites.sh), Core edge functions served
// and Studio running on :3101 (run-local-sites.sh). Every target is loopback.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";

import {
  LOCAL_DIR,
  REPO_ROOT,
  SEED_CREDENTIALS_PATH,
  STATE_DIR,
  assertLoopbackUrl,
  parseEnvFile,
  readSecrets,
  writePrivate,
} from "./lib/local-state.mjs";
import { corePlan, mediaNeeded, sitePlan, videosNeeded } from "./lib/brand-seed-transform.mjs";

const SOURCE = resolve(process.env.YS_SOURCE_DIR
  ?? "/Users/sethogieva/Desktop/Engineering Blueprint/somethingelse/content/young-and-stamped/platform");
const PRIVATE = resolve(process.env.YS_PRIVATE_DIR ?? resolve(homedir(), ".mingla-private/2829"));
const STUDIO = `http://localhost:${process.env.SITES_LOCAL_STUDIO_PORT || 3101}`;
const SOURCE_NOTE = "Imported from the brand's own records (local seed, #2829)";
const SITE_TIMEZONE = "America/New_York";
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!["--skip-core", "--skip-publish", "--reupload-media"].includes(flag)) {
    process.stderr.write(`FAIL seed-young-and-stamped: unknown argument ${flag}\n`);
    process.exit(2);
  }
}

const sha = (value) => createHash("sha256").update(value).digest("hex");
const say = (line) => process.stdout.write(`${line}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A stable uuid (v4-shaped) from a label, so re-runs update instead of duplicating. */
function stableId(label) {
  const h = createHash("md5").update(`ys-local-seed:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function statusEnv(label) {
  const path = resolve(STATE_DIR, `${label}.status.env`);
  if (!existsSync(path)) throw new Error(`STATUS_FILE_MISSING:${label} (run start-local-sites.sh)`);
  return parseEnvFile(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------- source

/** Record what the brand's own Payload seed would create (child process, no Payload, no network). */
function recordSource() {
  if (!existsSync(resolve(SOURCE, "src/seed/run.ts"))) throw new Error("SOURCE_SEED_MISSING (set YS_SOURCE_DIR)");
  mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  const out = resolve(PRIVATE, "ys-content.json");
  const recorder = resolve(LOCAL_DIR, "lib/payload-seed-recorder");
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types", "--no-warnings", "--import", resolve(recorder, "register.mjs"),
    resolve(recorder, "extract.mjs"),
    "--source", SOURCE, "--seed", "src/seed/run.ts", "--export", "seed",
    "--module", "src/seed/archive.ts", "--module", "src/redirects.ts",
    "--out", out,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`SOURCE_RECORD_FAILED: ${String(result.stderr).trim().split("\n").slice(-2).join(" | ")}`);
  say(result.stdout.trim());
  return JSON.parse(readFileSync(out, "utf8"));
}

/**
 * Strings the old site drew from component code rather than its CMS: read
 * from the brand's source so they are hers, never typed here. A missing one
 * stops the seed (a silent default would be invented copy).
 */
function componentText(recorded) {
  const read = (rel) => readFileSync(resolve(SOURCE, rel), "utf8");
  const blocks = read("src/components/RenderBlocks.tsx");
  const header = read("src/components/SiteHeaderClient.tsx");
  const empty = /const noUpcoming = \(\s*<GridEmpty\s+heading="[^"]*"\s+body="([^"]+)"\s+action=\{\{ label: '([^']+)', href: '([^']+)' \}\}/.exec(blocks);
  const cta = /<Link href="([^"]+)" className="btn btn--primary btn--sm[^"]*">\s*([^<\n]+?)\s*</.exec(header);
  const newsletter = /id="newsletter-email"[\s\S]{0,200}?placeholder="([^"]+)"/.exec(blocks);
  if (!empty || !cta || !newsletter) throw new Error("COMPONENT_TEXT_NOT_FOUND (the source layout changed; update the reader)");
  const archive = recorded.modules["src/seed/archive.ts"] ?? {};
  const redirects = recorded.modules["src/redirects.ts"]?.legacyRedirects ?? [];
  return {
    emptyBody: empty[1],
    emptyAction: { label: empty[2], href: empty[3] },
    headerCta: { href: cta[1], label: cta[2] },
    newsletterPlaceholder: newsletter[1],
    timezone: SITE_TIMEZONE,
    redirects,
    archive,
  };
}

// ------------------------------------------------------------------ core

function psqlCore(sql, vars = {}) {
  const url = new URL(assertLoopbackUrl(statusEnv("core").DB_URL, "core.db").toString());
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1) || "postgres",
    PGAPPNAME: "mingla-sites-local-ys-seed",
  };
  for (const [name, value] of Object.entries(vars)) env[`YS_SEED_${name.toUpperCase()}`] = value;
  const preamble = Object.keys(vars).map((name) => `\\getenv ${name} YS_SEED_${name.toUpperCase()}`).join("\n");
  const result = spawnSync("psql", ["-X", "--no-psqlrc", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: `${preamble}\n${sql}`, encoding: "utf8", env });
  if (result.status !== 0) throw new Error(`CORE_SQL_FAILED: ${String(result.stderr).split("\n").filter(Boolean).slice(-3).join(" | ")}`);
  return result.stdout.trim();
}

async function uploadCover(api, serviceKey, path, file) {
  const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const type = types[extname(file).toLowerCase()];
  if (!type) throw new Error(`COVER_TYPE_UNSUPPORTED:${extname(file)}`);
  const objectPath = `${path}${extname(file).toLowerCase()}`;
  const response = await fetch(`${api}/storage/v1/object/event_covers/${objectPath}`, {
    method: "POST",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": type, "x-upsert": "true" },
    body: readFileSync(file),
  });
  if (!response.ok) throw new Error(`COVER_UPLOAD_FAILED:${response.status}`);
  return `${api}/storage/v1/object/public/event_covers/${objectPath}`;
}

/** Bali, Albania (her trip documents) as real Mingla trips: dates, price, itinerary, gallery, guide. */
async function seedCoreTrips(recorded, brandId, plan) {
  const core = statusEnv("core");
  const api = assertLoopbackUrl(core.API_URL, "core.api").origin;
  const fileOf = (mediaId) => recorded.documents.find((doc) => doc.collection === "media" && doc.id === mediaId)?.file ?? null;
  const rows = [];
  for (const trip of plan.trips) {
    const id = stableId(`${brandId}:trip:${trip.slug}`);
    const coverFile = fileOf(trip.cover_media);
    const coverUrl = coverFile ? await uploadCover(api, core.SERVICE_ROLE_KEY, `${brandId}/${trip.slug}/cover`, coverFile) : null;
    const gallery = [];
    for (const [index, mediaId] of trip.gallery_media.entries()) {
      const file = fileOf(mediaId);
      if (!file) throw new Error(`GALLERY_FILE_MISSING:${trip.slug}:${index}`);
      gallery.push({ url: await uploadCover(api, core.SERVICE_ROLE_KEY, `${brandId}/${trip.slug}/gallery-${index + 1}`, file), type: "image" });
    }
    rows.push({ ...trip, id, ticket_type_id: stableId(`${brandId}:ticket:${trip.slug}`), cover_url: coverUrl, gallery });
  }
  const out = psqlCore(`
BEGIN;
-- #2829 W7c (A13.5): the local brand cannot take payments, like the real
-- one until she connects. Her trips have ended, and the site feed shows ended
-- trips whatever the brand's payments readiness, so no stand-in account is
-- needed. (A W7b run left one; it is removed so the parity run proves that.)
DELETE FROM public.stripe_connect_accounts
WHERE brand_id = :'brand_id'::uuid AND stripe_account_id = 'acct_local_fixture_only';
CREATE TEMP TABLE ys_trips ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(:'trips'::jsonb) AS t(
  id uuid, ticket_type_id uuid, slug text, title text, timezone text, start_date date, end_date date,
  description text, destination_text text, price_minor bigint, capacity integer, cover_url text,
  gallery jsonb, days jsonb, guide jsonb);
INSERT INTO public.events (id, brand_id, title, slug, event_type, visibility, status, timezone, currency,
  description, destination_text, cover_media_url, cover_media_type, cover_media_gallery, published_at)
SELECT id, :'brand_id'::uuid, title, slug, 'trip', 'public', 'ended', timezone, 'USD', description,
  destination_text, cover_url, CASE WHEN cover_url IS NULL THEN NULL ELSE 'image' END, COALESCE(gallery, '[]'::jsonb), now()
FROM ys_trips
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, status = EXCLUDED.status,
  timezone = EXCLUDED.timezone, description = EXCLUDED.description, destination_text = EXCLUDED.destination_text,
  cover_media_url = EXCLUDED.cover_media_url, cover_media_type = EXCLUDED.cover_media_type,
  cover_media_gallery = EXCLUDED.cover_media_gallery, deleted_at = NULL;
DELETE FROM public.event_dates WHERE event_id IN (SELECT id FROM ys_trips);
INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
SELECT id, (start_date::timestamp) AT TIME ZONE timezone, (end_date::timestamp) AT TIME ZONE timezone, timezone, true
FROM ys_trips WHERE start_date IS NOT NULL;
DELETE FROM public.trip_pricing_tiers WHERE event_id IN (SELECT id FROM ys_trips);
DELETE FROM public.ticket_types WHERE event_id IN (SELECT id FROM ys_trips);
INSERT INTO public.ticket_types (id, event_id, name, price_cents, is_free, quantity_total)
SELECT ticket_type_id, id, 'Place', price_minor, false, capacity FROM ys_trips WHERE price_minor IS NOT NULL;
INSERT INTO public.trip_pricing_tiers (event_id, ticket_type_id, tier_name)
SELECT id, ticket_type_id, 'Place' FROM ys_trips WHERE price_minor IS NOT NULL;
DELETE FROM public.trip_days WHERE event_id IN (SELECT id FROM ys_trips);
INSERT INTO public.trip_days (event_id, ordinal, title, narrative, date)
SELECT t.id, (d->>'ordinal')::smallint, d->>'title', NULLIF(d->>'narrative', ''),
  t.start_date + ((d->>'ordinal')::integer - 1)
FROM ys_trips t CROSS JOIN LATERAL jsonb_array_elements(t.days) d
WHERE btrim(COALESCE(d->>'title', '')) <> '';
INSERT INTO public.trip_guides (event_id, highlights, what_to_prepare, faqs, group_minimum)
SELECT id, ARRAY(SELECT jsonb_array_elements_text(guide->'highlights')), left(guide->>'what_to_prepare', 4000),
  COALESCE(guide->'faqs', '[]'::jsonb), (guide->>'group_minimum')::integer
FROM ys_trips
ON CONFLICT (event_id) DO UPDATE SET highlights = EXCLUDED.highlights, what_to_prepare = EXCLUDED.what_to_prepare,
  faqs = EXCLUDED.faqs, group_minimum = EXCLUDED.group_minimum, updated_at = now();
COMMIT;
SELECT json_agg(json_build_object('id', id, 'slug', slug)) FROM public.events WHERE id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(:'trips'::jsonb) x);
`, { brand_id: brandId, trips: JSON.stringify(rows) });
  const created = JSON.parse(out.split("\n").filter(Boolean).pop());
  say(`core trips ${created.map((row) => row.slug).join(", ")}`);
  return rows;
}

function runHistoryImport(plan, brandId) {
  const core = statusEnv("core");
  const file = resolve(PRIVATE, "ys-history.json");
  const mapping = resolve(PRIVATE, "ys-history-mapping.json");
  writePrivate(file, `${JSON.stringify(plan.historyFile, null, 2)}\n`);
  const result = spawnSync(process.execPath, [resolve(REPO_ROOT, "scripts/sites/import-historical-trips.mjs"), "--file", file, "--target", "local", "--apply", "--out", mapping], {
    encoding: "utf8",
    env: { ...process.env, MINGLA_CORE_URL: assertLoopbackUrl(core.API_URL, "core.api").origin, MINGLA_CORE_SERVICE_ROLE_KEY: core.SERVICE_ROLE_KEY },
  });
  if (result.status !== 0) throw new Error(`HISTORY_IMPORT_FAILED: ${String(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  const map = JSON.parse(readFileSync(mapping, "utf8"));
  if (map.brand_id !== brandId) throw new Error("HISTORY_MAPPING_BRAND_MISMATCH");
  say(`history ${Object.keys(map.trips).length} trips (${Object.values(map.trips).filter((row) => row.status === "created").length} created)`);
  return { file, mapping, map };
}

function runReviewImport(history, siteId) {
  const result = spawnSync(process.execPath, [resolve(LOCAL_DIR, "cms-env.mjs"), "--exec", "--", "sh", "-c", "cd mingla-site-cms && npx payload run src/scripts/import-testimonials.ts"], {
    encoding: "utf8",
    env: { ...process.env, SITES_IMPORT_FILE: history.file, SITES_IMPORT_MAPPING: history.mapping, SITES_IMPORT_SITE_ID: siteId, SITES_IMPORT_APPLY: "1" },
  });
  if (result.status !== 0) throw new Error(`REVIEW_IMPORT_FAILED: ${String(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  const lines = String(result.stdout).split("\n").filter((line) => /^\s+(created|existing|updated)/.test(line));
  say(`reviews ${lines.length} (${lines.filter((line) => line.includes("created")).length} created)`);
}

// --------------------------------------------------------- mingla (auth)

function localAuth() {
  const core = statusEnv("core");
  const api = assertLoopbackUrl(core.API_URL, "core.api").origin;
  const users = JSON.parse(readFileSync(SEED_CREDENTIALS_PATH, "utf8")).users;
  let token = null;
  async function login() {
    if (token) return token;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${api}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: core.ANON_KEY, "content-type": "application/json" },
        body: JSON.stringify({ email: users.brand_owner.email, password: users.brand_owner.password }),
      });
      if (response.ok) return (token = (await response.json()).access_token);
      await sleep(2000);
    }
    throw new Error("OWNER_LOGIN_FAILED");
  }
  async function control(path, method = "GET", body, { retry = true } = {}) {
    let response;
    // Cold local edge workers answer 502/504/546 now and then; the same
    // request (same operation id) is safe to repeat.
    for (let attempt = 0; attempt < (retry ? 5 : 1); attempt += 1) {
      response = await fetch(`${api}/functions/v1/brand-site-control${path}`, {
        method,
        headers: { apikey: core.ANON_KEY, authorization: `Bearer ${await login()}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (![502, 503, 504, 546].includes(response.status)) break;
      await sleep(3000);
    }
    return { status: response.status, json: await response.json().catch(() => null) };
  }
  async function rest(path) {
    const response = await fetch(`${api}/rest/v1/${path}`, { headers: { apikey: core.SERVICE_ROLE_KEY, authorization: `Bearer ${core.SERVICE_ROLE_KEY}` } });
    if (!response.ok) throw new Error(`REST_FAILED:${response.status}`);
    return response.json();
  }
  return { control, rest, api };
}

async function ensureSite(auth, brandId) {
  const find = async () => (await auth.rest(`brand_sites?brand_id=eq.${brandId}&select=id,status,brand_site_hosts(hostname,status,is_primary)`))[0] ?? null;
  let site = await find();
  if (!site) {
    const response = await auth.control(`/v1/brands/${brandId}/site`, "POST", { operation_id: crypto.randomUUID() });
    if (response.status >= 300) throw new Error(`PROVISION_FAILED:${response.status}:${response.json?.error?.code ?? ""}`);
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    site = await find();
    if (site?.brand_site_hosts?.some((host) => host.status === "active")) break;
    await sleep(1500);
  }
  if (!site) throw new Error("SITE_NOT_PROVISIONED");
  // Local synthetic recovery evidence so the site may publish (accepted only
  // on an environment='local' service row; see seed-local.mjs).
  psqlCore(`
SELECT public.brand_site_record_readiness_evidence(:'site_id'::uuid, gen_random_uuid(), encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  jsonb_build_object('schema_version', 1, 'evidence_kind', 'nightly_backup',
    'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'backup_retention_days', 7,
    'database_backup_verified_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'object_manifest_verified_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'manifest_digest', encode(extensions.digest('local-manifest', 'sha256'), 'hex'),
    'backup_bundle_digest', encode(extensions.digest('local-bundle', 'sha256'), 'hex'), 'object_count', 0, 'object_bytes', 0),
  'local_synthetic');
SELECT public.brand_site_record_readiness_evidence(:'site_id'::uuid, gen_random_uuid(), encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  jsonb_build_object('schema_version', 1, 'evidence_kind', 'restore_drill',
    'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'restore_drill_verified_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'restore_drill_evidence_digest', encode(extensions.digest('local-restore', 'sha256'), 'hex'),
    'tenant_count', 1, 'document_count', 1, 'object_count', 0, 'object_bytes', 0),
  'local_synthetic');
`, { site_id: site.id });
  const host = site.brand_site_hosts.find((row) => row.is_primary)?.hostname ?? site.brand_site_hosts[0]?.hostname;
  say(`site ${site.id} host ${host}`);
  return { id: site.id, host };
}

// ---------------------------------------------------------------- studio

async function studioSession(auth, brandId, siteId) {
  const exchange = await auth.control(`/v1/brands/${brandId}/editor-session`, "POST", { operation_id: crypto.randomUUID(), destination: "studio" });
  if (exchange.status >= 300) throw new Error(`EDITOR_SESSION_FAILED:${exchange.status}`);
  const response = await fetch(`${STUDIO}/api/mingla/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: STUDIO },
    body: JSON.stringify({ code: exchange.json.data.code, destination: "studio", return_surface: "web", site_id: siteId, brand_id: brandId }),
  });
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  const csrf = cookies.find((cookie) => cookie.startsWith("__Host-mingla_studio_csrf="))?.split("=")[1];
  if (response.status !== 200 || !csrf) throw new Error(`STUDIO_EXCHANGE_FAILED:${response.status}`);
  return async (path, init = {}) => {
    const result = await fetch(`${STUDIO}${path}`, {
      ...init,
      headers: { cookie: cookies.join("; "), origin: STUDIO, "x-mingla-csrf": csrf, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    });
    return { status: result.status, json: await result.json().catch(() => null) };
  };
}

async function studioUpload(req, file) {
  const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" };
  const type = types[extname(file).toLowerCase()];
  if (!type) throw new Error(`MEDIA_TYPE_UNSUPPORTED:${extname(file)}`);
  const bytes = readFileSync(file);
  // Re-runs reuse a ready upload of the same file (pictures only when it has
  // the W7b renditions, so older uploads are replaced once).
  const known = await req(`/api/media?depth=0&limit=1&where[checksum][equals]=${sha(bytes)}&where[state][equals]=READY`);
  const reuse = known.json?.docs?.[0];
  if (reuse && !flags.has("--reupload-media") && (type === "video/mp4" || Array.isArray(reuse.rendition_manifest?.variants))) return reuse.id;
  const filename = `media-${sha(bytes).slice(0, 12)}${extname(file).toLowerCase()}`;
  const grant = await req("/api/mingla/media/upload-grants", { method: "POST", body: JSON.stringify({ filename, content_type: type, bytes: bytes.byteLength }) });
  if (grant.status >= 300) throw new Error(`MEDIA_GRANT_FAILED:${grant.status}:${JSON.stringify(grant.json?.error ?? grant.json).slice(0, 200)}`);
  const put = await fetch(grant.json.data.upload_url, { method: "PUT", headers: grant.json.data.required_headers, body: bytes });
  if (!put.ok) throw new Error(`MEDIA_PUT_FAILED:${put.status}`);
  await req(`/api/mingla/media/${grant.json.data.media_id}/complete`, { method: "POST", body: JSON.stringify({ checksum: sha(bytes), bytes: bytes.byteLength }) });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await req(`/api/mingla/media/${grant.json.data.media_id}`);
    if (state.json?.data?.state === "READY") return grant.json.data.media_id;
    if (state.json?.data?.state === "REJECTED") throw new Error(`MEDIA_REJECTED:${state.json.data.rejection_code}`);
    await sleep(1000);
  }
  throw new Error("MEDIA_NEVER_READY");
}

async function upsert(req, collection, key, value, data, tenant) {
  const found = await req(`/api/${collection}?depth=0&draft=true&limit=1&where[${key}][equals]=${encodeURIComponent(value)}`);
  const existing = found.json?.docs?.[0];
  const response = existing
    ? await req(`/api/${collection}/${existing.id}?draft=true&depth=0`, { method: "PATCH", body: JSON.stringify(data) })
    : await req(`/api/${collection}?draft=true&depth=0`, { method: "POST", body: JSON.stringify({ ...data, tenant }) });
  if (response.status >= 300) throw new Error(`STUDIO_${collection.toUpperCase()}_FAILED:${response.status}:${JSON.stringify(response.json?.errors ?? response.json).slice(0, 400)}`);
  return (response.json?.doc ?? response.json).id;
}

async function buildSite(recorded, text, req, refsBase) {
  const settingsDoc = (await req("/api/site-settings?depth=0&draft=true&limit=1")).json.docs[0];
  const tenant = typeof settingsDoc.tenant === "object" ? settingsDoc.tenant.id : settingsDoc.tenant;

  const mediaIds = new Map();
  for (const item of mediaNeeded(recorded)) mediaIds.set(item.id, await studioUpload(req, item.file));
  const videoIds = new Map();
  for (const item of videosNeeded(recorded)) videoIds.set(item.id, await studioUpload(req, item.file));
  say(`media ${mediaIds.size} images, ${videoIds.size} video`);

  const plan = sitePlan(recorded, {
    ...refsBase,
    media: (id) => mediaIds.get(id) ?? null,
    video: (id) => videoIds.get(id) ?? null,
  }, text);

  const categoryIds = new Map();
  for (const category of plan.categories) {
    categoryIds.set(category.recorded_id, await upsert(req, "categories", "slug", category.slug, { title: category.title, slug: category.slug }, tenant));
  }
  for (const destination of plan.destinations) await upsert(req, "destinations", "slug", destination.slug, destination, tenant);
  for (const story of plan.stories) {
    const { category_recorded_id: categoryRef, ...body } = story;
    await upsert(req, "stories", "slug", story.slug, { ...body, ...(categoryIds.has(categoryRef) ? { category: categoryIds.get(categoryRef) } : {}) }, tenant);
  }
  say(`collections ${plan.categories.length} category, ${plan.destinations.length} destination, ${plan.stories.length} story`);

  const settings = await req(`/api/site-settings/${settingsDoc.id}?draft=true&depth=0`, { method: "PATCH", body: JSON.stringify(plan.settings) });
  if (settings.status >= 300) throw new Error(`STUDIO_SETTINGS_FAILED:${settings.status}:${JSON.stringify(settings.json?.errors ?? settings.json).slice(0, 400)}`);

  const existing = (await req("/api/pages?depth=0&draft=true&limit=100")).json.docs;
  const bySlug = new Map(existing.map((page) => [page.slug ?? "", page]));
  const pageIds = new Map();
  for (const page of plan.pages) {
    const current = bySlug.get(page.slug);
    const body = { title: page.title, slug: page.slug, blocks: page.blocks, enabled: true, kind: page.kind, parent: null, ...(page.collection_kind ? { collection_kind: page.collection_kind } : {}) };
    const response = current
      ? await req(`/api/pages/${current.id}?draft=true&depth=0`, { method: "PATCH", body: JSON.stringify({ ...body, revision: current.revision }) })
      : await req("/api/pages?draft=true&depth=0", { method: "POST", body: JSON.stringify({ ...body, tenant }) });
    if (response.status >= 300) throw new Error(`STUDIO_PAGE_FAILED:/${page.slug}:${response.status}:${JSON.stringify(response.json?.errors ?? response.json).slice(0, 600)}`);
    pageIds.set(page.slug, (response.json?.doc ?? response.json).id ?? current?.id);
  }
  for (const page of existing) {
    if (!plan.pages.some((row) => row.slug === (page.slug ?? "")) && page.enabled !== false) {
      await req(`/api/pages/${page.id}?draft=true&depth=0`, { method: "PATCH", body: JSON.stringify({ enabled: false, revision: page.revision }) });
    }
  }
  say(`pages ${plan.pages.length}`);

  const link = (item) => {
    const page = pageIds.get(item.page_slug);
    if (!page) throw new Error(`NAV_TARGET_MISSING:${item.label}`);
    return { label: item.label, target_type: "page", page };
  };
  const navBody = {
    items: plan.navigation.items.map((item) => ({ ...link(item), ...(item.children ? { children: item.children.map(link) } : {}) })),
    header_cta: plan.navigation.header_cta ? link(plan.navigation.header_cta) : null,
    wordmark: null,
  };
  const nav = (await req("/api/navigation?depth=0&draft=true&limit=1")).json.docs[0];
  const navResult = nav
    ? await req(`/api/navigation/${nav.id}?draft=true&depth=0`, { method: "PATCH", body: JSON.stringify(navBody) })
    : await req("/api/navigation?draft=true&depth=0", { method: "POST", body: JSON.stringify({ ...navBody, tenant }) });
  if (navResult.status >= 300) throw new Error(`STUDIO_NAV_FAILED:${navResult.status}:${JSON.stringify(navResult.json?.errors ?? navResult.json).slice(0, 400)}`);
  const footer = (await req("/api/footer?depth=0&draft=true&limit=1")).json.docs[0];
  const footerResult = footer
    ? await req(`/api/footer/${footer.id}?draft=true&depth=0`, { method: "PATCH", body: JSON.stringify(plan.footer) })
    : await req("/api/footer?draft=true&depth=0", { method: "POST", body: JSON.stringify({ ...plan.footer, tenant }) });
  if (footerResult.status >= 300) throw new Error(`STUDIO_FOOTER_FAILED:${footerResult.status}:${JSON.stringify(footerResult.json?.errors ?? footerResult.json).slice(0, 400)}`);
  say("navigation, footer, settings saved");
  return plan;
}

async function publish(auth, brandId, siteId) {
  const ari = (action) => auth.control(`/v1/sites/${siteId}/ari`, "POST", { operation_id: crypto.randomUUID(), action, brand_id: brandId, args: { brand_id: brandId, site_id: siteId } });
  let validation;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    validation = await ari("validate_site_draft");
    if (validation.status < 500) break;
    await sleep(3000);
  }
  if (validation.status >= 300) throw new Error(`VALIDATE_FAILED:${validation.status}:${JSON.stringify(validation.json).slice(0, 600)}`);
  const operationId = crypto.randomUUID();
  // Not repeated: a slow local publish can answer 503 while it still
  // completes, so the operation itself is the truth (polled below).
  const started = await auth.control(`/v1/sites/${siteId}/publications`, "POST", { operation_id: operationId, expected_revision: validation.json.data.home_revision, source_digest: validation.json.data.draft_digest }, { retry: false });
  if (started.status >= 300 && started.status < 500) throw new Error(`PUBLISH_FAILED:${started.status}:${JSON.stringify(started.json).slice(0, 400)}`);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const state = await auth.control(`/v1/sites/${siteId}/operations/${operationId}`);
    const phase = state.json?.data?.state ?? state.json?.data?.status;
    if (phase === "succeeded") return say("publish succeeded");
    if (phase === "failed") throw new Error(`PUBLISH_OPERATION_FAILED:${JSON.stringify(state.json?.data).slice(0, 600)}`);
    await sleep(2000);
  }
  throw new Error("PUBLISH_TIMEOUT");
}

// ------------------------------------------------------------------- run

async function main() {
  const brandId = readSecrets().fixtures.young_and_stamped_brand_id;
  const recorded = recordSource();
  const text = componentText(recorded);
  const plan = corePlan(recorded, { brandId, timezone: SITE_TIMEZONE, archive: text.archive, hash: sha, sourceNote: SOURCE_NOTE });
  const auth = localAuth();

  if (!flags.has("--skip-core")) await seedCoreTrips(recorded, brandId, plan);
  const trips = plan.trips.map((trip) => ({ ...trip, id: stableId(`${brandId}:trip:${trip.slug}`) }));
  const brandSlug = (await auth.rest(`brands?id=eq.${brandId}&select=slug`))[0]?.slug;
  const feedTrips = await auth.rest(`events?brand_id=eq.${brandId}&event_type=eq.trip&select=id,slug`);
  for (const trip of trips) if (!feedTrips.some((row) => row.id === trip.id)) throw new Error(`CORE_TRIP_MISSING:${trip.slug} (run without --skip-core)`);
  const history = runHistoryImport(plan, brandId);
  const site = await ensureSite(auth, brandId);
  runReviewImport(history, site.id);

  const tripRef = new Map(trips.map((trip) => [trip.recorded_id, { id: trip.id, public_url: `https://host.usemingla.com/t/${brandSlug}/${trip.slug}` }]));
  const historyIds = plan.historyFile.trips.map((row) => history.map.trips[row.import_key]?.event_id).filter(Boolean);
  const refsBase = {
    trip: (recordedId) => tripRef.get(recordedId) ?? null,
    tripsNewestFirst: [...trips].sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))).map((trip) => trip.id),
    history: historyIds,
    series: history.map.series ?? [],
    linkedHistory: plan.linkedHistoryKeys.map((key) => history.map.trips[key]?.event_id).filter(Boolean),
  };
  const req = await studioSession(auth, brandId, site.id);
  await buildSite(recorded, text, req, refsBase);
  if (!flags.has("--skip-publish")) await publish(auth, brandId, site.id);
  writePrivate(resolve(PRIVATE, "ys-seed-result.json"), `${JSON.stringify({
    site_id: site.id,
    host: site.host,
    trips: Object.fromEntries(trips.map((trip) => [trip.slug, { id: trip.id, public_url: tripRef.get(trip.recorded_id).public_url }])),
    history_count: historyIds.length,
    seeded_at: new Date().toISOString(),
  }, null, 2)}\n`);
  say("YS_LOCAL_SEED_OK");
}

main().catch((error) => {
  process.stderr.write(`FAIL seed-young-and-stamped: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exit(1);
});
