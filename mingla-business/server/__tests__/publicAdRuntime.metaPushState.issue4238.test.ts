// MINGLA-INVARIANT: I-4238-META-NO-AUTO-SPA-PAGEVIEW | issue #4238 | every Meta pixel boot (server-rendered landing and the SPA runtime) sets fbq.disablePushState = true before init, so Meta's automatic history-change PageView never double-counts buyer routes or counts host dashboard routes; the app sends its own PageViews.
/**
 * Meta's SPA guide (developers.facebook.com/documentation/meta-pixel/
 * implementation/tag_spa, read 14 Nov 2026): fbq.disablePushState = true stops
 * PageView events on history state changes.
 */
import { readFileSync } from "fs";
import { join } from "path";

test("the SSR Meta boot sets disablePushState before init", () => {
  const src = readFileSync(join(__dirname, "..", "publicAdRuntime.js"), "utf8");
  const flag = src.indexOf("fbq.disablePushState=true;");
  const init = src.indexOf('fbq("init",c.pixels.meta)');
  expect(flag).toBeGreaterThan(-1);
  expect(init).toBeGreaterThan(flag);
});

test("the SPA Meta boot sets disablePushState before init", () => {
  const src = readFileSync(join(__dirname, "..", "..", "src", "analytics", "adPixelRuntime.web.ts"), "utf8");
  const flag = src.indexOf(".disablePushState = true;");
  const init = src.indexOf('runtime.fbq?.("init", pixelId);');
  expect(flag).toBeGreaterThan(-1);
  expect(init).toBeGreaterThan(flag);
});
