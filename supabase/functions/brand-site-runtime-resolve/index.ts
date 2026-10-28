import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeSitesHost,
  SITES_HOST_RESOLUTION_SITE_ID,
  sitesJson,
  verifySitesEnvelope,
} from "../_shared/sitesContracts.ts";
import {
  resolveRuntimeToCoreVerifier,
  SITES_SHARE_TOKEN_RE,
  sitesShareTokenDigest,
} from "../_shared/sitesSecurity.ts";
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
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    // #2829 W4 — the live offerings feed for ONE site. The site is the one the
    // runtime resolved for the request host and signed for: the path, the
    // signed envelope and the body must all name it, or nothing is read.
    const offeringsMatch = path.match(
      /^\/internal\/v1\/sites\/([0-9a-f-]{36})\/offerings$/i,
    );
    if (offeringsMatch) {
      const siteId = offeringsMatch[1].toLowerCase();
      if (
        envelope.site_id === SITES_HOST_RESOLUTION_SITE_ID ||
        envelope.site_id !== siteId ||
        value.site_id !== siteId
      ) {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      const { data: feed, error: feedError } = await service.rpc(
        "brand_site_offerings_feed",
        { p_site_id: siteId },
      );
      if (feedError || !feed) {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      const { error: feedNonceError } = await service
        .from("brand_site_gateway_nonces")
        .insert({
          direction: envelope.direction,
          nonce: envelope.nonce,
          operation_id: envelope.operation_id,
          site_id: siteId,
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
      if (feedNonceError) {
        return sitesJson({ ok: false, error: { code: "REPLAY_DETECTED" } }, 409);
      }
      // Storage paths only, never signed URLs: the runtime serves covers
      // through its own token-bound media route.
      return sitesJson({ ok: true, data: feed }, 200, {
        "Cache-Control": "private, max-age=60, stale-if-error=300",
      });
    }
    // #2829 W5 (amendment A4) — may this site's contact form be shown? Mingla's
    // brand page answers the same question from `business_public_brands_view`
    // (`enquiries_enabled`, `enquiries_available`, #4111). Same site binding as
    // the feed. A view without those columns (before #4111 lands) or any read
    // failure answers "unknown": the site still shows the form, and a refused
    // send is shown to the visitor, never hidden.
    const enquiryMatch = path.match(
      /^\/internal\/v1\/sites\/([0-9a-f-]{36})\/enquiry-status$/i,
    );
    if (enquiryMatch) {
      const siteId = enquiryMatch[1].toLowerCase();
      if (
        envelope.site_id === SITES_HOST_RESOLUTION_SITE_ID ||
        envelope.site_id !== siteId ||
        value.site_id !== siteId
      ) {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      const { data: site, error: siteError } = await service
        .from("brand_sites")
        .select("brand_id")
        .eq("id", siteId)
        .maybeSingle();
      if (siteError || !site?.brand_id) {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      const { error: statusNonceError } = await service
        .from("brand_site_gateway_nonces")
        .insert({
          direction: envelope.direction,
          nonce: envelope.nonce,
          operation_id: envelope.operation_id,
          site_id: siteId,
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
      if (statusNonceError) {
        return sitesJson({ ok: false, error: { code: "REPLAY_DETECTED" } }, 409);
      }
      const { data: brand, error: brandError } = await service
        .from("business_public_brands_view")
        .select("enquiries_enabled, enquiries_available")
        .eq("id", site.brand_id)
        .maybeSingle();
      const status = brandError || !brand ||
          typeof brand.enquiries_enabled !== "boolean" ||
          typeof brand.enquiries_available !== "boolean"
        ? "unknown"
        : brand.enquiries_enabled && brand.enquiries_available
        ? "available"
        : "unavailable";
      return sitesJson({ ok: true, data: { status } }, 200, {
        "Cache-Control": "private, max-age=60, stale-if-error=300",
      });
    }
    // #2829 W10 — a private share-preview link, for the site the runtime
    // resolved for the request host (path, envelope and body must all name
    // it). Core answers that site's newest built preview, or nothing; an
    // expired, revoked or foreign token reads as not found.
    const shareMatch = path.match(
      /^\/internal\/v1\/sites\/([0-9a-f-]{36})\/share-preview$/i,
    );
    if (shareMatch) {
      const siteId = shareMatch[1].toLowerCase();
      const token = typeof value.token === "string" ? value.token : "";
      if (
        envelope.site_id === SITES_HOST_RESOLUTION_SITE_ID ||
        envelope.site_id !== siteId ||
        value.site_id !== siteId ||
        !SITES_SHARE_TOKEN_RE.test(token)
      ) {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      const { error: shareNonceError } = await service
        .from("brand_site_gateway_nonces")
        .insert({
          direction: envelope.direction,
          nonce: envelope.nonce,
          operation_id: envelope.operation_id,
          site_id: siteId,
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
      if (shareNonceError) {
        return sitesJson({ ok: false, error: { code: "REPLAY_DETECTED" } }, 409);
      }
      const { data: link, error: linkError } = await service.rpc(
        "brand_site_resolve_preview_link",
        { p_site_id: siteId, p_token_digest: await sitesShareTokenDigest(token) },
      );
      if (linkError || !link || typeof link !== "object") {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      const answer = link as Record<string, unknown>;
      return sitesJson({
        ok: true,
        data: { site_id: siteId, artifact_key: answer.artifact_key, expires_at: answer.expires_at },
      }, 200, { "Cache-Control": "no-store" });
    }
    const hostname = normalizeSitesHost(String(value.hostname ?? ""));
    // `/publication`: the live publication for a host. `/site`: only which
    // site a host belongs to (previews of a not-yet-published site).
    // `/probe` (#2829 W8): which site a custom domain is being attached to,
    // for the runtime's /.well-known/mingla-site answer (a hash of the id).
    const routeMatch = path.match(
      /^\/internal\/v1\/hosts\/([^/]+)\/(publication|site|probe)$/,
    );
    if (
      hostname === null || !routeMatch ||
      routeMatch[1].toLowerCase() !== hostname
    ) {
      return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    }
    // #2829 — Core is the authority on which site a host belongs to. Any
    // well-formed host is looked up; an unknown, revoked, deleted, offline or
    // unpublished one is simply absent from the resolver.
    const { data, error } = await service.rpc(
      routeMatch[2] === "site"
        ? "brand_site_resolve_host"
        : routeMatch[2] === "probe"
        ? "brand_site_resolve_probe_host"
        : "brand_site_resolve_publication",
      {
        p_hostname: hostname,
      },
    );
    if (error || !data || data.length === 0) {
      return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    }
    const result = data[0];
    const resolvedSiteId = String(result.site_id);
    // #2829 — a runtime that signs for a specific site only ever receives that
    // site. A host resolution (the runtime does not know the site yet) is
    // signed with the host-resolution id, and the signed path pins the host.
    if (
      envelope.site_id !== SITES_HOST_RESOLUTION_SITE_ID &&
      resolvedSiteId !== envelope.site_id
    ) {
      return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    }
    const { error: nonceError } = await service
      .from("brand_site_gateway_nonces")
      .insert({
        direction: envelope.direction,
        nonce: envelope.nonce,
        operation_id: envelope.operation_id,
        site_id: resolvedSiteId,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
    if (nonceError) {
      return sitesJson({ ok: false, error: { code: "REPLAY_DETECTED" } }, 409);
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
