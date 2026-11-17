// #4453 production-build smoke, step 2 (step 1 is fixtures.test.ts, which
// writes PROD_SMOKE_DIR). Builds the runtime with `next build` (skip with
// --no-build), then for each feed state (empty, three upcoming trips plus an
// event, a session and a room; #4453 milestone 9 adds one detail page per kind) starts a
// fresh `next start` in local mode against a loopback mock of Core and
// storage, and requests Home and Trips for every design key. Every page must
// answer 200, and with an empty feed no empty-grid markup may reach the
// public HTML (I-SITES-NO-PUBLIC-EMPTY-STATE). A server component calling a
// "use client" export fails only here, never in jsdom.
//
//   npm run smoke:prod            # from mingla-sites/
//   PROD_SMOKE_DIR=/tmp/x node e2e/prod-smoke/smoke.mjs --no-build
//
// Exit code 0 only when every request passed; the failures are printed.
//
// #4453 milestone 7 — `--fixture ys` serves Young and Stamped's COMPOSED site
// (composer v2 in Voyage, published through the real Studio builder by
// mingla-site-cms ysComposed.issue4453.test.ts with YS_COMPOSED_OUT) instead of
// the per-design fixtures, on the same production build, at
// http://youngandstamped.sites.localhost:<APP_PORT>/. It requests every page,
// checks Home's recipe order, that every same-site link answers 200 and every
// Book link goes to host.usemingla.com, and that no page scrolls sideways at
// 1440 or 375 px. PROD_SMOKE_SHOTS=<dir> saves full-page screenshots; --serve
// keeps next start running afterwards (Ctrl-C stops it) for a manual look.
//
//   npm run smoke:prod:ys         # from mingla-sites/ (see package.json)

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..", "..");
const dir = resolve(process.env.PROD_SMOKE_DIR ?? "/tmp/mingla-sites-prod-smoke");
const MOCK_PORT = Number(process.env.PROD_SMOKE_MOCK_PORT ?? 57471);
const APP_PORT = Number(process.env.PROD_SMOKE_APP_PORT ?? 3471);
const EMPTY_MARKERS = ["mg-empty", "v-empty", "offering-grid-message", "will appear here as soon as they are on sale", "No upcoming"];

const fixtureArg = process.argv.indexOf("--fixture");
const FIXTURE = fixtureArg > 0 ? process.argv[fixtureArg + 1] : null;
const SERVE = process.argv.includes("--serve");
const SHOTS = process.env.PROD_SMOKE_SHOTS ? resolve(process.env.PROD_SMOKE_SHOTS) : null;
if (FIXTURE !== null && FIXTURE !== "ys") {
  console.error(`prod-smoke: unknown --fixture ${FIXTURE} (only "ys")`);
  process.exit(2);
}
const YS_HOST = "youngandstamped.sites.localhost";

