/** Issue #1950 — Admin-only, read-only provider readiness control plane. */
// @ts-ignore Deno URL import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno URL import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ADAPTERS,
  handleAppReadinessRequest,
  type ReadinessDb,
} from "./handler.ts";
import {
  createAppsFlyerMeasurementReader,
  verifyAppsflyer,
} from "../_shared/adAppReadinessProviders/appsflyer.ts";
import { resolveCapiToken } from "../_shared/capiTokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const readAppsFlyerMeasurement = createAppsFlyerMeasurementReader(() =>
  resolveCapiToken("APPSFLYER_API_V2_TOKEN")
);

function requireData<T>(
  result: { data: T | null; error: { message: string } | null },
): T {
  if (result.error || result.data === null) {
    throw new Error("database_unavailable");
  }
  return result.data;
}

serve((request: Request) =>
  handleAppReadinessRequest(request, {
    authorize: async (authorization) => {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      });
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return { status: "unauthorized" as const };
      const { data: admin, error: adminError } = await userClient.rpc(
        "is_admin_user",
      );
      if (adminError || admin !== true) return { status: "forbidden" as const };
      return { status: "authorized" as const, actor: user.id };
    },
    createDb: (): ReadinessDb => {
      // Service credentials are instantiated only after the user + admin gates.
      const db = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false },
      });
      return {
        loadRegistry: async () => {
          const [targets, bindings, connections, identities] = await Promise
            .all([
              db.from("ad_app_targets").select("*"),
              db.from("ad_app_provider_bindings").select("*"),
              db.from("ad_connections").select(
                "id,platform,lane,display_name,external_account_id,external_org_id,auth_kind,token_env_var,connected,status,account_status,currency,timezone,min_daily_budget_cents,token_last_verified_at,extra",
              ).eq("lane", "consumer"),
              db.from("ad_app_provider_identities").select(
                "app_key,provider,payer_lane,expected_username,meta_page_id,meta_instagram_user_id,tiktok_identity_id,tiktok_identity_type,active",
              ),
            ]);
          return {
            targets: requireData(targets),
            bindings: requireData(bindings),
            connections: requireData(connections),
            identities: requireData(identities),
          } as never;
        },
        loadLatest: async () => {
          const targets = requireData(
            await db.from("ad_app_targets").select(
              "app_key,os,display_name,store_identifier,appsflyer_app_id",
            ).eq("active", true).order("app_key").order("os"),
          ) as Array<Record<string, unknown>>;
          const ordered = [
            ["explorer", "ios"],
            ["explorer", "android"],
            ["business", "ios"],
            ["business", "android"],
          ];
          const output = [];
          for (const [appKey, os] of ordered) {
            const target = targets.find((row) =>
              row.app_key === appKey && row.os === os
            );
            if (!target) continue;
            const runResult = await db.from("ad_app_readiness_runs").select(
              "id,checked_at,stale_at,duration_ms",
            ).eq("app_key", appKey).eq("os", os).order("checked_at", {
              ascending: false,
            }).order("id", { ascending: false }).limit(1).maybeSingle();
            if (runResult.error) throw new Error("database_unavailable");
            if (!runResult.data) {
              output.push({ ...target, latest: null, needs_check: true });
              continue;
            }
            const results = requireData(
              await db.from("ad_app_readiness_results").select(
                "provider,verdict,reason_code,owner_label,action_code,action_href,payer_evidence,identity_evidence,binding_evidence,measurement_evidence,funding_evidence",
              ).eq("run_id", runResult.data.id),
            );
            const canonical = ["meta", "tiktok", "snapchat", "google", "reddit"]
              .map((provider) =>
                (results as Array<Record<string, unknown>>).find((row) =>
                  row.provider === provider
                )
              );
            output.push({
              ...target,
              latest: {
                run_id: runResult.data.id,
                checked_at: runResult.data.checked_at,
                stale_at: runResult.data.stale_at,
                duration_ms: runResult.data.duration_ms,
                results: canonical.map((row) => ({
                  ...row,
                  evidence: {
                    payer: row?.payer_evidence,
                    identity: row?.identity_evidence,
                    binding: row?.binding_evidence,
                    measurement: row?.measurement_evidence,
                    funding: row?.funding_evidence,
                  },
                })),
              },
              needs_check: false,
            });
          }
          return output;
        },
        persist: async (run, results) =>
          requireData(
            await db.rpc("persist_ad_app_readiness_run", {
              p_run: run,
              p_results: results,
            }),
          ),
      };
    },
    now: () => new Date().toISOString(),
    checks: {
      verifyAppsflyer: (target, signal, checkedAt) =>
        verifyAppsflyer(
          target,
          signal,
          checkedAt,
          readAppsFlyerMeasurement,
        ),
      adapters: ADAPTERS,
    },
  })
);
