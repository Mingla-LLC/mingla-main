export type RuntimeConfig = {
  coreBaseUrl: string;
  sitesProjectRef: string;
  storageSupabaseUrl: string;
  storageSupabaseAnonKey: string;
  storageReaderEmail: string;
  storageReaderPassword: string;
  artifactBucket: string;
  approvedMediaBucket: string;
  allowedHostSuffix: string;
  runtimeIssuer: string;
  runtimeAudience: string;
  runtimeKeyId: string;
  runtimeHmac: string;
  pilotSiteId: string;
  candidateProbeSecret: string;
};

const CORE_ORIGIN = "https://gqnoajqerqhnvulmnyvv.supabase.co";

let cached: RuntimeConfig | undefined;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error("SERVICE_CONFIGURATION_UNAVAILABLE");
  return value;
}

function httpsOrigin(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SERVICE_CONFIGURATION_INVALID");
  return url.origin;
}

function storageSupabaseUrl(env: NodeJS.ProcessEnv, projectRef: string): string {
  const value = httpsOrigin(env, "SITES_STORAGE_SUPABASE_URL");
  if (new URL(value).hostname !== `${projectRef}.supabase.co`) {
    throw new Error("SERVICE_CONFIGURATION_INVALID");
  }
  return value;
}

function readerEmail(env: NodeJS.ProcessEnv): string {
  const value = required(env, "SITES_STORAGE_READER_EMAIL");
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("SERVICE_CONFIGURATION_INVALID");
  }
  return value;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const sitesProjectRef = required(env, "SITES_CMS_PROJECT_REF");
  const artifactBucket = env.SITES_PUBLICATION_ARTIFACT_BUCKET;
  const approvedMediaBucket = env.SITES_MEDIA_APPROVED_BUCKET;
  const runtimeKeyId = env.MINGLA_RUNTIME_TO_CORE_CURRENT_KID;
  const runtimeHmac = env.MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64;
  const pilotSiteId = env.SITES_PILOT_SITE_ID;
  const candidateProbeSecret = env.SITES_CANDIDATE_PROBE_SECRET;
  if (!artifactBucket || !approvedMediaBucket || !runtimeKeyId || !runtimeHmac || !pilotSiteId || !candidateProbeSecret) throw new Error("SERVICE_CONFIGURATION_UNAVAILABLE");
  if (!/^[a-z0-9]{20}$/.test(sitesProjectRef) ||
      artifactBucket !== "sites-publication-artifacts" ||
      approvedMediaBucket !== "sites-media-approved" ||
      !/^[A-Za-z0-9._-]{8,64}$/.test(runtimeKeyId) || Buffer.from(runtimeHmac, "base64").byteLength < 32 || Buffer.from(candidateProbeSecret, "base64").byteLength < 32 || !/^[0-9a-f-]{36}$/i.test(pilotSiteId)) throw new Error("SERVICE_CONFIGURATION_INVALID");
  const config = {
    coreBaseUrl: httpsOrigin(env, "SITES_CORE_BASE_URL"),
    sitesProjectRef,
    storageSupabaseUrl: storageSupabaseUrl(env, sitesProjectRef),
    storageSupabaseAnonKey: required(env, "SITES_STORAGE_SUPABASE_ANON_KEY"),
    storageReaderEmail: readerEmail(env),
    storageReaderPassword: required(env, "SITES_STORAGE_READER_PASSWORD"),
    artifactBucket,
    approvedMediaBucket,
    allowedHostSuffix: env.SITES_ALLOWED_HOST_SUFFIX || "sites.usemingla.com",
    runtimeIssuer: "mingla-sites",
    runtimeAudience: "mingla-core",
    runtimeKeyId,
    runtimeHmac,
    pilotSiteId,
    candidateProbeSecret,
  };
  if (
    config.coreBaseUrl !== CORE_ORIGIN ||
    config.allowedHostSuffix !== "sites.usemingla.com"
  ) throw new Error("SERVICE_CONFIGURATION_INVALID");
  return config;
}

export function runtimeConfig(): RuntimeConfig {
  if (cached) return cached;
  cached = loadRuntimeConfig(process.env);
  return cached;
}