/** Young and Stamped's composed artifact, bound to one local host exactly as Core binds a published site. */
function ysSites() {
  const artifactFile = join(dir, "ys-composed.json");
  if (!existsSync(artifactFile) || !existsSync(join(dir, "ys-feed.json"))) {
    console.error(`prod-smoke: no YS artifact in ${dir}; run mingla-site-cms ysComposed.issue4453.test.ts with YS_COMPOSED_OUT=${dir} first (npm run smoke:prod:ys does).`);
    process.exit(2);
  }
  const bytes = readFileSync(artifactFile);
  const artifact = JSON.parse(bytes.toString("utf8"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  // The mock serves storage objects by their last path segment (the digest file).
  writeFileSync(join(dir, `${digest}.json`), bytes);
  return {
    artifact,
    sites: {
      [YS_HOST]: {
        site_id: artifact.site_id, brand_id: artifact.brand_id, publication_id: artifact.publication_id,
        artifact_key: `publications/${artifact.site_id}/${artifact.publication_id}/${digest}.json`, artifact_digest: digest,
        artifact_schema_version: 2, renderer_key: artifact.renderer_key, renderer_version: artifact.renderer_version,
        hostname: YS_HOST, primary_hostname: YS_HOST, is_primary: true, host_kind: "subdomain", design_key: artifact.design.key,
        site_hostnames: [YS_HOST],
        smoke_paths: artifact.pages.map((page) => `/${page.path}`),
        expects_booking: false,
        expects_live_trips: true,
      },
    },
  };
}

let ys = null;
let sites;
let upcomingFeed;
if (FIXTURE === "ys") {
  ys = ysSites();
  sites = ys.sites;
  upcomingFeed = JSON.parse(readFileSync(join(dir, "ys-feed.json"), "utf8"));
} else {
  if (!existsSync(join(dir, "sites.json"))) {
    console.error(`prod-smoke: no fixtures in ${dir}; run the fixtures step first (npm run smoke:prod).`);
    process.exit(2);
  }
  sites = JSON.parse(readFileSync(join(dir, "sites.json"), "utf8"));
  upcomingFeed = JSON.parse(readFileSync(join(dir, "feed.json"), "utf8"));
}
let feedOn = false;

const VENUE = "22222222-2222-4222-8222-000000000001";
const EVENT = "22222222-2222-4222-8222-000000000002";
const TIER = "22222222-2222-4222-8222-000000000003";
function bookingAnswer() {
  const day = (i) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
  const slot = (d, t, state, left) => ({ label: t, start_local: `${d}T${t}`, state, left, price_minor: null, currency: null,
    href: state === "full" ? null : `https://host.usemingla.com/b/fixture/v/kitchen?tab=book&date=${d}&time=${t}&party=2` });
  const now = new Date().toISOString();
  return {
    generated_at: now,
    availability: { [`venue_slots:${VENUE}:2:7`]: { generated_at: now, timezone: "Africa/Lagos", source: "venue_slots", title: "Smoke Kitchen",
      days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ local_date: day(i), slots: [slot(day(i), "18:00", "open", 6), slot(day(i), "18:30", "few", 2), slot(day(i), "19:30", "full", 0), slot(day(i), "20:00", "open", 8)] })) } },
    ticket_tiers: { [EVENT]: { generated_at: now,
      event: { id: EVENT, title: "Supper club", start_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), end_at: null, timezone: "Africa/Lagos", status: "scheduled", public_url: "https://host.usemingla.com/e/fixture/supper" },
      tiers: [{ id: TIER, name: "Seat", price_minor: 450000, currency: "USD", is_free: false, state: "on_sale", sale_starts_at: null, href: `https://host.usemingla.com/checkout/${EVENT}?seed=${TIER}:1` }] } },
    targets: { [`venue_table:${VENUE}`]: { kind: "venue_table", id: VENUE, title: "Smoke Kitchen", base_url: "https://host.usemingla.com/b/fixture/v/kitchen", timezone: "Africa/Lagos", min_price_minor: null, currency: null } },
    rating: { source: "mingla_place_reviews", score: 4.6, count: 23 },
  };
}

/**
 * #4453 M7 — the departures a trip's availability strip asks for ("trip_departures"), answered from the
 * fixture feed's own trip (its next three start dates, each linking to the trip on Mingla). Only for asks
 * the page really made, keyed exactly as Core keys them.
 */
