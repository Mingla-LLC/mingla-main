// #4549 host-push-reconcile: the pure rules. No Deno, no fetch, no client at
// module scope, so every decision below runs in a test.
//
// WHY THIS EXISTS: a Host phone cannot see that Apple or Google refuse its push
// token; only the push provider knows. This sweep asks the provider (View user)
// for every push record of each recently-used Host account, stores the
// provider's verdict beside what the app reported, queues a bounded repair for
// refused records, and tells a person when an account cannot be reached.
//
// ABSENCE OF EVIDENCE IS NOT A VERDICT. A failed provider call changes nothing
// (same rule as sms-delivery-reconcile). A code the provider's documentation
// does not settle maps to `unknown`, never to a refusal.

export type ProviderState =
  | "unknown"
  | "subscribed"
  | "refused_token"
  | "refused_config"
  | "permission_off"
  | "never_prompted"
  | "unsubscribed"
  | "missing";

export type RepairState =
  | "none"
  | "requested"
  | "provider_deleted"
  | "repaired"
  | "gave_up";

export type DevicePermission = "granted" | "denied" | "not_determined";
export type Platform = "ios" | "android";

export interface DeviceRow {
  id: string | null; // null: not yet in the table
  user_id: string;
  provider_subscription_id: string;
  platform: Platform;
  device_permission: DevicePermission | null;
  last_reported_at: string;
  last_report_reason: string | null;
  provider_state: ProviderState;
  provider_status_code: number | null;
  provider_environment: number | null;
  provider_checked_at: string | null;
  repair_state: RepairState;
  repair_requests: number;
  repair_window_started_at: string | null;
  provider_deleted_at: string | null;
  created_at: string | null;
}

export interface ProviderSubscription {
  id: string;
  platform: Platform;
  notification_types: number | null;
  test_type: number | null;
}

export const MAX_USERS_PER_RUN = 40;
export const PROVIDER_MIN_INTERVAL_MS = 1_000;
export const PROVIDER_TIMEOUT_MS = 5_000;
export const MAX_CONSECUTIVE_UNAVAILABLE = 3;
export const DEFAULT_RETRY_AFTER_SECONDS = 60;
export const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;
export const MAX_REPAIR_REQUESTS = 3;
export const REPAIR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const DELETE_AFTER_MS = 24 * 60 * 60 * 1000;
export const STALE_ROW_MS = 60 * 24 * 60 * 60 * 1000;
export const ALERT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const CROWDED_ACCOUNT_RECORDS = 16;
/** #4549 P3-1: a whole run stops here, under the platform's wall-clock limit. */
export const RUN_DEADLINE_MS = 120_000;
/** #4549 P3-4: provider delete attempts per record (one success at most). */
export const MAX_PROVIDER_DELETE_ATTEMPTS = 3;
/** #4549 P2-2: a provider answer older than this no longer counts for the alert. */
export const ALERT_ANSWER_MAX_AGE_MS = 26 * 60 * 60 * 1000;
/** #4549 P2-1: while a condition persists, one reminder a day at most. */
export const ALERT_REMINDER_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Provider status codes.
// Source: OneSignal "Subscriptions" doc, section "Subscription status"
// (https://documentation.onesignal.com/docs/subscriptions), read 2026-11-22:
//   1 or any positive number  Subscribed
//   0, -99                    Never Subscribed ("has not subscribed ... yet")
//   -2                        Unsubscribed (opted out by the SDK or the API)
//   -3,-5                     Android Support Library Error
//   -4,-8,-11,-12,-29         Android Google Play Services Library Error
//   -6                        Android Invalid Google Project Number
//   -7,-9                     Android Outdated Google Play Services App
//   -10                       Not Subscribed (uninstalled, or turned off in
//                             device settings)
//   -13                       iOS missing_push_capability
//   -14,-16,-17,-30           iOS APNs Errors ("having an issue connecting to
//                             APNs")
//   -15                       iOS Simulator Error
//   -18                       Never Prompted
//   -19                       Prompted But Never Answered
//   -22                       Manually Unsubscribed via dashboard
//   -31                       Disabled via REST API
//   -32,-33,-34               Android Firebase registration errors
//   -20,-21,-23,-24 (web), -25..-28 (Huawei), -98 (SMS): not Host app push.
// The doc does not name which code the dashboard labels "APNs Bad Device
// Token"; the APNs error group is the only refusal that starts the repair
// ladder. Every code not listed above maps to `unknown`.
// ---------------------------------------------------------------------------
const APNS_ERROR_CODES = new Set([-14, -16, -17, -30]);
const CONFIG_ERROR_CODES = new Set([
  -3,
  -4,
  -5,
  -6,
  -7,
  -8,
  -9,
  -11,
  -12,
  -13,
  -15,
  -29,
  -32,
  -33,
  -34,
]);
const UNSUBSCRIBED_CODES = new Set([-2, -10, -22, -31]);
const NEVER_PROMPTED_CODES = new Set([-18, -19]);

