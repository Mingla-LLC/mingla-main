// #4549 host-push-reconcile: one run, with every outside thing injected (the
// database, the provider, the clock, the sleep, the alert sender), so the
// whole loop runs against fakes in a test. index.ts is the HTTP wiring.
//
// FAIL CLOSED, OUT LOUD: when the provider cannot answer (no credentials,
// back-off, rate limit, auth error, outage), no row changes on its account and
// the run says what it skipped in its one log line and response.

import {
  alertParagraphs,
  type AlertSet,
  alertSetIsEmpty,
  alertSetKey,
  changedColumns,
  classifyDeleteResponse,
  classifyViewResponse,
  computeAlertSet,
  type DeviceRow,
  isStaleRow,
  MAX_CONSECUTIVE_UNAVAILABLE,
  MAX_USERS_PER_RUN,
  planUserReconcile,
  PROVIDER_MIN_INTERVAL_MS,
  PROVIDER_TIMEOUT_MS,
  shouldSendAlert,
} from "./logic.ts";

/**
 * The provider delete switch. OFF, and not readable from a request: nothing a
 * caller sends can turn it on. Turning it on is a reviewed code change after
 * the team-phone test (spec #4549 TP-1) that wires it to the runtime config
 * bundle. Tests pass `deleteEnabled` in-process only.
 */
export const PROVIDER_DELETE_ENABLED = false;

export interface ReconcileState {
  last_alert_fingerprint: string | null;
  last_alert_at: string | null;
  provider_backoff_until: string | null;
}

export interface ReconcileStore {
  candidates(limit: number): Promise<string[]>;
  rowsForUser(userId: string): Promise<DeviceRow[]>;
  insertRow(row: DeviceRow): Promise<void>;
  updateRow(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Mark a row provider_deleted only if it was never deleted; true when this run won the claim. */
  claimProviderDelete(id: string, nowIso: string): Promise<boolean>;
  deleteRows(ids: string[]): Promise<void>;
  allRows(): Promise<DeviceRow[]>;
  displayNames(userIds: string[]): Promise<Map<string, string>>;
  readState(): Promise<ReconcileState>;
  writeState(patch: Partial<ReconcileState>): Promise<void>;
}

export interface ProviderCredentials {
  appId: string;
  restKey: string;
}

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<
  {
    status: number;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
  }
>;

export interface ReconcileDeps {
  store: ReconcileStore;
  credentials: ProviderCredentials;
  fetch: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  sendAlert?: (input: {
    subject: string;
    paragraphs: string[];
    recipients: string[];
    idempotencyKey?: string;
  }) => Promise<{ succeeded: number; attempted: number }>;
  recipients?: () => string[];
  hash?: (text: string) => Promise<string>;
  deleteEnabled?: boolean;
  log?: (line: string) => void;
}

export interface ReconcileSummary {
  users_checked: number;
  provider_calls: number;
  rows_inserted: number;
  rows_updated: number;
  rows_stale_removed: number;
  repairs_requested: number;
  provider_deletes: number;
  skipped_users: number;
  stopped:
    | null
    | "no_credentials"
    | "backoff"
    | "rate_limited"
    | "auth_error"
    | "provider_unavailable";
  alert: "none" | "sent" | "unchanged" | "send_failed";
}

async function defaultHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export async function runHostPushReconcile(
  deps: ReconcileDeps,
): Promise<ReconcileSummary> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((line: string) => console.log(line));
  // Strictly `true` only; anything else (absent, a string, a number) is off.
  const deleteEnabled = deps.deleteEnabled === true;
  const summary: ReconcileSummary = {
    users_checked: 0,
    provider_calls: 0,
    rows_inserted: 0,
    rows_updated: 0,
    rows_stale_removed: 0,
    repairs_requested: 0,
    provider_deletes: 0,
    skipped_users: 0,
    stopped: null,
    alert: "none",
  };

  const { store, credentials } = deps;
  const state = await store.readState();
  const startedAt = now();

