import { describe, expect, it } from "vitest";

/*
 * #2829 A8 — Studio never asks Gravatar for the signed-in owner's picture.
 * Payload's default admin avatar is "gravatar" (a request to www.gravatar.com
 * carrying a hash of the owner's email on every admin page). The real config,
 * sanitized by the installed Payload, must say "default".
 */

const fixtureKey = (character: string): string => Buffer.from(character.repeat(32), "utf8").toString("base64");

const fixtureEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: ["postgresql", "://", "sites_cms_app.abcdefghijklmnopqrst", ":", "fixture", "@", "aws-0-us-east-2.pooler.supabase.com", ":6543/postgres?sslmode=require"].join(""),
  PAYLOAD_SECRET: fixtureKey("A"),
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
  SITES_PREVIEW_SIGNING_SECRET: fixtureKey("A"),
  MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-core-current",
  MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: fixtureKey("B"),
  MINGLA_CORE_TO_CMS_CURRENT_KID: "core-cms-current",
  MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: fixtureKey("C"),
  SITES_CANDIDATE_PROBE_SECRET: fixtureKey("D"),
  SITES_PUBLIC_RUNTIME_ORIGIN: "https://gogi.sites.usemingla.com",
};

describe("#2829 A8 Studio avatar", () => {
  it("the sanitized Payload config uses the built-in avatar, not Gravatar", async () => {
    const previous = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(fixtureEnvironment)) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      const { default: configPromise } = await import("../payload.config");
      const config = await configPromise;
      expect(config.admin?.avatar).toBe("default");
      expect(JSON.stringify(config.admin ?? {})).not.toContain("gravatar");
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
