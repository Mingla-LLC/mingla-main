import {
  isLoopbackHost,
  localModeEnabled,
  localRuntimeOrigin,
  loopbackOrigin,
} from "./localMode";

import { MINGLA_BUSINESS_ORIGIN } from "./origins";

const GOOGLE_FONTS = { cssOrigin: "https://fonts.googleapis.com", fileHost: "fonts.gstatic.com" } as const;

export type CmsConfig = {
  /** #2829 — "local" only when every local-mode signal agrees (localMode.ts). */
  mode: "production" | "local";
  databaseUrl: string;
  databasePoolMax: number;
  payloadSecret: string;
  coreBaseUrl: string;
  cmsOrigin: string;
  storageEndpoint: string;
  storageRegion: string;
  storageAccessKeyId: string;
  storageSecretAccessKey: string;
  quarantineBucket: string;
  approvedBucket: string;
  /**
   * #2829 AD-3 — the one external service the builder calls: Google Fonts
   * (CSS from this origin, files from its static host). Fixed, never from env.
   */
  googleFonts: { cssOrigin: "https://fonts.googleapis.com"; fileHost: "fonts.gstatic.com" };
  artifactBucket: string;
  recoveryBucket: string;
  previewSecret: string;
  cmsToCoreCurrent: string;
  coreToCmsCurrent: string;
  coreToCmsPrevious: string | null;
  cmsToCoreCurrentKeyId: string;
  coreToCmsCurrentKeyId: string;
  coreToCmsPreviousKeyId: string | null;
  candidateProbeSecret: string;
  publicRuntimeOrigin: string;
  /**
   * #2829 W9f — where Studio sends the owner back ("Return to Mingla", the
   * preview's close and publish links, expired-session pages). Production is
   * always Business web; local mode is the local Business web (loopback).
   */
  businessOrigin: string;
};

/** #2829 W9f — the local Business web origin (run-business-web.sh default). */
export const LOCAL_BUSINESS_ORIGIN_DEFAULT = "http://localhost:8190";

let cached: CmsConfig | undefined;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function origin(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(`Invalid server origin: ${name}`);
  return parsed.origin;
}

function productionOrigin(
  env: NodeJS.ProcessEnv,
  name: string,
  expected: string,
): string {
  const value = origin(env, name);
  if (env.NODE_ENV === "production" && value !== expected) {
    throw new Error(`Invalid production origin: ${name}`);
  }
  return value;
}

function exactBucket(
  env: NodeJS.ProcessEnv,
  name: string,
  expected: string,
): string {
  const value = required(env, name);
  if (value !== expected) throw new Error(`Invalid Sites bucket: ${name}`);
  return value;
}

// #2829 — local mode: the CMS database is the local Sites CMS stack on
// loopback, reached as the same least-privilege roles production uses. TLS is
// off only here, and only because the host is loopback.
function localDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = required(env, "DATABASE_URL");
  const parsed = new URL(value);
  const connectionMode = env.SITES_DATABASE_CONNECTION_MODE || "runtime";
  const expectedUser = connectionMode === "migration"
    ? "sites_cms_migrator"
    : connectionMode === "runtime" ? "sites_cms_app" : null;
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    expectedUser === null ||
    decodeURIComponent(parsed.username) !== expectedUser ||
    !isLoopbackHost(parsed.hostname) ||
    !/^[0-9]{2,5}$/.test(parsed.port) ||
    parsed.pathname !== "/postgres" ||
    parsed.hash ||
    [...parsed.searchParams.keys()].some((name) => name !== "sslmode") ||
    (parsed.searchParams.has("sslmode") &&
      parsed.searchParams.get("sslmode") !== "disable")
  ) throw new Error("Invalid local database configuration.");
  return value;
}

