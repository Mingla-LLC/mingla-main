// #2107 — OTA (JavaScript) update policy.
//
// DELIBERATELY SEPARATE from _shared/appVersionPolicy.ts and served by its own
// function. The shipped clients validate the app-version-policy response with an
// EXACT key-set check, so adding a field to that response would make every
// already-installed 1.1.2/1.1.3/1.1.4 client reject it and fail open — silently
// disarming the native gate at the exact moment #2075's enforcement is switched
// on. A new endpoint cannot regress a client that never calls it.

// @ts-ignore Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isTrustedMinglaBrowserOrigin } from "./appVersionPolicy.ts";
import { structuredLog } from "./structuredLog.ts";

export type OtaUpdateMode = "silent" | "acknowledge" | "force_restart";

export type AppOtaPolicy = {
  appId: "explorer" | "business";
  platform: "ios" | "android";
  runtimeVersion: string;
  mode: OtaUpdateMode;
  message: string;
  updatedAt: string;
};

export type AppOtaPolicyReader = (
  appId: "explorer" | "business",
  platform: "ios" | "android",
  runtimeVersion: string,
) => Promise<AppOtaPolicy | null>;

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const OTA_POLICY_REQUEST_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-mingla-app-id, x-mingla-app-platform, x-mingla-app-version, x-mingla-app-runtime-version";

/**
 * CORS lives here, not inline in the function, so the allow-list is written once
 * and reviewed once. `x-client-info` is non-negotiable: supabase-js sends it on
 * every request, and an allow-list omitting it fails the browser preflight
 * outright (ORCH-1205).
 */
export function appOtaCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowOrigin = origin === null
    ? "*"
    : isTrustedMinglaBrowserOrigin(origin)
    ? origin
    : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": OTA_POLICY_REQUEST_HEADERS,
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}

export function isOtaUpdateMode(value: unknown): value is OtaUpdateMode {
  return value === "silent" || value === "acknowledge" ||
    value === "force_restart";
}

export function isSupportedRuntimeVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

/**
 * The absent-row default. Every unknown runtime resolves to `silent`, so a lane
 * we have never rowed behaves exactly as it does today.
 */
export function silentPolicy(
  appId: "explorer" | "business",
  platform: "ios" | "android",
  runtimeVersion: string,
): AppOtaPolicy {
  return {
    appId,
    platform,
    runtimeVersion,
    mode: "silent",
    message: "",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

function isPolicyRow(
  data: unknown,
  appId: "explorer" | "business",
  platform: "ios" | "android",
  runtimeVersion: string,
): data is Record<string, string> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const row = data as Record<string, unknown>;
  return row.app_id === appId &&
    row.platform === platform &&
    row.runtime_version === runtimeVersion &&
    isOtaUpdateMode(row.mode) &&
    typeof row.message === "string" &&
    typeof row.updated_at === "string" &&
    Number.isFinite(Date.parse(row.updated_at));
}

/**
 * Pure row interpretation, extracted so the whole decision is testable without a
 * database. Returns null ONLY for a row that exists and is malformed.
 */
export function interpretOtaPolicyRow(
  data: unknown,
  appId: "explorer" | "business",
  platform: "ios" | "android",
  runtimeVersion: string,
): AppOtaPolicy | null {
  // No row for this lane is the NORMAL, EXPECTED case — not an error. It is the
  // fail-safe default and the recorded state of every runtime we have not
  // enforced. Treating it as an outage would make a healthy unenforced lane
  // indistinguishable from a broken one.
  if (data === null || data === undefined) {
    return silentPolicy(appId, platform, runtimeVersion);
  }
  if (!isPolicyRow(data, appId, platform, runtimeVersion)) return null;
  return {
    appId,
    platform,
    runtimeVersion,
    mode: data.mode as OtaUpdateMode,
    message: data.message,
    updatedAt: data.updated_at,
  };
}

export async function readAppOtaPolicy(
  appId: "explorer" | "business",
  platform: "ios" | "android",
  runtimeVersion: string,
): Promise<AppOtaPolicy | null> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (url.length === 0 || key.length === 0) {
    structuredLog("error", "app_ota_policy_unavailable", {
      fn: "app-ota-policy",
      reason: "service_configuration_missing",
    });
    return null;
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from("app_ota_policies")
    .select("app_id, platform, runtime_version, mode, message, updated_at")
    .eq("app_id", appId)
    .eq("platform", platform)
    .eq("runtime_version", runtimeVersion)
    .maybeSingle();

  if (error !== null) {
    structuredLog("error", "app_ota_policy_unavailable", {
      fn: "app-ota-policy",
      appId,
      platform,
      reason: "database_read_failed",
    });
    return null;
  }

  const policy = interpretOtaPolicyRow(data, appId, platform, runtimeVersion);
  if (policy === null) {
    structuredLog("error", "app_ota_policy_unavailable", {
      fn: "app-ota-policy",
      appId,
      platform,
      reason: "policy_row_invalid",
    });
  }
  return policy;
}
