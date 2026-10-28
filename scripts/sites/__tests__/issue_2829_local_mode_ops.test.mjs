// #2829 — the Sites CMS bootstrap and Payload-migration scripts accept a
// loopback target only in local mode, and local mode never runs in a deploy.
// invariant: I-PROPOSED-2829-05 (DRAFT) — local mode cannot be active on any
// Vercel build or against a non-loopback backend.
import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapSitesCms } from "../bootstrap-sites-cms.mjs";
import { applySitesCmsMigrations } from "../apply-sites-cms-migrations.mjs";

const SECRET = "s".repeat(40);
const REF = "a".repeat(20);

function pgUrl({ user, password = SECRET, host, port, query = "" }) {
  return ["postgresql", "://", user, ":", password, "@", host, ":", port, "/postgres", query].join("");
}

function hostedEnv(overrides = {}) {
  return {
    SITES_CMS_PROJECT_REF: REF,
    SUPABASE_S3_ENDPOINT: `https://${REF}.storage.supabase.co/storage/v1/s3`,
    SITES_CMS_ADMIN_DATABASE_URL: pgUrl({ user: "postgres", host: `db.${REF}.supabase.co`, port: "5432", query: "?sslmode=require" }),
    SITES_CMS_MIGRATOR_DATABASE_URL: pgUrl({ user: "sites_cms_migrator", host: `db.${REF}.supabase.co`, port: "5432", query: "?sslmode=require" }),
    SITES_CMS_MIGRATOR_PASSWORD: SECRET,
    SITES_CMS_APP_PASSWORD: "t".repeat(40),
    SITES_RUNTIME_READER_SUBJECT: "00000000-0000-4000-8000-000000000001",
    SITES_PILOT_SITE_ID: "00000000-0000-4000-8000-000000000002",
    ...overrides,
  };
}

function localEnv(overrides = {}) {
  return hostedEnv({
    SITES_LOCAL_MODE: "1",
    SUPABASE_S3_ENDPOINT: "http://127.0.0.1:55421/storage/v1/s3",
    SITES_CMS_ADMIN_DATABASE_URL: pgUrl({ user: "postgres", password: "postgres", host: "127.0.0.1", port: "55422" }),
    SITES_CMS_MIGRATOR_DATABASE_URL: pgUrl({ user: "sites_cms_migrator", host: "127.0.0.1", port: "55422" }),
    ...overrides,
  });
}

function okSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: "SITES_BOOTSTRAP_OK\nDone.\n", stderr: "" };
  };
}

test("#2829 bootstrap: hosted rules unchanged without local mode", () => {
  const calls = [];
  bootstrapSitesCms({ env: hostedEnv(), spawn: okSpawn(calls) });
  assert.equal(calls[0].options.env.PGHOST, `db.${REF}.supabase.co`);
  // A loopback admin URL is refused when local mode is off.
  assert.throws(
    () => bootstrapSitesCms({
      env: hostedEnv({ SITES_CMS_ADMIN_DATABASE_URL: localEnv().SITES_CMS_ADMIN_DATABASE_URL }),
      spawn: okSpawn([]),
    }),
    /INVALID_ADMIN_DATABASE_URL/,
  );
  assert.throws(
    () => bootstrapSitesCms({
      env: hostedEnv({ SUPABASE_S3_ENDPOINT: "http://127.0.0.1:55421/storage/v1/s3" }),
      spawn: okSpawn([]),
    }),
    /S3_PROJECT_MISMATCH/,
  );
});

test("#2829 bootstrap: local mode reaches only the loopback CMS stack", () => {
  const calls = [];
  bootstrapSitesCms({ env: localEnv(), spawn: okSpawn(calls) });
  assert.equal(calls[0].options.env.PGHOST, "127.0.0.1");
  assert.equal(calls[0].options.env.PGPORT, "55422");
  for (const [overrides, code] of [
    [{ SITES_CMS_ADMIN_DATABASE_URL: hostedEnv().SITES_CMS_ADMIN_DATABASE_URL }, /INVALID_ADMIN_DATABASE_URL/],
    [{ SITES_CMS_ADMIN_DATABASE_URL: pgUrl({ user: "postgres", host: "10.0.0.3", port: "55422" }) }, /INVALID_ADMIN_DATABASE_URL/],
    [{ SITES_CMS_ADMIN_DATABASE_URL: pgUrl({ user: "postgres", host: "127.0.0.1", port: "55322" }) }, /INVALID_ADMIN_DATABASE_URL/],
    [{ SUPABASE_S3_ENDPOINT: hostedEnv().SUPABASE_S3_ENDPOINT }, /S3_PROJECT_MISMATCH/],
  ]) {
    assert.throws(() => bootstrapSitesCms({ env: localEnv(overrides), spawn: okSpawn([]) }), code);
  }
});

test("#2829 local mode never runs in a deploy or on a partial signal", () => {
  for (const marker of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }, { GITHUB_ACTIONS: "true" }]) {
    assert.throws(
      () => bootstrapSitesCms({ env: localEnv(marker), spawn: okSpawn([]) }),
      /LOCAL_MODE_FORBIDDEN_IN_DEPLOY/,
    );
  }
  assert.throws(
    () => bootstrapSitesCms({ env: localEnv({ SITES_LOCAL_MODE: "true" }), spawn: okSpawn([]) }),
    /LOCAL_MODE_INVALID/,
  );
});

test("#2829 Payload migrations: local migrator must be loopback and password-matched", () => {
  const calls = [];
  applySitesCmsMigrations({ env: localEnv(), bootstrap() {}, spawn: okSpawn(calls) });
  assert.equal(calls[0].options.env.DATABASE_URL, localEnv().SITES_CMS_MIGRATOR_DATABASE_URL);
  assert.equal(calls[0].options.env.SITES_LOCAL_MODE, "1");
  for (const [overrides, code] of [
    [{ SITES_CMS_MIGRATOR_DATABASE_URL: hostedEnv().SITES_CMS_MIGRATOR_DATABASE_URL }, /INVALID_MIGRATOR_DATABASE_URL/],
    [{ SITES_CMS_MIGRATOR_DATABASE_URL: pgUrl({ user: "sites_cms_migrator", host: "127.0.0.1", port: "55422", query: "?sslmode=require&x=1" }) }, /INVALID_MIGRATOR_DATABASE_URL/],
    [{ SITES_CMS_MIGRATOR_DATABASE_URL: pgUrl({ user: "sites_cms_app", host: "127.0.0.1", port: "55422" }) }, /INVALID_MIGRATOR_DATABASE_URL/],
    [{ SITES_CMS_MIGRATOR_PASSWORD: "x".repeat(40) }, /MIGRATOR_CREDENTIAL_MISMATCH/],
  ]) {
    assert.throws(
      () => applySitesCmsMigrations({ env: localEnv(overrides), bootstrap() {}, spawn: okSpawn([]) }),
      code,
    );
  }
  // Hosted path unchanged and still refuses loopback without local mode.
  assert.throws(
    () => applySitesCmsMigrations({
      env: hostedEnv({ SITES_CMS_MIGRATOR_DATABASE_URL: localEnv().SITES_CMS_MIGRATOR_DATABASE_URL }),
      bootstrap() {},
      spawn: okSpawn([]),
    }),
    /INVALID_MIGRATOR_DATABASE_URL/,
  );
});
