/*
 * #2829 W9f (A18 item 6) — Studio's "Return to Mingla" (and the preview's
 * close/publish links and expired-session pages) went to production
 * (host.usemingla.com) from a local stack. They now go to the configured
 * Business origin: always Business web in production, the local Business web
 * (loopback only) in local mode.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCmsConfig } from "./config";

function pg(user: string, host: string, port: string, query = ""): string {
  return ["postgresql", "://", user, ":", "fixture", "@", host, ":", port, "/postgres", query].join("");
}

function production(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: pg("sites_cms_app.abcdefghijklmnopqrst", "aws-0-us-east-2.pooler.supabase.com", "6543", "?sslmode=require"),
    PAYLOAD_SECRET: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
    SUPABASE_S3_ENDPOINT: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
    SUPABASE_S3_REGION: "us-east-2",
    SUPABASE_S3_ACCESS_KEY_ID: "fixture-access-key",
    SUPABASE_S3_SECRET_ACCESS_KEY: "fixture-secret-key",
    SITES_MEDIA_QUARANTINE_BUCKET: "sites-media-quarantine",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_RECOVERY_BUCKET: "sites-media-recovery",
    SITES_PREVIEW_SIGNING_SECRET: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-core-current",
    MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=",
    MINGLA_CORE_TO_CMS_CURRENT_KID: "core-cms-current",
    MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
    SITES_CANDIDATE_PROBE_SECRET: "REREREREREREREREREREREREREREREREREREREREREQ=",
    SITES_PUBLIC_RUNTIME_ORIGIN: "https://gogi.sites.usemingla.com",
    ...overrides,
  };
}

function local(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return production({
    NODE_ENV: "development",
    SITES_LOCAL_MODE: "1",
    DATABASE_URL: pg("sites_cms_app", "127.0.0.1", "55422"),
    SITES_CORE_BASE_URL: "http://127.0.0.1:55321",
    SITES_CMS_ORIGIN: "http://localhost:3101",
    SUPABASE_S3_ENDPOINT: "http://127.0.0.1:55421/storage/v1/s3",
    SUPABASE_S3_REGION: "local",
    SITES_PUBLIC_RUNTIME_ORIGIN: "http://localhost:3100",
    ...overrides,
  });
}

const BRAND = "4cb672ab-6e9c-441e-ade4-3a10d2619432";
const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.resetModules();
});

describe("#2829 W9f Studio return origin", () => {
  it("production always returns to Business web, whatever the environment says", () => {
    expect(loadCmsConfig(production()).businessOrigin).toBe("https://host.usemingla.com");
    expect(loadCmsConfig(production({ SITES_LOCAL_BUSINESS_ORIGIN: "http://localhost:8190" })).businessOrigin)
      .toBe("https://host.usemingla.com");
  });

  it("local mode returns to the local Business web (default port or the configured loopback origin)", () => {
    expect(loadCmsConfig(local()).businessOrigin).toBe("http://localhost:8190");
    expect(loadCmsConfig(local({ SITES_LOCAL_BUSINESS_ORIGIN: "http://127.0.0.1:8191" })).businessOrigin)
      .toBe("http://127.0.0.1:8191");
  });

  it("local mode refuses a non-loopback return origin", () => {
    for (const value of ["https://host.usemingla.com", "http://evil.example:8190", "http://localhost:8190/x"]) {
      expect(() => loadCmsConfig(local({ SITES_LOCAL_BUSINESS_ORIGIN: value }))).toThrow("SITES_LOCAL_BUSINESS_ORIGIN");
    }
  });

  it("Return to Mingla on a local stack lands on the local Website workspace", async () => {
    process.env = { ...savedEnv, ...local() } as NodeJS.ProcessEnv;
    vi.resetModules();
    const { studioReturnLocationFromContext } = await import("./session");
    const context = { brand_id: BRAND, return_surface: "web" } as Parameters<typeof studioReturnLocationFromContext>[0];
    expect(studioReturnLocationFromContext(context)).toBe(`http://localhost:8190/brand/${BRAND}/website`);
    expect(studioReturnLocationFromContext(context, "preview_publish"))
      .toBe(`http://localhost:8190/brand/${BRAND}/website?studioResult=preview_publish`);
  });
});
