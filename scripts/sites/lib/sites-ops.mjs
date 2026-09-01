import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";

export const SITES_BUCKETS = Object.freeze([
  "sites-media-quarantine",
  "sites-media-approved",
  "sites-publication-artifacts",
  "sites-media-recovery",
]);

export const BUCKET_PREFIXES = Object.freeze({
  "sites-media-quarantine": "quarantine",
  "sites-media-approved": "approved",
  "sites-publication-artifacts": "publications",
  "sites-media-recovery": "recovery",
});

export const BUNDLE_MAGIC = Buffer.from("MINGLA-SITES-AES256GCM-V1\n", "utf8");
export const PLAINTEXT_MAGIC = Buffer.from("MINGLA-SITES-BACKUP-V1\n", "utf8");
export const MAX_BACKUP_AGE_MS = 26 * 60 * 60 * 1000;
export const MAX_RESTORE_AGE_MS = 100 * 24 * 60 * 60 * 1000;
export const REQUIRED_BACKUP_RETENTION_DAYS = 7;

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const KID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export class SitesOpsError extends Error {
  constructor(code) {
    super(code);
    this.name = "SitesOpsError";
    this.code = code;
  }
}

export function fail(code) {
  throw new SitesOpsError(code);
}

export function requiredEnv(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    fail(`MISSING_${name}`);
  }
  return value;
}

export function requireUuid(value, code = "INVALID_SITE_ID") {
  if (typeof value !== "string" || !UUID_RE.test(value)) fail(code);
  return value.toLowerCase();
}

export function requireSha256(value, code = "INVALID_DIGEST") {
  if (typeof value !== "string" || !SHA256_RE.test(value)) fail(code);
  return value;
}

export function requireHttpsOrigin(value, code = "INVALID_HTTPS_ORIGIN") {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(code);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    fail(code);
  }
  return url.origin;
}

