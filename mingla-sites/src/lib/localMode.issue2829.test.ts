// #2829 — local mode must never activate in production (R-8, T-W0-1..6).
// MINGLA-INVARIANT: I-PROPOSED-2829-05 | issue #2829 | Local mode cannot be switched on in any Vercel build or against a non-loopback backend, and the production database refuses local-only configuration.
// Also enforced by the CMS twin (mingla-site-cms/src/lib/localMode.issue2829.test.ts),
// supabase/migrations/__tests__/issue_2829_sites_multi_brand.test.sql and
// supabase/functions/_shared/__tests__/issue_2829_sites_environment_guard.test.ts.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";
import {
  assertNoLocalModeOnVercelBuild,
  localExtraHosts,
  localModeEnabled,
  loopbackOrigin,
} from "./localMode";

const KEY = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=";
const PROBE = "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=";

function production(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_PROJECT_REF: "abcdefghijklmnopqrst",
    SITES_STORAGE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SITES_STORAGE_SUPABASE_ANON_KEY: "fixture-anon-key",
    SITES_STORAGE_READER_EMAIL: "sites-reader@example.invalid",
    SITES_STORAGE_READER_PASSWORD: "fixture-reader-password",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "runtime-key-1",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64: KEY,
    SITES_PILOT_SITE_ID: "00000000-0000-4000-8000-000000000001",
    SITES_CANDIDATE_PROBE_SECRET: PROBE,
    ...overrides,
  };
}

function local(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return production({
    SITES_LOCAL_MODE: "1",
    SITES_CORE_BASE_URL: "http://127.0.0.1:55321",
    SITES_STORAGE_SUPABASE_URL: "http://127.0.0.1:55421",
    ...overrides,
  });
}

describe("#2829 runtime config two-mode matrix", () => {
  it("T-W0-1 production config is unchanged when no local signal exists", () => {
    const config = loadRuntimeConfig(production());
    expect(config.mode).toBe("production");
    expect(config.coreBaseUrl).toBe("https://gqnoajqerqhnvulmnyvv.supabase.co");
    expect(config.allowedHostSuffix).toBe("sites.usemingla.com");
    expect(config.localExtraHosts).toEqual([]);
  });

  it("T-W0-2 a loopback Core or storage URL without local mode throws", () => {
    for (const overrides of [
      { SITES_CORE_BASE_URL: "http://127.0.0.1:55321" },
      { SITES_CORE_BASE_URL: "https://127.0.0.1:55321" },
      { SITES_STORAGE_SUPABASE_URL: "http://127.0.0.1:55421" },
      { SITES_ALLOWED_HOST_SUFFIX: "sites.localhost" },
    ]) {
      expect(() => loadRuntimeConfig(production(overrides)))
        .toThrow("SERVICE_CONFIGURATION_INVALID");
    }
  });

  it("T-W0-3 local mode with a Vercel marker throws, in both directions", () => {
    for (const marker of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }]) {
      expect(() => loadRuntimeConfig(local(marker))).toThrow("SITES_LOCAL_MODE_INVALID");
      // Production backends plus the flag on Vercel is the realistic mistake.
      expect(() => loadRuntimeConfig(production({ SITES_LOCAL_MODE: "1", ...marker })))
        .toThrow("SITES_LOCAL_MODE_INVALID");
    }
  });

  it("T-W0-4 every partial local signal throws instead of picking a mode", () => {
    for (const env of [
      production({ SITES_LOCAL_MODE: "true" }),
      production({ SITES_LOCAL_MODE: "0" }),
      production({ SITES_LOCAL_EXTRA_HOSTS: "brand.test" }),
    ]) {
      expect(() => loadRuntimeConfig(env)).toThrow("SITES_LOCAL_MODE_INVALID");
    }
    // The flag alone with production backends is refused: local mode demands
    // loopback backends, so a production origin can never run in local mode.
    expect(() => loadRuntimeConfig(production({ SITES_LOCAL_MODE: "1" })))
      .toThrow("SERVICE_CONFIGURATION_INVALID");
    for (const overrides of [
      { SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co" },
      { SITES_CORE_BASE_URL: "http://10.0.0.5:55321" },
      { SITES_CORE_BASE_URL: "http://localhost.attacker.invalid:55321" },
      { SITES_CORE_BASE_URL: "http://127.0.0.1" },
      { SITES_CORE_BASE_URL: "http://user:pw@127.0.0.1:55321" },
      { SITES_STORAGE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
      { SITES_ALLOWED_HOST_SUFFIX: "sites.usemingla.com" },
    ]) {
      expect(() => loadRuntimeConfig(local(overrides)))
        .toThrow("SERVICE_CONFIGURATION_INVALID");
    }
  });

  it("T-W0-5 a fully consistent local environment enables local mode", () => {
    const config = loadRuntimeConfig(local({ SITES_LOCAL_EXTRA_HOSTS: "brand-domain.test" }));
    expect(config.mode).toBe("local");
    expect(config.coreBaseUrl).toBe("http://127.0.0.1:55321");
    expect(config.storageSupabaseUrl).toBe("http://127.0.0.1:55421");
    expect(config.allowedHostSuffix).toBe("sites.localhost");
    expect(config.localExtraHosts).toEqual(["brand-domain.test"]);
    expect(localModeEnabled(local())).toBe(true);
    expect(localModeEnabled(production())).toBe(false);
    expect(loopbackOrigin("http://localhost:3101")).toBe("http://localhost:3101");
  });

  it("T-W0-5b local extra hosts can never name a Mingla or provider domain", () => {
    for (const value of [
      "gogi.sites.usemingla.com",
      "usemingla.com",
      "x.vercel.app",
      "abc.supabase.co",
      "mingla.app",
      "UPPER.test",
      "nodot",
      "bad_label.test",
    ]) {
      expect(() => localExtraHosts(value)).toThrow("SERVICE_CONFIGURATION_INVALID");
    }
  });

  it("T-W0-6 the build guard refuses any local variable on a Vercel build", () => {
    expect(() => assertNoLocalModeOnVercelBuild({ NODE_ENV: "test", VERCEL: "1", SITES_LOCAL_MODE: "1" }))
      .toThrow("SITES_LOCAL_MODE_FORBIDDEN_ON_VERCEL");
    expect(() => assertNoLocalModeOnVercelBuild({ NODE_ENV: "test", VERCEL_ENV: "production", SITES_LOCAL_EXTRA_HOSTS: "a.test" }))
      .toThrow("SITES_LOCAL_MODE_FORBIDDEN_ON_VERCEL");
    expect(() => assertNoLocalModeOnVercelBuild({ NODE_ENV: "test", VERCEL: "1" })).not.toThrow();
    expect(() => assertNoLocalModeOnVercelBuild({ NODE_ENV: "test", SITES_LOCAL_MODE: "1" })).not.toThrow();
  });

  it("T-W0-6b `next build` with VERCEL=1 SITES_LOCAL_MODE=1 exits non-zero", () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/next/dist/bin/next", "build"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 120_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          VERCEL: "1",
          SITES_LOCAL_MODE: "1",
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("SITES_LOCAL_MODE_FORBIDDEN_ON_VERCEL");
  }, 130_000);
});
