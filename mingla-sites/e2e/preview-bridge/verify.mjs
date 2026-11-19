// #4453 website workspace (build contract D) — the preview bridge on the REAL
// production build, in a real browser, under the preview's real response
// headers. jsdom proves the protocol; this proves the three things jsdom
// cannot:
//
//   1. PIXELS. For every design key, Home (and the trips page) of a private
//      preview is screenshotted twice at 1440 and 390 px: once with Studio's
//      section list beside the artifact (sections marked, bridge running,
//      `data-mingla-section` set) and once without it. The two pictures must
//      be IDENTICAL: zero differing pixels, same height.
//   2. THE POLICY. The preview document's Content-Security-Policy is the
//      strict one (nonce + strict-dynamic, no inline script), the bridge runs
//      under it, and the browser reports no policy violation and no
//      hydration error.
//   3. THE FRAME. Framed by a loopback parent (as Host web frames it), the
//      preview answers `ready`, a real mouse click on a link inside a section
//      selects the section and does not navigate, the keyboard reaches and
//      picks a section, marks and typed text appear, and with edit mode off
//      the same link navigates again.
//
// Step 1 is the prod-smoke fixtures (one publication per design key):
//
//   npm run verify:preview-bridge          # from mingla-sites/ (fixtures, build, verify)
//   PROD_SMOKE_DIR=/tmp/x node e2e/preview-bridge/verify.mjs --no-build
//
// Exit code 0 only when every check passed; the failures are printed.
// PREVIEW_BRIDGE_DESIGN=<key>[,<key>] runs only those designs.
// PREVIEW_BRIDGE_BREAK=wrapper is a sensitivity proof: it wraps the first
// section in an element the way a naive marker would, and the pixel check
// must then FAIL for designs that style top-level sections by position.

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..", "..");
const dir = resolve(process.env.PROD_SMOKE_DIR ?? "/tmp/mingla-sites-preview-bridge");
const outDir = resolve(process.env.PREVIEW_BRIDGE_OUT ?? join(dir, "preview-bridge-out"));
const MOCK_PORT = Number(process.env.PREVIEW_BRIDGE_MOCK_PORT ?? 57953);
const APP_PORT = Number(process.env.PREVIEW_BRIDGE_APP_PORT ?? 3953);
const PARENT_PORT = Number(process.env.PREVIEW_BRIDGE_PARENT_PORT ?? 3954);
const BREAK = process.env.PREVIEW_BRIDGE_BREAK ?? "";
const VIEWPORTS = [[1440, 900], [390, 844]];

if (!existsSync(join(dir, "sites.json"))) {
  console.error(`preview-bridge: no fixtures in ${dir}; run the fixtures step first (npm run verify:preview-bridge).`);
  process.exit(2);
}
let sites = JSON.parse(readFileSync(join(dir, "sites.json"), "utf8"));
const feed = JSON.parse(readFileSync(join(dir, "feed.json"), "utf8"));
if (process.env.PREVIEW_BRIDGE_DESIGN) {
  const keep = new Set(process.env.PREVIEW_BRIDGE_DESIGN.split(",").map((key) => key.trim()));
  sites = Object.fromEntries(Object.entries(sites).filter(([, site]) => keep.has(site.design_key)));
}

