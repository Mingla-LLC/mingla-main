export const FRESHNESS_MS = 15 * 60 * 1000;
export const APP_IDENTITY_PRESENTATION = {
  explorer: { label: "Mingla Explorer", shortLabel: "Explorer", username: "usemingla", tiktokType: "TT_USER" },
  business: { label: "Mingla Host", shortLabel: "Business", username: "minglahost", tiktokType: "BC_AUTH_TT" },
};
export const IDENTITY_PROVIDERS = ["meta", "tiktok"];

const REASONS = {
  app_registry_missing: ["App identity is not configured", ({ app }) => `Mingla could not find the canonical ${app} app record. Add the registry entry, then recheck.`],
  app_registry_inactive: ["App identity is disabled", ({ app }) => `The canonical ${app} app record is inactive. Enable it only after confirming the intended identities, then recheck.`],
  identity_registry_missing: [({ provider }) => `${provider} identity is not configured`, ({ provider, app }) => `No canonical ${provider} identity exists for ${app}. Add the exact identity mapping, then recheck.`],
  identity_registry_inactive: [({ provider }) => `${provider} identity is disabled`, ({ provider, app }) => `The canonical ${provider} mapping for ${app} is inactive. Confirm it before enabling and rechecking.`],
  identity_registry_invalid: ["Identity configuration is invalid", ({ provider }) => `The saved ${provider} mapping is incomplete or malformed. Fix the canonical IDs and identity type, then recheck.`],
  payer_connection_missing: ["Shared payer is not connected", ({ provider }) => `Mingla could not find the configured ${provider} payer connection for this identity. Connect the existing corporate payer, then recheck.`],
  payer_connection_inactive: ["Shared payer is inactive", ({ provider }) => `The existing ${provider} payer connection is not active. Restore that connection, then recheck.`],
  payer_account_mismatch: ["Wrong shared payer account", ({ provider }) => `The connected ${provider} payer does not match Mingla’s canonical corporate account. Correct the connection; do not substitute another identity.`],
  provider_unreachable: [({ provider }) => `${provider} could not be reached`, "The provider did not return a usable result. Nothing was treated as ready. Recheck when the provider is available."],
  provider_response_invalid: [({ provider }) => `${provider} returned an unexpected response`, "Mingla could not safely verify the response, so this identity is blocked. Recheck; investigate the provider response if it persists."],
  identity_not_found: ["Expected identity was not found", ({ provider, username }) => `${provider} did not return the exact configured identity for @${username}. No alternate identity was used.`],
  identity_type_mismatch: ["Identity type does not match", ({ expectedType }) => `The configured identity ID appeared under a different type. Expected ${expectedType}; no fallback was used.`],
  identity_username_mismatch: ["Public username does not match", ({ username }) => `The exact identity ID/type did not resolve to @${username}. Confirm the provider account before rechecking.`],
  identity_unavailable: ["Expected identity is unavailable", ({ username }) => `The exact @${username} identity exists but is not AVAILABLE for this payer. No alternate identity was used.`],
  meta_page_not_authorized: ["Facebook Page cannot advertise", ({ username }) => `The exact Facebook Page for @${username} is missing the required ADVERTISE permission under the shared payer.`],
  meta_instagram_mismatch: ["Instagram account does not match", "The exact Facebook Page is linked to a different Instagram account. Mingla did not substitute it."],
  meta_validate_only_failed: ["Meta could not validate this identity pair", "The read-only validation failed for the exact Page and Instagram pair. No creative was created. Fix the authorization, then recheck."],
};

function value(entry, context) {
  return typeof entry === "function" ? entry(context) : entry;
}

export function reasonCopy(code, { appKey, provider, username, expectedType } = {}) {
  const app = APP_IDENTITY_PRESENTATION[appKey]?.shortLabel ?? "selected";
  const providerLabel = provider === "meta" ? "Meta" : provider === "tiktok" ? "TikTok" : "Provider";
  const context = { app, provider: providerLabel, username: username ?? "unknown", expectedType: expectedType ?? "the configured type" };
  const mapping = REASONS[code];
  if (!mapping) return {
    title: "Identity check blocked",
    detail: "Mingla returned an unrecognized safety reason. Nothing was treated as ready. Recheck; investigate if it persists.",
  };
  return { title: value(mapping[0], context), detail: value(mapping[1], context) };
}

export function transportErrorCopy(status) {
  if (status === 400 || status === 405) return "The check request was rejected. Nothing was changed.";
  if (status === 401) return "Your admin session expired. Sign in again, then recheck.";
  if (status === 403) return "You don’t have permission to run this identity check.";
  return "We couldn’t complete this check. No identity result was accepted.";
}

export function validateIdentityPreflightResponse(payload, requestedAppKey) {
  if (!payload || typeof payload !== "object" || payload.app_key !== requestedAppKey ||
    (payload.overall !== "ready" && payload.overall !== "blocked") ||
    typeof payload.checked_at !== "string" || Number.isNaN(Date.parse(payload.checked_at)) ||
    !Array.isArray(payload.providers) || payload.providers.length !== 2) return null;
  const providerNames = payload.providers.map((row) => row?.provider);
  if (providerNames[0] !== "meta" || providerNames[1] !== "tiktok") return null;
  for (const row of payload.providers) {
    if (!row || (row.verdict !== "ready" && row.verdict !== "blocked") ||
      !Array.isArray(row.checks) || (row.verdict === "ready" && (!row.payer || !row.expected_identity || !row.matched_identity))) return null;
  }
  const exactOverall = payload.providers.every((row) => row.verdict === "ready") ? "ready" : "blocked";
  if (payload.overall !== exactOverall) return null;
  return payload;
}

export function isIdentityResultStale(checkedAt, nowMs = Date.now()) {
  const checkedMs = Date.parse(checkedAt);
  return Number.isNaN(checkedMs) || nowMs - checkedMs > FRESHNESS_MS;
}

export function deriveReadinessState(entry, { online = true, nowMs = Date.now() } = {}) {
  if (!online) return "offline";
  if (entry.phase === "loading" || entry.phase === "error") return entry.phase;
  if (entry.result && isIdentityResultStale(entry.result.checked_at, nowMs)) return "stale";
  return entry.phase;
}

export function shouldRestoreCompletionFocus({
  pending,
  appKey,
  currentRequestId,
  phase,
  state,
  online,
  errorStatus,
  buttonDisabled,
}) {
  if (!pending || pending.appKey !== appKey || pending.requestId !== currentRequestId) return false;
  if (!online || state === "offline" || state === "stale" || buttonDisabled) return false;
  if (phase === "error" && errorStatus === 403) return false;
  return phase === "ready" || phase === "blocked" || phase === "error";
}

export function formatFreshness(checkedAt, { nowMs = Date.now(), mode = "current", locale } = {}) {
  const checkedMs = Date.parse(checkedAt);
  if (Number.isNaN(checkedMs)) return null;
  const diffMs = checkedMs - nowMs;
  const abs = Math.abs(diffMs);
  let unit = "minute";
  let divisor = 60_000;
  if (abs < 60_000) { unit = "second"; divisor = 1_000; }
  else if (abs >= 3_600_000) { unit = "hour"; divisor = 3_600_000; }
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(diffMs / divisor), unit);
  if (mode === "stale") return `Checked ${relative} · Recheck required.`;
  if (mode === "previous") return `Previous check: ${relative} · Not current.`;
  const absolute = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(checkedMs));
  return `Checked ${relative} · ${absolute}.`;
}
