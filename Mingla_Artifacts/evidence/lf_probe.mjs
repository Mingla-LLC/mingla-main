/**
 * ORCH-0963 LF-1..LF-5 — live-fire probe of /b/{slug} against the local
 * Expo web-export build served on a static server. Cloudflare bot heuristic
 * blocks headless against prod (D-1 closed), so we run against the same
 * artifact Vercel ships (web-build directory) on localhost.
 *
 * Captures: visible text, screenshots, console errors, DOM tab structure.
 */
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const EVID = "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/Mingla_Artifacts/evidence";
const EXEC = "/Users/sethogieva/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:43099";

const TARGETS = [
  { id: "LF-1", slug: "travelbrand", label: "trip-planner: 2 public trips" },
  { id: "LF-2", slug: "leggothis", label: "popup event-brand: 11 public events" },
  { id: "LF-3", slug: "worldtravels", label: "trip-planner: 0 trips (empty-state)" },
];

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});

await fs.mkdir(EVID, { recursive: true });
const results = [];

for (const t of TARGETS) {
  const page = await ctx.newPage();
  const url = `${ORIGIN}/b/${t.slug}`;
  const consoleEvents = [];
  page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text().slice(0, 240) }));
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 240)));
  const failedRequests = [];
  page.on("requestfailed", (req) => failedRequests.push(`${req.method()} ${req.url().slice(0, 120)} :: ${req.failure()?.errorText}`));
  const responseStatuses = [];
  page.on("response", (resp) => {
    if (resp.status() >= 400) responseStatuses.push(`${resp.status()} ${resp.url().slice(0, 120)}`);
  });

  let renderState = "unknown";
  let visibleText = "";
  let title = "";
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!resp || resp.status() >= 400) {
      renderState = `http_${resp ? resp.status() : "no-response"}`;
    } else {
      try {
        // Wait for either "Loading brand..." to disappear OR for "Brand could not load" OR for trip/event cards
        await page.waitForFunction(
          () => {
            const t = document.body?.innerText ?? "";
            return !t.includes("Loading brand...") || t.includes("Brand could not load");
          },
          null,
          { timeout: 30000 },
        );
      } catch {
        renderState = "timeout_waiting_for_loaded_state";
      }
      // Settle queries (cards, etc.)
      await page.waitForTimeout(4000);
      visibleText = await page.evaluate(() => document.body?.innerText ?? "");
      title = await page.title();
      if (visibleText.includes("Brand could not load")) renderState = "error_brand_not_loaded";
      else if (visibleText.includes("Loading brand...")) renderState = "stuck_loading";
      else renderState = "rendered";
    }
  } catch (err) {
    renderState = `error: ${(err?.message ?? "unknown").slice(0, 120)}`;
  }

  // Extract diagnostic structure
  const tabLabels = ["Upcoming", "Past", "About", "Trips", "Past Trips"].filter((label) => visibleText.includes(label));
  const hasNextStrip = /NEXT\b/.test(visibleText) && visibleText.includes("→");
  const hasBuyTickets = (visibleText.match(/Buy tickets/g) ?? []).length;
  const tripDestinations = ["Tulum", "Washington DC", "DC Adventure", "The Sone"].filter((s) => visibleText.includes(s));
  const noTripsCopy = visibleText.includes("No upcoming trips yet");
  const noEventsCopy = visibleText.includes("No upcoming events yet");
  const spotsLeftMentions = (visibleText.match(/\d+\s+spots?\s+left/g) ?? []);
  const bookingClosedMentions = (visibleText.match(/Booking closed/g) ?? []).length;
  const nullLeak = /\bnull\s+spots?\s+left\b/i.test(visibleText) || /undefined/.test(visibleText);

  const screenshot = path.join(EVID, `lf_${t.id.toLowerCase()}_${t.slug}.png`);
  try {
    await page.screenshot({ path: screenshot, fullPage: true });
  } catch {}

  results.push({
    id: t.id,
    label: t.label,
    slug: t.slug,
    url,
    title,
    renderState,
    tabLabels,
    hasNextStrip,
    hasBuyTickets,
    tripDestinations,
    noTripsCopy,
    noEventsCopy,
    spotsLeftMentions,
    bookingClosedMentions,
    nullLeak,
    consoleErrors: consoleEvents.filter((e) => e.type === "error").slice(0, 6),
    consoleWarnings: consoleEvents.filter((e) => e.type === "warning").slice(0, 3),
    pageErrors: pageErrors.slice(0, 6),
    failedRequests: failedRequests.slice(0, 6),
    httpFailures: responseStatuses.slice(0, 6),
    visibleTextHead: visibleText.slice(0, 2000),
    screenshot,
  });
  await page.close();
}

// LF-4 — trip card tap navigates
const lf4Page = await ctx.newPage();
let lf4 = { id: "LF-4", outcome: "skipped" };
try {
  await lf4Page.goto(`${ORIGIN}/b/travelbrand`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await lf4Page.waitForFunction(() => !document.body?.innerText?.includes("Loading brand..."), null, { timeout: 30000 });
  await lf4Page.waitForTimeout(3000);
  // Find the trip card by accessibility label
  const tripCard = lf4Page.locator('[aria-label="Open trip The DC Adventure"]').first();
  const exists = await tripCard.count();
  if (exists === 0) {
    lf4 = { id: "LF-4", outcome: "card_not_found" };
  } else {
    await tripCard.click();
    await lf4Page.waitForTimeout(2000);
    const finalUrl = lf4Page.url();
    lf4 = {
      id: "LF-4",
      outcome: finalUrl.includes("/t/travelbrand/the-dc-adventure") ? "navigated_correctly" : "wrong_navigation",
      finalUrl,
    };
  }
} catch (err) {
  lf4 = { id: "LF-4", outcome: `error: ${err?.message?.slice(0, 120) ?? "unknown"}` };
}
await lf4Page.close();
results.push(lf4);

await browser.close();
await fs.writeFile(path.join(EVID, "lf_probe_results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((r) => ({ ...r, visibleTextHead: r.visibleTextHead?.slice(0, 400) })), null, 2));