  // --- Pacing: never more than one provider call per PROVIDER_MIN_INTERVAL_MS.
  let lastCallAt = Number.NEGATIVE_INFINITY;
  const paced = async (url: string, method: "GET" | "DELETE") => {
    const wait = lastCallAt + PROVIDER_MIN_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    lastCallAt = now();
    summary.provider_calls += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      return await deps.fetch(url, {
        method,
        headers: {
          Authorization: `Key ${credentials.restKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const backoffUntil = state.provider_backoff_until
    ? Date.parse(state.provider_backoff_until)
    : NaN;
  const candidates = await store.candidates(MAX_USERS_PER_RUN);
  if (!credentials.appId || !credentials.restKey) {
    summary.stopped = "no_credentials";
  } else if (Number.isFinite(backoffUntil) && backoffUntil > startedAt) {
    summary.stopped = "backoff";
  }
  const stopFor = async (
    reason: NonNullable<ReconcileSummary["stopped"]>,
    retryAfterSeconds?: number,
  ) => {
    summary.stopped = reason;
    if (retryAfterSeconds !== undefined) {
      await store.writeState({
        provider_backoff_until: new Date(now() + retryAfterSeconds * 1000)
          .toISOString(),
      });
    }
  };

  let consecutiveUnavailable = 0;
  const appPath = `https://api.onesignal.com/apps/${
    encodeURIComponent(credentials.appId)
  }`;
  for (const userId of candidates.slice(0, MAX_USERS_PER_RUN)) {
    if (summary.stopped !== null) {
      summary.skipped_users += 1;
      continue;
    }
    let outcome;
    try {
      const res = await paced(
        `${appPath}/users/by/external_id/${encodeURIComponent(userId)}`,
        "GET",
      );
      const body = res.status === 200
        ? await res.json().catch(() => null)
        : null;
      outcome = classifyViewResponse(
        res.status,
        body,
        res.headers.get("retry-after"),
      );
    } catch (err) {
      outcome = {
        kind: "unavailable" as const,
        reason: err instanceof Error ? err.name : "transport_error",
      };
    }
    if (outcome.kind === "rate_limited") {
      await stopFor("rate_limited", outcome.retryAfterSeconds);
      summary.skipped_users += 1;
      continue;
    }
    if (outcome.kind === "auth_error") {
      await stopFor("auth_error");
      summary.skipped_users += 1;
      continue;
    }
    if (outcome.kind === "unavailable") {
      // Absence of evidence: this account's rows stay exactly as they were.
      summary.skipped_users += 1;
      consecutiveUnavailable += 1;
      if (consecutiveUnavailable >= MAX_CONSECUTIVE_UNAVAILABLE) {
        await stopFor("provider_unavailable");
      }
      continue;
    }
    consecutiveUnavailable = 0;
    summary.users_checked += 1;

    const existing = await store.rowsForUser(userId);
    const plan = planUserReconcile(userId, existing, outcome, now(), {
      deleteEnabled,
    });
    const priorBySub = new Map(
      existing.map((r) => [r.provider_subscription_id, r]),
    );
    for (const row of plan.rows) {
      const prior = priorBySub.get(row.provider_subscription_id);
      if (!prior || prior.id === null) {
        await store.insertRow(row);
        summary.rows_inserted += 1;
      } else {
        const patch = changedColumns(prior, row);
        if (Object.keys(patch).length > 0) {
          await store.updateRow(prior.id, {
            ...patch,
            updated_at: new Date(now()).toISOString(),
          });
          summary.rows_updated += 1;
        }
      }
      if (
        row.repair_state === "requested" && prior?.repair_state !== "requested"
      ) {
        summary.repairs_requested += 1;
      }
    }

    for (const subId of plan.deleteRowKeys) {
      const prior = priorBySub.get(subId);
      if (!prior || prior.id === null || summary.stopped !== null) continue;
      // Claim first: a second concurrent run cannot delete the same record.
      const claimed = await store.claimProviderDelete(
        prior.id,
        new Date(now()).toISOString(),
      );
      if (!claimed) continue;
      try {
        const res = await paced(
          `${appPath}/subscriptions/${encodeURIComponent(subId)}`,
          "DELETE",
        );
        const result = classifyDeleteResponse(
          res.status,
          res.headers.get("retry-after"),
        );
        if (result.kind === "deleted") summary.provider_deletes += 1;
        else if (result.kind === "rate_limited") {
          await stopFor("rate_limited", result.retryAfterSeconds);
        } else {log(
            JSON.stringify({
              event: "host_push_provider_delete_failed",
              reason: result.reason,
            }),
          );}
      } catch (err) {
        log(JSON.stringify({
          event: "host_push_provider_delete_failed",
          reason: err instanceof Error ? err.name : "transport_error",
        }));
      }
    }
  }

  // --- Housekeeping and the alert read the database only.
  const rows = await store.allRows();
  const stale = rows.filter((r) => r.id !== null && isStaleRow(r, now())).map((
    r,
  ) => r.id as string);
  if (stale.length > 0) {
    await store.deleteRows(stale);
    summary.rows_stale_removed = stale.length;
  }
  const staleSet = new Set(stale);
  const set: AlertSet = computeAlertSet(
    rows.filter((r) => !staleSet.has(r.id ?? "")),
    now(),
  );
  if (!alertSetIsEmpty(set)) {
    const fingerprint = await (deps.hash ?? defaultHash)(alertSetKey(set));
    if (shouldSendAlert(set, fingerprint, state, now())) {
      const ids = [
        ...new Set([
          ...set.unreachable.map((u) => u.user_id),
          ...set.refused.map((u) => u.user_id),
          ...set.crowded.map((u) => u.user_id),
        ]),
      ];
      const names = await store.displayNames(ids);
      const send = deps.sendAlert;
      const result = send
        ? await send({
          subject: "Host push: accounts the Host app cannot reach",
          paragraphs: alertParagraphs(set, names),
          recipients: deps.recipients ? deps.recipients() : [],
          idempotencyKey: `host-push-reconcile:${fingerprint}:${
            Math.floor(now() / 3_600_000)
          }`,
        })
        : { succeeded: 0, attempted: 0 };
      if (result.succeeded > 0) {
        await store.writeState({
          last_alert_fingerprint: fingerprint,
          last_alert_at: new Date(now()).toISOString(),
        });
        summary.alert = "sent";
      } else {
        summary.alert = "send_failed";
      }
    } else {
      summary.alert = "unchanged";
    }
  }

  // One line per run, counts only (no account ids).
  log(
    JSON.stringify({
      event: "host_push_reconcile_run",
      ...summary,
      candidates: candidates.length,
    }),
  );
  if (summary.stopped !== null && summary.stopped !== "backoff") {
    console.error(JSON.stringify({
      event: "host_push_reconcile_stopped",
      reason: summary.stopped,
      skipped_users: summary.skipped_users,
    }));
  }
  if (summary.alert === "send_failed") {
    console.error(
      JSON.stringify({ event: "host_push_reconcile_alert_send_failed" }),
    );
  }
  return summary;
}
