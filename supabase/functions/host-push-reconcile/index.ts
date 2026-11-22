// #4549 host-push-reconcile: asks the push provider what it thinks of every
// Host app push record of recently-used Host accounts, stores the verdict,
// queues bounded repairs and emails ops when an account cannot be reached.
// Rules are in ./logic.ts, the run loop in ./run.ts; this file is the wiring.
//
// AUTH: service-role bearer only, the same gate sms-delivery-reconcile and
// notification-retry-sweeper use. pg_cron presents the service-role key via
// net.http_post.
//
// SCHEDULE: every 30 minutes (migration
// 20281124004549_issue_4549_host_push_device_health.sql).
//
// The request body is never read: nothing a caller sends changes what a run
// does, and the provider delete switch is the code constant
// PROVIDER_DELETE_ENABLED (off).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import { resolveAppCredentials } from "../_shared/push-utils.ts";
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import { apiHealthAlertRecipients } from "../_shared/secretBundle.ts";
import { type DeviceRow, MAX_PROVIDER_DELETE_ATTEMPTS } from "./logic.ts";
import {
  PROVIDER_DELETE_ENABLED,
  type ReconcileState,
  type ReconcileStore,
  runHostPushReconcile,
} from "./run.ts";

// Structural view of the service client: only what this function calls, so
// no second supabase-js type graph is pulled across the shared boundary.
type QueryResult = PromiseLike<
  { data: unknown; error: { message: string } | null }
>;
interface LooseQuery extends QueryResult {
  select(columns: string): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  is(column: string, value: null): LooseQuery;
  in(column: string, values: unknown[]): LooseQuery;
  limit(n: number): LooseQuery;
  maybeSingle(): QueryResult;
}
interface LooseTable {
  select(columns: string): LooseQuery;
  insert(row: Record<string, unknown>): QueryResult;
  update(patch: Record<string, unknown>): LooseQuery;
  delete(): LooseQuery;
}
interface LooseClient {
  from(table: string): LooseTable;
  rpc(fn: string, args: Record<string, unknown>): QueryResult;
}

const DEVICE_COLUMNS =
  "id,user_id,provider_subscription_id,platform,device_permission,last_reported_at,last_report_reason,provider_state,provider_status_code,provider_environment,provider_checked_at,repair_state,repair_requests,repair_window_started_at,provider_deleted_at,created_at";

function must(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): unknown {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

function makeStore(db: LooseClient): ReconcileStore {
  return {
    async candidates(limit) {
      const rows = must(
        await db.rpc("host_push_reconcile_candidates", { p_limit: limit }),
        "candidates",
      ) as Array<{ user_id: string }> | null;
      return (rows ?? []).map((r) => r.user_id);
    },
    async rowsForUser(userId) {
      return must(
        await db.from("host_push_devices").select(DEVICE_COLUMNS).eq(
          "user_id",
          userId,
        ),
        "rows_for_user",
      ) as DeviceRow[];
    },
    async insertRow(row) {
      const { id: _id, ...rest } = row;
      const result = await db.from("host_push_devices").insert(rest);
      // A concurrent report or run inserted the same record first: theirs wins.
      if (result.error && !/duplicate key/i.test(result.error.message)) {
        throw new Error(`insert_row: ${result.error.message}`);
      }
    },
    async updateRow(id, patch) {
      must(
        await db.from("host_push_devices").update(patch).eq("id", id),
        "update_row",
      );
    },
    async claimProviderDelete(id, _nowIso) {
      // One claim at a time per record, and at most
      // MAX_PROVIDER_DELETE_ATTEMPTS claims ever (#4549 P3-4).
      const rows = must(
        await db.rpc("host_push_claim_provider_delete", {
          p_id: id,
          p_max_attempts: MAX_PROVIDER_DELETE_ATTEMPTS,
        }),
        "claim_delete",
      ) as boolean | null;
      return rows === true;
    },
    async releaseProviderDelete(id) {
      must(
        await db.from("host_push_devices")
          .update({
            repair_state: "none",
            provider_deleted_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .eq("repair_state", "provider_deleted"),
        "release_delete",
      );
    },
    async deleteRows(ids) {
      must(
        await db.from("host_push_devices").delete().in("id", ids),
        "delete_rows",
      );
    },
    async allRows() {
      return must(
        await db.from("host_push_devices").select(DEVICE_COLUMNS).limit(10_000),
        "all_rows",
      ) as DeviceRow[];
    },
    async displayNames(userIds) {
      const names = new Map<string, string>();
      if (userIds.length === 0) return names;
      const rows = must(
        await db.from("creator_accounts").select("id,display_name").in(
          "id",
          userIds,
        ),
        "display_names",
      ) as Array<{ id: string; display_name: string | null }> | null;
      for (const r of rows ?? []) {
        if (r.display_name) names.set(r.id, r.display_name);
      }
      return names;
    },
    async readState() {
      const row = must(
        await db.from("host_push_reconcile_state")
          .select("last_alert_fingerprint,last_alert_at,provider_backoff_until")
          .eq("id", true)
          .maybeSingle(),
        "read_state",
      ) as ReconcileState | null;
      return row ??
        {
          last_alert_fingerprint: null,
          last_alert_at: null,
          provider_backoff_until: null,
        };
    },
    async writeState(patch) {
      must(
        await db.from("host_push_reconcile_state")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", true),
        "write_state",
      );
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (
    !serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`
  ) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  try {
    const summary = await runHostPushReconcile({
      // `as never`, the sibling pattern (payout-release-sweep): the esm.sh
      // supabase-js generics are too deep to check structurally against the
      // loose view above; runtime behaviour is the ordinary service client.
      store: makeStore(serviceClient() as never),
      credentials: resolveAppCredentials("business"),
      fetch: (input, init) => fetch(input, init),
      sendAlert: sendOpsAlertEmail,
      recipients: apiHealthAlertRecipients,
      deleteEnabled: PROVIDER_DELETE_ENABLED,
    });
    return jsonResponse(summary);
  } catch (err) {
    console.error(JSON.stringify({
      event: "host_push_reconcile_failed",
      detail: err instanceof Error ? err.message : String(err),
    }));
    return jsonResponse({ error: "reconcile_failed" }, 500);
  }
});