// One private preview per design: the publication's own artifact under a `preview-` id, with the section
// list Studio would store beside it (served or withheld by the mock, so the SAME artifact renders both ways).
const sectionId = (page, index) => createHash("sha256").update(`${page}|${index}`).digest("hex").slice(0, 24);
const previews = {};
for (const [host, site] of Object.entries(sites)) {
  const artifact = JSON.parse(readFileSync(join(dir, `${site.artifact_digest}.json`), "utf8"));
  const previewId = `preview-${randomBytes(16).toString("hex")}`;
  const bytes = Buffer.from(JSON.stringify({ ...artifact, publication_id: previewId }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(dir, `${digest}.json`), bytes);
  const pages = Object.fromEntries(artifact.pages.map((page) => [page.path, page.blocks.map((_, index) => sectionId(page.path, index))]));
  writeFileSync(join(dir, `${digest}.sections`), JSON.stringify({ v: 1, artifact_digest: digest, pages }));
  previews[host] = { key: `publications/${artifact.site_id}/${previewId}/${digest}.json`, pages, artifact, paths: site.smoke_paths.map((path) => path.replace(/^\//, "")) };
}

let sectionsOn = true;
let blankIds = false;
const mock = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    const url = req.url ?? "/";
    const send = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
    };
    let m;
    if (url.startsWith("/auth/v1/token")) return send(200, { access_token: "preview-bridge-local-token-4453-xxxx", token_type: "bearer", expires_in: 3600 });
    if (url.endsWith("/offerings")) return send(200, { ok: true, data: { ...feed, detail_pages: true } });
    if (url.includes("/enquiry-status")) return send(200, { ok: true, data: { status: "available" } });
    if ((m = url.match(/\/internal\/v1\/hosts\/([^/]+)\/(publication|site|probe)/))) {
      const site = sites[decodeURIComponent(m[1])];
      if (!site) return send(404, { ok: false });
      const { smoke_paths: _paths, expects_live_trips: _live, detail_paths: _details, ...binding } = site;
      return send(200, { ok: true, data: m[2] === "publication" ? binding : { site_id: site.site_id, brand_id: site.brand_id, hostname: site.hostname } });
    }
    if ((m = url.match(/^\/storage\/v1\/object\/authenticated\/sites-publication-artifacts\/(.+)$/))) {
      const name = decodeURIComponent(m[1]).split("/").pop();
      if (name.endsWith(".sections") && !sectionsOn) return send(404, { ok: false });
      const file = join(dir, name);
      // Diagnosis only (probe): the markers without any id, so nothing is measured or tagged.
      if (name.endsWith(".sections") && blankIds && existsSync(file)) {
        const list = JSON.parse(readFileSync(file, "utf8"));
        for (const path of Object.keys(list.pages)) list.pages[path] = list.pages[path].map(() => "");
        return send(200, list);
      }
      if (existsSync(file)) return send(200, readFileSync(file));
    }
    return send(404, { ok: false, error: "MOCK_NOT_FOUND" });
  });
});
await new Promise((done) => mock.listen(MOCK_PORT, "127.0.0.1", done));

// The window that frames the preview, on a loopback origin (what local Host web is).
const parentServer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>parent</title><body style="margin:0;background:#888">
<iframe id="f" title="preview" style="display:block;width:1200px;height:800px;border:0;margin:20px 0 0 30px"></iframe>
<script>
  window.received = [];
  const frame = document.getElementById("f");
  addEventListener("message", (event) => { if (event.source === frame.contentWindow) window.received.push({ origin: event.origin, data: event.data }); });
  window.tell = (message) => frame.contentWindow.postMessage(message, new URL(frame.src).origin);
  frame.src = new URLSearchParams(location.search).get("src");
