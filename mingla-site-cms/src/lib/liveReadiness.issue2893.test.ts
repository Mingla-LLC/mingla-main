import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCmsConfig } from "./config";
import { reconcileVerificationPath } from "./gateway";
import { MINGLA_BUSINESS_ORIGIN } from "./origins";

function postgresFixtureUrl({
  user,
  credential = "fixture",
  host,
  port = "5432",
  database = "postgres",
  sslmode,
}: {
  user: string;
  credential?: string;
  host: string;
  port?: string;
  database?: string;
  sslmode?: string;
}): string {
  const authority = ["postgresql", "://", user, ":", credential, "@", host, ":", port].join("");
  return `${authority}/${database}${sslmode ? `?sslmode=${sslmode}` : ""}`;
}

function validEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: postgresFixtureUrl({
      user: "sites_cms_app.abcdefghijklmnopqrst",
      host: "aws-0-us-east-2.pooler.supabase.com",
      port: "6543",
      sslmode: "require",
    }),
    PAYLOAD_SECRET: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
    SUPABASE_S3_ENDPOINT:
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
    SUPABASE_S3_REGION: "us-east-2",
    SUPABASE_S3_ACCESS_KEY_ID: "fixture-access-key",
    SUPABASE_S3_SECRET_ACCESS_KEY: "fixture-secret-key",
    SITES_MEDIA_QUARANTINE_BUCKET: "sites-media-quarantine",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_RECOVERY_BUCKET: "sites-media-recovery",
    SITES_PREVIEW_SIGNING_SECRET:
      "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-core-current",
    MINGLA_CMS_TO_CORE_CURRENT_KEY_B64:
      "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=",
    MINGLA_CORE_TO_CMS_CURRENT_KID: "core-cms-current",
    MINGLA_CORE_TO_CMS_CURRENT_KEY_B64:
      "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
    SITES_CANDIDATE_PROBE_SECRET:
      "REREREREREREREREREREREREREREREREREREREREREQ=",
    SITES_PUBLIC_RUNTIME_ORIGIN: "https://gogi.sites.usemingla.com",
    ...overrides,
  };
}

