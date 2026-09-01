import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeSitesHost,
  sitesJson,
  verifySitesEnvelope,
} from "../_shared/sitesContracts.ts";
import { resolveRuntimeToCoreVerifier } from "../_shared/sitesSecurity.ts";
import { observeSitesRequest } from "../_shared/sitesObservability.ts";

function envelopeHeader(req: Request): unknown {
  const value = req.headers.get("x-mingla-sites-envelope");
  if (value === null || value.length > 16_384) {
    throw new Error("SIGNATURE_INVALID");
  }
  try {
    return JSON.parse(atob(value));
  } catch {
    throw new Error("SIGNATURE_INVALID");
  }
}

async function handleBrandSiteRuntimeResolveRequest(
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") return sitesJson({ ok: false }, 405);
  const path =
    new URL(req.url).pathname.replace(/^.*\/brand-site-runtime-resolve/, "") ||
    "/";
  const raw = await req.text();
  try {
    const envelope = await verifySitesEnvelope({
      envelope: envelopeHeader(req),
      expectedAudience: "mingla-core",
      expectedDirection: "runtime_to_core",
      method: req.method,
      path,
      body: raw,
      keys: resolveRuntimeToCoreVerifier(),
    });
    const value = JSON.parse(raw) as Record<string, unknown>;
    const hostname = normalizeSitesHost(String(value.hostname ?? ""));
    const routeMatch = path.match(
      /^\/internal\/v1\/hosts\/([^/]+)\/publication$/,
    );
    if (
      hostname === null || !routeMatch ||
      routeMatch[1].toLowerCase() !== hostname
    ) {
      return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    }
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { error: nonceError } = await service
      .from("brand_site_gateway_nonces")
      .insert({
        direction: envelope.direction,
        nonce: envelope.nonce,
        operation_id: envelope.operation_id,
        site_id: envelope.site_id,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
    if (nonceError) {
      return sitesJson({ ok: false, error: { code: "REPLAY_DETECTED" } }, 409);
    }
    const { data, error } = await service.rpc(
      "brand_site_resolve_publication",
      {
        p_hostname: hostname,
      },
    );
    if (error || !data || data.length === 0) {
      return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    }
    const result = data[0];
    if (String(result.site_id) !== envelope.site_id) {
      return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    }
    return sitesJson({ ok: true, data: result }, 200, {
      "Cache-Control": "private, max-age=30, stale-if-error=300",
    });
  } catch {
    return sitesJson({ ok: false, error: { code: "SIGNATURE_INVALID" } }, 403);
  }
}

export async function handleBrandSiteRuntimeResolve(
  req: Request,
): Promise<Response> {
  return await observeSitesRequest(req, {
    service: "brand-site-runtime-resolve",
    direction: "runtime_to_core",
    handler: handleBrandSiteRuntimeResolveRequest,
  });
}

if (import.meta.main) serve(handleBrandSiteRuntimeResolve);