</script>`);
});
await new Promise((done) => parentServer.listen(PARENT_PORT, "127.0.0.1", done));

const key = () => randomBytes(32).toString("base64");
const env = {
  ...process.env,
  SITES_LOCAL_MODE: "1",
  NODE_ENV: "production",
  SITES_CMS_PROJECT_REF: "prodsmoke4453aaaaaaa",
  SITES_CORE_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SITES_STORAGE_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SITES_STORAGE_SUPABASE_ANON_KEY: "preview-bridge-anon",
  SITES_STORAGE_READER_EMAIL: "reader@preview-bridge.invalid",
  SITES_STORAGE_READER_PASSWORD: "preview-bridge",
  SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
  SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
  MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "preview-bridge-kid",
  MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64: key(),
  SITES_CANDIDATE_PROBE_SECRET: key(),
};
delete env.VERCEL;
delete env.VERCEL_ENV;

const closeAll = () => { mock.close(); parentServer.close(); };
if (!process.argv.includes("--no-build")) {
  console.log("preview-bridge: next build");
  let build = spawnSync("npx", ["next", "build"], { cwd: app, env, encoding: "utf8" });
  if (build.status !== 0 && /SecurityFatalError/.test(`${build.stdout}${build.stderr}`)) build = spawnSync("npx", ["next", "build"], { cwd: app, env, encoding: "utf8" });
  if (build.status !== 0) {
    process.stdout.write(build.stdout ?? "");
    process.stderr.write(build.stderr ?? "");
    closeAll();
    process.exit(build.status ?? 1);
  }
}

const failures = [];
const ok = (label) => console.log(`ok ${label}`);
const check = (condition, label, detail = "") => { if (condition) ok(label); else failures.push(`${label}${detail ? `: ${detail}` : ""}`); };
const previewUrl = (host, path = "") => `http://${host}:${APP_PORT}/preview?k=${encodeURIComponent(previews[host].key)}${path ? `&path=${encodeURIComponent(path)}` : ""}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const server = spawn("npx", ["next", "start", "-p", String(APP_PORT)], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (chunk) => { log += chunk; });
server.stderr.on("data", (chunk) => { log += chunk; });

async function waitForApp() {
  const host = Object.keys(sites)[0];
  for (let i = 0; i < 120; i += 1) {
    const status = await new Promise((done) => {
      const req = http.request({ host: "127.0.0.1", port: APP_PORT, path: "/", headers: { host: `${host}:${APP_PORT}` } }, (res) => { res.resume(); done(res.statusCode); });
      req.on("error", () => done(0));
      req.end();
    });
    if (status !== 0) return;
    await sleep(500);
  }
  throw new Error("next start did not come up");
}

// The fixtures name pictures that no storage holds. A flat grey picture stands in for every one (as in the
// design goldens), so a page lays out once instead of shifting whenever a missing picture gives up.
const placeholder = (() => {
  const png = new PNG({ width: 64, height: 48 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 158; png.data[i + 1] = 166; png.data[i + 2] = 174; png.data[i + 3] = 255; }
  return PNG.sync.write(png);
})();
async function withPlaceholderPictures(context) {
  await context.route(/\/(media|om|map)\//, (route) => (route.request().resourceType() === "image"
    ? route.fulfill({ status: 200, contentType: "image/png", body: placeholder })
    : route.continue()));
}

/** A settled, full-page picture: past the designs' reveal failsafe, scrolled through once, animations off. */
async function picture(page, url) {
  const problems = [];
  const onConsole = (message) => { if (message.type() === "error") problems.push(message.text()); };
  const onError = (error) => problems.push(String(error));
  page.on("console", onConsole);
  page.on("pageerror", onError);
  const response = await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  if (BREAK === "wrapper" && sectionsOn) {
    await page.evaluate(() => {
      const first = document.querySelector("[data-mingla-section]");
      if (!first) return;
      const wrapper = document.createElement("div");
      wrapper.style.display = "contents";
      first.parentNode.insertBefore(wrapper, first);
      wrapper.appendChild(first);
    });
  }
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise((done) => setTimeout(done, 80)); }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.fonts.ready);
  const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
  const facts = await page.evaluate(() => ({
    marked: document.querySelectorAll("[data-mingla-section]").length,
    markers: (() => { let n = 0; const walk = document.createTreeWalker(document.getElementById("main") ?? document.body, NodeFilter.SHOW_TEXT); while (walk.nextNode()) { const text = walk.currentNode.data; if (text.length && text.length % 3 === 0 && text === "\n\t\n".repeat(text.length / 3)) n += text.length / 3; } return n; })(),
    // The element that holds the sections lays whitespace out normally, and no section is inline-level.
    layout: (() => {
      const first = document.querySelector("[data-mingla-section]");
      if (!first) return "";
      const holder = getComputedStyle(first.parentElement);
      const inline = Array.from(document.querySelectorAll("[data-mingla-section]")).filter((root) => getComputedStyle(root).display.startsWith("inline")).length;
      return `${holder.display}/${holder.whiteSpaceCollapse ?? holder.whiteSpace}/${inline}`;
    })(),
    overlay: document.querySelectorAll("[data-mingla-preview-overlay]").length,
  }));
  page.off("console", onConsole);
  page.off("pageerror", onError);
  return { shot, facts, status: response?.status() ?? 0, headers: response?.headers() ?? {}, problems };
}

