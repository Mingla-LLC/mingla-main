// #4318 follow-up — the first tap on "Privacy & ad choices" dimmed the page at
// once and the choices sheet only appeared later (or not at all). Measured on
// the live event page at 390x844: the server copy of the sheet opened, then
// (a) it faded in from opacity 0 on a clock the page's boot work stalls, so the
//     scrim showed while the sheet was still invisible;
// (b) the boot hand-off dropped the page's stylesheet, which held the bar's
//     rules, so the open sheet lost its layout;
// (c) the app removed the server sheet and strip but not the scrim, and opened
//     nothing, so the page stayed dimmed with no sheet.
//
// This suite pins the server/source half of the fix. The browser half (sheet
// visible in the first frame the scrim is, before the app boots, and still open
// after it takes over) is playwright/issue4318-privacy-sheet-first-tap.spec.ts.
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("../supabaseRpc", () => ({
  requestRpcJson: jest.fn(),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require("../publicSearchDocument") as {
  renderVisibleDocument: (input: Record<string, unknown>) => string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const privacyRuntime = require("../publicPrivacyRuntime") as {
  PRIVACY_BAR_STYLE_ID: string;
  privacyBarCss: () => string;
  privacyBarRuntimeSource: () => string;
};

const BUSINESS = join(__dirname, "..", "..");
const REPO = join(BUSINESS, "..");
const BANNER = readFileSync(join(BUSINESS, "src/analytics/ConsentBanner.web.tsx"), "utf8");
const MARKETING_BANNER = readFileSync(join(REPO, "mingla-marketing/components/marketing/consent-banner.tsx"), "utf8");

const facts = {
  kind: "event",
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "acme",
  brandName: "Acme",
  title: "Signal night",
  description: "A public event.",
  status: "scheduled",
  eventType: "event",
  actionAvailable: true,
};

function keyframes(css: string): string {
  return css.match(/@keyframes mpb-in\{[^}]*\}[^}]*\}\}/)?.[0] ?? "";
}

describe("#4318 the privacy sheet opens on the first tap", () => {
  test("the sheet's entrance never starts invisible (server, Host app and usemingla.com)", () => {
    for (const [name, css] of [
      ["server", privacyRuntime.privacyBarCss()],
      ["host app", BANNER],
      ["marketing", MARKETING_BANNER],
    ] as const) {
      const frames = keyframes(css);
      expect([name, frames.length > 0]).toEqual([name, true]);
      // A stalled animation leaves the sheet on its first keyframe: that frame
      // must already show the sheet.
      expect([name, /opacity/.test(frames)]).toEqual([name, false]);
    }
  });

  test("the bar's rules live in their own style element, outside the stylesheet the boot hand-off drops", () => {
    const html = publicSearch.renderVisibleDocument({
      facts,
      state: "search_ready",
      canonicalPath: "/e/acme/signal-night",
    });
    const id = privacyRuntime.PRIVACY_BAR_STYLE_ID;
    expect(id).toBe("mingla-privacy-bar-style");
    // The app's strip reuses the element by this id instead of adding a copy.
    expect(BANNER).toContain(`const STYLE_ID = "${id}";`);
    const own = html.match(new RegExp(`<style id="${id}">([\\s\\S]*?)</style>`));
    expect(own).not.toBeNull();
    expect(html.match(new RegExp(`<style id="${id}">`, "g"))).toHaveLength(1);
    expect(own?.[1]).toContain(".mpb{");
    expect(own?.[1]).toContain(".mpb-scrim{");
    expect(own?.[1]).toContain(".mps{");
    const pageStyle = html.match(/<style id="mingla-public-document-style">([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(pageStyle.length).toBeGreaterThan(0);
    expect(pageStyle).not.toContain(".mpb");
    expect(pageStyle).not.toContain(".mps");
    // Same cascade position as before: ahead of the page's own rules.
    expect(html.indexOf(`<style id="${id}">`)).toBeLessThan(html.indexOf('<style id="mingla-public-document-style">'));
  });

  test("the server runtime stands down once the app has taken its sheet over", () => {
    // A removed server sheet must not keep trapping Tab or answering Escape.
    expect(privacyRuntime.privacyBarRuntimeSource()).toContain(
      'document.addEventListener("keydown",function(e){if(bar.hidden||!bar.isConnected)return;',
    );
  });

  test("the app takes over the server strip, sheet and scrim together, keeping an open sheet open", () => {
    expect(BANNER).toMatch(
      /"\[data-mingla-ssr-privacy-bar\],\[data-mingla-ssr-privacy-strip\],\[data-mingla-ssr-privacy-scrim\]"/,
    );
    expect(BANNER).toMatch(/const ssrSheet = takeoverSheet\(\);\s*if \(ssrSheet !== null\) \{\s*adoptedDraftRef\.current = ssrSheet;\s*setOpen\(true\);/);
    expect(BANNER).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(mounted\) removeServerPrivacyBar\(\);\s*\}, \[mounted\]\);/);
  });
});