function databaseUrl(env: NodeJS.ProcessEnv): string {
  const value = required(env, "DATABASE_URL");
  const parsed = new URL(value);
  const connectionMode = env.SITES_DATABASE_CONNECTION_MODE || "runtime";
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hash
  ) throw new Error("Invalid server database configuration.");
  if (!new Set(["runtime", "migration"]).has(connectionMode)) {
    throw new Error("Invalid server database connection mode.");
  }
  if (connectionMode === "migration") {
    const direct =
      parsed.username === "sites_cms_migrator" &&
      /^db\.[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname) &&
      parsed.port === "5432";
    const sessionPooler =
      /^sites_cms_migrator\.[a-z0-9]{20}$/.test(parsed.username) &&
      /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname) &&
      parsed.port === "5432";
    if (
      (!direct && !sessionPooler) ||
      parsed.searchParams.size !== 1 ||
      parsed.searchParams.get("sslmode") !== "require"
    ) throw new Error("Migration database configuration must use a direct or session-pooler migrator connection.");
    return value;
  }
  if (
    env.NODE_ENV === "production" &&
    (
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname) ||
      parsed.port !== "6543" ||
      !/^sites_cms_app\.[a-z0-9]{20}$/.test(parsed.username) ||
      parsed.searchParams.size !== 1 ||
      parsed.searchParams.get("sslmode") !== "require"
    )
  ) throw new Error("Production database configuration must use the transaction pooler.");
  return value;
}

function databasePoolMax(env: NodeJS.ProcessEnv): number {
  const raw = env.SITES_DATABASE_POOL_MAX || "3";
  if (!/^[1-3]$/.test(raw)) {
    throw new Error("Invalid server configuration: SITES_DATABASE_POOL_MAX");
  }
  return Number(raw);
}

function supabaseS3Endpoint(env: NodeJS.ProcessEnv): string {
  const value = required(env, "SUPABASE_S3_ENDPOINT");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !/^[a-z0-9]{20}\.storage\.supabase\.co$/.test(parsed.hostname) ||
    parsed.pathname !== "/storage/v1/s3" ||
    parsed.search ||
    parsed.hash
  ) throw new Error("Invalid Supabase S3 endpoint.");
  return value;
}

// #2829 — local mode: the local Sites CMS stack's S3 endpoint on loopback.
function localS3Endpoint(env: NodeJS.ProcessEnv): string {
  const value = required(env, "SUPABASE_S3_ENDPOINT");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:" ||
    parsed.username ||
    parsed.password ||
    !isLoopbackHost(parsed.hostname) ||
    !/^[0-9]{2,5}$/.test(parsed.port) ||
    parsed.pathname !== "/storage/v1/s3" ||
    parsed.search ||
    parsed.hash
  ) throw new Error("Invalid local S3 endpoint.");
  return value;
}

function supabaseS3Region(env: NodeJS.ProcessEnv): string {
  const value = required(env, "SUPABASE_S3_REGION");
  if (value !== "us-east-2") throw new Error("Invalid Supabase S3 region.");
  return value;
}

function sitesDatabaseProjectRef(
  env: NodeJS.ProcessEnv,
  value: string,
): string | null {
  const parsed = new URL(value);
  if (env.SITES_DATABASE_CONNECTION_MODE === "migration") {
    return parsed.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1] ??
      parsed.username.match(/^sites_cms_migrator\.([a-z0-9]{20})$/)?.[1] ??
      null;
  }
  return parsed.username.match(/^sites_cms_app\.([a-z0-9]{20})$/)?.[1] ??
    null;
}

function key(value: string, name: string): string {
  if (Buffer.from(value, "base64").byteLength < 32)
    throw new Error(`Invalid server key: ${name}`);
  return value;
}