export function postgresEnvFromUrl(value, baseEnv = process.env) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("INVALID_DATABASE_URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname || url.hash ||
    !/^\/[A-Za-z0-9_.-]+$/.test(url.pathname)
  ) fail("INVALID_DATABASE_URL");
  for (const key of url.searchParams.keys()) {
    if (key !== "sslmode") fail("INVALID_DATABASE_URL");
  }
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode && !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(sslmode)) {
    fail("INVALID_DATABASE_URL");
  }
  const env = {
    ...baseEnv,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

export function validateCmsDatabaseUrl(env) {
  const projectRef = requiredEnv(env, "SITES_CMS_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) fail("INVALID_PROJECT_REF");
  const raw = requiredEnv(env, "SITES_CMS_DATABASE_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("INVALID_CMS_DATABASE_URL");
  }
  const isDirect =
    decodeURIComponent(url.username) === "sites_cms_migrator" &&
    url.hostname === `db.${projectRef}.supabase.co` &&
    url.port === "5432";
  const isSessionPooler =
    decodeURIComponent(url.username) === `sites_cms_migrator.${projectRef}` &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.port === "5432";
  if (
    url.protocol !== "postgresql:" ||
    (!isDirect && !isSessionPooler) ||
    decodeURIComponent(url.password).length < 32 ||
    url.pathname !== "/postgres" ||
    url.hash || url.searchParams.size !== 1 ||
    url.searchParams.get("sslmode") !== "require"
  ) fail("INVALID_CMS_DATABASE_URL");
  return raw;
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) fail(code);
}

export function validateManagementProjectResponse(value, expectedRef, now = new Date()) {
  const currentIdentityShape = value && typeof value === "object" &&
    (Object.hasOwn(value, "id") || Object.hasOwn(value, "organization_id"));
  exactKeys(
    value,
    currentIdentityShape
      ? [
        "created_at", "database", "id", "name", "organization_id",
        "organization_slug", "ref", "region", "status",
      ]
      : ["created_at", "database", "name", "organization_slug", "ref", "region", "status"],
    "PROJECT_RESPONSE_SCHEMA_INVALID",
  );
  exactKeys(
    value.database,
    ["host", "postgres_engine", "release_channel", "version"],
    "PROJECT_RESPONSE_SCHEMA_INVALID",
  );
  const created = Date.parse(value.created_at);
  if (
    typeof expectedRef !== "string" || value.ref !== expectedRef ||
    (currentIdentityShape && value.id !== expectedRef) ||
    (currentIdentityShape && value.organization_id !== "mrcqqkovdchaltvquggd") ||
    value.organization_slug !== "mrcqqkovdchaltvquggd" ||
    value.name !== "mingla-sites-cms-prod" ||
    value.region !== "us-east-2" ||
    value.status !== "ACTIVE_HEALTHY" ||
    !Number.isFinite(created) || created > now.getTime() + 5 * 60 * 1000 ||
    value.database.host !== `db.${expectedRef}.supabase.co` ||
    typeof value.database.version !== "string" ||
    !/^17\./.test(value.database.version) ||
    value.database.postgres_engine !== "17" ||
    value.database.release_channel !== "ga"
  ) fail("PROJECT_RESPONSE_SCHEMA_INVALID");
  return {
    created_at: new Date(created).toISOString(),
    age_ms: Math.max(0, now.getTime() - created),
    region: value.region,
  };
}

export function validateManagementBackupResponse(value, {
  now = new Date(),
  projectCreatedAt,
} = {}) {
  exactKeys(
    value,
    ["backups", "physical_backup_data", "pitr_enabled", "region", "walg_enabled"],
    "BACKUP_RESPONSE_SCHEMA_INVALID",
  );
  if (
    typeof value.region !== "string" ||
    typeof value.walg_enabled !== "boolean" ||
    typeof value.pitr_enabled !== "boolean" ||
    !Array.isArray(value.backups)
  ) fail("BACKUP_RESPONSE_SCHEMA_INVALID");
  const projectCreated = Date.parse(projectCreatedAt);
  if (
    !Number.isFinite(projectCreated) ||
    projectCreated > now.getTime() + 5 * 60 * 1000
  ) fail("PROJECT_RESPONSE_SCHEMA_INVALID");
  if (value.walg_enabled !== true) fail("DATABASE_BACKUP_WALG_DISABLED");
  // #2948 — "there is no PITR window" has TWO wire shapes, not one. The
  // Management API returns `null` on some projects and `{}` on others, and the
  // Sites CMS project returns `{}`:
  //   {"backups":[...],"physical_backup_data":{},"pitr_enabled":false,...}
  // Only `null` was handled, so `{}` fell into the populated branch and
  // `exactKeys` rejected it — the whole reason `Private backup and isolated
  // restore` has never been green on `main`. Same bug class as #2944 one
  // function above: an exact-key contract against a third party's response.
  // The refusal is preserved everywhere it means something: a non-empty window
  // still has to carry exactly the two documented keys, a non-object is still
  // rejected by `exactKeys`, and claiming `pitr_enabled: true` with no window
  // is still incoherent and still fails.
  const physicalWindow = value.physical_backup_data;
  const windowAbsent = physicalWindow === null ||
    (typeof physicalWindow === "object" &&
      !Array.isArray(physicalWindow) &&
      Object.keys(physicalWindow).length === 0);
  if (windowAbsent) {
    if (value.pitr_enabled !== false) fail("BACKUP_RESPONSE_SCHEMA_INVALID");
  } else if (
    value.physical_backup_data &&
    typeof value.physical_backup_data === "object" &&
    !Array.isArray(value.physical_backup_data) &&
    Object.keys(value.physical_backup_data).length === 0
  ) {
    if (value.pitr_enabled !== false) fail("BACKUP_RESPONSE_SCHEMA_INVALID");
  } else {
    exactKeys(
      physicalWindow,
      ["earliest_physical_backup_date_unix", "latest_physical_backup_date_unix"],
      "BACKUP_RESPONSE_SCHEMA_INVALID",
    );
    if (
      !Number.isSafeInteger(physicalWindow.earliest_physical_backup_date_unix) ||
      !Number.isSafeInteger(physicalWindow.latest_physical_backup_date_unix)
    ) fail("BACKUP_RESPONSE_SCHEMA_INVALID");
  }

  const observed = value.backups.map((backup) => {
    exactKeys(
      backup,
      ["id", "inserted_at", "is_physical_backup", "status"],
      "BACKUP_RESPONSE_SCHEMA_INVALID",
    );
    const inserted = Date.parse(backup.inserted_at);
    if (
      !(typeof backup.id === "number" || typeof backup.id === "string") ||
      typeof backup.is_physical_backup !== "boolean" ||
      !["COMPLETED", "FAILED", "PENDING"].includes(backup.status) ||
      !Number.isFinite(inserted)
    ) fail("BACKUP_RESPONSE_SCHEMA_INVALID");
    return { ...backup, inserted };
  }).sort((left, right) => right.inserted - left.inserted);

  const completed = observed.filter((backup) => backup.status === "COMPLETED");
  const latestCompleted = completed[0] ?? null;
  const currentFailure = observed.find((backup) =>
    backup.status === "FAILED" &&
    (latestCompleted === null || backup.inserted >= latestCompleted.inserted));
  if (currentFailure) fail("DATABASE_BACKUP_CURRENT_FAILED");

  const projectAge = now.getTime() - projectCreated;
  if (completed.length === 0) {
    if (observed.length === 0 && projectAge < MAX_BACKUP_AGE_MS) {
      return {
        inserted_at: null,
        retention_days: REQUIRED_BACKUP_RETENTION_DAYS,
        region: value.region,
        state: "pending_first_backup",
      };
    }
    fail("DATABASE_BACKUP_MISSING");
  }

  const current = latestCompleted;
  const age = now.getTime() - current.inserted;
  if (age < -5 * 60 * 1000 || age > MAX_BACKUP_AGE_MS) {
    fail("DATABASE_BACKUP_STALE");
  }
  if (projectAge >= REQUIRED_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
    const distinctDays = new Set(
      completed.map((backup) => new Date(backup.inserted).toISOString().slice(0, 10)),
    );
    const oldest = completed.at(-1)?.inserted ?? current.inserted;
    if (
      distinctDays.size < REQUIRED_BACKUP_RETENTION_DAYS ||
      current.inserted - oldest <
        (REQUIRED_BACKUP_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000
    ) fail("DATABASE_BACKUP_RETENTION_UNPROVEN");
  }
  return {
    inserted_at: new Date(current.inserted).toISOString(),
    retention_days: REQUIRED_BACKUP_RETENTION_DAYS,
    region: value.region,
    state: projectAge >= REQUIRED_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
      ? "retention_proven"
      : "current",
  };
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(entries) {
  return [...entries]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function timestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secret, date, region) {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(date).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

export function storageConfigFromEnv(env) {
  const endpointValue = requiredEnv(env, "SUPABASE_S3_ENDPOINT");
  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    fail("INVALID_S3_ENDPOINT");
  }
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash || endpoint.pathname !== "/storage/v1/s3"
  ) fail("INVALID_S3_ENDPOINT");
  const projectRef = requiredEnv(env, "SITES_CMS_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) fail("INVALID_PROJECT_REF");
  if (endpoint.hostname !== `${projectRef}.storage.supabase.co`) {
    fail("S3_PROJECT_MISMATCH");
  }
  const region = requiredEnv(env, "SUPABASE_S3_REGION");
  if (region !== "us-east-2") fail("INVALID_S3_REGION");
  return {
    endpoint: endpoint.origin + endpoint.pathname,
    region,
    accessKeyId: requiredEnv(env, "SUPABASE_S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv(env, "SUPABASE_S3_SECRET_ACCESS_KEY"),
  };
}

export async function signedS3Request(
  config,
  { method, bucket, key = "", query = [], fetchImpl = fetch, now = new Date() },
) {
  if (!SITES_BUCKETS.includes(bucket)) fail("UNEXPECTED_BUCKET");
  const encodedKey = key.split("/").filter(Boolean).map(awsEncode).join("/");
  const url = new URL(
    `${config.endpoint}/${awsEncode(bucket)}${encodedKey ? `/${encodedKey}` : ""}`,
  );
  const queryString = canonicalQuery(query);
  if (queryString) url.search = queryString;
  const stamp = timestamp(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const headers = {
    host: url.host,
    "x-amz-content-sha256": EMPTY_SHA256,
    "x-amz-date": stamp,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort()
    .map((name) => `${name}:${headers[name]}\n`).join("");
  const canonical = [
    method,
    url.pathname,
    queryString,
    canonicalHeaders,
    signedHeaders,
    EMPTY_SHA256,
  ].join("\n");
  const toSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256Bytes(Buffer.from(canonical)),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(config.secretAccessKey, date, config.region),
  ).update(toSign).digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetchImpl(url, {
    method,
    headers: {
      authorization,
      "x-amz-content-sha256": EMPTY_SHA256,
      "x-amz-date": stamp,
    },
  });
}

function decodeXml(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlText(body, name, required = true) {
  const match = body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!match) {
    if (required) fail("S3_LIST_SCHEMA_INVALID");
    return null;
  }
  return decodeXml(match[1]);
}

export function parseS3List(body) {
  const objects = [];
  for (const match of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const value = match[1];
    const key = xmlText(value, "Key");
    const bytes = Number(xmlText(value, "Size"));
    const etag = xmlText(value, "ETag").replace(/^&quot;|&quot;$/g, "")
      .replace(/^"|"$/g, "");
    const lastModified = xmlText(value, "LastModified");
    if (
      !Number.isSafeInteger(bytes) || bytes < 0 ||
      !key || key.startsWith("/") || key.includes("..") ||
      !Number.isFinite(Date.parse(lastModified))
    ) fail("S3_LIST_SCHEMA_INVALID");
    objects.push({ key, bytes, etag, last_modified: new Date(lastModified).toISOString() });
  }
  const truncated = xmlText(body, "IsTruncated") === "true";
  const next = xmlText(body, "NextContinuationToken", false);
  if (truncated && !next) fail("S3_LIST_SCHEMA_INVALID");
  return { objects, next: truncated ? next : null };
}

export async function listBucket(config, bucket, fetchImpl = fetch) {
  const objects = [];
  let continuation = null;
  do {
    const query = [["list-type", "2"], ["max-keys", "1000"]];
    if (continuation) query.push(["continuation-token", continuation]);
    const response = await signedS3Request(config, {
      method: "GET", bucket, query, fetchImpl,
    });
    if (!response.ok) fail("S3_LIST_FAILED");
    const page = parseS3List(await response.text());
    objects.push(...page.objects);
    continuation = page.next;
  } while (continuation);
  objects.sort((left, right) => left.key.localeCompare(right.key));
  return objects;
}

export async function getObject(config, bucket, key, fetchImpl = fetch) {
  const response = await signedS3Request(config, {
    method: "GET", bucket, key, fetchImpl,
  });
  if (!response.ok) fail("S3_OBJECT_READ_FAILED");
  return Buffer.from(await response.arrayBuffer());
}

function canonicalCoreEnvelope(value) {
  return [
    value.schema_version,
    value.issuer,
    value.audience,
    value.direction,
    value.site_id,
    value.operation_id,
    value.issued_at,
    value.expires_at,
    value.nonce,
    value.method,
    value.path,
    value.body_sha256,
    value.kid,
  ].join("\n");
}

export function coreConfigFromEnv(env) {
  const kid = requiredEnv(env, "MINGLA_CMS_TO_CORE_CURRENT_KID");
  if (!KID_RE.test(kid)) fail("INVALID_CORE_KEY_ID");
  const key = Buffer.from(requiredEnv(env, "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64"), "base64");
  if (key.byteLength < 32) fail("INVALID_CORE_KEY");
  return {
    baseUrl: requireHttpsOrigin(requiredEnv(env, "SITES_CORE_BASE_URL"), "INVALID_CORE_ORIGIN"),
    kid,
    key,
  };
}

export function signCoreRequest(config, {
  siteId,
  operationId = randomUUID(),
  method,
  path,
  body = "",
  now = new Date(),
  nonce = randomUUID(),
}) {
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-site-cms",
    audience: "mingla-core",
    direction: "cms_to_core",
    site_id: requireUuid(siteId),
    operation_id: requireUuid(operationId, "INVALID_OPERATION_ID"),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    nonce: requireUuid(nonce, "INVALID_NONCE"),
    method: method.toUpperCase(),
    path,
    body_sha256: sha256Bytes(Buffer.from(body)),
    kid: config.kid,
  };
  return {
    ...unsigned,
    signature_b64: createHmac("sha256", config.key)
      .update(canonicalCoreEnvelope(unsigned)).digest("base64"),
  };
}

export async function callCore(config, {
  siteId,
  operationId,
  method,
  path,
  payload,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const body = payload === undefined ? "" : stableJson(payload);
  const envelope = signCoreRequest(config, {
    siteId, operationId, method, path, body, now,
  });
  const response = await fetchImpl(
    `${config.baseUrl}/functions/v1/brand-site-cms-callback${path}`,
    {
      method,
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        "x-mingla-sites-envelope": Buffer.from(JSON.stringify(envelope)).toString("base64"),
      },
      ...(payload === undefined ? {} : { body }),
    },
  );
  const value = await response.json().catch(() => null);
  if (!response.ok || !value?.ok || !value.data) fail("CORE_REQUEST_FAILED");
  return value.data;
}

export function validateProtectionResponse(value, siteId) {
  exactKeys(value, ["protected_artifact_keys"], "CORE_PROTECTION_SCHEMA_INVALID");
  if (!Array.isArray(value.protected_artifact_keys)) {
    fail("CORE_PROTECTION_SCHEMA_INVALID");
  }
  const prefix = `publications/${requireUuid(siteId)}/`;
  const keys = value.protected_artifact_keys.map((key) => {
    if (
      typeof key !== "string" || !key.startsWith(prefix) ||
      !/^publications\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.json$/i.test(key)
    ) fail("CORE_PROTECTION_SCHEMA_INVALID");
    return key;
  });
  if (new Set(keys).size !== keys.length) fail("CORE_PROTECTION_SCHEMA_INVALID");
  return new Set(keys);
}

export function validateReadinessResponse(value, siteId, evidenceKind) {
  exactKeys(
    value,
    ["accepted_at", "evidence_kind", "readiness", "site_id"],
    "CORE_READINESS_SCHEMA_INVALID",
  );
  if (
    value.site_id !== requireUuid(siteId) ||
    value.evidence_kind !== evidenceKind ||
    !Number.isFinite(Date.parse(value.accepted_at))
  ) fail("CORE_READINESS_SCHEMA_INVALID");
  exactKeys(value.readiness, [
    "backup_retention_days",
    "database_backup_verified_at",
    "object_manifest_verified_at",
    "restore_drill_evidence_digest",
    "restore_drill_verified_at",
  ], "CORE_READINESS_SCHEMA_INVALID");
  const readiness = value.readiness;
  for (const name of [
    "database_backup_verified_at",
    "object_manifest_verified_at",
    "restore_drill_verified_at",
  ]) {
    if (readiness[name] !== null && !Number.isFinite(Date.parse(readiness[name]))) {
      fail("CORE_READINESS_SCHEMA_INVALID");
    }
  }
  if (
    readiness.backup_retention_days !== null &&
    (!Number.isSafeInteger(readiness.backup_retention_days) || readiness.backup_retention_days < 7)
  ) fail("CORE_READINESS_SCHEMA_INVALID");
  if (
    readiness.restore_drill_evidence_digest !== null &&
    !SHA256_RE.test(readiness.restore_drill_evidence_digest)
  ) fail("CORE_READINESS_SCHEMA_INVALID");
  return value;
}

export function validatePilotDeactivationResponse(value, siteId) {
  exactKeys(value, [
    "deactivated_at", "hostname", "last_good_preserved", "site_id", "status",
  ], "CORE_DEACTIVATION_SCHEMA_INVALID");
  if (
    value.site_id !== requireUuid(siteId) ||
    value.hostname !== "gogi.sites.usemingla.com" ||
    value.status !== "disabled" ||
    value.last_good_preserved !== true ||
    !Number.isFinite(Date.parse(value.deactivated_at))
  ) fail("CORE_DEACTIVATION_SCHEMA_INVALID");
  return value;
}

export function validateObjectIdentity(bucket, key, siteId, tenantId = null) {
  if (!SITES_BUCKETS.includes(bucket)) fail("UNEXPECTED_BUCKET");
  const exactSiteId = requireUuid(siteId);
  if (bucket === "sites-media-recovery") {
    const exactTenantId = requireUuid(tenantId, "INVALID_TENANT_ID");
    const recoveryPattern = new RegExp(
      `^recovery/${exactTenantId}/${exactSiteId}/` +
      "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/" +
      "[0-9a-f]{64}/(master|320|640|960|1440|1920)\\.webp$",
      "i",
    );
    if (
      typeof key !== "string" || key.startsWith("/") || key.includes("..") ||
      !recoveryPattern.test(key)
    ) fail("OBJECT_TENANT_SITE_PREFIX_MISMATCH");
    return;
  }
  const prefix = `${BUCKET_PREFIXES[bucket]}/${exactSiteId}/`;
  if (!key.startsWith(prefix) || key.startsWith("/") || key.includes("..")) {
    fail("OBJECT_SITE_PREFIX_MISMATCH");
  }
}

export function validateManifest(manifest, now = new Date()) {
  exactKeys(manifest, [
    "backup", "counts", "database", "generated_at", "objects", "schema_version", "site_id",
    "tenant_id",
  ], "MANIFEST_SCHEMA_INVALID");
  if (manifest.schema_version !== 1) fail("MANIFEST_SCHEMA_INVALID");
  requireUuid(manifest.site_id);
  requireUuid(manifest.tenant_id, "INVALID_TENANT_ID");
  const generated = Date.parse(manifest.generated_at);
  if (!Number.isFinite(generated) || generated > now.getTime() + 5 * 60 * 1000) {
    fail("MANIFEST_SCHEMA_INVALID");
  }
  exactKeys(manifest.database, ["bytes", "format", "sha256"], "MANIFEST_SCHEMA_INVALID");
  if (
    manifest.database.format !== "pg_dump-custom" ||
    !Number.isSafeInteger(manifest.database.bytes) || manifest.database.bytes < 1
  ) fail("MANIFEST_SCHEMA_INVALID");
  requireSha256(manifest.database.sha256, "MANIFEST_SCHEMA_INVALID");
  exactKeys(manifest.backup, [
    "database_backup_verified_at", "management_observed_at", "retention_days",
  ], "MANIFEST_SCHEMA_INVALID");
  const databaseVerified = Date.parse(manifest.backup.database_backup_verified_at);
  const managementObserved = Date.parse(manifest.backup.management_observed_at);
  if (
    manifest.backup.retention_days < REQUIRED_BACKUP_RETENTION_DAYS ||
    !Number.isFinite(databaseVerified) ||
    databaseVerified > now.getTime() + 5 * 60 * 1000 ||
    now.getTime() - databaseVerified > MAX_BACKUP_AGE_MS ||
    !Number.isFinite(managementObserved) ||
    managementObserved > now.getTime() + 5 * 60 * 1000
  ) fail("DATABASE_BACKUP_STALE");
  exactKeys(manifest.counts, [
    "documents", "object_bytes", "objects", "tenants",
  ], "MANIFEST_SCHEMA_INVALID");
  for (const value of Object.values(manifest.counts)) {
    if (!Number.isSafeInteger(value) || value < 0) fail("MANIFEST_SCHEMA_INVALID");
  }
  if (!Array.isArray(manifest.objects) || manifest.objects.length !== manifest.counts.objects) {
    fail("MANIFEST_MISMATCH");
  }
  let objectBytes = 0;
  const identities = new Set();
  for (const object of manifest.objects) {
    exactKeys(object, [
      "bucket", "bytes", "key", "protected", "reference_state", "sha256", "site_id",
    ], "MANIFEST_SCHEMA_INVALID");
    if (object.site_id !== manifest.site_id) fail("OBJECT_SITE_PREFIX_MISMATCH");
    validateObjectIdentity(
      object.bucket,
      object.key,
      manifest.site_id,
      manifest.tenant_id,
    );
    if (
      !Number.isSafeInteger(object.bytes) || object.bytes < 0 ||
      typeof object.protected !== "boolean" ||
      typeof object.reference_state !== "string" || object.reference_state.length > 80
    ) fail("MANIFEST_SCHEMA_INVALID");
    requireSha256(object.sha256, "MANIFEST_SCHEMA_INVALID");
    const identity = `${object.bucket}/${object.key}`;
    if (identities.has(identity)) fail("MANIFEST_MISMATCH");
    identities.add(identity);
    objectBytes += object.bytes;
  }
  if (objectBytes !== manifest.counts.object_bytes) fail("MANIFEST_MISMATCH");
  return manifest;
}

export function encryptionKeyFromEnv(env) {
  const encoded = requiredEnv(env, "SITES_BACKUP_ENCRYPTION_KEY_B64");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    fail("INVALID_BACKUP_ENCRYPTION_KEY");
  }
  return key;
}

export async function encryptBundle(plaintextPath, outputPath, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(BUNDLE_MAGIC);
  writeFileSync(outputPath, Buffer.concat([BUNDLE_MAGIC, iv]), { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(plaintextPath), cipher, createWriteStream(outputPath, { flags: "a" }));
  appendFileSync(outputPath, cipher.getAuthTag());
  chmodSync(outputPath, 0o600);
  return { bytes: statSync(outputPath).size, sha256: sha256File(outputPath) };
}

export async function decryptBundle(bundlePath, plaintextPath, key) {
  const encrypted = readFileSync(bundlePath);
  if (
    encrypted.byteLength <= BUNDLE_MAGIC.byteLength + 12 + 16 ||
    !encrypted.subarray(0, BUNDLE_MAGIC.byteLength).equals(BUNDLE_MAGIC)
  ) fail("BACKUP_ARCHIVE_PLAINTEXT_OR_INVALID");
  const ivStart = BUNDLE_MAGIC.byteLength;
  const cipherStart = ivStart + 12;
  const tagStart = encrypted.byteLength - 16;
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(ivStart, cipherStart));
  decipher.setAAD(BUNDLE_MAGIC);
  decipher.setAuthTag(encrypted.subarray(tagStart));
  let plaintext;
  try {
    plaintext = Buffer.concat([
      decipher.update(encrypted.subarray(cipherStart, tagStart)),
      decipher.final(),
    ]);
  } catch {
    fail("BACKUP_DECRYPTION_FAILED");
  }
  writeFileSync(plaintextPath, plaintext, { flag: "wx", mode: 0o600 });
}

export async function writePlainBundle(path, manifest, databasePath, objects) {
  const manifestBytes = Buffer.from(stableJson(manifest), "utf8");
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(manifestBytes.byteLength));
  writeFileSync(path, Buffer.concat([PLAINTEXT_MAGIC, size, manifestBytes]), {
    flag: "wx",
    mode: 0o600,
  });
  for (const source of [databasePath, ...objects.map((object) => object.path)]) {
    await pipeline(createReadStream(source), createWriteStream(path, { flags: "a" }));
  }
  chmodSync(path, 0o600);
}

export function extractPlainBundle(path, outputDirectory, now = new Date()) {
  mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
  const descriptor = openSync(path, "r");
  let cursor = 0;
  try {
    const magic = Buffer.alloc(PLAINTEXT_MAGIC.byteLength);
    if (readSync(descriptor, magic, 0, magic.byteLength, cursor) !== magic.byteLength ||
      !magic.equals(PLAINTEXT_MAGIC)) fail("BACKUP_PLAINTEXT_SCHEMA_INVALID");
    cursor += magic.byteLength;
    const size = Buffer.alloc(8);
    if (readSync(descriptor, size, 0, size.byteLength, cursor) !== size.byteLength) {
      fail("BACKUP_PLAINTEXT_SCHEMA_INVALID");
    }
    cursor += size.byteLength;
    const manifestSize = Number(size.readBigUInt64BE());
    if (!Number.isSafeInteger(manifestSize) || manifestSize < 2 || manifestSize > 64 * 1024 * 1024) {
      fail("BACKUP_PLAINTEXT_SCHEMA_INVALID");
    }
    const manifestBytes = Buffer.alloc(manifestSize);
    if (readSync(descriptor, manifestBytes, 0, manifestSize, cursor) !== manifestSize) {
      fail("BACKUP_PLAINTEXT_SCHEMA_INVALID");
    }
    cursor += manifestSize;
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      fail("BACKUP_PLAINTEXT_SCHEMA_INVALID");
    }
    validateManifest(manifest, now);
    const expectedSize = cursor + manifest.database.bytes +
      manifest.objects.reduce((total, object) => total + object.bytes, 0);
    if (statSync(path).size !== expectedSize) fail("BACKUP_PLAINTEXT_LENGTH_MISMATCH");
    const databasePath = `${outputDirectory}/database.dump`;
    const databaseEnd = cursor + manifest.database.bytes - 1;
    const database = Buffer.alloc(manifest.database.bytes);
    if (readSync(descriptor, database, 0, database.byteLength, cursor) !== database.byteLength) {
      fail("BACKUP_PLAINTEXT_LENGTH_MISMATCH");
    }
    if (sha256Bytes(database) !== manifest.database.sha256) fail("DATABASE_DUMP_DIGEST_MISMATCH");
    writeFileSync(databasePath, database, { flag: "wx", mode: 0o600 });
    cursor = databaseEnd + 1;
    const extractedObjects = [];
    for (let index = 0; index < manifest.objects.length; index += 1) {
      const object = manifest.objects[index];
      const bytes = Buffer.alloc(object.bytes);
      if (readSync(descriptor, bytes, 0, bytes.byteLength, cursor) !== bytes.byteLength) {
        fail("BACKUP_PLAINTEXT_LENGTH_MISMATCH");
      }
      if (sha256Bytes(bytes) !== object.sha256) fail("OBJECT_DIGEST_MISMATCH");
      const objectPath = `${outputDirectory}/object-${String(index).padStart(8, "0")}.bin`;
      writeFileSync(objectPath, bytes, { flag: "wx", mode: 0o600 });
      extractedObjects.push({ ...object, path: objectPath });
      cursor += object.bytes;
    }
    return { manifest, databasePath, objects: extractedObjects };
  } finally {
    closeSync(descriptor);
  }
}

export function writeSafeResult(path, value) {
  writeFileSync(path, `${stableJson(value)}\n`, { flag: "wx", mode: 0o600 });
}

export function safeCliFailure(error) {
  const code = error instanceof SitesOpsError ? error.code : "UNEXPECTED_FAILURE";
  process.stderr.write(`SITES_OPS_ERROR code=${code}\n`);
  process.exitCode = 1;
}
