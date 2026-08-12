export const APP_KEYS = ["explorer", "business"] as const;
export const OPERATING_SYSTEMS = ["ios", "android"] as const;
export const READINESS_PROVIDERS = [
  "meta",
  "tiktok",
  "snapchat",
  "google",
  "reddit",
] as const;
export const DIMENSIONS = [
  "payer",
  "identity",
  "binding",
  "measurement",
  "funding",
] as const;

export type AppKey = typeof APP_KEYS[number];
export type OperatingSystem = typeof OPERATING_SYSTEMS[number];
export type ReadinessProvider = typeof READINESS_PROVIDERS[number];
export type DimensionName = typeof DIMENSIONS[number];
export type DimensionStatus =
  | "proven"
  | "action_required"
  | "blocked"
  | "not_applicable";
export type Verdict = "ready" | "action_required" | "blocked" | "stale";

export interface SafeEvidence {
  status: DimensionStatus;
  summary: string;
  source_class:
    | "provider_api"
    | "appsflyer_api"
    | "canonical_registry"
    | "dashboard_attestation";
  source_checked_at: string;
  safe_id?: string;
  safe_url?: string;
}

export type DimensionEvidence = Record<DimensionName, SafeEvidence>;

export interface TargetRow {
  app_key: AppKey;
  os: OperatingSystem;
  display_name: string;
  store_identifier: string;
  appsflyer_app_id: string;
  onelink_url: string;
  active: boolean;
}

export interface BindingRow {
  app_key: AppKey;
  os: OperatingSystem;
  provider: ReadinessProvider;
  payer_connection_id: string | null;
  public_identity_required: boolean;
  provider_app_id: string | null;
  provider_measurement_id: string | null;
  active: boolean;
}

const SAFE_SOURCE_CLASSES = new Set([
  "provider_api",
  "appsflyer_api",
  "canonical_registry",
  "dashboard_attestation",
]);
const SAFE_STATUSES = new Set([
  "proven",
  "action_required",
  "blocked",
  "not_applicable",
]);

export function parseTarget(value: unknown): {
  appKey: AppKey;
  os: OperatingSystem;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!APP_KEYS.includes(row.app_key as AppKey)) return null;
  if (!OPERATING_SYSTEMS.includes(row.os as OperatingSystem)) return null;
  return { appKey: row.app_key as AppKey, os: row.os as OperatingSystem };
}

export function targetKey(appKey: AppKey, os: OperatingSystem): string {
  return `${appKey}:${os}`;
}

export function sanitizeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean && clean.length <= 160 && /^[A-Za-z0-9._:@/-]+$/.test(clean)
    ? clean
    : undefined;
}

export function sanitizeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    const allowed = [
      "business.facebook.com",
      "ads.tiktok.com",
      "ads.snapchat.com",
      "ads.google.com",
      "ads.reddit.com",
      "www.facebook.com",
      "www.tiktok.com",
      "support.google.com",
      "businesshelp.snapchat.com",
      "business.reddithelp.com",
      "go.usemingla.com",
      "biz.usemingla.com",
    ];
    if (!allowed.includes(url.hostname)) return undefined;
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function normalizeEvidence(input: unknown): SafeEvidence | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  if (!SAFE_STATUSES.has(String(row.status))) return null;
  if (!SAFE_SOURCE_CLASSES.has(String(row.source_class))) return null;
  if (
    typeof row.summary !== "string" || !row.summary.trim() ||
    row.summary.length > 240
  ) return null;
  if (
    typeof row.source_checked_at !== "string" ||
    !Number.isFinite(Date.parse(row.source_checked_at))
  ) return null;
  return {
    status: row.status as DimensionStatus,
    summary: row.summary.trim(),
    source_class: row.source_class as SafeEvidence["source_class"],
    source_checked_at: row.source_checked_at,
    ...(sanitizeId(row.safe_id) ? { safe_id: sanitizeId(row.safe_id) } : {}),
    ...(sanitizeUrl(row.safe_url)
      ? { safe_url: sanitizeUrl(row.safe_url) }
      : {}),
  };
}

export function reduceVerdict(
  provider: ReadinessProvider,
  evidence: DimensionEvidence,
): Exclude<Verdict, "stale"> {
  if (
    (provider === "meta" || provider === "tiktok") &&
    evidence.identity.status === "not_applicable"
  ) return "blocked";
  const statuses = DIMENSIONS.map((name) => evidence[name].status);
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("action_required")) return "action_required";
  return statuses.every((status) =>
      status === "proven" || status === "not_applicable"
    )
    ? "ready"
    : "blocked";
}

export function deriveFreshVerdict(
  verdict: Exclude<Verdict, "stale">,
  staleAt: string,
  serverNow: string,
): Verdict {
  return Date.parse(serverNow) >= Date.parse(staleAt) ? "stale" : verdict;
}

export function durationBucket(ms: number): string {
  if (ms < 1000) return "lt_1s";
  if (ms < 3000) return "1_3s";
  if (ms < 10000) return "3_10s";
  if (ms < 30000) return "10_30s";
  if (ms <= 60000) return "30_60s";
  return "timeout";
}

export function evidence(
  status: DimensionStatus,
  summary: string,
  sourceCheckedAt: string,
  sourceClass: SafeEvidence["source_class"] = "canonical_registry",
  safeId?: string,
): SafeEvidence {
  return {
    status,
    summary,
    source_class: sourceClass,
    source_checked_at: sourceCheckedAt,
    ...(sanitizeId(safeId) ? { safe_id: sanitizeId(safeId) } : {}),
  };
}
