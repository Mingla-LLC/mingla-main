export type CmsConfig = {
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
};

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
    publicRuntimeOrigin: productionOrigin(
      env,
      "SITES_PUBLIC_RUNTIME_ORIGIN",
      "https://gogi.sites.usemingla.com",
    ),
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

export function cmsConfig(): CmsConfig {
  if (cached) return cached;
  cached = loadCmsConfig(process.env);
  return cached;
}