function withDepartures(answer, rawBody) {
  let asks = [];
  try { asks = JSON.parse(rawBody || "{}")?.request?.availability ?? []; } catch { asks = []; }
  for (const ask of Array.isArray(asks) ? asks : []) {
    if (ask?.source !== "trip_departures") continue;
    const trip = (feedOn ? upcomingFeed.offerings : []).find((offering) => offering.id.toLowerCase() === String(ask.target_id).toLowerCase());
    if (!trip) continue;
    const first = new Date(trip.start_at);
    const days = [0, 14, 28].map((offset) => new Date(first.getTime() + offset * 86_400_000).toISOString().slice(0, 10));
    answer.availability[`trip_departures:${String(ask.target_id).toLowerCase()}:${ask.party_size}:${ask.days}`] = {
      generated_at: answer.generated_at, timezone: trip.timezone ?? "Europe/London", source: "trip_departures", title: trip.title,
      days: days.map((date) => ({ local_date: date, slots: [{ label: "Depart", start_local: `${date}T09:00`, state: "open", left: 5, price_minor: null, currency: null, href: trip.public_url }] })),
    };
  }
  return answer;
}

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const url = req.url ?? "/";
    const send = (status, value, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
    };
    let m;
    if (url.startsWith("/auth/v1/token")) return send(200, { access_token: "prod-smoke-local-token-4453-xxxxxxxx", token_type: "bearer", expires_in: 3600 });
    if (url.endsWith("/offerings")) {
      // #4453 milestone 9 — SITES_DETAIL_PAGES on in both states (with an empty feed every detail path must 404).
      return send(200, { ok: true, data: { ...(feedOn ? upcomingFeed : { ...upcomingFeed, offerings: [] }), detail_pages: true } });
    }
    // #4453 milestone 9 — Core's detail extras: a trip's days and inclusions, a room's facts.
    if (url.endsWith("/offering-detail")) {
      let ask = {};
      try { ask = JSON.parse(body); } catch { /* answered below */ }
      const row = feedOn ? upcomingFeed.offerings.find((offering) => offering.kind === ask.kind && offering.slug === ask.slug) : null;
      if (!row) return send(404, { ok: false, error: { code: "NOT_FOUND" } });
      return send(200, { ok: true, data: {
        offering_id: row.id, kind: row.kind,
        days: row.kind === "trip" ? [{ day: 1, title: "Arrive on the coast", summary: "Meet the group and walk the harbour at dusk." }, { day: 2, title: "Out to the islands", summary: null }] : [],
        included: row.kind === "trip" ? ["Two guides", "Every breakfast", "Boat transfers"] : [],
        stay: row.kind === "stay" ? { kind: "room", max_guests: 3, max_adults: 2, max_children: 1, amenities: ["Wi-Fi", "Sea view"], accessibility: [] } : null,
        photos: [],
      } });
    }
    if (url.includes("/enquiry-status")) return send(200, { ok: true, data: { status: "available" } });
    // #4453 milestone 5 — Core's live booking answer for the blocks every Home carries.
    if (url.endsWith("/booking")) return send(200, { ok: true, data: withDepartures(bookingAnswer(), body) });
    if ((m = url.match(/\/internal\/v1\/hosts\/([^/]+)\/(publication|site|probe)/))) {
      const site = sites[decodeURIComponent(m[1])];
      if (!site) return send(404, { ok: false });
      const { smoke_paths: _paths, expects_live_trips: _live, ...binding } = site;
      return send(200, { ok: true, data: m[2] === "publication" ? binding : { site_id: site.site_id, brand_id: site.brand_id, hostname: site.hostname } });
    }
    if ((m = url.match(/^\/storage\/v1\/object\/authenticated\/sites-publication-artifacts\/(.+)$/))) {
      const file = join(dir, decodeURIComponent(m[1]).split("/").pop());
      if (existsSync(file)) return send(200, readFileSync(file));
    }
    return send(404, { ok: false, error: "MOCK_NOT_FOUND" });
  });
});
await new Promise((done) => mock.listen(MOCK_PORT, "127.0.0.1", done));

const key = () => randomBytes(32).toString("base64");
const env = {
  ...process.env,
  SITES_LOCAL_MODE: "1",
  NODE_ENV: "production",
  SITES_CMS_PROJECT_REF: "prodsmoke4453aaaaaaa",
  SITES_CORE_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SITES_STORAGE_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SITES_STORAGE_SUPABASE_ANON_KEY: "prod-smoke-anon",
  SITES_STORAGE_READER_EMAIL: "reader@prod-smoke.invalid",
  SITES_STORAGE_READER_PASSWORD: "prod-smoke",
  SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
  SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
  MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "prod-smoke-kid",
  MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64: key(),
  SITES_CANDIDATE_PROBE_SECRET: key(),
};
delete env.VERCEL;
delete env.VERCEL_ENV;

if (!process.argv.includes("--no-build")) {
  console.log("prod-smoke: next build");
  // Next 16 may stop a build once to show an upgrade notice ("Retry the same
  // command to continue"); the smoke retries exactly once in that case.
  let build = spawnSync("npx", ["next", "build"], { cwd: app, env, encoding: "utf8" });
  if (build.status !== 0 && /SecurityFatalError/.test(`${build.stdout}${build.stderr}`)) {
    console.log("prod-smoke: next build stopped for its upgrade notice; retrying once");
    build = spawnSync("npx", ["next", "build"], { cwd: app, env, encoding: "utf8" });
  }
  process.stdout.write(build.stdout ?? "");
  process.stderr.write(build.stderr ?? "");
  if (build.status !== 0) { mock.close(); process.exit(build.status ?? 1); }
}