async function pixelChecks(browser) {
  mkdirSync(outDir, { recursive: true });
  for (const [width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await withPlaceholderPictures(context);
    const page = await context.newPage();
    // One fixed clock, so an "open now" line reads the same in both pictures.
    await page.clock.setFixedTime(new Date("2026-11-18T12:00:00Z"));
    for (const [host, site] of Object.entries(sites)) {
      for (const path of previews[host].paths) {
        const label = `${width} ${site.design_key} /${path}`;
        // One load to warm the browser's caches for this host (a first, cold load can lay out a
        // scroll-snapping row differently from every later one, marked or not); it is not compared.
        sectionsOn = false;
        await page.goto(previewUrl(host, path), { waitUntil: "networkidle" });
        sectionsOn = true;
        const marked = await picture(page, previewUrl(host, path));
        sectionsOn = false;
        const plain = await picture(page, previewUrl(host, path));
        sectionsOn = true;
        if (marked.status !== 200 || plain.status !== 200) { failures.push(`${label}: status ${marked.status}/${plain.status}`); continue; }
        const blocks = previews[host].pages[path].length;
        check(marked.facts.marked > 0 && marked.facts.markers === blocks, `${label} sections are marked with the list (${marked.facts.marked} elements, ${blocks} blocks)`, JSON.stringify(marked.facts));
        check(/^(block|flow-root|flex|grid)\/collapse\/0$/.test(marked.facts.layout), `${label} the sections' holder is a plain block container and no section is inline (${marked.facts.layout})`, marked.facts.layout);
        check(plain.facts.marked === 0 && plain.facts.markers === 0, `${label} nothing is marked without the list`, JSON.stringify(plain.facts));
        // A resource the fixtures do not hold (a font file, a video) fails the same way in both; anything else is a real problem.
        const real = (problems) => problems.filter((text) => !/Failed to load resource/.test(text));
        check(real(marked.problems).length === 0, `${label} no console error with marks`, real(marked.problems).join(" | ").slice(0, 400));
        /*
         * The verdict. A full-page picture of a page with a blurred fixed header or a dithered gradient is
         * not always the same twice (a channel off by one, here and there), with or without marks. So:
         *   - the two pictures must have the same size, and no pixel may differ by more than rendering
         *     noise (pixelmatch 0.1, the goldens' own threshold): a moved section fails this at once;
         *   - and the marked page must be able to produce the unmarked page's picture EXACTLY: if the first
         *     pair is not byte-equal, a second unmarked picture and up to two more marked ones are taken,
         *     and some marked picture must equal some unmarked one, pixel for pixel.
         */
        const name = `${site.design_key}-${path || "home"}-${width}`;
        const read = (shot) => PNG.sync.read(shot);
        const differing = (left, right, threshold) => {
          const a = read(left), b = read(right);
          if (a.width !== b.width || a.height !== b.height) return { count: -1, size: `${a.width}x${a.height} vs ${b.width}x${b.height}`, diff: null };
          const diff = new PNG({ width: a.width, height: a.height });
          return { count: pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold, includeAA: true }), size: `${a.width}x${a.height}`, diff };
        };
        const keep = (suffix, bytes) => writeFileSync(join(outDir, `${name}-${suffix}.png`), bytes);
        const visible = differing(marked.shot, plain.shot, 0.1);
        if (visible.count !== 0) {
          keep("marked", marked.shot);
          keep("plain", plain.shot);
          if (visible.diff) keep("diff", PNG.sync.write(visible.diff));
          failures.push(`${label}: the page looks different with section marks (${visible.count < 0 ? visible.size : `${visible.count} pixels`}; see ${outDir})`);
          continue;
        }
        const markedShots = [marked.shot];
        const plainShots = [plain.shot];
        const exact = () => markedShots.some((left) => plainShots.some((right) => differing(left, right, 0).count === 0));
        let retakes = 0;
        if (!exact()) {
          sectionsOn = false;
          plainShots.push((await picture(page, previewUrl(host, path))).shot);
          sectionsOn = true;
          while (!exact() && retakes < 2) {
            retakes += 1;
            markedShots.push((await picture(page, previewUrl(host, path))).shot);
          }
        }
        const noise = plainShots.length > 1 ? differing(plainShots[0], plainShots[1], 0).count : 0;
        if (!exact()) {
          keep("marked", marked.shot);
          keep("plain", plain.shot);
          keep("diff", PNG.sync.write(differing(marked.shot, plain.shot, 0).diff));
        }
        check(exact(), `${label} pixel-identical with and without section marks (${visible.size}${retakes || plainShots.length > 1 ? `; this page is not the same picture twice even unmarked (${noise} px between two unmarked loads), matched exactly on retake ${retakes}` : ""})`, `no marked picture equals an unmarked one (unmarked vs unmarked: ${noise} px; see ${outDir})`);
      }
    }
    await context.close();
  }
}

