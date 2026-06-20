// ORCH-1161 — capture a REAL screenshot of the buyer-web consent UI.
// Serves the static web-build-1161 export, mocks the Supabase REST/RPC layer
// with a fixture paid event, drives index -> add ticket -> buyer, then
// screenshots the consent checkbox in its key states.
import { createReadStream, existsSync, statSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";

const ROOT = resolve(process.argv[2] ?? "web-build-1161");
const PORT = Number(process.argv[3] ?? 43161);
const OUT = resolve(process.argv[4] ?? "/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/evidence/ORCH-1161");
mkdirSync(OUT, { recursive: true });

const EVENT_ID = "orch1161-event";
const BRAND_ID = "orch1161-brand";
const TICKET_ID = "orch1161-ticket-ga";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
]);

const resolveAsset = (url) => {
  const parsed = new URL(url, `http://127.0.0.1:${PORT}`);
  const cleanPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const candidate = resolve(ROOT, cleanPath);
  if (candidate.startsWith(ROOT) && existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  return join(ROOT, "index.html"); // SPA fallback for deep routes
};

const server = createServer((req, res) => {
  const assetPath = resolveAsset(req.url ?? "/");
  const ct = contentTypes.get(extname(assetPath)) ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store" });
  createReadStream(assetPath).pipe(res);
});

// ---- Fixture rows -----------------------------------------------------------
const viewRow = {
  id: EVENT_ID,
  brand_id: BRAND_ID,
  brand_slug: "orch1161-brand",
  brand_name: "The Lantern Room",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: false,
  event_type: "event",
  title: "Rooftop Jazz Night",
  description: "An evening of live jazz.",
  slug: "rooftop-jazz-night",
  location_text: "Raleigh, NC",
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  cover_media_provider: null,
  cover_media_source_url: null,
  cover_media_credit: null,
  cover_media_credit_url: null,
  cover_media_alt: null,
  currency: "USD",
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2026-06-01T12:00:00.000Z",
  timezone: "America/New_York",
  created_at: "2026-05-01T12:00:00.000Z",
  updated_at: "2026-06-01T12:00:00.000Z",
  public_theme: {
    business_event: {
      format: "in_person",
      whenMode: "single",
      location: { venueName: "The Lantern Room", address: "Raleigh, NC" },
      settings: {},
    },
  },
  master_start_at: "2026-07-01T23:00:00.000Z",
  master_end_at: "2026-07-02T02:00:00.000Z",
  master_timezone: "America/New_York",
  master_event_date_id: "orch1161-date",
  min_price_cents: 2500,
};

const ticketRow = {
  id: TICKET_ID,
  event_id: EVENT_ID,
  name: "General Admission",
  description: "Standing room",
  price_cents: 2500,
  currency: "USD",
  quantity_total: 100,
  is_unlimited: false,
  is_free: false,
  sale_start_at: null,
  sale_end_at: null,
  min_purchase_qty: 1,
  max_purchase_qty: 10,
  is_hidden: false,
  is_disabled: false,
  requires_approval: false,
  allow_transfers: true,
  password_protected: false,
  available_online: true,
  available_in_person: false,
  waitlist_enabled: false,
  display_order: 0,
};

const brandRow = {
  id: BRAND_ID,
  slug: "orch1161-brand",
  name: "The Lantern Room",
  description: null,
  cover_media_url: null,
};

const jsonHeaders = { "access-control-allow-origin": "*", "content-type": "application/json" };

async function installMocks(page) {
  await page.route("**/functions/v1/**", (route) =>
    route.fulfill({ status: 200, headers: jsonHeaders, body: "{}" }),
  );
  await page.route("**/rest/v1/rpc/**", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    let body = "null";
    if (name === "pg_brand_can_charge") body = "true";
    else if (name === "pg_brands_can_charge") body = "[]";
    else if (name === "pg_public_ticket_types_remaining")
      body = JSON.stringify([{ ticket_type_id: TICKET_ID, remaining: 50 }]);
    else if (name === "pg_public_event_tier_allin")
      body = JSON.stringify([{ ticket_type_id: TICKET_ID, all_in_cents: 2750 }]);
    else if (name === "pg_public_event_by_slug") body = "null";
    else body = "[]";
    route.fulfill({ status: 200, headers: jsonHeaders, body });
  });
  await page.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/rpc/")) return route.fallback();
    const table = url.pathname.split("/").pop() ?? "";
    const wantsObject =
      route.request().headers().accept?.includes("application/vnd.pgrst.object+json") === true;
    let rows = [];
    if (table === "business_public_events_view") rows = [viewRow];
    else if (table === "ticket_types") rows = [ticketRow];
    else if (table === "brands") rows = [brandRow];
    const body = wantsObject ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows);
    route.fulfill({ status: 200, headers: jsonHeaders, body });
  });
}

