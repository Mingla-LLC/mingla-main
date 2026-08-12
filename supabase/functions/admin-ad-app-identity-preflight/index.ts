/**
 * Issue #1928 — mutation-free Admin preflight for exact app/public identities.
 * Provider access is GET-only except Meta's execution_options=["validate_only"]
 * creative probe, which must return no object id. Results are never persisted.
 */

// @ts-ignore — Deno ESM import; types resolve at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolve at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AdConnectionRow } from "../_shared/adChannel.ts";
import {
  type AdAdvertisingAppRow,
  type AdAppKey,
  type AdAppProviderIdentityRow,
  type AdIdentityProvider,
  type AdIdentityReasonCode,
  isAdAppKey,
  isIdentityProvider,
  parseAdvertisingApp,
  type ParsedProviderIdentity,
  parseProviderIdentity,
  resolvePayerConnection,
  selectExactTikTokIdentity,
} from "../_shared/adAppIdentityRegistry.ts";
import {
  metaCheckPageAdvertiseTaskForIdentity,
  metaFetchIgBusinessAccountForIdentity,
  metaValidateOnlyCreativeProbeForIdentity,
  resolveMetaClient,
} from "../_shared/meta.ts";
import {
  resolveTikTokClient,
  tiktokFetchAdvertiser,
  tiktokFetchIdentities,
} from "../_shared/tiktok.ts";
import { evaluateMetaIdentityAuthority } from "./metaIdentityAuthority.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PROVIDERS: readonly AdIdentityProvider[] = ["meta", "tiktok"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

interface CheckRow {
  code: string;
  status: "pass" | "fail";
  reason_code: AdIdentityReasonCode | null;
}

interface ProviderResult {
  provider: AdIdentityProvider;
  verdict: "ready" | "blocked";
  payer:
    | { connection_id: string; external_account_id: string; status: string }
    | null;
  expected_identity: Record<string, string> | null;
  matched_identity: Record<string, string> | null;
  checks: CheckRow[];
  reason_code?: AdIdentityReasonCode;
}

function expectedShape(
  identity: ParsedProviderIdentity | null,
): Record<string, string> | null {
  if (!identity) return null;
  if (identity.provider === "meta") {
    return {
      username: identity.expected_username,
      page_id: identity.meta_page_id,
      instagram_user_id: identity.meta_instagram_user_id,
    };
  }
  return {
    username: identity.expected_username,
    identity_id: identity.tiktok_identity_id,
    identity_type: identity.tiktok_identity_type,
  };
}

function blocked(
  provider: AdIdentityProvider,
  reason: AdIdentityReasonCode,
  identity: ParsedProviderIdentity | null = null,
  connection: AdConnectionRow | null = null,
  checks: CheckRow[] = [],
): ProviderResult {
  return {
    provider,
    verdict: "blocked",
    payer: connection
      ? {
        connection_id: connection.id,
        external_account_id: connection.external_account_id,
        status: connection.status,
      }
      : null,
    expected_identity: expectedShape(identity),
    matched_identity: null,
    checks: [...checks, {
      code: "identity_ready",
      status: "fail",
      reason_code: reason,
    }],
    reason_code: reason,
  };
}

function payerShape(connection: AdConnectionRow) {
  return {
    connection_id: connection.id,
    external_account_id: connection.external_account_id,
    status: connection.status,
  };
}

function providerFailureReason(error: unknown): AdIdentityReasonCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code === "network_error" || code === "429" || /^5\d\d$/.test(code)) {
      return "provider_unreachable";
    }
  }
  return "provider_response_invalid";
}

async function runMeta(
  identity: Extract<ParsedProviderIdentity, { provider: "meta" }>,
  connection: AdConnectionRow,
): Promise<ProviderResult> {
  const checks: CheckRow[] = [{
    code: "payer_connected",
    status: "pass",
    reason_code: null,
  }];
  try {
    const client = resolveMetaClient(connection);
    if (connection.external_account_id !== client.config.adAccountId) {
      return blocked(
        "meta",
        "payer_account_mismatch",
        identity,
        connection,
        checks,
      );
    }
    const authority = await evaluateMetaIdentityAuthority({
      pageId: identity.meta_page_id,
      instagramUserId: identity.meta_instagram_user_id,
    }, {
      checkPageAuthorization: (pageId) =>
        metaCheckPageAdvertiseTaskForIdentity(client, pageId),
      fetchPageLinkedInstagram: (pageId) =>
        metaFetchIgBusinessAccountForIdentity(client, pageId),
      validateExactIdentity: (exactIdentity) =>
        metaValidateOnlyCreativeProbeForIdentity(client, exactIdentity),
    });
    if (authority.reason === "meta_page_not_authorized") {
      return blocked(
        "meta",
        "meta_page_not_authorized",
        identity,
        connection,
        checks,
      );
    }
    checks.push({
      code: "identity_exact_match",
      status: "pass",
      reason_code: null,
    });
    if (authority.pageLinkDiagnostic !== "match") {
      console.info(JSON.stringify({
        event: "meta_page_link_diagnostic",
        status: authority.pageLinkDiagnostic,
      }));
    }
    if (authority.verdict === "blocked") {
      return blocked(
        "meta",
        "meta_validate_only_failed",
        identity,
        connection,
        checks,
      );
    }
    checks.push(
      { code: "identity_authorized", status: "pass", reason_code: null },
      { code: "identity_available", status: "pass", reason_code: null },
    );
    return {
      provider: "meta",
      verdict: "ready",
      payer: payerShape(connection),
      expected_identity: expectedShape(identity),
      matched_identity: {
        username: identity.expected_username,
        page_id: identity.meta_page_id,
        instagram_user_id: identity.meta_instagram_user_id,
        availability: "AVAILABLE",
      },
      checks,
    };
  } catch (error) {
    return blocked(
      "meta",
      providerFailureReason(error),
      identity,
      connection,
      checks,
    );
  }
}

