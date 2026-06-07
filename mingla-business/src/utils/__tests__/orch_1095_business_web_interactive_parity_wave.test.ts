import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const interactiveRoutes = [
  ["/", "auth-root"],
  ["/auth", "auth-index"],
  ["/auth/callback", "auth-callback"],
  ["/hub/events", "hub-events"],
  ["/hub/trips", "hub-trips"],
  ["/marketing", "marketing-overview"],
  ["/marketing/campaigns/compose", "marketing-compose"],
  ["/account", "account"],
] as const;

const blockedRoutes = [
  "/hub/experiences",
  "/ari",
  "/connect-account-management",
] as const;

describe("ORCH-1095 business web interactive parity wave", () => {
  test("static Home marks the five graduated routes and keeps blocked shells", () => {
    const home = repoFile("public/home.html");

    for (const [route, marker] of interactiveRoutes) {
      if (marker === "auth-root" || marker === "auth-index" || marker === "auth-callback") {
        continue;
      }
      expect(home).toContain(`href="${route}"`);
      expect(home).toContain(`data-orch-1095-interactive-route="${marker}"`);
    }

    for (const route of blockedRoutes) {
      expect(home).not.toContain(`href="${route}"`);
    }

    expect(home).toContain('data-shell-link="hub-experiences"');
    expect(home).toContain('data-shell-link="ari-assistant"');
    expect(home).toContain('data-shell-link="payout-account"');
    expect(home).toContain("generated secure session");
  });

  test("root and preboot maps agree on interactive versus blocked route status", () => {
    const rootLayout = repoFile("app/_layout.tsx");
    const injector = repoFile("scripts/inject-mobile-blur-css.mjs");

    for (const [route] of interactiveRoutes) {
      expect(rootLayout).toContain(`"${route}": "interactive"`);
      expect(injector).toContain(`"${route}":"interactive"`);
    }

    expect(rootLayout).toContain('"/event/create": "interactive"');
    expect(injector).toContain('"/event/create":"interactive"');
    expect(rootLayout).toContain('] ?? "static-section"');
    expect(injector).toContain('return map[path]||"static-section"');

    for (const route of blockedRoutes) {
      expect(rootLayout).toContain(`"${route}": "blocked"`);
      expect(injector).toContain(`"${route}":"blocked"`);
    }
  });

  test("phone preboot no longer redirects graduated signed-in routes to static Home anchors", () => {
    const injector = stripComments(repoFile("scripts/inject-mobile-blur-css.mjs"));

    expect(injector).not.toContain('location.replace("/home#"+target)');
    expect(injector).not.toContain('status==="approved"');
    expect(injector).not.toContain('function hasSession()');
    expect(injector).toContain('status==="static-section"');
    expect(injector).toContain('status!=="interactive"');
  });

  test("phone preboot renders lightweight signed-in route entries before Expo boot", () => {
    const injector = stripComments(repoFile("scripts/inject-mobile-blur-css.mjs"));

    expect(injector).toContain('data-orch-1095-light-route-entry="true"');
    expect(injector).toContain('status==="interactive"&&isLightRoute(path)');
    expect(injector).toContain("renderRoute(path,session);return");
    expect(injector).toContain("business_management_events_view");
    expect(injector).toContain("marketing_campaigns");
    expect(injector).toContain("mingla-business.currentBrand.v14");
    expect(injector).toContain('resolvePublicConfig("EXPO_PUBLIC_SUPABASE_ANON_KEY")');
    expect(injector).not.toContain(["eyJ", "hbGciOiJI"].join(""));
  });

  test("lightweight entries do not create new unpromoted direct-entry taps", () => {
    const injector = stripComments(repoFile("scripts/inject-mobile-blur-css.mjs"));

    for (const unpromotedTarget of [
      '"/account/edit-profile"',
      '"/brand/"+b.id',
      '"/marketing/campaigns/"+c.id',
      '"/trip/"+t.id',
      '"/trip/create"',
      '"/event/"+e.id+"/edit"',
      '"Save draft in full composer"',
    ]) {
      expect(injector).not.toContain(unpromotedTarget);
    }

    expect(injector).toContain('"/home#account"');
    expect(injector).toContain('"/home#hub-trips"');
    expect(injector).toContain('"/home#hub-events"');
    expect(injector).toContain('"Return to marketing"');
  });

  test("post-auth static Home redirect stays scoped to root/auth callers", () => {
    const redirect = repoFile("src/utils/mobileWebStaticHomeRedirect.ts");

    expect(redirect).toContain('window.location.replace("/home")');
    expect(redirect).toContain("(max-width: 767px), (pointer: coarse)");
    for (const routeFile of ["app/index.tsx", "app/auth/index.tsx", "app/auth/callback.tsx"]) {
      expect(repoFile(routeFile)).toContain("redirectMobileBusinessWebToStaticHome");
    }
    for (const routeFile of [
      "app/(tabs)/hub/events.tsx",
      "app/(tabs)/hub/trips.tsx",
      "app/(tabs)/marketing/index.tsx",
      "app/(tabs)/marketing/campaigns/compose.tsx",
      "app/(tabs)/account.tsx",
    ]) {
      expect(repoFile(routeFile)).not.toContain("redirectMobileBusinessWebToStaticHome");
    }
  });

  test("browser composer and seller copy protections remain intact", () => {
    const webPicker = stripComments(
      repoFile("src/components/marketing/ComposerV2/SchedulePickerSheet.tsx"),
    );
    const home = repoFile("public/home.html");

    expect(webPicker).toContain('type="date"');
    expect(webPicker).toContain('type="time"');
    expect(webPicker).not.toContain("@react-native-community/datetimepicker");
    expect(home).not.toContain("Connect Stripe");
    expect(home).not.toContain("Payments & Stripe");
    expect(home).not.toContain("Stripe account");
  });
});
