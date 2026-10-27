/**
 * #2829 — the local Sites stack points Business web at a loopback Core and a
 * loopback Studio (scripts/sites/local/run-business-web.sh). Two guards keep
 * that from ever shipping:
 *   1. resolveStudioOrigin honours only a bare http loopback origin;
 *      anything else is the production Studio.
 *   2. app.config.js fails every EAS profile and every Vercel build that
 *      carries the Studio override or a loopback Supabase URL.
 *
 * FAILS-ON-REVERT: delete the assertNoLocalSitesOverridesInHostedBuild call
 * from app.config.js and the "fails the hosted build" cases go red; drop the
 * loopback check from resolveStudioOrigin and the "falls back" cases go red.
 */
import path from "node:path";

jest.mock("../supabase", () => ({ supabase: {} }));

import {
  PRODUCTION_STUDIO_ORIGIN,
  resolveStudioOrigin,
  studioExchangeUrl,
} from "../brandSitesService";

const appConfigPath = path.resolve(__dirname, "../../../app.config.js");
const ORIGINAL_ENV = process.env;

const RELEASE_ENV = {
  EXPO_PUBLIC_APPSFLYER_DEV_KEY: "af_dev_key_placeholder",
  EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "id0000000000",
  EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.mingla.business.placeholder",
  EXPO_PUBLIC_GIPHY_API_KEY: "giphy_key_placeholder",
  EXPO_PUBLIC_ONESIGNAL_APP_ID: "4505e476-0000-4000-8000-000000000000",
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_" + "0".repeat(24),
  MINGLA_STRIPE_MODE: "test",
} as const;

function runConfig(env: Record<string, string | undefined>): unknown {
  jest.resetModules();
  const next: Record<string, string | undefined> = { ...ORIGINAL_ENV, ...RELEASE_ENV };
  delete next.EAS_BUILD_PROFILE;
  delete next.VERCEL_ENV;
  delete next.EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN;
  delete next.EXPO_PUBLIC_SUPABASE_URL;
  process.env = { ...next, ...env } as NodeJS.ProcessEnv;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configFn = require(appConfigPath) as (ctx: never) => unknown;
  return configFn({ config: { plugins: [] } } as never);
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("#2829 resolveStudioOrigin", () => {
  it("is production when nothing is set", () => {
    expect(resolveStudioOrigin(undefined)).toBe(PRODUCTION_STUDIO_ORIGIN);
    expect(resolveStudioOrigin("")).toBe(PRODUCTION_STUDIO_ORIGIN);
  });

  it("honours a bare http loopback origin", () => {
    expect(resolveStudioOrigin("http://localhost:3101")).toBe("http://localhost:3101");
    expect(resolveStudioOrigin("http://127.0.0.1:3101/")).toBe("http://127.0.0.1:3101");
  });

  it.each([
    "https://evil.example",
    "http://evil.example:3101",
    "https://localhost:3101",
    "http://localhost.evil.example",
    "http://localhost:3101/path",
    "http://localhost:3101/?x=1",
    "http://user:pw@localhost:3101",
    "javascript:alert(1)",
    "not a url",
  ])("falls back to production for %s", (raw) => {
    expect(resolveStudioOrigin(raw)).toBe(PRODUCTION_STUDIO_ORIGIN);
  });

  it("builds the exchange URL on the resolved origin", () => {
    const url = studioExchangeUrl(
      { code: "c", destination: "studio", site_id: "s", expires_at: "" } as never,
      "web",
      "b",
    );
    expect(url.startsWith(`${resolveStudioOrigin()}/mingla/exchange?code=c`)).toBe(true);
  });
});

describe("#2829 app.config.js refuses local Sites overrides in hosted builds", () => {
  const LOCAL = {
    EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN: "http://localhost:3101",
    EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  };

  it("leaves local dev untouched", () => {
    expect(() => runConfig(LOCAL)).not.toThrow();
  });

  it.each(["development", "preview", "production"])(
    "fails the %s EAS build that carries the Studio override",
    (profile) => {
      expect(() =>
        runConfig({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN: LOCAL.EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN }),
      ).toThrow(/EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN.*#2829/);
    },
  );

  it.each(["preview", "production"])(
    "fails the %s Vercel build that carries a loopback Supabase URL",
    (vercelEnv) => {
      expect(() =>
        runConfig({ VERCEL_ENV: vercelEnv, EXPO_PUBLIC_SUPABASE_URL: LOCAL.EXPO_PUBLIC_SUPABASE_URL }),
      ).toThrow(/loopback host.*#2829/);
    },
  );

  it("lets a hosted build with the hosted Supabase URL through this guard", () => {
    expect(() =>
      runConfig({ EAS_BUILD_PROFILE: "development", EXPO_PUBLIC_SUPABASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co" }),
    ).not.toThrow();
  });
});