const failures = [];
const request = (host, path) => new Promise((done) => {
  const req = http.request({ host: "127.0.0.1", port: APP_PORT, path, headers: { host: `${host}:${APP_PORT}` } }, (res) => {
    let html = "";
    res.on("data", (chunk) => { html += chunk; });
    res.on("end", () => done({ status: res.statusCode ?? 0, html }));
  });
  req.on("error", (error) => done({ status: 0, html: String(error) }));
  req.end();
});

async function waitForApp() {
  for (let i = 0; i < 120; i += 1) {
    const { status } = await request(Object.keys(sites)[0], "/");
    if (status !== 0) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("next start did not come up");
}

async function phoneWidthCheck(out) {
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    out.push("phone width: Playwright is not installed (npm ci in mingla-sites)");
    return;
  }
  // The pinned Playwright browser, else the machine's Chrome (no download at run time).
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    for (const [host, site] of Object.entries(sites)) {
      for (const path of [...site.smoke_paths, ...(site.detail_paths ?? []).map((detail) => detail.path)]) {
        await page.goto(`http://${host}:${APP_PORT}${path}`, { waitUntil: "networkidle" });
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        if (width > 375) out.push(`375 ${site.design_key} ${path}: the page is ${width}px wide (scrolls sideways)`);
        else console.log(`ok 375 ${site.design_key} ${path} (${width}px)`);
      }
    }
  } finally {
    await browser.close();
  }
}

/** Text of a block's own heading, as the artifact holds it (hero and ticker carry none). */
const headingOf = (block) => (typeof block.heading === "string" && block.heading.trim() ? block.heading.trim() : null);
const decode = (html) => html.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

/** #4453 M7 — Young and Stamped: recipe order, links, and no sideways scroll at 1440 and 375 (screenshots on request). */
async function ysChecks(out) {
  const home = ys.artifact.pages.find((page) => page.path === "");
  const homeHtml = decode((await request(YS_HOST, "/")).html);
  console.log(`ys Home recipe: ${home.blocks.map((block) => block.type).join(" > ")}`);
  let at = -1;
  for (const block of home.blocks) {
    const heading = headingOf(block);
    if (!heading) continue;
    const found = homeHtml.indexOf(heading, at + 1);
    if (found < 0) out.push(`ys Home: the ${block.type} heading "${heading}" is not drawn`);
    else if (found < at) out.push(`ys Home: ${block.type} "${heading}" is out of recipe order`);
    else { at = found; console.log(`ok ys recipe ${block.type} "${heading}"`); }
  }
  // Every same-site link answers 200; every Book link leaves for host.usemingla.com.
  const sameSite = new Set();
  const bookLinks = [];
  for (const path of sites[YS_HOST].smoke_paths) {
    const { html } = await request(YS_HOST, path);
    for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const href = decode(m[1]);
      const text = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (href.startsWith("/") && !href.startsWith("//")) sameSite.add(href.split("#")[0].split("?")[0] || "/");
      if (/\bbook\b/i.test(text) && !href.startsWith("/")) bookLinks.push({ path, href, text });
    }
  }
  for (const href of [...sameSite].sort()) {
    if (href.startsWith("/_next/") || href.startsWith("/__")) continue;
    const { status } = await request(YS_HOST, href);
    if (status !== 200) out.push(`ys link ${href}: HTTP ${status}`);
    else console.log(`ok ys link ${href}`);
  }
  for (const link of bookLinks) {
    if (!link.href.startsWith("https://host.usemingla.com/")) out.push(`ys Book link on ${link.path} goes to ${link.href}`);
    else console.log(`ok ys Book "${link.text}" on ${link.path} -> ${link.href}`);
  }
  if (!bookLinks.length) out.push("ys: no Book link to host.usemingla.com on any page");
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    out.push("ys widths: Playwright is not installed (npm ci in mingla-sites)");
    return;
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  try {
    for (const width of [1440, 375]) {
      // Reduced motion draws every scroll-reveal section at once, so a full-page screenshot shows them all.
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 }, reducedMotion: "reduce" });
      for (const path of ["/", "/trips", "/about"]) {
        await page.goto(`http://${YS_HOST}:${APP_PORT}${path}`, { waitUntil: "networkidle" });
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
        if (scroll > width) out.push(`ys ${width} ${path}: the page is ${scroll}px wide (scrolls sideways)`);
        else console.log(`ok ys ${width} ${path} (${scroll}px)`);
        if (SHOTS) {
          // Walk the page once so lazy images and reveal observers fire, then shoot from the top.
          await page.evaluate(async () => {
            for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
            window.scrollTo(0, 0);
          });
          await page.waitForTimeout(300);
        }
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `ys-${path === "/" ? "home" : path.slice(1)}-${width}.png`), fullPage: true });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (SHOTS) console.log(`ys screenshots: ${SHOTS}`);
}

