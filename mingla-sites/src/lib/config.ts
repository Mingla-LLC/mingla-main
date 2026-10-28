import {
  LOCAL_HOST_SUFFIX,
  localExtraHosts,
  localModeEnabled,
  loopbackOrigin,
} from "./localMode";
import { isStreamVideoHost } from "../contracts/generated/video.ts";

export type RuntimeConfig = {
  /** #2829 — "local" only when every local-mode signal agrees (localMode.ts). */
  mode: "production" | "local";
  /** Local mode only: extra hostnames served for custom-domain tests. */
  localExtraHosts: readonly string[];
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
  candidateProbeSecret: string;
  /**
   * #2829 W5 — where the site's contact form and newsletter box send (Mingla's
   * public enquiry and subscribe functions, #4111). Always Core: the
   * production Core, or the local Core stack in local mode.
   */
  formsFunctionsBaseUrl: string;
  /**
   * #2829 W6 (AD-9) — the stream-video CDN hostnames a site may play from
   * (`SITES_VIDEO_CDN_HOSTS`, comma separated). A stream video on any other
   * host is not played (its poster shows) and never enters the CSP. Empty
   * (the default) means no stream video plays anywhere.
   */
  videoCdnHosts: readonly string[];
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

/** #2829 W6 — `SITES_VIDEO_CDN_HOSTS`: bare lowercase hostnames, comma separated. */
export function videoCdnHosts(value: string | undefined): readonly string[] {
  if (!value || !value.trim()) return [];
  const hosts = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (hosts.length > 4 || hosts.some((host) => !isStreamVideoHost(host))) throw new Error("SERVICE_CONFIGURATION_INVALID");
  return hosts;
}

function readerEmail(env: NodeJS.ProcessEnv): string {
  const value = required(env, "SITES_STORAGE_READER_EMAIL");
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("SERVICE_CONFIGURATION_INVALID");
  }
  return value;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  // #2829 — decide the mode first: a partial local signal throws here, so a
  // production deployment can never drift into the loopback rules below.
  const local = localModeEnabled(env);
  const sitesProjectRef = required(env, "SITES_CMS_PROJECT_REF");
  const artifactBucket = env.SITES_PUBLICATION_ARTIFACT_BUCKET;
  const approvedMediaBucket = env.SITES_MEDIA_APPROVED_BUCKET;
  const runtimeKeyId = env.MINGLA_RUNTIME_TO_CORE_CURRENT_KID;
  const runtimeHmac = env.MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64;
  // #2829 — the runtime serves every entitled brand; the old single-site id
  // variable is ignored if a deployment still sets it.
  const candidateProbeSecret = env.SITES_CANDIDATE_PROBE_SECRET;
  if (!artifactBucket || !approvedMediaBucket || !runtimeKeyId || !runtimeHmac || !candidateProbeSecret) throw new Error("SERVICE_CONFIGURATION_UNAVAILABLE");
  if (!/^[a-z0-9]{20}$/.test(sitesProjectRef) ||
      artifactBucket !== "sites-publication-artifacts" ||
      approvedMediaBucket !== "sites-media-approved" ||
      !/^[A-Za-z0-9._-]{8,64}$/.test(runtimeKeyId) || Buffer.from(runtimeHmac, "base64").byteLength < 32 || Buffer.from(candidateProbeSecret, "base64").byteLength < 32) throw new Error("SERVICE_CONFIGURATION_INVALID");
  const config = {
    mode: local ? "local" as const : "production" as const,
    localExtraHosts: local ? localExtraHosts(env.SITES_LOCAL_EXTRA_HOSTS) : [],
    coreBaseUrl: local
      ? loopbackOrigin(env.SITES_CORE_BASE_URL)
      : httpsOrigin(env, "SITES_CORE_BASE_URL"),
    sitesProjectRef,
    storageSupabaseUrl: local
      ? loopbackOrigin(env.SITES_STORAGE_SUPABASE_URL)
      : storageSupabaseUrl(env, sitesProjectRef),
    storageSupabaseAnonKey: required(env, "SITES_STORAGE_SUPABASE_ANON_KEY"),
    storageReaderEmail: readerEmail(env),
    storageReaderPassword: required(env, "SITES_STORAGE_READER_PASSWORD"),
    artifactBucket,
    approvedMediaBucket,
    allowedHostSuffix: env.SITES_ALLOWED_HOST_SUFFIX ||
      (local ? LOCAL_HOST_SUFFIX : "sites.usemingla.com"),
    runtimeIssuer: "mingla-sites",
    runtimeAudience: "mingla-core",
    runtimeKeyId,
    runtimeHmac,
    candidateProbeSecret,
    formsFunctionsBaseUrl: "",
    videoCdnHosts: videoCdnHosts(env.SITES_VIDEO_CDN_HOSTS),
  };
  config.formsFunctionsBaseUrl = config.coreBaseUrl;
  if (local) {
    // #2829 — local mode answers only for `*.sites.localhost` and only ever
    // talks to loopback backends (checked above by loopbackOrigin).
    if (config.allowedHostSuffix !== LOCAL_HOST_SUFFIX) {
      throw new Error("SERVICE_CONFIGURATION_INVALID");
    }
    return config;
  }
  if (
    config.coreBaseUrl !== CORE_ORIGIN ||
    config.allowedHostSuffix !== "sites.usemingla.com" ||
    config.formsFunctionsBaseUrl !== CORE_ORIGIN
  ) throw new Error("SERVICE_CONFIGURATION_INVALID");
  return config;
}

export function runtimeConfig(): RuntimeConfig {
  if (cached) return cached;
  cached = loadRuntimeConfig(process.env);
  return cached;
}
