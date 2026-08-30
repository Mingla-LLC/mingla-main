type RuntimeConfig = {
  coreBaseUrl: string;
  artifactReadBaseUrl: string;
  artifactReadToken: string;
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

let cached: RuntimeConfig | undefined;

function httpsOrigin(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("SERVICE_CONFIGURATION_UNAVAILABLE");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SERVICE_CONFIGURATION_INVALID");
  return url.origin;
}

export function runtimeConfig(): RuntimeConfig {
  if (cached) return cached;
  const artifactReadToken = process.env.SITES_ARTIFACT_READ_TOKEN;
  const artifactBucket = process.env.SITES_PUBLICATION_ARTIFACT_BUCKET;
  const approvedMediaBucket = process.env.SITES_MEDIA_APPROVED_BUCKET;
  const runtimeKeyId = process.env.MINGLA_RUNTIME_TO_CORE_CURRENT_KID;
  const runtimeHmac = process.env.MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64;
  const pilotSiteId = process.env.SITES_PILOT_SITE_ID;
  const candidateProbeSecret = process.env.SITES_CANDIDATE_PROBE_SECRET;
  if (!artifactReadToken || !artifactBucket || !approvedMediaBucket || !runtimeKeyId || !runtimeHmac || !pilotSiteId || !candidateProbeSecret) throw new Error("SERVICE_CONFIGURATION_UNAVAILABLE");
  if (!/^[A-Za-z0-9._-]{8,64}$/.test(runtimeKeyId) || Buffer.from(runtimeHmac, "base64").byteLength < 32 || Buffer.from(candidateProbeSecret, "base64").byteLength < 32 || !/^[0-9a-f-]{36}$/i.test(pilotSiteId)) throw new Error("SERVICE_CONFIGURATION_INVALID");
  cached = {
    coreBaseUrl: httpsOrigin("SITES_CORE_BASE_URL"),
    artifactReadBaseUrl: httpsOrigin("SITES_ARTIFACT_READ_BASE_URL"),
    artifactReadToken,
    artifactBucket,
    approvedMediaBucket,
    allowedHostSuffix: process.env.SITES_ALLOWED_HOST_SUFFIX || "sites.usemingla.com",
    runtimeIssuer: "mingla-sites",
    runtimeAudience: "mingla-core",
    runtimeKeyId,
    runtimeHmac,
    pilotSiteId,
    candidateProbeSecret,
  };
  if (cached.allowedHostSuffix !== "sites.usemingla.com") throw new Error("SERVICE_CONFIGURATION_INVALID");
  return cached;
}