export function mapProviderState(
  code: number | null | undefined,
  devicePermission: DevicePermission | null,
): ProviderState {
  if (typeof code !== "number" || !Number.isFinite(code)) return "unknown";
  if (code >= 1) return "subscribed";
  if (code === 0 || code === -99) {
    return devicePermission === "denied" ? "permission_off" : "never_prompted";
  }
  if (APNS_ERROR_CODES.has(code)) return "refused_token";
  if (CONFIG_ERROR_CODES.has(code)) return "refused_config";
  if (UNSUBSCRIBED_CODES.has(code)) return "unsubscribed";
  if (NEVER_PROMPTED_CODES.has(code)) return "never_prompted";
  return "unknown";
}

/** OneSignal subscription `type` to our platform; other channels are ignored. */
export function platformOf(type: unknown): Platform | null {
  if (type === "iOSPush") return "ios";
  if (type === "AndroidPush") return "android";
  return null;
}

// ---------------------------------------------------------------------------
// View user response.
// Source: OneSignal "View user" reference
// (https://documentation.onesignal.com/reference/view-user), read 2026-11-22:
//   GET https://api.onesignal.com/apps/{app_id}/users/by/{alias_label}/{alias_id}
//   Authorization: Key <App REST API key>
//   200 { identity, properties, subscriptions: [{ id, type, token, enabled,
//         notification_types, test_type, app_version, device_model, ... }] }
//   test_type: 0 or null Production, 1 Development, 2 Ad-Hoc (stored raw)
//   400 bad request, 401 missing auth, 404 not found,
//   429 rate limited (Retry-After seconds always present),
//   503 unavailable (Retry-After optional).
// Rate limits (https://documentation.onesignal.com/reference/rate-limits):
//   view endpoints (messages, templates, users) 1 request/sec/app; on 429
//   "stop sending requests immediately" and wait Retry-After.
// ---------------------------------------------------------------------------
export type ViewOutcome =
  | { kind: "ok"; subscriptions: ProviderSubscription[] }
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "auth_error"; status: number }
  | { kind: "unavailable"; reason: string };

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function parseRetryAfter(header: string | null): number {
  const parsed = header === null ? NaN : Number(header.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  return Math.min(Math.ceil(parsed), MAX_RETRY_AFTER_SECONDS);
}

export function classifyViewResponse(
  status: number,
  body: unknown,
  retryAfter: string | null,
  expectedExternalId: string,
): ViewOutcome {
  if (status === 429) {
    return {
      kind: "rate_limited",
      retryAfterSeconds: parseRetryAfter(retryAfter),
    };
  }
  if (status === 401 || status === 403) return { kind: "auth_error", status };
  if (status === 404) return { kind: "not_found" };
  if (status !== 200) return { kind: "unavailable", reason: `http_${status}` };
  if (typeof body !== "object" || body === null) {
    return { kind: "unavailable", reason: "body_not_object" };
  }
  // #4549 P3-2: the answer must be about the account we asked for (View user
  // returns `identity.external_id`). Anything else is not evidence about it.
  const identity = (body as { identity?: { external_id?: unknown } }).identity;
  if (identity?.external_id !== expectedExternalId) {
    return { kind: "unavailable", reason: "identity_mismatch" };
  }
  const subs = (body as { subscriptions?: unknown }).subscriptions;
  if (!Array.isArray(subs)) {
    return { kind: "unavailable", reason: "subscriptions_missing" };
  }
  const out: ProviderSubscription[] = [];
  for (const raw of subs) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const platform = platformOf(r.type);
    if (platform === null || typeof r.id !== "string" || r.id.length === 0) {
      continue;
    }
    out.push({
      id: r.id,
      platform,
      notification_types: intOrNull(r.notification_types),
      test_type: intOrNull(r.test_type),
    });
  }
  return { kind: "ok", subscriptions: out };
}

