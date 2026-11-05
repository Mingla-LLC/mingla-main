// MINGLA-INVARIANT: I-PROPOSED-2830-MULTI-TENANT-RECOVERY | issue #2830 | The Sites backup, restore drill and retention sweep cover every tenant; adding a brand never fails them, and every object and row must still belong to exactly one known tenant.
/*
 * #2830 — real pg_dump, real pg_restore and the real inventory SQL against the
 * pinned PostgreSQL 17 image the workflow uses: three tenants, one with a live
 * publication, one draft-only and one with no documents. Storage, Core and the
 * Management API are fixtures; nothing here can reach production.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runBackup } from "../backup-sites-cms.mjs";
import { EPHEMERAL_RESTORE_DATABASE_URL, runRestore } from "../restore-sites-cms.mjs";
import {
  DRAFT,
  DRAFT_MEDIA,
  DRAFT_STREAM,
  EMPTY,
  PILOT,
  PILOT_MEDIA,
  PUBLICATION,
  fixtureEnv,
  fixtureFetch,
  fixtureObjects,
} from "./issue_2830_multi_tenant_fixture.mjs";

const IMAGE = "postgres:17.10-alpine";
const PASSWORD = "sites-restore-ephemeral-only";
const docker = spawnSync("docker", ["info"], { encoding: "utf8" });
const dockerReady = docker.status === 0;
// A runner that should have Docker and does not is a red run, never a skip.
const skip = !dockerReady && !process.env.CI ? "docker is not available locally" : false;

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function startPostgres() {
  const name = `sites-2830-pg17-${process.pid}-${randomBytes(4).toString("hex")}`;
  const started = spawnSync("docker", [
    "run", "--detach", "--rm", "--name", name,
    "--env", `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE,
  ], { encoding: "utf8", timeout: 180_000 });
  assert.equal(started.status, 0, started.stderr);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = spawnSync("docker", [
      "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres",
    ], { encoding: "utf8" });
    if (ready.status === 0) return name;
    pause(500);
  }
  spawnSync("docker", ["rm", "--force", name]);
  assert.fail("postgres did not become ready");
}

/** Runs the scripts' client commands in the container, against one database. */
function clientSpawn(container, database, { afterRestore = null } = {}) {
  const exec = (command, args, input) => spawnSync("docker", [
    "exec", ...(input ? ["--interactive"] : []),
    "--env", "PGHOST=127.0.0.1", "--env", "PGPORT=5432", "--env", "PGUSER=postgres",
    "--env", `PGPASSWORD=${PASSWORD}`, "--env", `PGDATABASE=${database}`,
    container, command, ...args,
  ], { input, maxBuffer: 64 * 1024 * 1024 });
  const text = (result) => ({
    status: result.status,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
  });
  return (command, args) => {
    if (args.includes("--version")) return text(exec(command, args));
    if (command === "pg_dump") {
      const at = args.indexOf("--file");
      const result = exec(command, [...args.slice(0, at), ...args.slice(at + 2)]);
      if (result.status === 0) writeFileSync(args[at + 1], result.stdout);
      return { status: result.status, stdout: "", stderr: result.stderr.toString("utf8") };
    }
    if (command === "pg_restore") {
      const result = exec(command, args.slice(0, -1), readFileSync(args.at(-1)));
      if (result.status === 0 && afterRestore) afterRestore();
      return text(result);
    }
    return text(exec(command, args));
  };
}

