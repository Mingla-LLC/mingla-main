import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export const POSTGRES_WAVE = "phase3e-postgres-fold-wave";
export const POSTGRES_CLASS_PREFIX = "postgres17-";
export const POSTGRES_CHILD_ENV_NAMES = new Set(["PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"]);

export function isPostgresBatchSuite(suite) {
  return suite?.migrationWave === POSTGRES_WAVE && typeof suite?.databaseName === "string";
}

export function postgresDatabaseName(suiteId) {
  const readable = suiteId.replace(/^issue-/, "i_").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
  const suffix = crypto.createHash("sha256").update(suiteId).digest("hex").slice(0, 10);
  return `suite_${readable.slice(0, 44)}_${suffix}`;
}

export function postgresAdditionalDatabaseName(suiteId, alias) {
  return postgresDatabaseName(`${suiteId}-${alias}`);
}

export function postgresEvidencePath(klass, tempRoot = process.env.RUNNER_TEMP || os.tmpdir()) {
  return path.join(tempRoot, `ci-batch-postgres-${klass}.json`);
}