// Delete subscription (https://documentation.onesignal.com/reference/delete-subscription),
// read 2026-11-22: DELETE /apps/{app_id}/subscriptions/{subscription_id};
// 202 accepted (asynchronous), 404 "Subscription not found", 429 rate limited
// (Retry-After always), 400/403/503 errors. 404 means the record is already
// gone, which is the outcome the delete wanted.
export type DeleteOutcome =
  | { kind: "deleted" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "failed"; reason: string };

export function classifyDeleteResponse(
  status: number,
  retryAfter: string | null,
): DeleteOutcome {
  if (status === 202 || status === 200 || status === 404) {
    return { kind: "deleted" };
  }
  if (status === 429) {
    return {
      kind: "rate_limited",
      retryAfterSeconds: parseRetryAfter(retryAfter),
    };
  }
  return { kind: "failed", reason: `http_${status}` };
}

// ---------------------------------------------------------------------------
// Per-account plan.
// ---------------------------------------------------------------------------
function ms(iso: string | null): number | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export interface UserPlan {
  rows: DeviceRow[]; // every row after this run, new rows have id null
  deleteRowKeys: string[]; // provider_subscription_id of rows to delete at the provider
}

/**
 * The repair ladder for one row. Bounded by construction:
 * - at most MAX_REPAIR_REQUESTS requests are handed to the app per window
 *   (the report RPC counts them);
 * - at most one provider delete per row, ever (provider_deleted_at);
 * - a row still refused REPAIR_WINDOW_MS after its first request, or after a
 *   delete with no replacement, is `gave_up` and never touched again.
 */
