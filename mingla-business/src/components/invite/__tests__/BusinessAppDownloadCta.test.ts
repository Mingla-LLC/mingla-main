/**
 * ORCH-1378 — T-18 / T-23 / SC-10: the invite download CTA's TARGET and its
 * web-only render gate.
 *
 * The destination is the load-bearing part: `referrer=af_tranid…` on the Android
 * 301 IS the install attribution. Any drift — to a plain store link, to the
 * consumer OneLink domain, or to the raw vendor base — silently destroys it
 * while the button still "works", which is exactly the class of failure that
 * makes this worth pinning.
 */

// NOTE: the component itself imports react-native and cannot be loaded under the
// node/ts-jest harness — which is exactly why the URL is composed in the PURE
// guestFunnelLink module. We import the REAL builder (the same one the component
// calls) rather than re-deriving the string here, so this test cannot drift from
// what actually ships.
import { buildBusinessInviteDownloadUrl } from "../../../services/guestFunnelLink";
import { BUSINESS_INVITE_ONELINK_URL } from "../../../constants/storeLinks";

const BUSINESS_INVITE_CTA_URL = buildBusinessInviteDownloadUrl();

describe("ORCH-1378 BusinessAppDownloadCta — T-18: the CTA target (SC-10)", () => {
  it("targets the LIVE-VERIFIED branded business OneLink with both attribution params", () => {
    expect(BUSINESS_INVITE_CTA_URL).toBe(
      "https://biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept",
    );
  });

  it("is composed from the storeLinks SSOT constant, not a local literal", () => {
    expect(BUSINESS_INVITE_CTA_URL.startsWith(BUSINESS_INVITE_ONELINK_URL)).toBe(true);
    expect(BUSINESS_INVITE_ONELINK_URL).toBe("https://biz.usemingla.com/ZSCW");
  });

  it("carries pid=business_web (the channel) and c=brand_invite_accept (the campaign)", () => {
    const qs = new URLSearchParams(BUSINESS_INVITE_CTA_URL.split("?")[1]);
    expect(qs.get("pid")).toBe("business_web");
    expect(qs.get("c")).toBe("brand_invite_accept");
  });

  // ─── The four destinations that would silently kill attribution ──────────
  it("NEVER go.usemingla.com — that is consumer/Explorer-owned (1 domain = 1 template → WRONG STORE)", () => {
    expect(BUSINESS_INVITE_CTA_URL).not.toContain("go.usemingla.com");
  });

  it("NEVER minglabiz.onelink.me — the raw vendor base, not the branded domain", () => {
    expect(BUSINESS_INVITE_CTA_URL).not.toContain("minglabiz.onelink.me");
  });

  it("NEVER usemingla.com/business/download — a plain store link carries NO attribution", () => {
    expect(BUSINESS_INVITE_CTA_URL).not.toContain("/business/download");
  });

  it("NEVER a direct store listing — the 301 must come from the OneLink, or af_tranid is lost", () => {
    expect(BUSINESS_INVITE_CTA_URL).not.toContain("apps.apple.com");
    expect(BUSINESS_INVITE_CTA_URL).not.toContain("play.google.com");
  });

  it("is ONE url for every platform — no client-side store branching (the OneLink does the 301)", () => {
    // Pinning the contract: if a future change introduces per-platform targets,
    // it must delete this test and explain why attribution survives.
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "BusinessAppDownloadCta.tsx"),
      "utf8",
    );
    const noComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(noComments).not.toContain("APP_STORE_URL");
    expect(noComments).not.toContain("PLAY_STORE_URL");
    expect(noComments).not.toContain("IOS_STORE_URL");
    expect(noComments).not.toContain("ANDROID_STORE_URL");
  });
});

describe("ORCH-1378 BusinessAppDownloadCta — T-23: web-only + open discipline", () => {
  const source = (): string => {
    const fs = require("node:fs");
    const path = require("node:path");
    return fs.readFileSync(
      path.join(__dirname, "..", "BusinessAppDownloadCta.tsx"),
      "utf8",
    );
  };

  it("T-23 — gates render on Platform.OS === 'web' (on native the user already HAS the app)", () => {
    expect(source()).toMatch(/if \(Platform\.OS !== "web"\) return null;/);
  });

  it("SC-11 — delegates opening to the ONE owner `openExternal`, never a local window.open", () => {
    const noComments = source()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(noComments).toMatch(/openExternal\(/);
    // Re-rolling window.open here is how the ORCH-1381/1382 double-nav bug
    // spreads to a third copy.
    expect(noComments).not.toMatch(/window\.open\(/);
    expect(noComments).not.toMatch(/location\.(href|assign)/);
  });

  it("a11y — the button carries an explicit accessibility label", () => {
    expect(source()).toMatch(/accessibilityLabel="Download the Mingla Business app"/);
  });

  it("copy matches the approved strings verbatim", () => {
    const s = source();
    expect(s).toContain("Get the Mingla Business app");
    expect(s).toContain(
      "Manage your brand, sell tickets, and scan guests in from your phone.",
    );
    expect(s).toContain('label="Download the app"');
  });
});
