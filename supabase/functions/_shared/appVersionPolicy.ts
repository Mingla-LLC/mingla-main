// @ts-ignore Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { structuredLog } from "./structuredLog.ts";

export type AppVersionPolicy = {
  appId: "explorer" | "business";
  platform: "ios" | "android";
  minimumVersion: string;
  storeUrl: string;
  message: string;
  enforcementMode: "observe" | "enforce";
  updatedAt: string;
};

export type AppVersionPolicyReader = (
  appId: "explorer" | "business",
  platform: "ios" | "android",
) => Promise<AppVersionPolicy | null>;

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TRUSTED_BROWSER_ORIGINS = new Set([
  "https://host.usemingla.com",
  "https://admin.usemingla.com",
  "https://usemingla.com",
  "https://www.usemingla.com",
  "http://localhost:3000",
  "http://localhost:8081",
  "http://localhost:19006",
]);

export const APP_VERSION_REQUEST_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-mingla-app-id, x-mingla-app-platform, x-mingla-app-version";

export function compareSemver(a: string, b: string): number | null {
  const left = VERSION_PATTERN.exec(a);
  const right = VERSION_PATTERN.exec(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index += 1) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment.length !== rightSegment.length) {
      return leftSegment.length > rightSegment.length ? 1 : -1;
    }
    if (leftSegment !== rightSegment) {
      return leftSegment > rightSegment ? 1 : -1;
    }
  }
  return 0;
}

export function isTrustedMinglaBrowserOrigin(origin: string | null): boolean {
  if (origin === null) return false;
  if (TRUSTED_BROWSER_ORIGINS.has(origin)) return true;
  const configuredOrigin = Deno.env.get("BUSINESS_WEB_ORIGIN")?.trim();
  if (configuredOrigin === undefined || configuredOrigin !== origin) return false;
  try {
    const url = new URL(configuredOrigin);
    return url.protocol === "https:" && url.origin === configuredOrigin;
  } catch {
    return false;
  }
}

export function appVersionCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowOrigin = origin === null
    ? "*"
    : isTrustedMinglaBrowserOrigin(origin)
    ? origin
    : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": APP_VERSION_REQUEST_HEADERS,
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}

function isPolicyRow(
  data: unknown,
  appId: "explorer" | "business",
  platform: "ios" | "android",
): data is Record<string, string> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const row = data as Record<string, unknown>;
  return row.app_id === appId &&
    row.platform === platform &&
    typeof row.minimum_version === "string" &&
    VERSION_PATTERN.test(row.minimum_version) &&
    typeof row.store_url === "string" &&
    row.store_url.startsWith("https://") &&
    typeof row.message === "string" &&
    row.message.trim().length > 0 &&
    (row.enforcement_mode === "observe" ||
      row.enforcement_mode === "enforce") &&
    typeof row.updated_at === "string" &&
    Number.isFinite(Date.parse(row.updated_at));
}

export async function readAppVersionPolicy(
  appId: "explorer" | "business",
  platform: "ios" | "android",
): Promise<AppVersionPolicy | null> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (url.length === 0 || key.length === 0) {
    structuredLog("error", "app_version_policy_unavailable", {
      fn: "app-version-policy",
      reason: "service_configuration_missing",
    });
    return null;
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from("app_version_policies")
    .select(
      "app_id, platform, minimum_version, store_url, message, enforcement_mode, updated_at",
    )
    .eq("app_id", appId)
    .eq("platform", platform)
    .maybeSingle();
  if (error !== null || !isPolicyRow(data, appId, platform)) {
    structuredLog("error", "app_version_policy_unavailable", {
      fn: "app-version-policy",
      appId,
      platform,
      reason: error !== null
        ? "database_read_failed"
        : "policy_missing_or_invalid",
    });
    return null;
  }
  return {
    appId,
    platform,
    minimumVersion: data.minimum_version,
    storeUrl: data.store_url,
    message: data.message,
    enforcementMode: data.enforcement_mode as "observe" | "enforce",
    updatedAt: data.updated_at,
  };
}

function rejection(
  req: Request,
  policy?: AppVersionPolicy,
): Response {
  return new Response(
    JSON.stringify({
      error: "app_update_required",
      ...(policy === undefined ? {} : {
        minimumVersion: policy.minimumVersion,
        storeUrl: policy.storeUrl,
      }),
    }),
    { status: 426, headers: appVersionCorsHeaders(req) },
  );
}

export async function evaluateBusinessNativeVersion(
  req: Request,
  fn: string,
  readPolicy: AppVersionPolicyReader = readAppVersionPolicy,
): Promise<Response | null> {
  const origin = req.headers.get("origin");
  if (isTrustedMinglaBrowserOrigin(origin)) return null;

  const appId = req.headers.get("x-mingla-app-id");
  const version = req.headers.get("x-mingla-app-version");
  const platformHeader = req.headers.get("x-mingla-app-platform");
  const platform = platformHeader === "ios" || platformHeader === "android"
    ? platformHeader
    : null;

  if (platform === null) {
    const policies = await Promise.all([
      readPolicy("business", "ios"),
      readPolicy("business", "android"),
    ]);
    const enforce = policies.some((policy) =>
      policy?.enforcementMode === "enforce"
    );
    structuredLog("warn", "app_version_rejected", {
      fn,
      reason: "missing_or_invalid_platform",
      enforcementMode: enforce ? "enforce" : "observe",
      originClass: origin === null ? "none" : "untrusted",
    });
    return enforce ? rejection(req) : null;
  }

  const policy = await readPolicy("business", platform);
  if (policy === null) {
    structuredLog("warn", "app_version_policy_unavailable", {
      fn,
      platform,
      reason: "policy_unavailable_fail_open",
    });
    return null;
  }

  const comparison = version === null
    ? null
    : compareSemver(version, policy.minimumVersion);
  const reason = appId !== "business"
    ? "missing_or_invalid_app_id"
    : version === null || comparison === null
    ? "missing_or_invalid_version"
    : comparison < 0
    ? "outdated"
    : null;
  if (reason === null) return null;

  structuredLog("warn", "app_version_rejected", {
    fn,
    platform,
    reason,
    enforcementMode: policy.enforcementMode,
    versionBucket: reason === "outdated" ? "below_minimum" : "invalid",
    originClass: origin === null ? "none" : "untrusted",
  });
  return policy.enforcementMode === "enforce" ? rejection(req, policy) : null;
}
