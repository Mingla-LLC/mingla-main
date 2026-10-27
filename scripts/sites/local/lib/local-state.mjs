// #2829 W0 — local Sites stack state: generated identity + key material.
//
// Everything secret lives in scripts/sites/local/.state/ (gitignored, 0700)
// and in the three gitignored env files. Nothing here is ever printed.

import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(LOCAL_DIR, "..", "..", "..");
export const STATE_DIR = resolve(LOCAL_DIR, ".state");
export const SECRETS_PATH = resolve(STATE_DIR, "local-secrets.json");
export const CMS_OPS_ENV_PATH = resolve(STATE_DIR, "cms-ops.env");
export const SEED_CREDENTIALS_PATH = resolve(LOCAL_DIR, ".seed-credentials.local.json");

export const PORTS = Object.freeze({
  coreApi: Number(process.env.SITES_LOCAL_CORE_API_PORT || 55321),
  coreDb: Number(process.env.SITES_LOCAL_CORE_DB_PORT || 55322),
  cmsApi: 55421,
  cmsDb: 55422,
  runtime: Number(process.env.SITES_LOCAL_RUNTIME_PORT || 3100),
  studio: Number(process.env.SITES_LOCAL_STUDIO_PORT || 3101),
  // #2829 W9f — Business web (run-business-web.sh default); Studio's
  // "Return to Mingla" goes here in local mode.
  businessWeb: Number(process.env.SITES_LOCAL_BUSINESS_WEB_PORT || 8190),
});

// A fixed, obviously-fake 20-character ref so the runtime's ref-shaped
// setting is satisfied without naming any real project.
export const LOCAL_SITES_PROJECT_REF = "localsitescms0000001";
export const LOCAL_HOST_SUFFIX = "sites.localhost";

export function b64(bytes = 32) {
  return randomBytes(bytes).toString("base64");
}

function kid(prefix) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

function password() {
  return randomBytes(24).toString("base64url");
}

export function newSecrets() {
  return {
    schema: 1,
    created_at: new Date().toISOString(),
    keys: {
      runtime_to_core: { kid: kid("local-rt"), key_b64: b64() },
      cms_to_core: { kid: kid("local-cc"), key_b64: b64() },
      core_to_cms: { kid: kid("local-kc"), key_b64: b64() },
      attribution_pepper_b64: b64(),
      preview_signing_secret_b64: b64(),
      candidate_probe_secret_b64: b64(),
      runtime_media_key_b64: b64(),
      payload_secret_b64: b64(),
    },
    cms_roles: {
      migrator_password: password(),
      app_password: password(),
    },
    storage_reader: {
      email: `sites-reader-${randomBytes(4).toString("hex")}@local.invalid`,
      password: password(),
      user_id: null,
    },
    fixtures: {
      gogi_brand_id: randomUUID(),
      gogi_site_id: randomUUID(),
      young_and_stamped_brand_id: randomUUID(),
      local_test_trips_brand_id: randomUUID(),
      local_test_trip_event_id: randomUUID(),
    },
  };
}

export function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
}

export function readSecrets() {
  if (!existsSync(SECRETS_PATH)) {
    throw new Error("LOCAL_SECRETS_MISSING: run scripts/sites/local/generate-local-keys.mjs first");
  }
  return JSON.parse(readFileSync(SECRETS_PATH, "utf8"));
}

export function writePrivate(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function writeSecrets(secrets) {
  ensureStateDir();
  writePrivate(SECRETS_PATH, `${JSON.stringify(secrets, null, 2)}\n`);
}

/** Parse `supabase status -o env` output (KEY="value" lines). */
export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

export function renderEnv(header, entries) {
  const lines = [header.trim(), ""];
  for (const [name, value] of entries) {
    if (value === undefined || value === null) continue;
    if (/[\r\n]/.test(String(value))) throw new Error(`ENV_VALUE_INVALID:${name}`);
    lines.push(`${name}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Refuse anything that is not loopback: the local scripts never go remote. */
export function assertLoopbackUrl(raw, label) {
  const url = new URL(raw);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`NON_LOOPBACK_TARGET:${label}`);
  }
  return url;
}
