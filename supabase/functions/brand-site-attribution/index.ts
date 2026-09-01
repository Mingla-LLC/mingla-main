import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  requireUuid,
  sitesJson,
  verifySitesEnvelope,
} from "../_shared/sitesContracts.ts";
import {
  resolveRuntimeToCoreVerifier,
  resolveSitesAttributionPepper,
} from "../_shared/sitesSecurity.ts";
import { observeSitesRequest } from "../_shared/sitesObservability.ts";

const encoder = new TextEncoder();
const ALLOWED_EVENTS = new Set([
  "site_view",
  "page_view",
  "cta_click",
  "offering_view",
  "reservation_start",
  "checkout_start",
  "checkout_complete",
  "contact_click",
  "consent_granted",
  "consent_denied",
]);

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function digest(pepper: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(pepper).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(result).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function handleBrandSiteAttributionRequest(
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") return sitesJson({ ok: false }, 405);
  const path =
    new URL(req.url).pathname.replace(/^.*\/brand-site-attribution/, "") ||
    "/";
  const raw = await req.text();
  try {
    const encodedEnvelope = req.headers.get("x-mingla-sites-envelope");
    if (encodedEnvelope === null || encodedEnvelope.length > 16_384) {
      throw new Error("SIGNATURE_INVALID");
    }
    let parsedEnvelope: unknown;
    try {
      parsedEnvelope = JSON.parse(atob(encodedEnvelope));
    } catch {
      throw new Error("SIGNATURE_INVALID");
    }
    const envelope = await verifySitesEnvelope({
      envelope: parsedEnvelope,
      expectedAudience: "mingla-core",
      expectedDirection: "runtime_to_core",
      method: req.method,
      path,
      body: raw,
      keys: resolveRuntimeToCoreVerifier(),
    });
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("VALIDATION_FAILED");
    }
    const input = value as Record<string, unknown>;
    const siteId = requireUuid(input.site_id);
    const action = String(input.action ?? "issue");
    const expectedPath = action === "event"
      ? `/internal/v1/sites/${siteId}/analytics-events`
      : action === "issue"
      ? `/internal/v1/sites/${siteId}/attribution`
      : "";
    if (envelope.site_id !== siteId || path !== expectedPath) {
      throw new Error("SIGNATURE_INVALID");
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
    const pepper = resolveSitesAttributionPepper();
    if (action === "event") {
      if (
        input.consent_granted !== true ||
        !ALLOWED_EVENTS.has(String(input.event_name ?? ""))
      ) {
        return sitesJson({ ok: false, error: { code: "FORBIDDEN" } }, 403);
      }
      const eventKeys = new Set([
        "action",
        "consent_granted",
        "event_name",
        "occurred_at",
        "site_id",
        "brand_id",
        "publication_id",
        "page_role",
        "cta_kind",
        "offering_id",
        "referrer_class",
        "consent_policy_version",
        "event_id",
      ]);
      if (Object.keys(input).some((key) => !eventKeys.has(key))) {
        return sitesJson(
          { ok: false, error: { code: "VALIDATION_FAILED" } },
          400,
        );
      }
      const event = { ...input };
      delete event.action;
      delete event.consent_granted;
      const { data, error } = await service.rpc(
        "brand_site_record_analytics_event",
        { p_event: event },
      );
      return error
        ? sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400)
        : sitesJson({ ok: true, data }, 202);
    }
    if (action === "issue") {
      const issueKeys = new Set([
        "action",
        "consent_granted",
        "event_name",
        "site_id",
        "brand_id",
        "publication_id",
        "consent_policy_version",
        "source_kind",
        "source_ref",
      ]);
      if (
        Object.keys(input).some((key) => !issueKeys.has(key)) ||
        input.consent_granted !== true ||
        !ALLOWED_EVENTS.has(String(input.event_name ?? ""))
      ) {
        return sitesJson({ ok: false, error: { code: "FORBIDDEN" } }, 403);
      }
      const rawToken = token();
      const brandId = requireUuid(input.brand_id);
      const publicationId = requireUuid(input.publication_id);
      const { data: binding, error: bindingError } = await service
        .from("brand_sites")
        .select("id")
        .eq("id", siteId)
        .eq("brand_id", brandId)
        .eq("active_publication_id", publicationId)
        .eq("status", "published")
        .maybeSingle();
      if (bindingError || !binding) {
        return sitesJson({ ok: false, error: { code: "FORBIDDEN" } }, 403);
      }
      const { error } = await service.from("brand_site_attribution_touches")
        .insert({
          site_id: siteId,
          brand_id: brandId,
          publication_id: publicationId,
          token_digest: await digest(pepper, rawToken),
          consent_policy_version: String(input.consent_policy_version ?? "v1"),
          source_kind:
            ["direct", "site", "campaign"].includes(String(input.source_kind))
              ? String(input.source_kind)
              : "site",
          source_ref: typeof input.source_ref === "string" &&
              /^[A-Za-z0-9_.-]{1,80}$/.test(input.source_ref)
            ? input.source_ref
            : null,
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
      if (error) {
        return sitesJson({
          ok: false,
          error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE" },
        }, 503);
      }
      return sitesJson({
        ok: true,
        data: { token: rawToken, expires_in_seconds: 1800 },
      });
    }
    return sitesJson({ ok: false, error: { code: "FORBIDDEN" } }, 403);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VALIDATION_FAILED";
    if (code === "SIGNATURE_INVALID") {
      return sitesJson({ ok: false, error: { code } }, 403);
    }
    return sitesJson(
      {
        ok: false,
        error: {
          code: code === "sites_security_unavailable"
            ? "SERVICE_TEMPORARILY_UNAVAILABLE"
            : "VALIDATION_FAILED",
        },
      },
      code === "sites_security_unavailable" ? 503 : 400,
    );
  }
}

export async function handleBrandSiteAttribution(
  req: Request,
): Promise<Response> {
  return await observeSitesRequest(req, {
    service: "brand-site-attribution",
    direction: "public_to_core",
    handler: handleBrandSiteAttributionRequest,
  });
}

if (import.meta.main) serve(handleBrandSiteAttribution);
