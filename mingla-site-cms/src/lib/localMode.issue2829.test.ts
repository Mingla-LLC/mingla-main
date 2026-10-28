// #2829 — Studio local mode must never activate in production (R-8, T-W0 CMS twin).
// invariant: I-PROPOSED-2829-05 (DRAFT) — local mode cannot be active on any
// Vercel build or against a non-loopback backend. Enforced by this file, the
// runtime twin (mingla-sites/src/lib/localMode.issue2829.test.ts) and
// supabase/migrations/__tests__/issue_2829_sites_multi_brand.test.sql.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCmsConfig } from "./config";
import { assertNoLocalModeOnVercelBuild, localModeEnabled } from "./localMode";

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

describe("#2829 Studio config two-mode matrix", () => {
  it("production config is unchanged when no local signal exists", () => {
    const config = loadCmsConfig(production());
    expect(config.mode).toBe("production");
    expect(config.coreBaseUrl).toBe("https://gqnoajqerqhnvulmnyvv.supabase.co");
    expect(config.storageRegion).toBe("us-east-2");
  });

  it("loopback backends without local mode are refused", () => {
    for (const [overrides, message] of [
      [{ SITES_CORE_BASE_URL: "http://127.0.0.1:55321" }, "Invalid server origin"],
      [{ SUPABASE_S3_ENDPOINT: "http://127.0.0.1:55421/storage/v1/s3" }, "Invalid Supabase S3 endpoint."],
      [{ SUPABASE_S3_REGION: "local" }, "Invalid Supabase S3 region."],
      [{ DATABASE_URL: pg("sites_cms_app", "127.0.0.1", "55422") }, "transaction pooler"],
    ] as const) {
      expect(() => loadCmsConfig(production(overrides))).toThrow(message);
    }
  });

  it("local mode with a Vercel marker throws", () => {
    for (const marker of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }]) {
      expect(() => loadCmsConfig(local(marker))).toThrow("SITES_LOCAL_MODE_INVALID");
      expect(() => loadCmsConfig(production({ SITES_LOCAL_MODE: "1", ...marker })))
        .toThrow("SITES_LOCAL_MODE_INVALID");
    }
  });

  it("every partial local signal throws", () => {
    for (const env of [
      production({ SITES_LOCAL_MODE: "yes" }),
      production({ SITES_LOCAL_EXTRA_HOSTS: "brand.test" }),
    ]) expect(() => loadCmsConfig(env)).toThrow("SITES_LOCAL_MODE_INVALID");
    // Flag on, production backends: refused (local mode demands loopback).
    expect(() => loadCmsConfig(production({ SITES_LOCAL_MODE: "1" }))).toThrow();
    for (const [overrides, message] of [
      [{ DATABASE_URL: pg("sites_cms_app.abcdefghijklmnopqrst", "aws-0-us-east-2.pooler.supabase.com", "6543") }, "Invalid local database configuration."],
      [{ DATABASE_URL: pg("postgres", "127.0.0.1", "55422") }, "Invalid local database configuration."],
      [{ DATABASE_URL: pg("sites_cms_app", "10.0.0.2", "55422") }, "Invalid local database configuration."],
      [{ DATABASE_URL: pg("sites_cms_app", "127.0.0.1", "55422", "?sslmode=require&x=1") }, "Invalid local database configuration."],
      [{ DATABASE_URL: pg("sites_cms_app", "127.0.0.1", "55322") }, "same project"],
      [{ SUPABASE_S3_ENDPOINT: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3" }, "Invalid local S3 endpoint."],
      [{ SUPABASE_S3_REGION: "us-east-2" }, "Invalid Supabase S3 region."],
      [{ SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co" }, "Invalid local origin"],
      [{ SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com" }, "Invalid local origin"],
      [{ SITES_PUBLIC_RUNTIME_ORIGIN: "https://gogi.sites.usemingla.com" }, "Invalid local origin"],
      [{ SITES_PUBLIC_RUNTIME_ORIGIN: "http://gogi.sites.usemingla.com:3100" }, "Invalid local origin"],
    ] as const) {
      expect(() => loadCmsConfig(local(overrides))).toThrow(message);
    }
  });

  it("a fully consistent local environment enables local mode", () => {
    const config = loadCmsConfig(local());
    expect(config.mode).toBe("local");
    expect(config.storageEndpoint).toBe("http://127.0.0.1:55421/storage/v1/s3");
    expect(loadCmsConfig(local({ SITES_PUBLIC_RUNTIME_ORIGIN: "http://gogi-fixture.sites.localhost:3100" })).publicRuntimeOrigin)
      .toBe("http://gogi-fixture.sites.localhost:3100");
    expect(loadCmsConfig(local({ SITES_DATABASE_CONNECTION_MODE: "migration", DATABASE_URL: pg("sites_cms_migrator", "127.0.0.1", "55422") })).mode)
      .toBe("local");
    expect(localModeEnabled(production())).toBe(false);
  });

  it("the pinned production CA stays; TLS is off only in local mode", () => {
    const source = readFileSync("src/payload.config.ts", "utf8");
    expect(source).toContain('config.mode === "local"');
    expect(source).toContain("rejectUnauthorized: true");
    expect(source).toContain("supabase-prod-ca-2021.crt");
  });

  it("the build guard refuses any local variable on a Vercel build (helper and next.config.mjs agree)", () => {
    expect(() => assertNoLocalModeOnVercelBuild({ NODE_ENV: "test", VERCEL: "1", SITES_LOCAL_MODE: "1" }))
      .toThrow("SITES_LOCAL_MODE_FORBIDDEN_ON_VERCEL");
    expect(() => assertNoLocalModeOnVercelBuild({ NODE_ENV: "test", VERCEL: "1" })).not.toThrow();
    const nextConfig = readFileSync("next.config.mjs", "utf8");
    expect(nextConfig).toContain('["VERCEL", "VERCEL_ENV"]');
    expect(nextConfig).toContain('["SITES_LOCAL_MODE", "SITES_LOCAL_EXTRA_HOSTS"]');
  });

  it("`next build` with VERCEL=1 SITES_LOCAL_MODE=1 exits non-zero", () => {
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
