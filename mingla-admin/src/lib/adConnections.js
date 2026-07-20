/**
 * ISSUE-978 [Ad Connections panel] — pure logic for the all-5-platform
 * Connections status panel. Kept dependency-free (no React, no supabase
 * client) so it is unit-testable with plain `node:test`, matching the house
 * pattern in mingla-admin/src/lib/adBuilder/*.js.
 *
 * Backend truth (proven in #977 Lane B/F-7/F-8, source-read of
 * supabase/functions/admin-ad-connect/index.ts): a successful `connect` call
 * upserts one `ad_connections` row per (platform, lane) with
 * `connected:true`, `status:"connected"`, `token_last_verified_at:now()`,
 * `account_status` (platform-native enum — Meta ACTIVE / Google ENABLED /
 * TikTok STATUS_ENABLE / Snapchat ACTIVE / Reddit null — n/a on Reddit), and
 * `extra.last_error` set on any failed attempt. A failed/never-run connect
 * leaves `status:"unknown"` (column default) or `status:"invalid"`, and
 * Google has NO row at all until its secrets are provisioned (409
 * google_not_provisioned never writes a row) — this module treats a missing
 * row as an honest "not connected" state, never fabricated data.
 */

/** The 5 ad channels, in the order the panel renders them. */
export const PLATFORM_META = [
  { platform: "meta", label: "Meta (Facebook / Instagram)" },
  { platform: "tiktok", label: "TikTok" },
  { platform: "snapchat", label: "Snapchat" },
  { platform: "google", label: "Google Ads" },
  { platform: "reddit", label: "Reddit" },
];

export const PLATFORMS = PLATFORM_META.map((p) => p.platform);

/** A connected row older than this (or never verified) is flagged stale. */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

/** Platform-native "the account is actually usable" values (F-7/Lane E). */
export const ACTIVE_ACCOUNT_STATUSES = new Set(["ACTIVE", "ENABLED", "STATUS_ENABLE"]);

/** "verified 2h ago" / "verified 3d ago" / "never" — never throws on bad input. */
export function humanizeAge(isoString, now = new Date()) {
  if (!isoString) return "never";
  const then = new Date(isoString);
  const thenMs = then.getTime();
  if (Number.isNaN(thenMs)) return "never";
  const diffMs = now.getTime() - thenMs;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Classify one ad_connections row (or null — platform never connected/no
 * row, e.g. Google pre-provisioning) into { state, reason }.
 * state: "connected" | "stale" | "not_connected".
 * reason: plain-English (F-2's fix contract — never a raw enum/proof-tag) or
 * null when state === "connected".
 */
export function computeConnectionStatus(row, now = new Date()) {
  if (!row || row.connected !== true || row.status !== "connected") {
    const lastError = row?.extra?.last_error;
    const reason = lastError
      ? String(lastError)
      : row?.status === "invalid"
        ? "The last connect attempt failed. Reconnect to retry."
        : "Not connected yet.";
    return { state: "not_connected", reason };
  }

  const verifiedIso = row.token_last_verified_at ?? null;
  const verifiedAt = verifiedIso ? new Date(verifiedIso) : null;
  const isStaleAge = !verifiedAt || Number.isNaN(verifiedAt.getTime()) ||
    now.getTime() - verifiedAt.getTime() > STALE_THRESHOLD_MS;

  const accountStatus = row.account_status ?? null;
  const isStaleAccount = accountStatus != null && !ACTIVE_ACCOUNT_STATUSES.has(accountStatus);

  if (isStaleAge || isStaleAccount) {
    const reasons = [];
    if (isStaleAge) {
      reasons.push(verifiedAt ? "hasn't been re-verified in over 24 hours" : "has never been verified");
    }
    if (isStaleAccount) {
      reasons.push(`the account status is "${accountStatus}", not active`);
    }
    return {
      state: "stale",
      reason: `Connected, but ${reasons.join(" and ")}. Reconnect to refresh it.`,
    };
  }

  return { state: "connected", reason: null };
}

/**
 * Merge live `ad_connections` rows (any subset/order, any missing platform)
 * with the fixed 5-platform list so the panel ALWAYS renders exactly 5 rows
 * — a platform with no row (Google, pre-connect) renders as "not_connected /
 * never" rather than being silently dropped.
 */
export function buildConnectionRows(connections, now = new Date()) {
  const byPlatform = new Map((connections ?? []).filter(Boolean).map((row) => [row.platform, row]));
  return PLATFORM_META.map(({ platform, label }) => {
    const row = byPlatform.get(platform) ?? null;
    const { state, reason } = computeConnectionStatus(row, now);
    return {
      platform,
      label,
      row,
      state,
      reason,
      displayName: row?.display_name ?? null,
      externalAccountId: row?.external_account_id ?? null,
      accountStatus: row?.account_status ?? null,
      tokenLastVerifiedAt: row?.token_last_verified_at ?? null,
      verifiedAgeLabel: humanizeAge(row?.token_last_verified_at ?? null, now),
    };
  });
}

/**
 * Factory for the Connect/Reconnect click handler — dependency-injected so
 * it is testable without a React render (the house pattern for this repo:
 * business logic in lib/, components are thin wiring). `connectChannelFn`
 * matches adEngineService.connectChannel(platform, action) → { data, error }.
 */
export function createReconnectHandler({ connectChannelFn, onStart, onSuccess, onError }) {
  return async function reconnect(platform, action = "connect") {
    onStart?.(platform);
    try {
      const { data, error } = await connectChannelFn(platform, action);
      if (error) {
        onError?.(platform, error);
        return { ok: false, error };
      }
      onSuccess?.(platform, data);
      return { ok: true, data };
    } catch (err) {
      onError?.(platform, err);
      return { ok: false, error: err };
    }
  };
}
