import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { BasePayload } from "payload";
import { describe, expect, it } from "vitest";

/*
 * #2830 — every column Payload selects from an upload collection's table must
 * be created by a registered migration.
 *
 * The dependency bump to 3.90.2 added a hidden `_objectKey` field to every
 * upload collection the storage plugin manages. No migration shipped with it,
 * so every Payload read of `media` failed in Postgres with
 * `column "_objectkey" does not exist`, and the retention sweep failed on
 * every backup run.
 *
 * Nothing here is a hand-kept list. The expected columns come from the real
 * config handed to the real adapter at the installed version, without a
 * database connection; the created columns come from running every registered
 * migration's `up` against a recorder. A plugin that grows another column on
 * an upload table fails this until a migration creates it.
 */

const fixtureKey = (character: string): string =>
  Buffer.from(character.repeat(32), "utf8").toString("base64");
const postgresFixtureUrl = (): string =>
  [
    "postgresql",
    "://",
    "sites_cms_app.abcdefghijklmnopqrst",
    ":",
    "fixture",
    "@",
    "aws-0-us-east-2.pooler.supabase.com",
    ":6543/postgres?sslmode=require",
  ].join("");

const fixtureEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: postgresFixtureUrl(),
  PAYLOAD_SECRET: fixtureKey("A"),
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
  SITES_PREVIEW_SIGNING_SECRET: fixtureKey("A"),
  MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-core-current",
  MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: fixtureKey("B"),
  MINGLA_CORE_TO_CMS_CURRENT_KID: "core-cms-current",
  MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: fixtureKey("C"),
  SITES_CANDIDATE_PROBE_SECRET: fixtureKey("D"),
  SITES_PUBLIC_RUNTIME_ORIGIN: "https://gogi.sites.usemingla.com",
};

type AdapterView = {
  pool?: unknown;
  schemaName?: string;
  tables: Record<string, PgTable>;
};

/** The columns the installed adapter will select, per upload collection table. */
async function expectedUploadColumns(): Promise<Map<string, string[]>> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(fixtureEnvironment)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    const { default: configPromise } = await import("../payload.config");
    const payload = new BasePayload();
    await payload.init({
      config: configPromise,
      disableDBConnect: true,
      disableOnInit: true,
    });
    const adapter = payload.db as unknown as AdapterView;
    // The fixture URL names no real database; prove nothing dialled it.
    expect(adapter.pool).toBeUndefined();
    expect(adapter.schemaName).toBe("sites_cms");
    const expected = new Map<string, string[]>();
    for (const collection of payload.config.collections) {
      if (!collection.upload) continue;
      const table = adapter.tables[collection.slug.replace(/-/g, "_")];
      if (!table) throw new Error(`No table for upload collection ${collection.slug}`);
      expected.set(
        getTableName(table),
        Object.values(getTableColumns(table)).map((column) => column.name),
      );
    }
    return expected;
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function sqlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(sqlText).join("");
  if (value && typeof value === "object") {
    const node = value as { queryChunks?: unknown; value?: unknown };
    if (node.queryChunks !== undefined) return sqlText(node.queryChunks);
    if (node.value !== undefined) return sqlText(node.value);
  }
  throw new Error("A migration used a SQL fragment this test cannot read.");
}

/** Every registered migration's `up`, run in order against a recorder. */
async function migratedSql(): Promise<string> {
  const { migrations } = await import("../migrations");
  const statements: string[] = [];
  const recorder = {
    execute: async (query: unknown) => {
      statements.push(sqlText(query));
      return { rows: [] };
    },
  };
  for (const migration of migrations) {
    await migration.up({ db: recorder, payload: {}, req: {} } as never);
  }
  return statements.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Columns a table has once every recorded statement has run. */
function createdColumns(sql: string, table: string): Set<string> {
  const qualified = `"sites_cms"\\."${escapeRegExp(table)}"`;
  const columns = new Set<string>();
  const create = sql.match(
    new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${qualified} \\(([\\s\\S]*?)\\n\\s*\\);`),
  );
  if (create) {
    for (const line of create[1].split("\n")) {
      const column = line.match(/^\s*"([^"]+)"\s/);
      if (column) columns.add(column[1]);
    }
  }
  const alter = new RegExp(
    `ALTER TABLE ${qualified} (ADD|DROP) COLUMN(?: IF (?:NOT )?EXISTS)? "([^"]+)"`,
    "g",
  );
  for (const match of sql.matchAll(alter)) {
    if (match[1] === "ADD") columns.add(match[2]);
    else columns.delete(match[2]);
  }
  return columns;
}

describe("#2830 upload collection columns are migrated", () => {
  it("creates every column the adapter selects from an upload collection", async () => {
    const expected = await expectedUploadColumns();
    const sql = await migratedSql();

    expect([...expected.keys()]).toEqual(["media"]);
    for (const [table, columns] of expected) {
      const created = createdColumns(sql, table);
      // A recorder that read nothing would make the next line pass for free.
      expect(created.size).toBeGreaterThan(20);
      expect(columns.filter((column) => !created.has(column))).toEqual([]);
    }
  }, 60_000);

  it("names the storage key column exactly as the adapter does", async () => {
    const expected = await expectedUploadColumns();
    // `_objectKey` snake-cases to `_objectkey`, not `_object_key`.
    expect(expected.get("media")).toContain("_objectkey");
    expect(expected.get("media")).not.toContain("_object_key");
    expect(createdColumns(await migratedSql(), "media").has("_objectkey")).toBe(true);
  }, 60_000);
});
