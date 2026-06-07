import fs from "node:fs";
import path from "node:path";

// ORCH-1098 Stage 3 — the REAL Mingla Business Expo app now boots on phone
// browsers. The device-proven root cause was BottomNav's react-native-reanimated
// machinery driving an unbounded re-render/fiber loop on the phone renderer
// (heap → ~1 GB → "Aw, Snap") the instant it mounted in the tabs layout — so it
// crashed EVERY signed-in tab route. The fix web-gates a non-reanimated
// `MobileWebCapsule` into BottomNav.web.tsx and lets the real routes mount on
// mobile (no static stand-in, no firewall detour).
//
// These assertions are the regression guard. They FAIL if anyone:
//   1. re-introduces reanimated into the web BottomNav narrow-web path, or
//   2. re-introduces the mobile→static-home redirect, or
//   3. re-introduces the `/home → /home.html` Vercel rewrite, or
//   4. re-introduces the static-home preboot redirect / light-route firewall.
// The blur-kill + chunk-recovery helpers are intentionally KEPT and asserted.

const businessRoot = path.resolve(__dirname, "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(businessRoot, rel), "utf8");
const exists = (rel: string): boolean =>
  fs.existsSync(path.join(businessRoot, rel));

// Strip block + line comments so "must NOT contain X" assertions test the CODE,
// not explanatory comments that legitimately mention the removed thing by name.
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

describe("ORCH-1098 Stage 3 — real Business app boots on phone browsers", () => {
  describe("BottomNav.web renders the non-reanimated capsule on narrow web", () => {
    const src = read("src/components/ui/BottomNav.web.tsx");

    it("ships the MobileWebCapsule and routes narrow web to it", () => {
      expect(src).toContain("const MobileWebCapsule");
      // The narrow-web branch returns MobileWebCapsule, NOT the reanimated
      // canonical capsule.
      expect(src).toContain("<MobileWebCapsule");
      expect(src).toContain("if (!isWideDesktop)");
    });

    it("contains NO react-native-reanimated machinery on the web path", () => {
      // The killer loop was reanimated. The web BottomNav CODE must never import
      // or use any of it (comments may name it for documentation).
      const code = stripComments(src);
      expect(code).not.toContain("react-native-reanimated");
      expect(code).not.toContain("useSharedValue");
      expect(code).not.toContain("useAnimatedStyle");
      expect(code).not.toContain("useReducedMotion");
      expect(code).not.toContain("withSpring");
      // No animated spotlight view on the web capsule (the OOM driver).
      expect(code).not.toContain("Animated.View");
      // No onLayout measurement loop feeding the spring.
      expect(code).not.toMatch(/onLayout=\{/);
    });

    it("no longer imports the canonical reanimated capsule for narrow web", () => {
      const code = stripComments(src);
      expect(code).not.toContain("MobileBottomNav");
      expect(code).not.toContain('from "./BottomNav"');
    });
  });

  describe("native BottomNav keeps the reanimated spotlight (web-gate only)", () => {
    const native = read("src/components/ui/BottomNav.tsx");
    it("iOS/Android still use the animated spotlight capsule", () => {
      // The fix is web-only; native behavior is byte-unchanged.
      expect(native).toContain("useSharedValue");
      expect(native).toContain("useAnimatedStyle");
      expect(native).toContain("withSpring");
      expect(native).toContain("Animated.View");
    });
  });

  describe("the static-home redirect is GONE", () => {
    it("deletes the redirect util entirely", () => {
      expect(exists("src/utils/mobileWebStaticHomeRedirect.ts")).toBe(false);
    });

    it("removes the redirect call from every route that had it", () => {
      for (const route of [
        "app/index.tsx",
        "app/auth/index.tsx",
        "app/auth/callback.tsx",
      ]) {
        const src = read(route);
        expect(src).not.toContain("redirectMobileBusinessWebToStaticHome");
        expect(src).not.toContain("isMobileBusinessWeb");
        expect(src).not.toContain("mobileWebStaticHomeRedirect");
      }
    });
  });

  describe("the /home → /home.html Vercel rewrite is GONE", () => {
    const vercel = JSON.parse(read("vercel.json")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };

    it("no longer shadows /home with the static stand-in", () => {
      const homeRewrite = vercel.rewrites.find(
        (r) => r.source === "/home" && r.destination === "/home.html",
      );
      expect(homeRewrite).toBeUndefined();
    });

    it("keeps the SPA fallback so /home serves the real Expo route", () => {
      const fallback = vercel.rewrites.find((r) => r.source === "/(.*)");
      expect(fallback).toBeDefined();
      expect(fallback?.destination).toBe("/");
    });

    it("keeps the static auth/callback handoff (a real OAuth token fix)", () => {
      const callback = vercel.rewrites.find((r) => r.source === "/auth/callback");
      expect(callback?.destination).toBe("/auth/callback.html");
    });
  });

  describe("the static auth callback redirects to '/' on ALL devices", () => {
    const html = read("public/auth/callback.html");
    it("always sends the finished session to the real app", () => {
      expect(html).toContain('window.location.replace("/");');
      // the device-gated phone→/home detour is gone
      expect(html).not.toContain('isPhoneClient ? "/home" : "/"');
      expect(html).not.toContain('replace(isPhoneClient');
    });
  });

  describe("inject-mobile-blur-css keeps perf helpers, drops the firewall", () => {
    const inject = read("scripts/inject-mobile-blur-css.mjs");
    // "must NOT contain" assertions run against the CODE (comments may mention
    // the removed firewall by name for documentation).
    const injectCode = stripComments(inject);

    it("KEEPS the mobile blur-kill <style> injection", () => {
      expect(inject).toContain("mingla-mobile-web-no-blur");
      expect(inject).toContain("backdrop-filter:none");
      expect(inject).toContain("STYLE_TAG");
    });

    it("KEEPS the stale-chunk recovery script", () => {
      expect(inject).toContain("mingla-mobile-web-chunk-recovery");
      expect(inject).toContain("CHUNK_RECOVERY_SCRIPT");
    });

    it("DROPS the static-home preboot redirect", () => {
      expect(injectCode).not.toContain("mingla-mobile-web-home-preboot");
      expect(injectCode).not.toContain("PREBOOT_SCRIPT");
    });

    it("DROPS the orch1093/1095 light-route firewall + deferral loader", () => {
      expect(injectCode).not.toContain("orch1093-mobile-route-script-deferral");
      expect(injectCode).not.toContain("buildRouteDeferralLoader");
      expect(injectCode).not.toContain("renderMarketingComposerRoute");
      expect(injectCode).not.toContain("COMPOSER_RUNTIME_SOURCE");
      expect(injectCode).not.toContain("light-route");
    });
  });
});
