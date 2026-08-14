// @ts-ignore Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { structuredLog } from "./structuredLog.ts";

export type AppVersionPolicy = { appId: "explorer" | "business"; platform: "ios" | "android"; minimumVersion: string; storeUrl: string; message: string; enforcementMode: "observe" | "enforce"; updatedAt: string };
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareSemver(a: string, b: string): number | null { const aa = VERSION.exec(a); const bb = VERSION.exec(b); if (!aa || !bb) return null; for (let i = 1; i <= 3; i += 1) { const d = Number(aa[i]) - Number(bb[i]); if (d) return d; } return 0; }
export async function readAppVersionPolicy(appId: "explorer" | "business", platform: "ios" | "android"): Promise<AppVersionPolicy | null> {
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data, error } = await client.from("app_version_policies").select("app_id, platform, minimum_version, store_url, message, enforcement_mode, updated_at").eq("app_id", appId).eq("platform", platform).maybeSingle();
  if (error || !data || compareSemver(data.minimum_version, data.minimum_version) === null) return null;
  return { appId, platform, minimumVersion: data.minimum_version, storeUrl: data.store_url, message: data.message, enforcementMode: data.enforcement_mode, updatedAt: data.updated_at };
}
export async function evaluateBusinessNativeVersion(req: Request, fn: string): Promise<Response | null> {
  const origin = req.headers.get("origin");
  if (origin) return null; // Browser callers, including Business web, are exempt.
  const appId = req.headers.get("x-mingla-app-id"); const version = req.headers.get("x-mingla-app-version");
  const platformHeader = req.headers.get("x-mingla-app-platform");
  const platform = platformHeader === "ios" || platformHeader === "android" ? platformHeader : null;
  if (appId !== "business" || !platform || !version) { structuredLog("warn", "app_version_rejected", { fn, reason: "missing_or_invalid_native_headers" }); return null; }
  const policy = await readAppVersionPolicy("business", platform);
  if (!policy) { structuredLog("warn", "app_version_rejected", { fn, reason: "policy_unavailable" }); return null; }
  const comparison = compareSemver(version, policy.minimumVersion);
  const stale = comparison === null || comparison < 0;
  if (!stale) return null;
  structuredLog("warn", "app_version_rejected", { fn, reason: comparison === null ? "invalid_version" : "outdated", enforcementMode: policy.enforcementMode });
  if (policy.enforcementMode !== "enforce") return null;
  return new Response(JSON.stringify({ error: "app_update_required", minimumVersion: policy.minimumVersion, storeUrl: policy.storeUrl }), { status: 426, headers: { "Content-Type": "application/json" } });
}
