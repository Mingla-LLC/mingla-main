import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUuid, sitesJson } from "../_shared/sitesContracts.ts";
import { resolveSitesAttributionPepper } from "../_shared/sitesSecurity.ts";

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

export async function handleBrandSiteAttribution(
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") return sitesJson({ ok: false }, 405);
  const origin = req.headers.get("origin") ?? "";
  if (origin !== "https://gogi.sites.usemingla.com") {
    return sitesJson({ ok: false, error: { code: "FORBIDDEN" } }, 403);
  }
  let input: Record<string, unknown>;
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    input = value as Record<string, unknown>;
  } catch {
    return sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400);
  }
  try {
    const action = String(input.action ?? "issue");
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
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
      const siteId = requireUuid(input.site_id);
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
    return sitesJson(
      {
        ok: false,
        error: {
          code: error instanceof Error &&
              error.message === "sites_security_unavailable"
            ? "SERVICE_TEMPORARILY_UNAVAILABLE"
            : "VALIDATION_FAILED",
        },
      },
      400,
    );
  }
}

if (import.meta.main) serve(handleBrandSiteAttribution);