export function advanceRepair(
  row: DeviceRow,
  now: number,
  opts: { deleteEnabled: boolean; replacedAfterDelete: boolean },
): { row: DeviceRow; wantDelete: boolean } {
  const next = { ...row };
  const windowStart = ms(row.repair_window_started_at);

  // #4549 P2-3: a record the provider shows as subscribed again is healthy,
  // whatever the ladder said before (gave_up included).
  if (
    row.provider_state === "subscribed" &&
    (row.repair_state === "gave_up" || row.repair_state === "requested")
  ) {
    next.repair_state = "repaired";
    return { row: next, wantDelete: false };
  }

  if (row.repair_state === "gave_up") return { row: next, wantDelete: false };

  if (row.repair_state === "provider_deleted") {
    const deletedAt = ms(row.provider_deleted_at) ?? now;
    if (opts.replacedAfterDelete) next.repair_state = "repaired";
    else if (now - deletedAt >= REPAIR_WINDOW_MS) next.repair_state = "gave_up";
    return { row: next, wantDelete: false };
  }

  if (row.provider_state === "subscribed") {
    if (row.repair_state === "requested" || windowStart !== null) {
      next.repair_state = "repaired";
    }
    return { row: next, wantDelete: false };
  }

  if (row.provider_state !== "refused_token") {
    return { row: next, wantDelete: false };
  }

  // Refused. A row repaired before and refused again starts one new window.
  let start = windowStart;
  if (start === null || row.repair_state === "repaired") {
    start = now;
    next.repair_window_started_at = new Date(now).toISOString();
    next.repair_requests = 0;
    next.repair_state = "none";
  }

  if (now - start >= REPAIR_WINDOW_MS) {
    next.repair_state = "gave_up";
    return { row: next, wantDelete: false };
  }

  const reportedSince = (ms(row.last_reported_at) ?? 0) > start &&
    row.last_report_reason !== null;
  if (
    opts.deleteEnabled &&
    row.provider_deleted_at === null &&
    now - start >= DELETE_AFTER_MS &&
    reportedSince &&
    next.repair_requests >= 1
  ) {
    return { row: next, wantDelete: true };
  }

  if (
    next.repair_state !== "requested" &&
    next.repair_requests < MAX_REPAIR_REQUESTS
  ) {
    next.repair_state = "requested";
  }
  return { row: next, wantDelete: false };
}

export function planUserReconcile(
  userId: string,
  existing: DeviceRow[],
  outcome: { kind: "ok"; subscriptions: ProviderSubscription[] } | {
    kind: "not_found";
  },
  now: number,
  opts: { deleteEnabled: boolean },
): UserPlan {
  const nowIso = new Date(now).toISOString();
  const bySub = new Map(existing.map((r) => [r.provider_subscription_id, r]));
  const seen = new Set<string>();
  const rows: DeviceRow[] = [];
  const subs = outcome.kind === "ok" ? outcome.subscriptions : [];

  for (const sub of subs) {
    if (seen.has(sub.id)) continue;
    seen.add(sub.id);
    const prior = bySub.get(sub.id);
    const base: DeviceRow = prior ?? {
      id: null,
      user_id: userId,
      provider_subscription_id: sub.id,
      platform: sub.platform,
      device_permission: null,
      // Never reported by the app (old client): visible, dated by this check.
      last_reported_at: nowIso,
      last_report_reason: null,
      provider_state: "unknown",
      provider_status_code: null,
      provider_environment: null,
      provider_checked_at: null,
      repair_state: "none",
      repair_requests: 0,
      repair_window_started_at: null,
      provider_deleted_at: null,
      created_at: nowIso,
    };
    rows.push({
      ...base,
      platform: sub.platform,
      provider_state: mapProviderState(
        sub.notification_types,
        base.device_permission,
      ),
      provider_status_code: sub.notification_types,
      provider_environment: sub.test_type,
      provider_checked_at: nowIso,
    });
  }
  for (const prior of existing) {
    if (seen.has(prior.provider_subscription_id)) continue;
    rows.push({
      ...prior,
      provider_state: "missing",
      provider_checked_at: nowIso,
    });
  }

  const deleteRowKeys: string[] = [];
  const finalRows = rows.map((row) => {
    const deletedAt = ms(row.provider_deleted_at);
    const replacedAfterDelete = deletedAt !== null &&
      rows.some((other) =>
        other !== row &&
        other.platform === row.platform &&
        other.provider_state === "subscribed" &&
        (ms(other.created_at) ?? now) > deletedAt
      );
    const result = advanceRepair(row, now, {
      deleteEnabled: opts.deleteEnabled,
      replacedAfterDelete,
    });
    // Never delete a record the provider shows as subscribed, or in any state
    // other than refused_token.
    if (result.wantDelete && result.row.provider_state === "refused_token") {
      deleteRowKeys.push(row.provider_subscription_id);
    }
    return result.row;
  });
  return { rows: finalRows, deleteRowKeys };
}