const log = (...a) => console.log("[orch-1161]", ...a);

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  log("static server on", PORT, "root", ROOT);

  const browser = await chromium.launch();
  // iPhone-ish viewport so the dark mobile checkout looks right.
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
  });
  page.on("console", (m) => {
    if (m.type() === "error") log("PAGE-ERR", m.text());
  });
  await installMocks(page);

  // 1. Land on the checkout index (deep route → SPA fallback to index.html).
  await page.goto(`http://127.0.0.1:${PORT}/checkout/${EVENT_ID}`, {
    waitUntil: "domcontentloaded",
  });
  log("navigated to checkout index");

  // Wait for the ticket selector to render.
  await page
    .getByText("Select your tickets", { exact: false })
    .waitFor({ timeout: 30000 })
    .catch(() => log("WARN: 'Select your tickets' not seen"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "_debug_index.png") });

  // 2. Add one ticket via the "+" stepper.
  const plus =
    (await page.getByRole("button", { name: /add|increase|increment/i }).count()) > 0
      ? page.getByRole("button", { name: /add|increase|increment/i }).first()
      : page.locator('[aria-label*="dd" i], [aria-label*="ncrease" i]').first();
  await plus.click({ timeout: 15000 }).catch(async (e) => {
    log("plus click via role failed, trying any button near price", e.message);
  });
  await page.waitForTimeout(1000);

  // 3. Continue → buyer page.
  const cont = page.getByRole("button", { name: /continue/i }).first();
  await cont.click({ timeout: 15000 });
  log("clicked Continue");

  // 4. Wait for the buyer page consent checkbox.
  await page
    .getByText("terms and conditions", { exact: false })
    .first()
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  log("buyer page consent label visible");

  // STATE A: buyer page as landed — empty fields, greyed Pay, unchecked box.
  await page.screenshot({ path: join(OUT, "consent_checkout_web_unchecked.png") });
  log("saved consent_checkout_web_unchecked.png");

  // STATE B: fill ALL fields valid, box still unchecked, tap greyed Pay to
  // trigger the red "Please agree to continue." flash. Use the exact a11y
  // labels the Inputs expose.
  await page.getByLabel("Full name, required", { exact: true }).fill("Jordan Rivera").catch((e) => log("name fill", e.message));
  await page.getByLabel("Email address, required", { exact: true }).fill("jordan@example.com").catch((e) => log("email fill", e.message));
  const phone = page.getByLabel("Mobile number, required", { exact: true }).first();
  await phone.fill("9195550123").catch((e) => log("phone fill", e.message));
  // blur so validation clears any touched errors
  await page.keyboard.press("Tab").catch(() => {});
  await page.waitForTimeout(600);
  // tap the greyed Pay (captured by the overlay Pressable → shows the hint)
  const payBtn = page.getByRole("button", { name: /continue to payment|reserve free/i }).first();
  await payBtn.click({ force: true, timeout: 8000 }).catch(() => log("pay tap (greyed) noop"));
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, "consent_checkout_web_required_flash.png") });
  log("saved consent_checkout_web_required_flash.png");

  // STATE C: check the box → Pay enabled (orange), fields valid.
  const box = page.getByRole("checkbox").first();
  await box.click({ timeout: 8000 }).catch(() => log("checkbox click noop"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "consent_checkout_web_checked.png") });
  log("saved consent_checkout_web_checked.png");

  // STATE D: open the T&C sheet via the underlined link.
  await page.getByText("terms and conditions", { exact: false }).first().click({ timeout: 8000 }).catch(() => log("link tap noop"));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, "consent_checkout_web_terms_sheet.png") });
  log("saved consent_checkout_web_terms_sheet.png");

  await browser.close();
  server.close();
  log("done");
}

main().catch((e) => {
  console.error("[orch-1161] FATAL", e);
  server.close();
  process.exit(1);
});
