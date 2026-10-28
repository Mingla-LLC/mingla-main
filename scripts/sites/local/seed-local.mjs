#!/usr/bin/env node
// #2829 W0 — seed the LOCAL Sites stack. Idempotent and re-runnable.
//
//   seed-local.mjs                  seed Core (users, brands, team, config)
//   seed-local.mjs --storage-reader create the runtime storage reader on the
//                                   Sites CMS stack and re-bind the reader
//                                   policy to it (re-runs the CMS bootstrap)
//
// Core seed (neutral fixtures only — no Young & Stamped content or media):
//   - the Sites service config row with environment='local' (the ONLY place
//     a local row is ever written; migrations never write one)
//   - seven test users, one per role (owner, brand admin, marketing manager,
//     event manager, finance manager, scanner, Mingla admin); passwords are
//     generated into scripts/sites/local/.seed-credentials.local.json
//     (gitignored) and never printed
//   - brands "gogi fixture", "Young & Stamped" (local shell only: name and
//     slug, nothing else) and "Local Test Trips", each with fresh random ids
//     (never a production id), the owner owning all three and the other roles
//     as accepted team members
//   - the gogi fixture's site row (provisioning) with the id the local
//     runtime and storage policy are bound to
//   - one upcoming public trip on "Local Test Trips"
//   - W1: entitlements for gogi fixture and Young & Stamped (Local Test Trips
//     left ungranted) and local_synthetic recovery evidence
// Later waves extend this file (W5/W6
// content via scripts/sites/local/seed-young-and-stamped.mjs).
//
// Every target is loopback; the script refuses anything else.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  CMS_OPS_ENV_PATH,
  LOCAL_DIR,
  SEED_CREDENTIALS_PATH,
  STATE_DIR,
  assertLoopbackUrl,
  parseEnvFile,
  readSecrets,
  writePrivate,
  writeSecrets,
} from "./lib/local-state.mjs";
import { LOCAL_DOMAIN_STATES_DDL } from "./domain-state.mjs";

const ROLES = [
  "brand_owner",
  "brand_admin",
  "marketing_manager",
  "event_manager",
  "finance_manager",
  "scanner",
  "mingla_admin",
];

function statusDbUrl(label, override) {
  if (override) return assertLoopbackUrl(override, label).toString();
  const path = resolve(STATE_DIR, `${label}.status.env`);
  if (!existsSync(path)) throw new Error(`STATUS_FILE_MISSING:${label}`);
  const url = parseEnvFile(readFileSync(path, "utf8")).DB_URL;
  if (!url) throw new Error(`STATUS_VALUE_MISSING:${label}:DB_URL`);
  return assertLoopbackUrl(url, label).toString();
}

function credentials() {
  const existing = existsSync(SEED_CREDENTIALS_PATH)
    ? JSON.parse(readFileSync(SEED_CREDENTIALS_PATH, "utf8"))
    : { users: {} };
  for (const role of ROLES) {
    if (!existing.users[role]) {
      existing.users[role] = {
        id: randomUUID(),
        email: `sites-${role.replace(/_/g, "-")}@local.invalid`,
        password: randomBytes(18).toString("base64url"),
      };
    }
  }
  writePrivate(SEED_CREDENTIALS_PATH, `${JSON.stringify(existing, null, 2)}\n`);
  return existing.users;
}

function psql(databaseUrl, sql, vars) {
  const url = new URL(databaseUrl);
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1) || "postgres",
    PGAPPNAME: "mingla-sites-local-seed",
    PGCONNECT_TIMEOUT: "10",
  };
  const args = ["-X", "--no-psqlrc", "-q", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(vars)) {
    // Secrets go through the environment (\getenv), never argv.
    env[`SITES_SEED_${name.toUpperCase()}`] = value;
  }
  const preamble = Object.keys(vars)
    .map((name) => `\\getenv ${name} SITES_SEED_${name.toUpperCase()}`)
    .join("\n");
  const result = spawnSync("psql", args, {
    input: `${preamble}\n${sql}`,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`SEED_SQL_FAILED: ${String(result.stderr).split("\n").filter(Boolean).slice(-3).join(" | ")}`);
  }
  return result.stdout;
}

function statusValue(label, name) {
  const path = resolve(STATE_DIR, `${label}.status.env`);
  if (!existsSync(path)) throw new Error(`STATUS_FILE_MISSING:${label}`);
  const value = parseEnvFile(readFileSync(path, "utf8"))[name];
  if (!value) throw new Error(`STATUS_VALUE_MISSING:${label}:${name}`);
  return value;
}

/**
 * Create (or re-password) a confirmed email user through the stack's own
 * GoTrue admin API, so identities and every auth column are exactly what
 * GoTrue writes. Fixed ids keep re-runs idempotent.
 */
