// #2829 — the local Sites stack scripts keep secrets out of git, only ever
// target loopback, and no migration writes a local service config row.
// invariant: I-PROPOSED-2829-05 (DRAFT) — local-only configuration never
// reaches a hosted database (here: no migration inserts environment 'local').
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertLoopbackUrl,
  newSecrets,
  renderEnv,
} from "../local/lib/local-state.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("#2829 generated local files are gitignored", () => {
  for (const path of [
    "mingla-sites/.env.local",
    "mingla-site-cms/.env.local",
    "supabase/functions/.env.local",
    "scripts/sites/local/.state/local-secrets.json",
    "scripts/sites/local/.state/cms-ops.env",
    "scripts/sites/local/.seed-credentials.local.json",
    "scripts/sites/local/.stacks/core/supabase/config.toml",
  ]) {
    const result = spawnSync("git", ["check-ignore", "-q", path], { cwd: REPO_ROOT });
    assert.equal(result.status, 0, `${path} is not gitignored`);
  }
  for (const path of ["mingla-sites/.env.example", "mingla-site-cms/.env.example"]) {
    const result = spawnSync("git", ["check-ignore", "-q", path], { cwd: REPO_ROOT });
    assert.equal(result.status, 1, `${path} must stay tracked`);
  }
});

test("#2829 local key material is fresh, 32+ bytes and pairwise distinct", () => {
  const first = newSecrets();
  const second = newSecrets();
  const material = [
    first.keys.runtime_to_core.key_b64,
    first.keys.cms_to_core.key_b64,
    first.keys.core_to_cms.key_b64,
    first.keys.attribution_pepper_b64,
    first.keys.preview_signing_secret_b64,
    first.keys.candidate_probe_secret_b64,
    first.keys.runtime_media_key_b64,
    first.keys.payload_secret_b64,
  ];
  for (const value of material) assert.ok(Buffer.from(value, "base64").byteLength >= 32);
  assert.equal(new Set(material).size, material.length);
  assert.notEqual(first.keys.runtime_to_core.key_b64, second.keys.runtime_to_core.key_b64);
  assert.notEqual(first.fixtures.gogi_brand_id, second.fixtures.gogi_brand_id);
  for (const id of Object.values(first.fixtures)) {
    assert.notEqual(id, "733bc470-45e1-4684-8896-acd7e26074ff", "fixture reused the production gögi brand id");
  }
});

test("#2829 local scripts refuse non-loopback targets and unsafe env values", () => {
  assert.equal(assertLoopbackUrl("http://127.0.0.1:55322/postgres", "db").hostname, "127.0.0.1");
  for (const url of [
    "https://gqnoajqerqhnvulmnyvv.supabase.co",
    "postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    "http://localhost.attacker.invalid:55321",
  ]) assert.throws(() => assertLoopbackUrl(url, "x"), /NON_LOOPBACK_TARGET/);
  assert.throws(() => renderEnv("# h", [["A", "line\nINJECTED=1"]]), /ENV_VALUE_INVALID/);
});

test("#2829 no migration inserts a local Sites service config row", () => {
  const dir = resolve(REPO_ROOT, "supabase/migrations");
  const offenders = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql"))) {
    const sql = readFileSync(resolve(dir, name), "utf8").replace(/--[^\n]*/g, "");
    for (const match of sql.matchAll(/INSERT\s+INTO\s+(?:public\.)?brand_site_service_config[\s\S]*?;/gi)) {
      if (/'local'/i.test(match[0])) offenders.push(name);
    }
    if (/UPDATE\s+(?:public\.)?brand_site_service_config[\s\S]*?environment\s*=\s*'local'/i.test(sql)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, []);
});