async function runTikTok(
  identity: Extract<ParsedProviderIdentity, { provider: "tiktok" }>,
  connection: AdConnectionRow,
): Promise<ProviderResult> {
  const checks: CheckRow[] = [{
    code: "payer_connected",
    status: "pass",
    reason_code: null,
  }];
  try {
    const client = resolveTikTokClient(connection);
    const advertiser = await tiktokFetchAdvertiser(client);
    if (
      client.advertiserId !== connection.external_account_id ||
      advertiser.advertiserId !== connection.external_account_id
    ) {
      return blocked(
        "tiktok",
        "payer_account_mismatch",
        identity,
        connection,
        checks,
      );
    }
    const identities = await tiktokFetchIdentities(client);
    const selected = selectExactTikTokIdentity(identities, identity);
    if (!selected.identity || selected.reason) {
      return blocked(
        "tiktok",
        selected.reason ?? "identity_not_found",
        identity,
        connection,
        checks,
      );
    }
    checks.push(
      { code: "identity_exact_match", status: "pass", reason_code: null },
      { code: "identity_authorized", status: "pass", reason_code: null },
      { code: "identity_available", status: "pass", reason_code: null },
    );
    return {
      provider: "tiktok",
      verdict: "ready",
      payer: payerShape(connection),
      expected_identity: expectedShape(identity),
      matched_identity: {
        username: selected.identity.username ?? identity.expected_username,
        identity_id: selected.identity.identityId,
        identity_type: selected.identity.identityType,
        availability: selected.identity.availableStatus ?? "",
      },
      checks,
    };
  } catch (error) {
    return blocked(
      "tiktok",
      providerFailureReason(error),
      identity,
      connection,
      checks,
    );
  }
}

function parseRequest(
  body: unknown,
): { appKey: AdAppKey; providers: AdIdentityProvider[] } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => key !== "app_key" && key !== "providers")
  ) return null;
  if (!isAdAppKey(row.app_key)) return null;
  const providers = row.providers === undefined
    ? [...PROVIDERS]
    : row.providers;
  if (
    !Array.isArray(providers) || providers.length === 0 ||
    providers.some((provider) => !isIdentityProvider(provider)) ||
    new Set(providers).size !== providers.length
  ) return null;
  const requested = new Set(providers as AdIdentityProvider[]);
  return {
    appKey: row.app_key,
    providers: PROVIDERS.filter((provider) => requested.has(provider)),
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: isAdmin, error: adminError } = await userClient.rpc(
    "is_admin_user",
  );
  if (adminError) return json({ error: "internal_error" }, 500);
  if (isAdmin !== true) return json({ error: "forbidden" }, 403);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "validation_error" }, 400);
  }
  const request = parseRequest(rawBody);
  if (!request) return json({ error: "validation_error" }, 400);

  // Service role is created only after both authentication and admin authorization.
  const service = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [
    { data: appRows, error: appError },
    { data: identityRows, error: identityError },
    { data: connectionRows, error: connectionError },
  ] = await Promise.all([
    service.from("ad_advertising_apps").select("app_key,display_name,active")
      .eq("app_key", request.appKey),
    service.from("ad_app_provider_identities").select("*").eq(
      "app_key",
      request.appKey,
    ).in("provider", request.providers),
    service.from("ad_connections").select("*").in(
      "platform",
      request.providers,
    ),
  ]);
  if (appError || identityError || connectionError) {
    return json({ error: "internal_error" }, 500);
  }

  const app = parseAdvertisingApp(
    (appRows ?? []) as AdAdvertisingAppRow[],
    request.appKey,
  );
  const results: ProviderResult[] = [];
  for (const provider of request.providers) {
    if (app.reason) {
      results.push(blocked(provider, app.reason));
      continue;
    }
    const parsed = parseProviderIdentity(
      (identityRows ?? []) as AdAppProviderIdentityRow[],
      request.appKey,
      provider,
    );
    if (!parsed.identity || parsed.reason) {
      results.push(
        blocked(provider, parsed.reason ?? "identity_registry_invalid"),
      );
      continue;
    }
    const payer = resolvePayerConnection(
      (connectionRows ?? []) as AdConnectionRow[],
      parsed.identity,
    );
    if (!payer.connection || payer.reason) {
      results.push(
        blocked(
          provider,
          payer.reason ?? "payer_connection_missing",
          parsed.identity,
          payer.connection,
        ),
      );
      continue;
    }
    results.push(
      parsed.identity.provider === "meta"
        ? await runMeta(parsed.identity, payer.connection)
        : await runTikTok(parsed.identity, payer.connection),
    );
  }

  return json({
    app_key: request.appKey,
    checked_at: new Date().toISOString(),
    overall: results.every((row) => row.verdict === "ready")
      ? "ready"
      : "blocked",
    providers: results,
  });
});