async function ensureAuthUser(label, { id, email, password }) {
  const api = assertLoopbackUrl(statusValue(label, "API_URL"), `${label}.api`).origin;
  const key = statusValue(label, "SERVICE_ROLE_KEY");
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const existing = await fetch(`${api}/auth/v1/admin/users/${id}`, { headers });
  const response = existing.ok
    ? await fetch(`${api}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
    : await fetch(`${api}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, email, password, email_confirm: true }),
    });
  if (!response.ok) throw new Error(`AUTH_USER_FAILED:${label}:${response.status}`);
}

async function seedCore() {
  const secrets = readSecrets();
  const users = credentials();
  const f = secrets.fixtures;
  const vars = {
    gogi_brand_id: f.gogi_brand_id,
    gogi_site_id: f.gogi_site_id,
    ys_brand_id: f.young_and_stamped_brand_id,
    trips_brand_id: f.local_test_trips_brand_id,
    trip_event_id: f.local_test_trip_event_id,
  };
  for (const role of ROLES) {
    vars[`${role}_id`] = users[role].id;
    vars[`${role}_email`] = users[role].email;
  }
  // SITES_LOCAL_SEED_SKIP_AUTH=1 is for exercising the SQL half against a bare
  // Postgres (no GoTrue); the users must then already exist.
  if (process.env.SITES_LOCAL_SEED_SKIP_AUTH !== "1") {
    for (const role of ROLES) await ensureAuthUser("core", users[role]);
  }
  const memberRoles = ROLES.filter((role) => role !== "brand_owner" && role !== "mingla_admin");
  const sql = `
BEGIN;
INSERT INTO public.creator_accounts (id) VALUES (:'brand_owner_id'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (email, role, status, accepted_at)
VALUES (:'mingla_admin_email', 'admin', 'active', now())
ON CONFLICT (email) DO UPDATE SET status = 'active';

INSERT INTO public.brands (id, account_id, name, slug, default_currency) VALUES
  (:'gogi_brand_id'::uuid, :'brand_owner_id'::uuid, 'gogi fixture', 'gogi-fixture', 'NGN'),
  (:'ys_brand_id'::uuid, :'brand_owner_id'::uuid, 'Young & Stamped', 'youngandstamped', 'USD'),
  (:'trips_brand_id'::uuid, :'brand_owner_id'::uuid, 'Local Test Trips', 'local-test-trips', 'USD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
SELECT brand_id, user_id, role, now()
FROM (VALUES
${memberRoles.map((role) => `  (:'${role}_id'::uuid, '${role}')`).join(",\n")}
) AS member(user_id, role)
CROSS JOIN (VALUES (:'gogi_brand_id'::uuid), (:'ys_brand_id'::uuid), (:'trips_brand_id'::uuid)) AS brand(brand_id)
ON CONFLICT (brand_id, user_id) WHERE removed_at IS NULL DO NOTHING;

-- The local service row. A production row can never be turned into this one
-- (environment is insert-only), so refuse loudly if one is present.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brand_site_service_config WHERE environment <> 'local') THEN
    RAISE EXCEPTION 'SEED_REFUSED: this database holds a non-local Sites service row';
  END IF;
END
$guard$;
INSERT INTO public.brand_site_service_config (
  config_key, environment, cms_origin, public_runtime_origin, public_host_suffix,
  configured_by, configured_at, updated_by, updated_at
) VALUES (
  -- Core edge functions run inside Docker and reach Studio on the host
  -- through the Docker host gateway (amendment A2.3; local rows only).
  'sites_v1', 'local', 'http://host.docker.internal:3101', 'http://localhost:3100', 'sites.localhost',
  :'mingla_admin_id'::uuid, now(), :'mingla_admin_id'::uuid, now()
)
ON CONFLICT (config_key) DO UPDATE SET
  cms_origin = EXCLUDED.cms_origin,
  public_runtime_origin = EXCLUDED.public_runtime_origin,
  public_host_suffix = EXCLUDED.public_host_suffix,
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

-- #2829 W1 — per-brand entitlements, as a Mingla admin grants them. "gogi
-- fixture" and "Young & Stamped" are granted; "Local Test Trips" is left
-- ungranted so the not-granted path can be exercised (grant it in Admin).
INSERT INTO public.brand_site_entitlements (brand_id, status, source, granted_by, granted_at, reason_code, note)
VALUES
  (:'gogi_brand_id'::uuid, 'granted', 'admin', :'mingla_admin_id'::uuid, now(), 'rollout', 'local seed'),
  (:'ys_brand_id'::uuid, 'granted', 'admin', :'mingla_admin_id'::uuid, now(), 'rollout', 'local seed')
ON CONFLICT (brand_id) DO NOTHING;

INSERT INTO public.brand_sites (id, brand_id, status, created_by)
VALUES (:'gogi_site_id'::uuid, :'gogi_brand_id'::uuid, 'provisioning', :'brand_owner_id'::uuid)
ON CONFLICT (id) DO NOTHING;

-- #2829 W1 — synthetic recovery evidence so a local site can make its first
-- publish. Core accepts 'local_synthetic' ONLY on an environment='local' row.
SELECT public.brand_site_record_readiness_evidence(
  :'gogi_site_id'::uuid, gen_random_uuid(), encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  jsonb_build_object(
    'schema_version', 1, 'evidence_kind', 'nightly_backup',
    'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'backup_retention_days', 7,
    'database_backup_verified_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'object_manifest_verified_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'manifest_digest', encode(extensions.digest('local-manifest', 'sha256'), 'hex'),
    'backup_bundle_digest', encode(extensions.digest('local-bundle', 'sha256'), 'hex'),
    'object_count', 0, 'object_bytes', 0),
  'local_synthetic');
SELECT public.brand_site_record_readiness_evidence(
  :'gogi_site_id'::uuid, gen_random_uuid(), encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  jsonb_build_object(
    'schema_version', 1, 'evidence_kind', 'restore_drill',
    'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'restore_drill_verified_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'restore_drill_evidence_digest', encode(extensions.digest('local-restore', 'sha256'), 'hex'),
    'tenant_count', 1, 'document_count', 1, 'object_count', 0, 'object_bytes', 0),
  'local_synthetic');

-- One upcoming public trip, 60-66 days out, so later waves have a bookable
-- offering to project. Neutral fixture copy only.
INSERT INTO public.events (id, brand_id, title, slug, event_type, visibility, status, timezone, currency)
VALUES (:'trip_event_id'::uuid, :'trips_brand_id'::uuid, 'Fixture coast walk', 'fixture-coast-walk',
        'trip', 'public', 'scheduled', 'Europe/London', 'USD')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
SELECT :'trip_event_id'::uuid, date_trunc('day', now()) + interval '60 days',
       date_trunc('day', now()) + interval '66 days', 'Europe/London', true
WHERE NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id = :'trip_event_id'::uuid);

-- #2829 W8 — the local domain provider's control table (local stacks only;
-- no migration creates it). Drive it with scripts/sites/local/domain-state.mjs.
${LOCAL_DOMAIN_STATES_DDL}
COMMIT;

SELECT 'SITES_LOCAL_SEED_OK'
  || ' users=' || (SELECT count(*) FROM auth.users WHERE email LIKE 'sites-%@local.invalid')
  || ' brands=' || (SELECT count(*) FROM public.brands WHERE id IN (:'gogi_brand_id'::uuid, :'ys_brand_id'::uuid, :'trips_brand_id'::uuid))
  || ' environment=' || (SELECT environment FROM public.brand_site_service_config WHERE config_key = 'sites_v1')
  || ' entitled=' || (SELECT count(*) FROM public.brand_site_entitlements WHERE status = 'granted' AND brand_id IN (:'gogi_brand_id'::uuid, :'ys_brand_id'::uuid, :'trips_brand_id'::uuid));
`;
  const out = psql(statusDbUrl("core", process.env.SITES_LOCAL_CORE_DB_URL), sql, vars);
  process.stdout.write(`${out.trim().split("\n").filter((line) => line.includes("SITES_LOCAL_SEED_OK")).pop() ?? "SITES_LOCAL_SEED_OK"}\n`);
}

