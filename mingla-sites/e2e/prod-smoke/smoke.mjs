// #4453 production-build smoke, step 2 (step 1 is fixtures.test.ts, which
// writes PROD_SMOKE_DIR). Builds the runtime with `next build` (skip with
// --no-build), then for each feed state (empty, three upcoming trips) starts a
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

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..", "..");
const dir = resolve(process.env.PROD_SMOKE_DIR ?? "/tmp/mingla-sites-prod-smoke");
const MOCK_PORT = Number(process.env.PROD_SMOKE_MOCK_PORT ?? 57471);
const APP_PORT = Number(process.env.PROD_SMOKE_APP_PORT ?? 3471);
const EMPTY_MARKERS = ["mg-empty", "v-empty", "offering-grid-message", "will appear here as soon as they are on sale", "No upcoming"];

if (!existsSync(join(dir, "sites.json"))) {
  console.error(`prod-smoke: no fixtures in ${dir}; run the fixtures step first (npm run smoke:prod).`);
  process.exit(2);
}
const sites = JSON.parse(readFileSync(join(dir, "sites.json"), "utf8"));
const upcomingFeed = JSON.parse(readFileSync(join(dir, "feed.json"), "utf8"));
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
      return send(200, { ok: true, data: feedOn ? upcomingFeed : { ...upcomingFeed, offerings: [] } });
    }
    if (url.includes("/enquiry-status")) return send(200, { ok: true, data: { status: "available" } });
    // #4453 milestone 5 — Core's live booking answer for the blocks every Home carries.
    if (url.endsWith("/booking")) return send(200, { ok: true, data: bookingAnswer() });
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
      for (const path of site.smoke_paths) {
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
        if (html.includes("Smoke Trip 1")) sawTrip = true;
        if (path === "/" && site.expects_booking && !(html.includes("mg-slots") && html.includes("mg-tiers") && (!site.expects_rating || html.includes("reviews on Mingla")))) {
          failures.push(`${label}: the live booking blocks are not drawn on Home (saved ${site.design_key}-home.html)`);
          writeFileSync(join(dir, `${site.design_key}-home.html`), html);
        }
        console.log(`ok ${label}`);
      }
      if (state === "upcoming" && site.expects_live_trips && !sawTrip) failures.push(`upcoming ${site.design_key}: no upcoming trip drawn on Home or Trips`);
    }
    // #4453 milestone 5 (tester P1-3) — at 375 px no page scrolls sideways, on every design, Home and Trips.
    if (state === "upcoming") await phoneWidthCheck(failures);
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
console.log(`prod-smoke: PASS (${Object.keys(sites).length} designs x 2 feed states)`);