/** Provider and repair columns the reconciler owns; device columns are the app's. */
export const RECONCILER_COLUMNS = [
  "platform",
  "provider_state",
  "provider_status_code",
  "provider_environment",
  "provider_checked_at",
  "repair_state",
  "repair_requests",
  "repair_window_started_at",
] as const;

export function changedColumns(
  before: DeviceRow,
  after: DeviceRow,
): Partial<Record<(typeof RECONCILER_COLUMNS)[number], unknown>> {
  const patch: Partial<Record<(typeof RECONCILER_COLUMNS)[number], unknown>> =
    {};
  for (const col of RECONCILER_COLUMNS) {
    if (before[col] !== after[col]) patch[col] = after[col];
  }
  return patch;
}

export function isStaleRow(row: DeviceRow, now: number): boolean {
  const reported = ms(row.last_reported_at) ?? 0;
  const checked = ms(row.provider_checked_at) ?? 0;
  return now - Math.max(reported, checked) >= STALE_ROW_MS;
}

// ---------------------------------------------------------------------------
// Ops alert.
// ---------------------------------------------------------------------------
export interface AlertSet {
  unreachable: Array<{ user_id: string; states: string[] }>; // sorted
  refused: Array<
    { user_id: string; platform: Platform; state: ProviderState | RepairState }
  >;
  crowded: Array<{ user_id: string; records: number }>;
}

export function computeAlertSet(rows: DeviceRow[], now: number): AlertSet {
  const byUser = new Map<string, DeviceRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  const recent = (row: DeviceRow): boolean =>
    now - (ms(row.last_reported_at) ?? 0) <= ALERT_LOOKBACK_MS;

  const unreachable: AlertSet["unreachable"] = [];
  const refused: AlertSet["refused"] = [];
  const crowded: AlertSet["crowded"] = [];
  for (
    const [userId, list] of [...byUser.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )
  ) {
    const appReported = list.some((r) =>
      r.last_report_reason !== null && recent(r)
    ); // #4549 P2-2: only an account whose every record has a fresh, real
    // provider answer can be called unreachable; unchecked or `unknown`
    // records mean "not yet checked", never "no device the provider accepts".
    const answered = list.every((r) =>
      r.provider_state !== "unknown" && r.provider_checked_at !== null &&
      now - (ms(r.provider_checked_at) ?? 0) <= ALERT_ANSWER_MAX_AGE_MS
    );

    if (
      appReported && answered &&
      !list.some((r) => r.provider_state === "subscribed")
    ) {
      const states = [
        ...new Set(list.map((r) => `${r.platform}:${r.provider_state}`)),
      ].sort();
      unreachable.push({ user_id: userId, states });
    }
    for (const r of list) {
      if (!recent(r)) continue;
      if (
        r.provider_state === "refused_token" || r.repair_state === "gave_up"
      ) {
        refused.push({
          user_id: userId,
          platform: r.platform,
          state: r.repair_state === "gave_up" ? "gave_up" : "refused_token",
        });
      }
    }
    if (list.length >= CROWDED_ACCOUNT_RECORDS) {
      crowded.push({ user_id: userId, records: list.length });
    }
  }
  refused.sort((a, b) =>
    `${a.user_id}:${a.platform}:${a.state}`.localeCompare(
      `${b.user_id}:${b.platform}:${b.state}`,
    )
  );
  return { unreachable, refused, crowded };
}

export function alertSetIsEmpty(set: AlertSet): boolean {
  return set.unreachable.length === 0 && set.refused.length === 0 &&
    set.crowded.length === 0;
}

export interface AlertCounts {
  unreachable: number;
  refused: number;
  crowded: number;
}

const CATEGORIES = ["unreachable", "refused", "crowded"] as const;

export function alertCounts(set: AlertSet): AlertCounts {
  return {
    unreachable: set.unreachable.length,
    refused: set.refused.length,
    crowded: set.crowded.length,
  };
}

