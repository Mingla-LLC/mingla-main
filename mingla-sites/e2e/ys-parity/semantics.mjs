// #2829 W7b — §7 check 6: what pixels cannot see. Skip link, focus order
// through the header, the menu disclosure's keys, the phone drawer (focus
// trap, Escape), reduced motion removing transforms, FAQ open/close, and the
// trip filters (a place filter keeps only matching past trips; an inverted
// date range says so). Run against the local pilot site; page paths come from
// the private baseline's _meta.json and the place to filter by is read from
// the page itself, so no brand content lives here.
//
//   node e2e/ys-parity/semantics.mjs --origin http://<host>:3100 --baseline <dir> --out <dir>

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { args, assertOutsideRepo, CONSENT_STORAGE, parityPages } from "./lib.mjs";

const options = args(process.argv.slice(2), ["origin", "baseline", "out"]);
const out = assertOutsideRepo(resolve(options.out));
const origin = new URL(options.origin).origin;
const pages = parityPages(JSON.parse(readFileSync(resolve(options.baseline, "_meta.json"), "utf8")));
const pathOf = (name) => pages.find((page) => page.name === name)?.path;
const checks = [];
const record = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
};

const browser = await chromium.launch({ channel: "chrome" });
const context = async (width, extra = {}) => {
  const value = await browser.newContext({ viewport: { width, height: width > 390 ? 900 : 844 }, deviceScaleFactor: 1, ...extra });
  await value.addInitScript(([key, choice]) => { try { window.localStorage.setItem(key, choice); } catch { /* see capture.mjs */ } }, [CONSENT_STORAGE.key, CONSENT_STORAGE.value]);
  return value;
};
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName.toLowerCase(), cls: el.className?.toString() ?? "", text: (el.textContent ?? "").trim().slice(0, 40), href: el.getAttribute("href"), expanded: el.getAttribute("aria-expanded") } : null;
});