export function loadCmsConfig(env: NodeJS.ProcessEnv): CmsConfig {
  // #2829 — decide the mode first; a partial local signal throws here.
  if (localModeEnabled(env)) return loadLocalCmsConfig(env);
  const coreToCmsPreviousKeyId =
    env.MINGLA_CORE_TO_CMS_PREVIOUS_KID || null;
  const coreToCmsPrevious =
    env.MINGLA_CORE_TO_CMS_PREVIOUS_KEY_B64 || null;
  if ((coreToCmsPreviousKeyId === null) !== (coreToCmsPrevious === null))
    throw new Error("Previous gateway key slots must be configured together.");
  const configuredDatabaseUrl = databaseUrl(env);
  const configuredStorageEndpoint = supabaseS3Endpoint(env);
  const databaseProjectRef = sitesDatabaseProjectRef(
    env,
    configuredDatabaseUrl,
  );
  const storageProjectRef = new URL(configuredStorageEndpoint).hostname.split(
    ".",
    1,
  )[0];
  if (
    databaseProjectRef !== null &&
    databaseProjectRef !== storageProjectRef
  ) throw new Error("CMS database and object storage must use the same project.");
  const config = {
    mode: "production" as const,
    databaseUrl: configuredDatabaseUrl,
    databasePoolMax: databasePoolMax(env),
    payloadSecret: key(required(env, "PAYLOAD_SECRET"), "PAYLOAD_SECRET"),
    coreBaseUrl: productionOrigin(
      env,
      "SITES_CORE_BASE_URL",
      "https://gqnoajqerqhnvulmnyvv.supabase.co",
    ),
    cmsOrigin: productionOrigin(
      env,
      "SITES_CMS_ORIGIN",
      "https://studio.sites.usemingla.com",
    ),
    storageEndpoint: configuredStorageEndpoint,
    storageRegion: supabaseS3Region(env),
    storageAccessKeyId: required(env, "SUPABASE_S3_ACCESS_KEY_ID"),
    storageSecretAccessKey: required(env, "SUPABASE_S3_SECRET_ACCESS_KEY"),
    quarantineBucket: exactBucket(
      env,
      "SITES_MEDIA_QUARANTINE_BUCKET",
      "sites-media-quarantine",
    ),
    approvedBucket: exactBucket(
      env,
      "SITES_MEDIA_APPROVED_BUCKET",
      "sites-media-approved",
    ),
    googleFonts: GOOGLE_FONTS,
    artifactBucket: exactBucket(
      env,
      "SITES_PUBLICATION_ARTIFACT_BUCKET",
      "sites-publication-artifacts",
    ),
    recoveryBucket: exactBucket(
      env,
      "SITES_MEDIA_RECOVERY_BUCKET",
      "sites-media-recovery",
    ),
    previewSecret: key(
      required(env, "SITES_PREVIEW_SIGNING_SECRET"),
      "SITES_PREVIEW_SIGNING_SECRET",
    ),
    cmsToCoreCurrent: key(
      required(env, "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64"),
      "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64",
    ),
    coreToCmsCurrent: key(
      required(env, "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64"),
      "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64",
    ),
    coreToCmsPrevious: coreToCmsPrevious
      ? key(coreToCmsPrevious, "MINGLA_CORE_TO_CMS_PREVIOUS_KEY_B64")
      : null,
    cmsToCoreCurrentKeyId: required(env, "MINGLA_CMS_TO_CORE_CURRENT_KID"),
    coreToCmsCurrentKeyId: required(env, "MINGLA_CORE_TO_CMS_CURRENT_KID"),
    coreToCmsPreviousKeyId,
    candidateProbeSecret: key(
      required(env, "SITES_CANDIDATE_PROBE_SECRET"),
      "SITES_CANDIDATE_PROBE_SECRET",
    ),
    // #2829 — any https runtime origin (it carries the scheme and port the
    // CMS uses to reach the runtime; each site's host comes from Core).
    publicRuntimeOrigin: origin(env, "SITES_PUBLIC_RUNTIME_ORIGIN"),
    businessOrigin: MINGLA_BUSINESS_ORIGIN,
  };
  for (
    const id of [
      config.cmsToCoreCurrentKeyId,
      config.coreToCmsCurrentKeyId,
      config.coreToCmsPreviousKeyId,
    ].filter(Boolean)
  )
    if (!/^[A-Za-z0-9._-]{8,64}$/.test(id!))
      throw new Error("Invalid gateway key ID.");
  return config;
}

function validateKeyIds(config: CmsConfig): CmsConfig {
  for (
    const id of [
      config.cmsToCoreCurrentKeyId,
      config.coreToCmsCurrentKeyId,
      config.coreToCmsPreviousKeyId,
    ].filter(Boolean)
  )
    if (!/^[A-Za-z0-9._-]{8,64}$/.test(id!))
      throw new Error("Invalid gateway key ID.");
  return config;
}

/**
 * #2829 — local mode. Every origin is loopback (the public runtime may also be
 * a `*.sites.localhost` site origin), the database and S3 endpoint are the
 * local Sites CMS stack, and the two must be the SAME stack: Supabase lays out
 * a stack's ports as API = N, database = N + 1, so a database on another
 * stack's port is refused just as production refuses two project refs.
 */