/**
 * Diagnosis only: PREVIEW_BRIDGE_PROBE=<design>:<width>:<n> takes n marked and n unmarked pictures of that
 * design's Home in turn and prints each picture's hash, to tell rendering noise from a real difference.
 */
async function probe(browser) {
  const [design, width, count] = process.env.PREVIEW_BRIDGE_PROBE.split(":");
  const host = Object.keys(sites).find((name) => sites[name].design_key === design);
  const context = await browser.newContext({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  if (!process.env.PREVIEW_BRIDGE_NO_PLACEHOLDERS) await withPlaceholderPictures(context);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00Z"));
  mkdirSync(outDir, { recursive: true });
  // The other designs first, as the full run visits them before this one.
  for (const [other, site] of Object.entries(sites)) {
    if (other === host) continue;
    for (const path of previews[other].paths) for (const on of [true, false]) { sectionsOn = on; await picture(page, previewUrl(other, path)); }
    console.log(`probe warmed with ${site.design_key}`);
  }
  for (let i = 0; i < Number(count); i += 1) {
    for (const mode of ["marked", "plain", "blank"]) {
      sectionsOn = mode !== "plain";
      blankIds = mode === "blank";
      const { shot, facts } = await picture(page, previewUrl(host, ""));
      const hash = createHash("sha256").update(PNG.sync.read(shot).data).digest("hex").slice(0, 12);
      writeFileSync(join(outDir, `probe-${mode}-${i}.png`), shot);
      console.log(`probe ${design} ${width} ${mode} #${i} ${hash} markers=${facts.markers} tagged=${facts.marked}`);
    }
  }
  blankIds = false;
  sectionsOn = true;
  await context.close();
}

function policyChecks(headers, label) {
  const csp = headers["content-security-policy"] ?? "";
  const script = csp.split("; ").find((part) => part.startsWith("script-src ")) ?? "";
  check(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'$/.test(script), `${label} script-src is nonce + strict-dynamic`, script);
  check(!/unsafe-inline|unsafe-eval/.test(script), `${label} script-src allows no inline script and no eval`, script);
  check(/frame-ancestors 'self' https:\/\/host\.usemingla\.com https:\/\/studio\.sites\.usemingla\.com http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/.test(csp), `${label} frame-ancestors is the preview's (local mode adds loopback)`, csp);
  check(csp.includes("connect-src 'self'") && csp.includes("base-uri 'none'") && csp.includes("object-src 'none'"), `${label} connect, base and object stay closed`, csp);
  check((headers["cache-control"] ?? "").includes("no-store") && (headers["x-robots-tag"] ?? "").includes("noindex") && headers["referrer-policy"] === "no-referrer", `${label} private, never cached, no referrer`);
}

async function framedChecks(browser) {
  for (const [host, site] of Object.entries(sites)) {
    const label = `framed ${site.design_key}`;
    const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const page = await context.newPage();
    const violations = [];
    page.on("console", (message) => { if (/Content Security Policy|Refused to|hydrat/i.test(message.text())) violations.push(message.text()); });
    page.on("pageerror", (error) => violations.push(String(error)));
    if (process.env.PREVIEW_BRIDGE_DEBUG) {
      page.on("console", (message) => console.log(`[console ${message.type()}] ${message.text().slice(0, 300)}`));
      page.on("pageerror", (error) => console.log(`[pageerror] ${error.stack ?? error}`));
    }
    let documentHeaders = null;
    page.on("response", (response) => { if (!documentHeaders && response.url().includes("/preview?k=")) documentHeaders = response.headers(); });
    const received = async (type) => (await page.evaluate(() => window.received)).filter((entry) => entry.data?.type === type);
    const waitFor = async (type, count = 1) => {
      for (let i = 0; i < 100; i += 1) {
        const got = await received(type);
        if (got.length >= count) return got;
        await sleep(100);
      }
      return received(type);
    };
    await page.goto(`http://localhost:${PARENT_PORT}/?src=${encodeURIComponent(previewUrl(host))}`, { waitUntil: "networkidle" });
    const ready = await waitFor("mingla:preview-ready");
    if (!ready.length) { failures.push(`${label}: the parent never got mingla:preview-ready`); await context.close(); continue; }
    policyChecks(documentHeaders ?? {}, label);
    const first = ready[0];
    const ids = previews[host].pages[""];
    check(first.origin === `http://${host}:${APP_PORT}`, `${label} ready comes from the site's own origin`, first.origin);
    check(first.data.page_path === "" && first.data.sections.length > 0 && first.data.sections.every((section) => ids.includes(section.id)), `${label} ready lists this page's sections (${first.data.sections.length} of ${ids.length} drew something)`, JSON.stringify(first.data).slice(0, 300));
    check(first.data.sections.every((section, index, all) => index === 0 || section.top >= all[index - 1].top) && first.data.doc_height > 0, `${label} sections are in page order with real positions`);
    const frame = page.frames().find((candidate) => candidate.url().includes("/preview?k="));
    const startUrl = frame.url();
    // What the page scrolls before the workspace asks for anything (no edit mode, no marks).
    const sizeBefore = await frame.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);

    // Edit mode: a real click on a link inside a section selects the section and does not navigate.
    await page.evaluate(() => window.tell({ type: "mingla:preview-mode", edit: true }));
    await sleep(200);
    const target = await frame.evaluate(() => {
      for (const link of document.querySelectorAll("#main a[href]")) {
        const section = link.closest("[data-mingla-section]");
        const rect = link.getBoundingClientRect();
        if (!section || rect.width < 4 || rect.height < 4 || rect.top < 90 || rect.bottom > window.innerHeight - 10) continue;
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        return { id: section.getAttribute("data-mingla-section"), x, y, href: link.getAttribute("href") };
      }
      // No link of a section is on the first screen in this design: click a section itself.
      for (const section of document.querySelectorAll("[data-mingla-section]")) {
        const rect = section.getBoundingClientRect();
        const y = Math.max(rect.top, 100) + 20;
        if (rect.width > 40 && y < Math.min(rect.bottom, window.innerHeight) - 10) return { id: section.getAttribute("data-mingla-section"), x: rect.left + rect.width / 2, y, href: "(the section itself)" };
      }
      return null;
    });
    const inert = await frame.evaluate(() => Array.from(document.querySelectorAll("[inert]")).length);
    check(inert > 0, `${label} the page is inert in edit mode`);
    if (!target) failures.push(`${label}: no section is on screen to click`);
    else {
      const box = await page.locator("#f").boundingBox();
      await page.mouse.click(box.x + target.x, box.y + target.y);
      const selected = await waitFor("mingla:preview-select");
      const under = selected.length ? "" : await frame.evaluate(({ x, y }) => {
        const held = Array.from(document.querySelectorAll("[inert]"));
        for (const element of held) element.removeAttribute("inert");
        const chain = [];
        for (let element = document.elementFromPoint(x, y); element && chain.length < 6; element = element.parentElement) chain.push(`${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${typeof element.className === "string" && element.className ? `.${element.className.trim().split(/\s+/).join(".")}` : ""}`);
        for (const element of held) element.setAttribute("inert", "");
        return ` under the pointer: ${chain.join(" < ")}`;
      }, target);
      check(selected.length === 1 && selected[0].data.section_id === target.id, `${label} a click on ${target.href.startsWith("(") ? "a section" : "a link inside a section"} selects that section`, JSON.stringify(selected.map((entry) => entry.data)).slice(0, 300) + under);
      await sleep(600);
      check(frame.url() === startUrl && (await received("mingla:preview-ready")).length === ready.length, `${label} the click did not navigate`, frame.url());
      const rect = selected[0]?.data.rect;
      const listed = first.data.sections.find((section) => section.id === target.id);
      check(Boolean(rect && listed && rect.top === listed.top && rect.height === listed.height && rect.width > 0), `${label} the selection's box is the section's box`, JSON.stringify(rect));
    }

    // Keyboard: the first Tab into the page lands on a section, Enter picks it, and the bridge draws the ring.
    const buttons = await frame.evaluate(() => Array.from(document.querySelectorAll("[data-mingla-section-button]")).map((button) => button.getAttribute("data-mingla-section-button")));
    check(buttons.length === first.data.sections.length && buttons.every((id, index) => id === first.data.sections[index].id), `${label} one keyboard button per section, in page order`);
    await frame.evaluate(() => { document.querySelector("[data-mingla-section-button]").focus(); });
    await page.keyboard.press("Tab");
    const focused = await frame.evaluate(() => document.activeElement?.getAttribute("data-mingla-section-button") ?? null);
    check(focused === buttons[1], `${label} Tab moves to the next section (never into the page)`, String(focused));
    const ring = await frame.evaluate((id) => {
      const mark = document.querySelector(`[data-mingla-mark="${id}"]`);
      return mark ? { kind: mark.getAttribute("data-mingla-mark-kind"), shadow: getComputedStyle(mark).boxShadow, events: getComputedStyle(mark).pointerEvents } : null;
    }, focused);
    check(Boolean(ring && ring.kind === "focus" && ring.shadow !== "none" && ring.events === "none"), `${label} the focused section has a visible ring drawn by the bridge`, JSON.stringify(ring));
    const before = (await received("mingla:preview-select")).length;
    await page.keyboard.press("Enter");
    const afterEnter = await waitFor("mingla:preview-select", before + 1);
    check(afterEnter.length === before + 1 && afterEnter.at(-1).data.section_id === focused, `${label} Enter selects the focused section`);

    // Marks and typed text.
    await page.evaluate(([selected, unread]) => window.tell({ type: "mingla:preview-marks", selected, ari: null, unread: [{ id: unread, by: "team" }] }), [buttons[0], buttons[1]]);
    await sleep(150);
    const marks = await frame.evaluate(() => {
      const layer = document.querySelector("[data-mingla-preview-overlay]");
      const style = getComputedStyle(layer);
      return {
        chips: Array.from(layer.querySelectorAll("[data-mingla-chip]")).map((chip) => chip.textContent),
        kinds: Array.from(layer.querySelectorAll("[data-mingla-mark]")).map((mark) => mark.getAttribute("data-mingla-mark-kind")),
        layer: [style.position, style.pointerEvents, layer.offsetWidth, layer.offsetHeight],
        size: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      };
    });
    check(marks.chips.includes("Read me · made by the Mingla team") && marks.kinds.includes("selected"), `${label} the outline and the "Read me" chip are drawn`, JSON.stringify(marks));
    check(marks.layer[0] === "absolute" && marks.layer[1] === "none" && marks.layer[2] === 0 && marks.layer[3] === 0, `${label} the marks layer takes no space and no pointer`, JSON.stringify(marks.layer));
    check(marks.size[0] === sizeBefore[0] && marks.size[1] === sizeBefore[1], `${label} drawing marks (and the keyboard buttons) does not change what the page scrolls (${sizeBefore.join("x")})`, `${sizeBefore.join("x")} became ${marks.size.join("x")}`);
    const swap = await frame.evaluate(() => {
      for (const root of document.querySelectorAll("[data-mingla-section]")) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode.nodeValue;
          if (text && text.trim().length > 8 && !["SCRIPT", "STYLE"].includes(walker.currentNode.parentElement.tagName)) return { id: root.getAttribute("data-mingla-section"), from: text };
        }
      }
      return null;
    });
    if (swap) {
      await page.evaluate((message) => window.tell(message), { type: "mingla:preview-text", section_id: swap.id, from: swap.from, to: "Typed in the workspace <b>now</b>" });
      await sleep(150);
      const shown = await frame.evaluate((id) => Array.from(document.querySelectorAll(`[data-mingla-section="${id}"]`)).some((root) => root.textContent.includes("Typed in the workspace <b>now</b>") && !root.querySelector("b:only-child")), swap.id);
      check(shown, `${label} typed text appears in the section as plain text`);
    }

    // Edit mode off: the page is live again and the same link navigates (inside the preview).
    await page.evaluate(() => window.tell({ type: "mingla:preview-mode", edit: false }));
    await sleep(200);
    check((await frame.evaluate(() => document.querySelectorAll("[inert], [data-mingla-section-button]").length)) === 0, `${label} edit mode off: nothing is inert, no keyboard buttons`);
    const internal = await frame.evaluate(() => {
      for (const link of document.querySelectorAll("a[href*='/preview?k=']")) {
        const rect = link.getBoundingClientRect();
        if (link.target === "_blank" || rect.width < 4 || rect.height < 4 || rect.top < 0 || rect.bottom > window.innerHeight) continue;
        if (new URL(link.href).searchParams.get("path") && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === link) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      return null;
    });
    if (internal) {
      const box = await page.locator("#f").boundingBox();
      await page.mouse.click(box.x + internal.x, box.y + internal.y);
      const again = await waitFor("mingla:preview-ready", ready.length + 1);
      check(again.length > ready.length && again.at(-1).data.page_path !== "", `${label} with edit mode off a link navigates inside the preview and the new page says ready`, JSON.stringify(again.at(-1)?.data.page_path));
    } else ok(`${label} (no in-preview link visible in the first screen; navigation check skipped)`);
    check(violations.length === 0, `${label} no Content-Security-Policy violation and no hydration error`, violations.join(" | ").slice(0, 600));
    await context.close();
  }
}

try {
  await waitForApp();
  const { chromium } = await import("@playwright/test");
  // Software rasterising: GPU tiles are not the same picture twice on every machine (anti-aliased curves and
  // dithered gradients come out a channel apart), and this check compares pictures exactly.
  const args = ["--disable-gpu", "--disable-gpu-rasterization", "--force-color-profile=srgb"];
  const browser = await chromium.launch({ args }).catch(() => chromium.launch({ channel: "chrome", args }));
  try {
    if (process.env.PREVIEW_BRIDGE_PROBE) await probe(browser);
    else {
      await framedChecks(browser);
      await pixelChecks(browser);
    }
  } finally {
    await browser.close();
  }
} catch (error) {
  failures.push(`preview-bridge: ${error instanceof Error ? error.stack : String(error)}`);
  failures.push(log.slice(-2000));
} finally {
  server.kill("SIGTERM");
  closeAll();
}

if (failures.length) {
  console.error(`\npreview-bridge: ${failures.length} FAILED`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("\npreview-bridge: every check passed");