function psql(container, database, sql) {
  const result = spawnSync("docker", [
    "exec", "--interactive", "--env", `PGPASSWORD=${PASSWORD}`, container,
    "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database,
    "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "--tuples-only", "--no-align",
  ], { input: sql, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function sourceSql(objects) {
  const tenantTable = (name) => `CREATE TABLE sites_cms.${name} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid REFERENCES sites_cms.tenants(id) ON DELETE SET NULL
  );`;
  const pageRows = (tenant, count) => Array.from({ length: count }, () =>
    `INSERT INTO sites_cms.pages (tenant_id) VALUES ('${tenant.tenant_id}');`).join("\n");
  return `
    CREATE SCHEMA sites_cms;
    CREATE TABLE sites_cms.tenants (id uuid PRIMARY KEY, core_site_id uuid UNIQUE);
    ${["pages", "navigation", "footer", "site_settings"].map(tenantTable).join("\n")}
    CREATE TABLE sites_cms.media (
      id uuid PRIMARY KEY,
      tenant_id uuid REFERENCES sites_cms.tenants(id) ON DELETE SET NULL,
      state text, kind text, quarantine_key text, approved_master_key text,
      rendition_manifest jsonb
    );
    CREATE TABLE sites_cms.publication_jobs (
      id uuid PRIMARY KEY,
      tenant_id uuid REFERENCES sites_cms.tenants(id) ON DELETE SET NULL,
      status text, artifact_key text, artifact_digest text
    );
    INSERT INTO sites_cms.tenants VALUES
      ('${PILOT.tenant_id}', '${PILOT.site_id}'),
      ('${DRAFT.tenant_id}', '${DRAFT.site_id}'),
      ('${EMPTY.tenant_id}', '${EMPTY.site_id}');
    ${pageRows(PILOT, 3)}
    ${pageRows(DRAFT, 2)}
    INSERT INTO sites_cms.media
      (id, tenant_id, state, kind, approved_master_key, rendition_manifest) VALUES
      ('${PILOT_MEDIA}', '${PILOT.tenant_id}', 'READY', 'image', '${objects.pilotMaster}',
        '${JSON.stringify(objects.pilotManifest)}'),
      ('${DRAFT_MEDIA}', '${DRAFT.tenant_id}', 'READY', 'image', '${objects.draftMaster}',
        '${JSON.stringify(objects.draftManifest)}'),
      ('${DRAFT_STREAM}', '${DRAFT.tenant_id}', 'READY', 'stream_video', NULL, NULL);
    INSERT INTO sites_cms.publication_jobs VALUES
      ('${PUBLICATION}', '${PILOT.tenant_id}', 'published', '${objects.artifactKey}',
        '${objects.artifactDigest}');
  `;
}

test("#2830 a three-tenant backup restores every brand on real PostgreSQL 17", {
  skip,
  timeout: 240_000,
}, async () => {
  assert.equal(dockerReady, true, "this suite must run where Docker is available");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "issue-2830-pg17-")));
  const container = startPostgres();
  try {
    const now = new Date();
    const objects = fixtureObjects();
    psql(container, "postgres", "CREATE DATABASE source;");
    psql(container, "source", sourceSql(objects));

    const encryptionKey = Buffer.alloc(32, 31).toString("base64");
    const resultPath = join(root, "result.json");
    const env = fixtureEnv({ output: root, resultPath, encryptionKey });
    const fetchImpl = fixtureFetch({
      now,
      buckets: objects.buckets,
      protection: {
        [PILOT.site_id]: [objects.artifactKey],
        [DRAFT.site_id]: [],
        [EMPTY.site_id]: [],
      },
    });
    const backup = await runBackup({
      env,
      fetchImpl,
      spawn: clientSpawn(container, "source"),
      now,
    });
    assert.deepEqual(backup.site_ids, [PILOT.site_id, DRAFT.site_id, EMPTY.site_id]);
    assert.equal(backup.object_count, 3);

    const restoreEnv = (name) => ({
      SITES_BACKUP_BUNDLE_PATH: backup.bundle_path,
      SITES_BACKUP_RESTORE_RESULT_PATH: join(root, name),
      SITES_RESTORE_DATABASE_URL: EPHEMERAL_RESTORE_DATABASE_URL,
      SITES_PILOT_SITE_ID: PILOT.site_id,
      SITES_BACKUP_ENCRYPTION_KEY_B64: encryptionKey,
      SITES_CORE_BASE_URL: env.SITES_CORE_BASE_URL,
      MINGLA_CMS_TO_CORE_CURRENT_KID: env.MINGLA_CMS_TO_CORE_CURRENT_KID,
      MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: env.MINGLA_CMS_TO_CORE_CURRENT_KEY_B64,
    });
    const restored = await runRestore({
      env: restoreEnv("restore-result.json"),
      fetchImpl,
      spawn: clientSpawn(container, "postgres"),
      now,
    });
    // pilot: 3 pages + 1 media + 1 job; draft: 2 pages + 2 media; empty: none.
    assert.equal(restored.tenant_count, 3);
    assert.equal(restored.document_count, 9);
    assert.equal(restored.object_count, 3);
    assert.equal(
      psql(container, "postgres", `
        SELECT string_agg(tenant.core_site_id || ':' || (
          SELECT count(*) FROM sites_cms.pages p WHERE p.tenant_id = tenant.id
        ), ',' ORDER BY tenant.id) FROM sites_cms.tenants tenant;`),
      `${PILOT.site_id}:3,${DRAFT.site_id}:2,${EMPTY.site_id}:0`,
    );

    // Same totals, wrong brand: a page that came back under another tenant must
    // fail the drill even though every total still adds up.
    psql(container, "postgres", "DROP SCHEMA sites_cms CASCADE;");
    await assert.rejects(() => runRestore({
      env: restoreEnv("restore-result-moved.json"),
      fetchImpl,
      spawn: clientSpawn(container, "postgres", {
        afterRestore: () => psql(container, "postgres",
          `UPDATE sites_cms.pages SET tenant_id = '${PILOT.tenant_id}'
           WHERE tenant_id = '${DRAFT.tenant_id}';`),
      }),
      now,
    }), /RESTORE_DATABASE_COUNT_MISMATCH/);

    // A brand missing altogether fails too.
    psql(container, "postgres", "DROP SCHEMA sites_cms CASCADE;");
    await assert.rejects(() => runRestore({
      env: restoreEnv("restore-result-missing.json"),
      fetchImpl,
      spawn: clientSpawn(container, "postgres", {
        afterRestore: () => psql(container, "postgres",
          `DELETE FROM sites_cms.tenants WHERE id = '${EMPTY.tenant_id}';`),
      }),
      now,
    }), /RESTORE_DATABASE_COUNT_MISMATCH/);

    // A pilot with nothing in it is not a recoverable pilot, even when the
    // bundle faithfully says so. Another brand being empty stayed fine above.
    psql(container, "postgres", "DROP SCHEMA sites_cms CASCADE;");
    psql(container, "source", `
      DELETE FROM sites_cms.publication_jobs WHERE tenant_id = '${PILOT.tenant_id}';
      DELETE FROM sites_cms.media WHERE tenant_id = '${PILOT.tenant_id}';
      DELETE FROM sites_cms.pages WHERE tenant_id = '${PILOT.tenant_id}';`);
    objects.buckets["sites-media-approved"].delete(objects.pilotMaster);
    objects.buckets["sites-publication-artifacts"].clear();
    const emptiedFetch = fixtureFetch({
      now,
      buckets: objects.buckets,
      protection: { [PILOT.site_id]: [], [DRAFT.site_id]: [], [EMPTY.site_id]: [] },
    });
    const emptied = await runBackup({
      env: { ...env, SITES_BACKUP_RESULT_PATH: join(root, "result-emptied.json") },
      fetchImpl: emptiedFetch,
      spawn: clientSpawn(container, "source"),
      now,
    });
    await assert.rejects(() => runRestore({
      env: {
        ...restoreEnv("restore-result-emptied.json"),
        SITES_BACKUP_BUNDLE_PATH: emptied.bundle_path,
      },
      fetchImpl: emptiedFetch,
      spawn: clientSpawn(container, "postgres"),
      now,
    }), /RESTORE_EMPTY_PILOT/);
  } finally {
    spawnSync("docker", ["rm", "--force", container]);
    rmSync(root, { recursive: true, force: true });
  }
});