try {
  // Desktop: skip link, header focus order, disclosure keys.
  {
    const ctx = await context(1440);
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const first = await focused(page);
    const skipVisible = await page.evaluate(() => {
      const el = document.activeElement;
      const r = el?.getBoundingClientRect();
      return Boolean(r && r.width > 1 && r.height > 1 && r.top >= 0);
    });
    record("skip link is the first stop and becomes visible", first?.cls.includes("skip-link") && skipVisible, JSON.stringify(first));
    await page.keyboard.press("Enter");
    const hash = await page.evaluate(() => location.hash);
    record("skip link moves to the main content", hash === "#main");
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const order = [];
    for (let index = 0; index < 9; index += 1) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
    }
    const headerStops = order.slice(1).filter((stop) => stop && (stop.cls.includes("nav-link") || stop.cls.includes("logo-lockup") || stop.cls.includes("btn--primary")));
    const sequence = headerStops.map((stop) => (stop.cls.includes("logo-lockup") ? "logo" : stop.cls.includes("btn--primary") ? "cta" : stop.expanded !== null ? "disclosure" : "link"));
    record("header focus order: logo, links, menu disclosure, call to action", sequence.join(",").startsWith("logo,link") && sequence.includes("disclosure") && sequence.lastIndexOf("cta") > sequence.indexOf("disclosure"), sequence.join(","));
    const trigger = page.locator(".site-header button.nav-link[aria-expanded]").first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    record("disclosure opens with Enter", (await trigger.getAttribute("aria-expanded")) === "true");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    const inPanel = await page.evaluate(() => Boolean(document.activeElement?.closest(".nav-panel")));
    record("ArrowDown moves into the panel", inPanel);
    await page.keyboard.press("End");
    const last = await page.evaluate(() => { const items = [...document.querySelectorAll(".nav-panel [data-nav-item]")]; return items.indexOf(document.activeElement) === items.length - 1; });
    record("End focuses the last item", last);
    await page.keyboard.press("Home");
    const firstItem = await page.evaluate(() => document.querySelector(".nav-panel [data-nav-item]") === document.activeElement);
    record("Home focuses the first item", firstItem);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const back = await page.evaluate(() => document.activeElement?.matches(".site-header button.nav-link[aria-expanded]"));
    record("Escape closes and returns focus to the trigger", back && (await trigger.getAttribute("aria-expanded")) === "false");
    await ctx.close();
  }
  // Phone: the drawer.
  {
    const ctx = await context(390);
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const toggle = page.locator(".v-drawer__toggle");
    await toggle.click();
    await page.waitForTimeout(400);
    record("drawer opens", (await toggle.getAttribute("aria-expanded")) === "true");
    const inert = await page.evaluate(() => Boolean(document.querySelector("main")?.hasAttribute("inert")));
    record("page behind the drawer is inert", inert);
    let trapped = true;
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest(".v-drawer")));
      if (!inside) trapped = false;
    }
    record("focus stays inside the drawer", trapped);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    record("Escape closes the drawer and returns focus", (await toggle.getAttribute("aria-expanded")) === "false" && await page.evaluate(() => Boolean(document.activeElement?.closest(".v-drawer__toggle, .v-drawer summary"))));
    await ctx.close();
  }
  // Reduced motion.
  {
    const ctx = await context(1440, { reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`${origin}${pathOf("about-us") ?? "/"}`, { waitUntil: "networkidle" });
    const moving = await page.evaluate(() => [...document.querySelectorAll(".reveal, .hero-enter, .line-mask > *")].filter((el) => {
      const style = getComputedStyle(el);
      return (style.transform !== "none" && style.transform !== "matrix(1, 0, 0, 1, 0, 0)") || Number(style.opacity) < 1;
    }).length);
    const total = await page.evaluate(() => document.querySelectorAll(".reveal").length);
    record("reduced motion: nothing moves or waits to appear", moving === 0 && total > 0, `${moving} moving of ${total} reveals`);
    await ctx.close();
  }
  // FAQ.
  {
    const ctx = await context(1440);
    const page = await ctx.newPage();
    await page.goto(`${origin}${pathOf("faqs")}`, { waitUntil: "networkidle" });
    const details = page.locator(".faq details").first();
    await details.locator("summary").click();
    const opened = await details.evaluate((el) => el.open);
    await details.locator("summary").click();
    const closed = await details.evaluate((el) => !el.open);
    record("FAQ opens and closes", opened && closed);
    await ctx.close();
  }
  // Trip filters.
  {
    const ctx = await context(1440);
    const page = await ctx.newPage();
    const trips = pathOf("trips");
    await page.goto(`${origin}${trips}`, { waitUntil: "networkidle" });
    const places = await page.locator(".band.is-tinted .chip-location").allTextContents();
    const place = places.map((value) => value.trim()).find(Boolean);
    await page.goto(`${origin}${trips}?where=${encodeURIComponent(place ?? "")}`, { waitUntil: "networkidle" });
    const filtered = (await page.locator(".band .chip-location").allTextContents()).map((value) => value.trim());
    record("a place filter keeps only that place's trips", Boolean(place) && filtered.length >= 1 && filtered.every((value) => value === place) && filtered.length < places.length + 1, `${place}: ${filtered.join(", ")} (of ${places.join(", ")})`);
    await page.goto(`${origin}${trips}?from=2026-12-01&to=2026-01-01`, { waitUntil: "networkidle" });
    const inverted = await page.locator("text=Check your dates").count();
    record("an inverted date range says so", inverted > 0);
    await ctx.close();
  }
} finally {
  await browser.close();
}
const pass = checks.every((check) => check.ok);
writeFileSync(resolve(out, "semantics.json"), `${JSON.stringify({ pass, checks }, null, 2)}\n`);
process.stdout.write(`semantics ${pass ? "PASS" : "FAIL"} (${checks.filter((c) => c.ok).length}/${checks.length})\n`);
process.exit(pass ? 0 : 1);
