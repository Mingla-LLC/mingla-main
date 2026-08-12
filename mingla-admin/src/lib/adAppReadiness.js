export const APP_ORDER = ["explorer", "business"];
export const OS_ORDER = ["ios", "android"];
export const PROVIDER_ORDER = ["meta", "tiktok", "snapchat", "google", "reddit"];
export const DIMENSION_ORDER = ["payer", "identity", "binding", "measurement", "funding"];
export const TARGET_ORDER = APP_ORDER.flatMap((appKey) => OS_ORDER.map((os) => `${appKey}:${os}`));
const VERDICTS = new Set(["ready", "action_required", "blocked", "stale"]);
const ACTIONS = new Set(["review_mingla_configuration", "review_provider_billing", "reauthorize_provider", "contact_provider_support", "retry_check", "review_blocker"]);
const OWNERS = new Set(["Mingla Admin", "Growth operations", "Engineering", "Finance", "Provider support"]);

export const VERDICT_COPY = {
  ready: "Ready",
  action_required: "Action required",
  blocked: "Blocked",
  stale: "Stale",
};

export const ACTION_COPY = {
  review_mingla_configuration: "Review Mingla configuration",
  review_provider_billing: "Review provider billing",
  reauthorize_provider: "Reauthorize provider",
  contact_provider_support: "Contact provider support",
  retry_check: "Retry selected target",
  review_blocker: "Review blocker",
};

export function targetKey(appKey, os) { return `${appKey}:${os}`; }
export function validTarget(appKey, os) { return APP_ORDER.includes(appKey) && OS_ORDER.includes(os); }

export function parseTargetQuery(search) {
  const params = new URLSearchParams(search || "");
  const appKey = APP_ORDER.includes(params.get("app")) ? params.get("app") : "explorer";
  const os = OS_ORDER.includes(params.get("os")) ? params.get("os") : "ios";
  return { appKey, os };
}

export function writeTargetQuery(appKey, os) {
  const params = new URLSearchParams(); params.set("app", appKey); params.set("os", os);
  return `?${params.toString()}`;
}

function validEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => ["status","summary","source_class","source_checked_at","safe_id","safe_url"].includes(key)) &&
    ["proven","action_required","blocked","not_applicable"].includes(value.status) &&
    typeof value.summary === "string" && Number.isFinite(Date.parse(value.source_checked_at));
}

function normalizeResult(value, provider, staleAt, serverNow) {
  if (!value || value.provider !== provider || !VERDICTS.has(value.verdict)) return missingResult(provider);
  const evidence = value.evidence;
  if (!evidence || !DIMENSION_ORDER.every((name) => validEvidence(evidence[name]))) return missingResult(provider);
  if (value.verdict === "stale") return missingResult(provider);
  if (value.verdict === "ready" && (value.owner_label != null || value.action_code != null)) return missingResult(provider);
  if (value.verdict !== "ready" && (!OWNERS.has(value.owner_label) || !ACTIONS.has(value.action_code))) return missingResult(provider);
  const stale = Date.parse(serverNow) >= Date.parse(staleAt);
  const verdict = stale ? "stale" : value.verdict;
  return { provider, verdict, reason_code: typeof value.reason_code === "string" ? value.reason_code : "unknown_verification_failure", owner_label: value.owner_label ?? null, action_code: value.action_code ?? null, action_href: safeActionHref(value.action_href), evidence };
}

export function missingResult(provider) {
  const at = new Date(0).toISOString();
  const item = { status: "blocked", summary: "Incomplete provider result.", source_class: "canonical_registry", source_checked_at: at };
  return { provider, verdict: "blocked", reason_code: "incomplete_provider_result", owner_label: "Engineering", action_code: "retry_check", action_href: null, evidence: Object.fromEntries(DIMENSION_ORDER.map((name) => [name, name === "identity" && !["meta","tiktok"].includes(provider) ? { ...item, status: "not_applicable", summary: "Not applicable — this provider does not show a Mingla social profile." } : item])) };
}

export function uncheckedResult(provider) {
  return {
    provider,
    verdict: "needs_check",
    reason_code: "needs_check",
    owner_label: null,
    action_code: null,
    action_href: null,
    evidence: null,
  };
}

export function primaryEvidenceName(reasonCode) {
  if (/funding|billing/.test(reasonCode)) return "funding";
  if (/measurement|event_mapping/.test(reasonCode)) return "measurement";
  if (/identity/.test(reasonCode)) return "identity";
  if (/payer|permission|oauth/.test(reasonCode)) return "payer";
  return "binding";
}