function loadLocalCmsConfig(env: NodeJS.ProcessEnv): CmsConfig {
  const coreToCmsPreviousKeyId =
    env.MINGLA_CORE_TO_CMS_PREVIOUS_KID || null;
  const coreToCmsPrevious =
    env.MINGLA_CORE_TO_CMS_PREVIOUS_KEY_B64 || null;
  if ((coreToCmsPreviousKeyId === null) !== (coreToCmsPrevious === null))
    throw new Error("Previous gateway key slots must be configured together.");
  const configuredDatabaseUrl = localDatabaseUrl(env);
  const configuredStorageEndpoint = localS3Endpoint(env);
  if (
    Number(new URL(configuredDatabaseUrl).port) !==
    Number(new URL(configuredStorageEndpoint).port) + 1
  ) throw new Error("CMS database and object storage must use the same project.");
  const region = required(env, "SUPABASE_S3_REGION");
  if (region !== "local") throw new Error("Invalid Supabase S3 region.");
  return validateKeyIds({
    mode: "local",
    databaseUrl: configuredDatabaseUrl,
    databasePoolMax: databasePoolMax(env),
    payloadSecret: key(required(env, "PAYLOAD_SECRET"), "PAYLOAD_SECRET"),
    coreBaseUrl: loopbackOrigin(required(env, "SITES_CORE_BASE_URL"), "SITES_CORE_BASE_URL"),
    cmsOrigin: loopbackOrigin(required(env, "SITES_CMS_ORIGIN"), "SITES_CMS_ORIGIN"),
    storageEndpoint: configuredStorageEndpoint,
    storageRegion: region,
    storageAccessKeyId: required(env, "SUPABASE_S3_ACCESS_KEY_ID"),
    storageSecretAccessKey: required(env, "SUPABASE_S3_SECRET_ACCESS_KEY"),
    quarantineBucket: exactBucket(env, "SITES_MEDIA_QUARANTINE_BUCKET", "sites-media-quarantine"),
    approvedBucket: exactBucket(env, "SITES_MEDIA_APPROVED_BUCKET", "sites-media-approved"),
    googleFonts: GOOGLE_FONTS,
    artifactBucket: exactBucket(env, "SITES_PUBLICATION_ARTIFACT_BUCKET", "sites-publication-artifacts"),
    recoveryBucket: exactBucket(env, "SITES_MEDIA_RECOVERY_BUCKET", "sites-media-recovery"),
    previewSecret: key(required(env, "SITES_PREVIEW_SIGNING_SECRET"), "SITES_PREVIEW_SIGNING_SECRET"),
    cmsToCoreCurrent: key(required(env, "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64"), "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64"),
    coreToCmsCurrent: key(required(env, "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64"), "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64"),
    coreToCmsPrevious: coreToCmsPrevious
      ? key(coreToCmsPrevious, "MINGLA_CORE_TO_CMS_PREVIOUS_KEY_B64")
      : null,
    cmsToCoreCurrentKeyId: required(env, "MINGLA_CMS_TO_CORE_CURRENT_KID"),
    coreToCmsCurrentKeyId: required(env, "MINGLA_CORE_TO_CMS_CURRENT_KID"),
    coreToCmsPreviousKeyId,
    candidateProbeSecret: key(required(env, "SITES_CANDIDATE_PROBE_SECRET"), "SITES_CANDIDATE_PROBE_SECRET"),
    publicRuntimeOrigin: localRuntimeOrigin(
      required(env, "SITES_PUBLIC_RUNTIME_ORIGIN"),
      "SITES_PUBLIC_RUNTIME_ORIGIN",
    ),
    businessOrigin: loopbackOrigin(
      env.SITES_LOCAL_BUSINESS_ORIGIN || LOCAL_BUSINESS_ORIGIN_DEFAULT,
      "SITES_LOCAL_BUSINESS_ORIGIN",
    ),
  });
}

export function cmsConfig(): CmsConfig {
  if (cached) return cached;
  cached = loadCmsConfig(process.env);
  return cached;
}