for (const state of ["empty", "upcoming"]) {
  feedOn = state === "upcoming";
  const server = spawn("npx", ["next", "start", "-p", String(APP_PORT)], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (chunk) => { log += chunk; });
  server.stderr.on("data", (chunk) => { log += chunk; });
  try {
    await waitForApp();
    for (const [host, site] of Object.entries(sites)) {
      let sawTrip = false;
      for (const path of site.smoke_paths) {
        const { status, html } = await request(host, path);
        const label = `${state} ${site.design_key} ${path}`;
        if (status !== 200) { failures.push(`${label}: HTTP ${status}`); continue; }
        if (state === "empty") {
          const found = EMPTY_MARKERS.filter((marker) => html.includes(marker));
          if (found.length) failures.push(`${label}: empty-grid markup on the public page (${found.join(", ")})`);
        }
        if (html.includes(upcomingFeed.offerings[0]?.title ?? "Smoke Trip 1")) sawTrip = true;
        if (path === "/" && site.expects_booking && !(html.includes("mg-slots") && html.includes("mg-tiers") && (!site.expects_rating || html.includes("reviews on Mingla")))) {
          failures.push(`${label}: the live booking blocks are not drawn on Home (saved ${site.design_key}-home.html)`);
          writeFileSync(join(dir, `${site.design_key}-home.html`), html);
        }
        console.log(`ok ${label}`);
      }
      if (state === "upcoming" && site.expects_live_trips && !sawTrip) failures.push(`upcoming ${site.design_key}: no upcoming trip drawn on Home or Trips`);
      // #4453 milestone 9 — one detail page per kind on every design: 200 with the
      // detail template and its Mingla action while the offering is in the feed,
      // 404 once it is not (the empty feed).
      for (const detail of site.detail_paths ?? []) {
        const { status, html } = await request(host, detail.path);
        const label = `${state} ${site.design_key} ${detail.path}`;
        if (state === "empty") {
          if (status !== 404) failures.push(`${label}: HTTP ${status}, expected 404 (not in the feed)`);
          else console.log(`ok ${label} (404)`);
          continue;
        }
        if (status !== 200) { failures.push(`${label}: HTTP ${status}`); continue; }
        if (!html.includes("mg-dtl") || !html.includes(detail.title) || !html.includes("https://host.usemingla.com/")) {
          failures.push(`${label}: no detail template, title or Mingla action (saved ${site.design_key}-detail.html)`);
          writeFileSync(join(dir, `${site.design_key}-detail.html`), html);
        } else console.log(`ok ${label}`);
      }
    }
    // #4453 milestone 5 (tester P1-3) — at 375 px no page scrolls sideways, on every design, Home and Trips.
    if (state === "upcoming") await (ys ? ysChecks(failures) : phoneWidthCheck(failures));
    if (state === "upcoming" && SERVE) {
      console.log(`prod-smoke: serving ${Object.keys(sites).map((host) => `http://${host}:${APP_PORT}/`).join(" ")} (Ctrl-C stops it)`);
      await new Promise((done) => { process.once("SIGINT", done); process.once("SIGTERM", done); });
    }
  } catch (error) {
    failures.push(`${state}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    server.kill("SIGTERM");
    await new Promise((done) => setTimeout(done, 800));
  }
  const crashes = log.split("\n").filter((line) => /⨯|Attempted to call|from the server/.test(line));
  for (const line of crashes.slice(0, 10)) failures.push(`${state} server log: ${line.trim().slice(0, 240)}`);
}
mock.close();
// `next build` rewrites the tracked next-env.d.ts; put the reviewed copy back.
spawnSync("git", ["checkout", "--", "next-env.d.ts"], { cwd: app, stdio: "ignore" });

if (failures.length) {
  console.error(`prod-smoke: FAIL (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`prod-smoke: PASS (${Object.keys(sites).length} designs x 2 feed states, ${Object.values(sites).reduce((sum, site) => sum + (site.detail_paths?.length ?? 0), 0)} detail pages)`);