export function safeActionHref(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value); if (url.protocol !== "https:") return null;
    const allowed = ["business.facebook.com","ads.tiktok.com","ads.snapchat.com","ads.google.com","ads.reddit.com","support.google.com","businesshelp.snapchat.com","business.reddithelp.com"];
    if (!allowed.includes(url.hostname)) return null;
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch { return null; }
}

export function validateReadinessResponse(input, expectedApp, expectedOs) {
  if (!input || input.contract_version !== 1 || !Number.isFinite(Date.parse(input.server_now)) || !Array.isArray(input.targets) || input.targets.length !== 4) return null;
  const targets = input.targets.map((target) => {
    if (!validTarget(target?.app_key, target?.os) || typeof target.display_name !== "string" || typeof target.store_identifier !== "string" || typeof target.appsflyer_app_id !== "string") return null;
    let latest = null;
    if (target.latest) {
      if (!Number.isFinite(Date.parse(target.latest.checked_at)) || !Number.isFinite(Date.parse(target.latest.stale_at)) || !Array.isArray(target.latest.results)) return null;
      const byProvider = new Map(target.latest.results.map((row) => [row?.provider, row]));
      const exactOrder = target.latest.results.map((row) => row?.provider).join(",") === PROVIDER_ORDER.join(",") && byProvider.size === 5;
      latest = { run_id: target.latest.run_id, checked_at: target.latest.checked_at, stale_at: target.latest.stale_at, duration_ms: target.latest.duration_ms, results: exactOrder ? PROVIDER_ORDER.map((provider) => normalizeResult(byProvider.get(provider), provider, target.latest.stale_at, input.server_now)) : PROVIDER_ORDER.map(missingResult) };
    }
    return { app_key: target.app_key, os: target.os, display_name: target.display_name, store_identifier: target.store_identifier, appsflyer_app_id: target.appsflyer_app_id, latest, needs_check: !latest };
  });
  if (targets.some((target) => !target) || new Set(targets.map((target) => targetKey(target.app_key, target.os))).size !== 4) return null;
  if (targets.map((target) => targetKey(target.app_key, target.os)).join(",") !== TARGET_ORDER.join(",")) return null;
  const selected = targets.find((target) => target.app_key === expectedApp && target.os === expectedOs);
  return selected ? { contract_version: 1, server_now: input.server_now, targets, selected } : null;
}

export function countsFor(latest) {
  const counts = { ready: 0, action_required: 0, blocked: 0, stale: 0 };
  latest?.results?.forEach((row) => { if (VERDICTS.has(row.verdict)) counts[row.verdict] += 1; });
  return counts;
}

export function summaryFor(latest) {
  if (!latest) return "Check this target to verify all five providers.";
  const counts = countsFor(latest);
  if (counts.stale) return "Evidence is stale. Recheck before relying on this target.";
  if (counts.blocked) return "This target is blocked until the provider issue is resolved.";
  if (counts.action_required) return "Action is required before this target can be used.";
  return counts.ready === 5 ? "Ready for a future paused app campaign." : "This target is blocked until the provider issue is resolved.";
}

export function demoteLatest(latest) {
  if (!latest) return null;
  return { ...latest, results: latest.results.map((row) => ({ ...row, verdict: "stale" })) };
}

export function refreshLatestFreshness(latest, nowMs) {
  if (!latest || !Number.isFinite(nowMs) || !Number.isFinite(Date.parse(latest.stale_at))) return latest;
  return nowMs >= Date.parse(latest.stale_at) ? demoteLatest(latest) : latest;
}

export function acceptRequest({ selectedKey, capturedKey, currentRequestId, capturedRequestId, mounted, aborted }) {
  return mounted && !aborted && selectedKey === capturedKey && currentRequestId === capturedRequestId;
}

export function shouldRestoreCompletionFocus({ pending, selectedKey, currentRequestId, phase, online, buttonDisabled }) {
  return Boolean(pending && pending.targetKey === selectedKey && pending.requestId === currentRequestId && ["idle","error"].includes(phase) && online && !buttonDisabled);
}

export function analyticsPayload(eventName, { appKey, os, provider = null, verdict = null, reasonCode = null, durationBucket = null, freshnessBucket = null }) {
  return { event_name: eventName, app_key: appKey, os, ...(provider ? { provider } : {}), ...(verdict ? { verdict } : {}), ...(reasonCode ? { reason_code: reasonCode } : {}), ...(durationBucket ? { duration_bucket: durationBucket } : {}), ...(freshnessBucket ? { freshness_bucket: freshnessBucket } : {}) };
}
