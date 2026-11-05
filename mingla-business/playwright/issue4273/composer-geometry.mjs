/**
 * #4273 — measures the real composer in a real browser. Local proof, not a CI lane.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 EXPO_PUBLIC_SUPABASE_ANON_KEY=stub \
 *     npx expo export -p web --output-dir <dir>
 *   node playwright/issue4273/composer-geometry.mjs <dir> [screenshot-dir]
 *
 * Every width and method mix: the editor keeps usable height, its centre is really
 * the editor (elementsFromPoint, so nothing paints over it), the cards start below
 * it, the left column scrolls to the last card, and the send bar stays on screen.
 * Exits non-zero on any miss. The backend is a small stub; only layout is proven.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const WEB = process.argv[2];
const SHOTS = process.argv[3] ?? null;
if (!WEB) throw new Error("usage: composer-geometry.mjs <web-export-dir> [screenshot-dir]");

const U = "4273f000-0000-4000-8000-000000000001";
const B = "4273f000-0000-4000-8000-0000000000b1";
const G = "4273f000-0000-4000-8000-00000000000a";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "none" })}.${b64({ sub: U, role: "authenticated", exp: 4102444800 })}.x`;
const user = { id: U, aud: "authenticated", role: "authenticated", email: "host@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const brand = { id: B, name: "Harmattan Club", slug: "harmattan", account_id: U, default_currency: "USD", contact_email: null, kind: "popup", stats: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

const api = http.createServer((q, r) => {
  let body = "";
  q.on("data", (d) => { body += d; });
  q.on("end", () => {
    const h = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "content-type": "application/json" };
    if (q.method === "OPTIONS") { r.writeHead(204, h); r.end(); return; }
    const u = q.url;
    let out = [];
    if (u.startsWith("/auth/v1/user")) out = user;
    else if (u.includes("combined_audience_reach")) out = 4;
    else if (u.includes("combined_audience_summary")) out = { peopleCount: JSON.parse(body || "{}").p_sources?.length ? 5 : 0, sources: [], followersTotal: 1, followersAlsoInBook: 1 };
    else if (u.includes("get_or_create_marketing_combined")) out = { audienceId: G, name: "Your Book + Followers", sources: ["book", "followers"] };
    else if (u.includes("/rest/v1/brands")) out = [brand];
    else if (u.includes("/rest/v1/feature_flags")) out = [{ is_enabled: true }];
    else if (u.includes("/rpc/get_brand_circle_reach")) {
      const av = { state: "ready", reason: null, refreshedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3e6).toISOString() };
      out = { followers: 1, extended: 0, availability: { followers: av, extended: av } };
    } else if (u.includes("book_audience")) out = { audienceId: "4273f000-0000-4000-8000-0000000000e1", activeBookTotal: 3 };
    else if (u.includes("/rest/v1/brand_team_members")) out = [{ role: "brand_owner", permissions_override: null, accepted_at: "2026-01-01T00:00:00Z", brand }];
    else if (u.includes("/functions/v1/stripe-mode")) out = { mode: "live", publishable_key_prefix: "pk_live", webhook_endpoints: 0 };
    if ((q.headers.accept || "").includes("pgrst.object") && Array.isArray(out)) out = out[0] ?? null;
    r.writeHead(200, h);
    r.end(JSON.stringify(out));
  });
}).listen(54399, "127.0.0.1");

const types = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf" };
const site = http.createServer((q, r) => {
  let f = path.join(WEB, decodeURIComponent(q.url.split("?")[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = fs.existsSync(`${f}.html`) ? `${f}.html` : path.join(WEB, "index.html");
  r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
}).listen(54400, "127.0.0.1");

const SIZES = [[390, 844], [1024, 700], [1024, 900], [1280, 800], [1440, 900], [1536, 864]];
const MIXES = [["email"], ["email", "sms"], ["email", "push"], ["email", "sms", "push"], ["sms"], ["push"], ["sms", "push"]];
const LABEL = { email: "Send by Email", sms: "Send by SMS", push: "Send by Push" };
const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 999999, expires_at: 4102444800, user };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript((s) => {
  localStorage.setItem("sb-127-auth-token", JSON.stringify(s));
}, session);
const page = await ctx.newPage();
page.setDefaultTimeout(180000);
await page.goto("http://127.0.0.1:54400/marketing/campaigns/compose", { waitUntil: "domcontentloaded" });
await page.getByTestId("composer-send-by").waitFor();
const dismiss = page.getByRole("button", { name: /^OK$/ });
if (await dismiss.count()) await dismiss.first().click().catch(() => {});

const chip = (kind) => page.getByRole("checkbox", { name: new RegExp(`^${LABEL[kind]}`) });
// The tick is in the label: this build's checkbox role emits no aria-checked.
const isOn = async (kind) => ((await chip(kind).textContent()) ?? "").startsWith("✓");
async function setMix(mix) {
  // Turn the wanted methods on first: the last one on cannot be turned off.
  for (const kind of mix) if (!(await isOn(kind))) await chip(kind).click();
  for (const kind of Object.keys(LABEL)) if (!mix.includes(kind) && (await isOn(kind))) await chip(kind).click();
}

const misses = [];
let checks = 0;
const miss = (where, what) => { misses.push(`${where}: ${what}`); };
for (const [width, height] of SIZES) {
  await page.setViewportSize({ width, height });
  for (const mix of MIXES) {
    await setMix(mix);
    await page.waitForTimeout(250);
    const where = `${width}x${height} ${mix.join("+")}`;
    const g = await page.evaluate(() => {
      const byId = (id) => document.querySelector(`[data-testid="${id}"]`);
      const region = byId("composer-flex-region");
      region.scrollTop = 0;
      const slot = byId("composer-editor-slot");
      const plain = byId("composer-plain-message");
      const cards = byId("composer-method-cards");
      const commit = [...document.querySelectorAll("button,[role=button]")].find((n) => /^(Send now|Schedule)/.test(n.textContent ?? ""));
      const rect = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
      let centreHitsEditor = null;
      if (slot) {
        // Bring the editor's middle on screen, then ask what is really there.
        const before = slot.getBoundingClientRect();
        const regionBox = region.getBoundingClientRect();
        region.scrollTop += Math.max(0, before.top + before.height / 2 - (regionBox.top + regionBox.height / 2));
        const r = slot.getBoundingClientRect();
        const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        centreHitsEditor = stack.length > 0 && slot.contains(stack[0]);
        region.scrollTop = 0;
      }
      const lastCard = cards ? rect(cards) : null;
      region.scrollTop = region.scrollHeight;
      const end = cards ? cards.getBoundingClientRect().bottom : null;
      const regionEnd = region.getBoundingClientRect().bottom;
      region.scrollTop = 0;
      return { slot: rect(slot), plain: rect(plain), cards: lastCard, commit: rect(commit), centreHitsEditor, lastCardReachable: end === null || end <= regionEnd + 1, innerHeight: window.innerHeight, overflowX: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    checks += 1;
    if (mix.includes("email")) {
      if (!g.slot) miss(where, "no editor");
      else {
        if (g.slot.height < 280) miss(where, `editor is ${g.slot.height}px tall`);
        if (g.centreHitsEditor !== true) miss(where, "something paints over the editor's centre");
        if (g.cards && g.cards.top < g.slot.bottom - 1) miss(where, `cards start ${g.slot.bottom - g.cards.top}px inside the editor`);
      }
    }
    if (mix.some((kind) => kind !== "email") && !g.lastCardReachable) miss(where, "the last card cannot be scrolled to");
    if (g.commit && g.commit.bottom > g.innerHeight + 1) miss(where, `send bar ends ${g.commit.bottom - g.innerHeight}px off screen`);
    if (g.overflowX) miss(where, "the page scrolls sideways");
    if (SHOTS && mix.length === 3) await page.screenshot({ path: path.join(SHOTS, `after_${width}x${height}_${mix.join("_")}.jpg`), type: "jpeg", quality: 80 });
  }
}
console.log(`composer-geometry: ${checks} layouts, ${misses.length} misses`);
for (const line of misses) console.log(`  MISS ${line}`);
await browser.close();
api.close();
site.close();
process.exit(misses.length === 0 ? 0 : 1);
