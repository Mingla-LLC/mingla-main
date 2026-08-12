export type AdAppKey = "explorer" | "business";
export type AdIdentityProvider = "meta" | "tiktok";
export type AdIdentityReasonCode =
  | "app_registry_missing"
  | "app_registry_inactive"
  | "identity_registry_missing"
  | "identity_registry_inactive"
  | "identity_registry_invalid"
  | "payer_connection_missing"
  | "payer_connection_inactive"
  | "payer_account_mismatch"
  | "provider_unreachable"
  | "provider_response_invalid"
  | "identity_not_found"
  | "identity_type_mismatch"
  | "identity_username_mismatch"
  | "identity_unavailable"
  | "meta_page_not_authorized"
  | "meta_instagram_mismatch"
  | "meta_validate_only_failed";

export interface AdAdvertisingAppRow {
  app_key: string;
  display_name: string;
  active: boolean;
}

export interface AdAppProviderIdentityRow {
  id: string;
  app_key: string;
  provider: string;
  payer_lane: string;
  expected_username: string;
  meta_page_id: string | null;
  meta_instagram_user_id: string | null;
  tiktok_identity_id: string | null;
  tiktok_identity_type: string | null;
  active: boolean;
}

export interface PayerConnectionRow {
  id: string;
  platform: string;
  lane: string;
  external_account_id: string;
  status: string;
  connected: boolean;
}

export interface DiscoveredTikTokIdentity {
  identityId: string;
  identityType: string;
  username: string | null;
  displayName: string | null;
  availableStatus: string | null;
}

export type ParsedProviderIdentity =
  | (AdAppProviderIdentityRow & {
    provider: "meta";
    payer_lane: "consumer" | "business";
    meta_page_id: string;
    meta_instagram_user_id: string;
    tiktok_identity_id: null;
    tiktok_identity_type: null;
  })
  | (AdAppProviderIdentityRow & {
    provider: "tiktok";
    payer_lane: "consumer" | "business";
    meta_page_id: null;
    meta_instagram_user_id: null;
    tiktok_identity_id: string;
    tiktok_identity_type: "TT_USER" | "BC_AUTH_TT";
  });

export function isAdAppKey(value: unknown): value is AdAppKey {
  return value === "explorer" || value === "business";
}

export function isIdentityProvider(
  value: unknown,
): value is AdIdentityProvider {
  return value === "meta" || value === "tiktok";
}

export function normalizeIdentityUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@/, "").toLowerCase();
  return normalized || null;
}

export function parseAdvertisingApp(
  rows: readonly AdAdvertisingAppRow[],
  appKey: AdAppKey,
): { app: AdAdvertisingAppRow | null; reason: AdIdentityReasonCode | null } {
  const matches = rows.filter((row) => row.app_key === appKey);
  if (matches.length !== 1) {
    return { app: null, reason: "app_registry_missing" };
  }
  const app = matches[0];
  if (!app.active) return { app, reason: "app_registry_inactive" };
  if (typeof app.display_name !== "string" || !app.display_name.trim()) {
    return { app: null, reason: "app_registry_missing" };
  }
  return { app, reason: null };
}

export function parseProviderIdentity(
  rows: readonly AdAppProviderIdentityRow[],
  appKey: AdAppKey,
  provider: AdIdentityProvider,
): {
  identity: ParsedProviderIdentity | null;
  reason: AdIdentityReasonCode | null;
} {
  const matches = rows.filter((row) =>
    row.app_key === appKey && row.provider === provider
  );
  if (matches.length !== 1) {
    return { identity: null, reason: "identity_registry_missing" };
  }
  const row = matches[0];
  if (!row.active) {
    return { identity: null, reason: "identity_registry_inactive" };
  }
  const username = normalizeIdentityUsername(row.expected_username);
  const laneOk = row.payer_lane === "consumer" || row.payer_lane === "business";
  const metaOk = provider === "meta" && Boolean(row.meta_page_id) &&
    Boolean(row.meta_instagram_user_id) && row.tiktok_identity_id === null &&
    row.tiktok_identity_type === null;
  const tiktokOk = provider === "tiktok" && row.meta_page_id === null &&
    row.meta_instagram_user_id === null && Boolean(row.tiktok_identity_id) &&
    (row.tiktok_identity_type === "TT_USER" ||
      row.tiktok_identity_type === "BC_AUTH_TT");
  if (
    !username || username !== row.expected_username || !laneOk ||
    (!metaOk && !tiktokOk)
  ) {
    return { identity: null, reason: "identity_registry_invalid" };
  }
  return { identity: row as ParsedProviderIdentity, reason: null };
}

export function resolvePayerConnection<T extends PayerConnectionRow>(
  rows: readonly T[],
  identity: ParsedProviderIdentity,
): { connection: T | null; reason: AdIdentityReasonCode | null } {
  const matches = rows.filter((row) =>
    row.platform === identity.provider && row.lane === identity.payer_lane
  );
  if (matches.length !== 1) {
    return { connection: null, reason: "payer_connection_missing" };
  }
  const connection = matches[0];
  if (!connection.connected || connection.status !== "connected") {
    return { connection, reason: "payer_connection_inactive" };
  }
  return { connection, reason: null };
}

export function selectExactTikTokIdentity(
  identities: readonly DiscoveredTikTokIdentity[],
  expected: Extract<ParsedProviderIdentity, { provider: "tiktok" }>,
): {
  identity: DiscoveredTikTokIdentity | null;
  reason: AdIdentityReasonCode | null;
} {
  const sameId = identities.filter((row) =>
    row.identityId === expected.tiktok_identity_id
  );
  const exact = sameId.find((row) =>
    row.identityType === expected.tiktok_identity_type
  );
  if (!exact) {
    return sameId.length > 0
      ? { identity: null, reason: "identity_type_mismatch" }
      : { identity: null, reason: "identity_not_found" };
  }
  if (exact.availableStatus !== "AVAILABLE") {
    return { identity: exact, reason: "identity_unavailable" };
  }
  const username = normalizeIdentityUsername(exact.username);
  if (username !== null && username !== expected.expected_username) {
    return { identity: exact, reason: "identity_username_mismatch" };
  }
  return { identity: exact, reason: null };
}
