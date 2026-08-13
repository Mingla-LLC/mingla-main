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
          const [targetResult, bindingResult, measurementResult, canaryResult] =
            await Promise.all([
              db.from("ad_app_targets").select(
                "app_key,os,display_name,store_identifier,appsflyer_app_id",
              ).eq("active", true).order("app_key").order("os"),
              db.from("ad_app_provider_bindings").select(
                "app_key,os,provider,provider_contract_kind,provider_app_id,provider_measurement_id,binding_version,readiness_invalidated_at",
              ).eq("active", true),
              db.from("ad_app_measurement_configurations").select(
                "app_key,os,provider,status,partner_active,install_mapping_enabled,privacy_status,safe_measurement_id,evidence_provenance,checked_at,expires_at,configuration_version",
              ),
              db.from("ad_app_acquisition_canaries").select(
                "app_key,os,provider,status,founder_approval_reference,approved_spend_ceiling_cents,approved_currency,started_at,paused_at,safe_provider_campaign_id,evidence_expires_at,canary_version",
              ),
            ]);
          const targets = requireData(targetResult) as Array<
            Record<string, unknown>
          >;
          const bindingRows = requireData(bindingResult) as Array<
            Record<string, unknown>
          >;
          const measurementRows = requireData(measurementResult) as Array<
            Record<string, unknown>
          >;
          const canaryRows = requireData(canaryResult) as Array<
            Record<string, unknown>
          >;
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
            const targetBindings: Array<Record<string, unknown>> = bindingRows
              .filter((row) => row.app_key === appKey && row.os === os)
              .map((row) => ({
                ...row,
                measurement_configuration: measurementRows.find((item) =>
                  item.app_key === appKey && item.os === os &&
                  item.provider === row.provider
                ) ?? null,
                canary: canaryRows.find((item) =>
                  item.app_key === appKey && item.os === os &&
                  item.provider === row.provider
                ) ?? null,
              }));
            const runResult = await db.from("ad_app_readiness_runs").select(
              "id,checked_at,stale_at,duration_ms",
            ).eq("app_key", appKey).eq("os", os).order("checked_at", {
              ascending: false,
            }).order("id", { ascending: false }).limit(1).maybeSingle();
            if (runResult.error) throw new Error("database_unavailable");
            if (!runResult.data) {
              output.push({
                ...target,
                provider_contracts: targetBindings,
                latest: null,
                needs_check: true,
              });
              continue;
            }
            const latestRun = runResult.data;
            const results = requireData(
              await db.from("ad_app_readiness_results").select(
                "provider,verdict,reason_code,owner_label,action_code,action_href,payer_evidence,identity_evidence,binding_evidence,measurement_evidence,funding_evidence",
              ).eq("run_id", latestRun.id),
            );
            const canonical = ["meta", "tiktok", "snapchat", "google", "reddit"]
              .map((provider) =>
                (results as Array<Record<string, unknown>>).find((row) =>
                  row.provider === provider
                )
              );
            const invalidated = targetBindings.some((row) =>
              Date.parse(String(row.readiness_invalidated_at ?? "")) >=
                Date.parse(latestRun.checked_at)
            );
            output.push({
              ...target,
              provider_contracts: targetBindings,
              latest: {
                run_id: latestRun.id,
                checked_at: latestRun.checked_at,
                stale_at: invalidated
                  ? latestRun.checked_at
                  : latestRun.stale_at,
                duration_ms: latestRun.duration_ms,
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
        setSafeBinding: async (input) =>
          requireData(
            await db.rpc("set_ad_app_safe_binding", { p_change: input }),
          ),
      };
    },
    now: () => new Date().toISOString(),
    checks: {
      verifyAppsflyer: (target, signal, checkedAt, bindings) =>
        verifyAppsflyer(
          target,
          signal,
          checkedAt,
          readAppsFlyerMeasurement,
          bindings,
        ),
      adapters: ADAPTERS,
    },
  })
);