function parseBaseline(raw: string | null): AlertCounts | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<AlertCounts>;
    if (CATEGORIES.every((c) => typeof v[c] === "number")) {
      return v as AlertCounts;
    }
  } catch {
    // A legacy or damaged value is treated as "no alert sent yet".
  }
  return null;
}

export type AlertDecision =
  | { kind: "send"; reason: "start" | "worse" | "reminder"; baseline: string }
  | { kind: "clear" }
  | { kind: "none" };

/**
 * #4549 P2-1. One email when the condition STARTS (a category goes from none
 * to some) or MATERIALLY WORSENS (a category's count at least doubles AND
 * grows by 3 or more since the last email); while it persists, a reminder at
 * most once a day; membership churn alone never mails. The baseline (counts at
 * the last email) is stored in host_push_reconcile_state.last_alert_fingerprint
 * as JSON; when every category is back to zero it is cleared, so a new start
 * alerts again. No all-clear email.
 */
export function decideAlert(
  set: AlertSet,
  state: {
    last_alert_fingerprint: string | null;
    last_alert_at: string | null;
  },
  now: number,
): AlertDecision {
  const counts = alertCounts(set);
  const baseline = parseBaseline(state.last_alert_fingerprint);
  if (alertSetIsEmpty(set)) {
    return state.last_alert_fingerprint !== null
      ? { kind: "clear" }
      : { kind: "none" };
  }
  const stored = JSON.stringify(counts);
  if (baseline === null) {
    return { kind: "send", reason: "start", baseline: stored };
  }
  for (const c of CATEGORIES) {
    if (baseline[c] === 0 && counts[c] > 0) {
      return { kind: "send", reason: "start", baseline: stored };
    }
    if (counts[c] >= 2 * baseline[c] && counts[c] - baseline[c] >= 3) {
      return { kind: "send", reason: "worse", baseline: stored };
    }
  }
  const last = ms(state.last_alert_at);
  if (last === null || now - last >= ALERT_REMINDER_MS) {
    return { kind: "send", reason: "reminder", baseline: stored };
  }
  return { kind: "none" };
}

export function alertParagraphs(
  set: AlertSet,
  names: Map<string, string>,
): string[] {
  const label = (id: string): string =>
    names.get(id) ?? "an account with no display name";
  const counts = new Map<string, number>();
  for (const u of set.unreachable) {
    for (const s of u.states) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const paragraphs = [
    `${set.unreachable.length} Host account(s) that used the Host app in the last 7 days have no device the push provider accepts. ` +
    `${set.refused.length} device(s) are refused by Apple's push service or were given up on after repair.`,
  ];
  if (counts.size > 0) {
    paragraphs.push(
      "Devices on those accounts, by platform and provider state: " +
        [...counts.entries()].sort().map(([k, v]) => `${k} ${v}`).join(", ") +
        ".",
    );
  }
  if (set.unreachable.length > 0) {
    paragraphs.push(
      "Unreachable accounts: " +
        set.unreachable.map((u) =>
          `${label(u.user_id)} (${u.states.join(", ")})`
        ).join("; ") +
        ".",
    );
  }
  if (set.refused.length > 0) {
    paragraphs.push(
      "Refused devices: " +
        set.refused.map((r) =>
          `${label(r.user_id)} (${r.platform}, ${r.state})`
        ).join("; ") +
        ".",
    );
  }
  if (set.crowded.length > 0) {
    paragraphs.push(
      `Accounts with ${CROWDED_ACCOUNT_RECORDS} or more push records (the provider keeps 20 per account and drops the oldest): ` +
        set.crowded.map((c) => `${label(c.user_id)} (${c.records})`).join(
          "; ",
        ) + ".",
    );
  }
  paragraphs.push(
    "A refused iPhone is fixed today by deleting and reinstalling Mingla Host from the App Store, signing in and allowing notifications. (#4549)",
  );
  return paragraphs;
}