describe("#2893 production CMS launch configuration", () => {
  it("#2914 verifies the exact production reconcile path including /api", () => {
    const operationId = "00000000-0000-4000-8000-000000000001";
    const productionPath = `/api/internal/reconcile/${operationId}`;
    expect(
      reconcileVerificationPath(
        `https://studio.sites.usemingla.com${productionPath}`,
      ),
    ).toBe(productionPath);
    expect(() =>
      reconcileVerificationPath(
        `https://studio.sites.usemingla.com/internal/reconcile/${operationId}`,
      )
    ).toThrow("SIGNATURE_INVALID");
  });

  it("keeps schema creation in the privileged bootstrap, not the bounded Payload migrator", () => {
    const foundationMigration = readFileSync(
      "src/migrations/20260830_122002_issue_2830_sites_foundation.ts",
      "utf8",
    );
    expect(foundationMigration).not.toMatch(/CREATE\s+SCHEMA/i);
    expect(foundationMigration).toContain(
      'REVOKE ALL ON SCHEMA "sites_cms" FROM PUBLIC, anon, authenticated',
    );
  });

  it("pins the Supabase database trust root and keeps certificate verification on", () => {
    const certificate = new X509Certificate(
      readFileSync("src/certs/supabase-prod-ca-2021.crt", "utf8"),
    );
    expect(certificate.subject).toContain("CN=Supabase Root 2021 CA");
    expect(certificate.fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    );
    const payloadConfig = readFileSync("src/payload.config.ts", "utf8");
    expect(payloadConfig).toContain('databaseConnectionUrl.searchParams.delete("sslmode")');
    expect(payloadConfig).toContain("ca: supabaseRootCa");
    expect(payloadConfig).toContain("rejectUnauthorized: true");
    expect(payloadConfig).not.toContain("rejectUnauthorized: false");
  });

  it("accepts only the exact Supabase S3 endpoint shape", () => {
    expect(loadCmsConfig(validEnvironment()).storageEndpoint).toBe(
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
    );
    for (const endpoint of [
      "http://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
      "https://abcdefghijklmnopqrst.storage.supabase.co",
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3/",
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/object",
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3?x=1",
      "https://storage.example.invalid/storage/v1/s3",
      "https://user:password@abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
    ]) {
      expect(() =>
        loadCmsConfig(validEnvironment({ SUPABASE_S3_ENDPOINT: endpoint }))
      ).toThrow("Invalid Supabase S3 endpoint.");
    }
    expect(() =>
      loadCmsConfig(validEnvironment({ SUPABASE_S3_REGION: "us-east-1" }))
    ).toThrow("Invalid Supabase S3 region.");
  });

  it("uses a bounded pilot pool and requires the transaction-pooler port", () => {
    expect(loadCmsConfig(validEnvironment()).databasePoolMax).toBe(3);
    for (const poolMax of ["1", "2", "3"]) {
      expect(
        loadCmsConfig(
          validEnvironment({ SITES_DATABASE_POOL_MAX: poolMax }),
        ).databasePoolMax,
      ).toBe(Number(poolMax));
    }
    for (const poolMax of ["0", "4", "03", "unlimited"]) {
      expect(() =>
        loadCmsConfig(
          validEnvironment({ SITES_DATABASE_POOL_MAX: poolMax }),
        )
      ).toThrow("Invalid server configuration: SITES_DATABASE_POOL_MAX");
    }
    expect(() =>
      loadCmsConfig(
        validEnvironment({
          DATABASE_URL: postgresFixtureUrl({
            user: "postgres", host: "abcdefghijklmnopqrst.supabase.co",
          }),
        }),
      )
    ).toThrow("Production database configuration must use the transaction pooler.");
    expect(() =>
      loadCmsConfig(
        validEnvironment({
          DATABASE_URL: postgresFixtureUrl({
            user: "postgres.abcdefghijklmnopqrst", host: "aws-0-us-east-2.pooler.supabase.com",
          }),
        }),
      )
    ).toThrow("Production database configuration must use the transaction pooler.");
    for (const databaseUrl of [
      postgresFixtureUrl({ user: "postgres.abcdefghijklmnopqrst", host: "aws-0-us-east-2.pooler.supabase.com", port: "6543", sslmode: "require" }),
      postgresFixtureUrl({ user: "sites_cms_app.abcdefghijklmnopqrst", host: "aws-0-us-east-2.pooler.supabase.com", port: "6543" }),
      postgresFixtureUrl({ user: "sites_cms_app.abcdefghijklmnopqrst", host: "aws-0-us-east-2.pooler.supabase.com", port: "6543", sslmode: "disable" }),
    ]) {
      expect(() =>
        loadCmsConfig(validEnvironment({ DATABASE_URL: databaseUrl }))
      ).toThrow("Production database configuration must use the transaction pooler.");
    }
  });

  it("admits migration mode only for the exact direct or session-pooler migrator connection", () => {
    const migration = loadCmsConfig(
      validEnvironment({
        SITES_DATABASE_CONNECTION_MODE: "migration",
        DATABASE_URL: postgresFixtureUrl({
          user: "sites_cms_migrator", host: "db.abcdefghijklmnopqrst.supabase.co", sslmode: "require",
        }),
      }),
    );
    expect(migration.databaseUrl).toContain("db.abcdefghijklmnopqrst.supabase.co:5432");
    const sessionMigration = loadCmsConfig(
      validEnvironment({
        SITES_DATABASE_CONNECTION_MODE: "migration",
        DATABASE_URL: postgresFixtureUrl({
          user: "sites_cms_migrator.abcdefghijklmnopqrst",
          host: "aws-0-us-east-2.pooler.supabase.com",
          port: "5432",
          sslmode: "require",
        }),
      }),
    );
    expect(sessionMigration.databaseUrl).toContain("pooler.supabase.com:5432");
    for (const databaseUrl of [
      postgresFixtureUrl({ user: "sites_cms_app", host: "db.abcdefghijklmnopqrst.supabase.co", sslmode: "require" }),
      postgresFixtureUrl({ user: "sites_cms_migrator", host: "aws-0-us-east-2.pooler.supabase.com", port: "6543", sslmode: "require" }),
      postgresFixtureUrl({ user: "sites_cms_migrator", host: "db.abcdefghijklmnopqrst.supabase.co" }),
    ]) {
      expect(() =>
        loadCmsConfig(
          validEnvironment({
            SITES_DATABASE_CONNECTION_MODE: "migration",
            DATABASE_URL: databaseUrl,
          }),
        )
      ).toThrow("Migration database configuration must use a direct or session-pooler migrator connection.");
    }
    expect(() =>
      loadCmsConfig(
        validEnvironment({ SITES_DATABASE_CONNECTION_MODE: "other" }),
      )
    ).toThrow("Invalid server database connection mode.");
  });

  it("binds database rows and private objects to one exact Sites project", () => {
    expect(() =>
      loadCmsConfig(
        validEnvironment({
          DATABASE_URL: postgresFixtureUrl({
            user: "sites_cms_app.zyxwvutsrqponmlkjihg", host: "aws-0-us-east-2.pooler.supabase.com", port: "6543", sslmode: "require",
          }),
        }),
      )
    ).toThrow("CMS database and object storage must use the same project.");
    expect(() =>
      loadCmsConfig(
        validEnvironment({
          SITES_DATABASE_CONNECTION_MODE: "migration",
          DATABASE_URL: postgresFixtureUrl({
            user: "sites_cms_migrator.zyxwvutsrqponmlkjihg",
            host: "aws-0-us-east-2.pooler.supabase.com",
            port: "5432",
            sslmode: "require",
          }),
        }),
      )
    ).toThrow("CMS database and object storage must use the same project.");
    expect(() =>
      loadCmsConfig(
        validEnvironment({
          SITES_DATABASE_CONNECTION_MODE: "migration",
          DATABASE_URL: postgresFixtureUrl({
            user: "sites_cms_migrator", host: "db.zyxwvutsrqponmlkjihg.supabase.co", sslmode: "require",
          }),
        }),
      )
    ).toThrow("CMS database and object storage must use the same project.");
  });

  it("pins production origins and all four private bucket identities", () => {
    for (const overrides of [
      { SITES_CORE_BASE_URL: "https://other.supabase.co" },
      { SITES_CMS_ORIGIN: "https://mingla-site-cms.vercel.app" },
      { SITES_PUBLIC_RUNTIME_ORIGIN: "https://mingla-sites.vercel.app" },
      { SITES_MEDIA_QUARANTINE_BUCKET: "quarantine" },
      { SITES_MEDIA_APPROVED_BUCKET: "approved" },
      { SITES_PUBLICATION_ARTIFACT_BUCKET: "artifacts" },
      { SITES_MEDIA_RECOVERY_BUCKET: "recovery" },
    ]) {
      expect(() => loadCmsConfig(validEnvironment(overrides))).toThrow();
    }
  });

  it("owns every Studio web return, CORS and frame origin at the canonical Host", () => {
    expect(MINGLA_BUSINESS_ORIGIN).toBe("https://host.usemingla.com");
    const relevantSources = [
      "src/payload.config.ts",
      "src/lib/session.ts",
      "src/endpoints/sitesEndpoints.ts",
      "src/app/(frontend)/mingla/exchange/page.tsx",
      "src/app/(frontend)/mingla/session-expired/page.tsx",
      "src/app/(frontend)/preview/page.tsx",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    expect(relevantSources).not.toContain("business.usemingla.com");
    expect(relevantSources).toContain("MINGLA_BUSINESS_ORIGIN");
  });
});
