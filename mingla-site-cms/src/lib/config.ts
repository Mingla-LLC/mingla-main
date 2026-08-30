export type CmsConfig = {
  databaseUrl: string;
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

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function origin(name: string): string {
  const value = required(name);
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

function key(value: string, name: string): string {
  if (Buffer.from(value, "base64").byteLength < 32)
    throw new Error(`Invalid server key: ${name}`);
  return value;
}

export function cmsConfig(): CmsConfig {
  if (cached) return cached;
  const coreToCmsPreviousKeyId =
    process.env.MINGLA_CORE_TO_CMS_PREVIOUS_KID || null;
  const coreToCmsPrevious =
    process.env.MINGLA_CORE_TO_CMS_PREVIOUS_KEY_B64 || null;
  if ((coreToCmsPreviousKeyId === null) !== (coreToCmsPrevious === null))
    throw new Error("Previous gateway key slots must be configured together.");
  cached = {
    databaseUrl: required("DATABASE_URL"),
    payloadSecret: key(required("PAYLOAD_SECRET"), "PAYLOAD_SECRET"),
    coreBaseUrl: origin("SITES_CORE_BASE_URL"),
    cmsOrigin: origin("SITES_CMS_ORIGIN"),
    storageEndpoint: origin("SUPABASE_S3_ENDPOINT"),
    storageRegion: required("SUPABASE_S3_REGION"),
    storageAccessKeyId: required("SUPABASE_S3_ACCESS_KEY_ID"),
    storageSecretAccessKey: required("SUPABASE_S3_SECRET_ACCESS_KEY"),
    quarantineBucket: required("SITES_MEDIA_QUARANTINE_BUCKET"),
    approvedBucket: required("SITES_MEDIA_APPROVED_BUCKET"),
    artifactBucket: required("SITES_PUBLICATION_ARTIFACT_BUCKET"),
    recoveryBucket: required("SITES_MEDIA_RECOVERY_BUCKET"),
    previewSecret: key(
      required("SITES_PREVIEW_SIGNING_SECRET"),
      "SITES_PREVIEW_SIGNING_SECRET",
    ),
    cmsToCoreCurrent: key(
      required("MINGLA_CMS_TO_CORE_CURRENT_KEY_B64"),
      "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64",
    ),
    coreToCmsCurrent: key(
      required("MINGLA_CORE_TO_CMS_CURRENT_KEY_B64"),
      "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64",
    ),
    coreToCmsPrevious: coreToCmsPrevious
      ? key(coreToCmsPrevious, "MINGLA_CORE_TO_CMS_PREVIOUS_KEY_B64")
      : null,
    cmsToCoreCurrentKeyId: required("MINGLA_CMS_TO_CORE_CURRENT_KID"),
    coreToCmsCurrentKeyId: required("MINGLA_CORE_TO_CMS_CURRENT_KID"),
    coreToCmsPreviousKeyId,
    candidateProbeSecret: key(
      required("SITES_CANDIDATE_PROBE_SECRET"),
      "SITES_CANDIDATE_PROBE_SECRET",
    ),
    publicRuntimeOrigin: origin("SITES_PUBLIC_RUNTIME_ORIGIN"),
  };
  for (
    const id of [
      cached.cmsToCoreCurrentKeyId,
      cached.coreToCmsCurrentKeyId,
      cached.coreToCmsPreviousKeyId,
    ].filter(Boolean)
  )
    if (!/^[A-Za-z0-9._-]{8,64}$/.test(id!))
      throw new Error("Invalid gateway key ID.");
  return cached;
}
