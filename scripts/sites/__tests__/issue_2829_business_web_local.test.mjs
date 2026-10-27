// #2829 — Business web against the local Sites stack: the env file and the
// sign-in code helper only ever talk to loopback, only for local seed users,
// and the env file is gitignored.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUSINESS_ENV_PATH,
  businessEnvEntries,
  parsePort,
  readCoreStatus,
  resolveSeedEmail,
} from "../local/business-web.mjs";
import { REPO_ROOT } from "../local/lib/local-state.mjs";

function statusFile(body) {
  const dir = mkdtempSync(join(tmpdir(), "bw-2829-"));
  const path = join(dir, "core.status.env");
  writeFileSync(path, body);
  return path;
}

test("#2829 the env points Business at loopback Core and Studio only", () => {
  const entries = Object.fromEntries(businessEnvEntries({ apiUrl: "http://127.0.0.1:55321", anonKey: "anon" }, 8190));
  assert.equal(entries.EXPO_PUBLIC_SUPABASE_URL, "http://127.0.0.1:55321");
  assert.equal(entries.EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN, "http://localhost:3101");
  assert.equal(entries.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL, "http://localhost:8190");
  assert.equal(entries.EXPO_PUBLIC_FF_SITES_ENABLED, "true");
  assert.match(entries.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY, /^pk_test_/);
  assert.equal(entries.MINGLA_STRIPE_MODE, "test");
  assert.throws(
    () => businessEnvEntries({ apiUrl: "https://gqnoajqerqhnvulmnyvv.supabase.co", anonKey: "x" }, 8190),
    /NON_LOOPBACK_TARGET/,
  );
});

test("#2829 a hosted Core status file is refused", () => {
  const hosted = statusFile('API_URL="https://gqnoajqerqhnvulmnyvv.supabase.co"\nANON_KEY="a"\nSERVICE_ROLE_KEY="s"\n');
  assert.throws(() => readCoreStatus(hosted), /NON_LOOPBACK_TARGET/);
  const local = statusFile('API_URL="http://127.0.0.1:55321/"\nANON_KEY="a"\nSERVICE_ROLE_KEY="s"\n');
  assert.equal(readCoreStatus(local).apiUrl, "http://127.0.0.1:55321");
  assert.throws(() => readCoreStatus(statusFile('API_URL="http://127.0.0.1:55321"\n')), /CORE_STATUS_INCOMPLETE/);
});

test("#2829 codes are only for local seed users", () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-2829-"));
  const creds = join(dir, "creds.json");
  writeFileSync(creds, JSON.stringify({ users: { brand_owner: { email: "sites-brand-owner@local.invalid" } } }));
  assert.equal(resolveSeedEmail("brand_owner", creds), "sites-brand-owner@local.invalid");
  assert.equal(resolveSeedEmail("sites-x@local.invalid", creds), "sites-x@local.invalid");
  assert.throws(() => resolveSeedEmail("someone@usemingla.com", creds), /NOT_A_LOCAL_SEED_USER/);
  assert.throws(() => resolveSeedEmail("ghost", creds), /UNKNOWN_ROLE/);
  assert.throws(() => resolveSeedEmail("", creds), /WHO_REQUIRED/);
});

test("#2829 ports are validated and the env file is gitignored", () => {
  assert.equal(parsePort("8190"), 8190);
  assert.throws(() => parsePort("80"), /BAD_PORT/);
  assert.throws(() => parsePort("8190; rm -rf /"), /BAD_PORT/);
  const ignored = execFileSync("git", ["check-ignore", BUSINESS_ENV_PATH], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.match(ignored, /scripts\/sites\/local\/\.state\/business-web\.env/);
  assert.doesNotMatch(BUSINESS_ENV_PATH, /mingla-business/);
});