async function seedStorageReader() {
  const secrets = readSecrets();
  const reader = secrets.storage_reader;
  if (!reader.user_id) {
    reader.user_id = randomUUID();
    writeSecrets(secrets);
  }
  await ensureAuthUser("cms", {
    id: reader.user_id,
    email: reader.email,
    password: reader.password,
  });
  // Re-render cms-ops.env with the real subject, then re-bind the policy.
  const ops = readFileSync(CMS_OPS_ENV_PATH, "utf8").replace(
    /^SITES_RUNTIME_READER_SUBJECT=.*$/m,
    `SITES_RUNTIME_READER_SUBJECT=${reader.user_id}`,
  );
  writePrivate(CMS_OPS_ENV_PATH, ops);
  const result = spawnSync(
    process.execPath,
    [resolve(LOCAL_DIR, "cms-env.mjs"), "--exec", "--", process.execPath, resolve(LOCAL_DIR, "..", "bootstrap-sites-cms.mjs")],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("READER_POLICY_REBIND_FAILED");
  process.stdout.write("SITES_LOCAL_STORAGE_READER_OK\n");
}

try {
  if (process.argv.includes("--storage-reader")) await seedStorageReader();
  else await seedCore();
} catch (error) {
  process.stderr.write(`FAIL seed-local: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exit(1);
}
