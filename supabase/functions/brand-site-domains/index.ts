// #2829 W8 (AD-10) — a brand's own domain on its Mingla website.
//
// verify_jwt = true (supabase/config.toml). Customer routes act as the signed-
// in user: every write goes through a rank-checked Core RPC (brand admin and
// above manage; rank 20-49 read). The sweep route additionally requires the
// service-role bearer, compared in code.
//
//   GET    /v1/sites/<id>/domains                    list (rank 20)
//   POST   /v1/sites/<id>/domains                    attach -> provider add -> records
//   POST   /v1/sites/<id>/domains/<hostId>/check     check now (rank 50, or a Mingla admin)
//   POST   /v1/sites/<id>/domains/<hostId>/primary   make this the main address
//   DELETE /v1/sites/<id>/domains/<hostId>           disconnect (primary moves first)
//   POST   /internal/v1/domains/sweep                every 6 hours (pg_cron)
//
// Like brand-site-control, a POST to the function root may carry `route` and
// `method` in its body (supabase.functions.invoke sends POST only).
//
// Mode: a `local` service config row inside a local stack uses the local
// provider, resolver and probe (no secrets); otherwise production uses the
// hosting provider adapter with VERCEL_SITES_API_TOKEN, VERCEL_SITES_PROJECT_ID
// and VERCEL_SITES_TEAM_ID. Without them the function refuses to attach
// (nothing half-made) and the sweep does nothing.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUuid, sitesJson } from "../_shared/sitesContracts.ts";
import { guardSitesEnvironment } from "../_shared/sitesSecurity.ts";
import { observeSitesRequest } from "../_shared/sitesObservability.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkDomain,
  classifyCustomHostname,
  type DnsResolver,
  DohDnsResolver,
  type DomainProvider,
  DomainProviderError,
  HttpsSiteProbe,
  LocalDnsResolver,
  LocalDomainProvider,
  LocalSiteProbe,
  type ProviderDomainState,
  registrableDomain,
  type SiteProbe,
  VercelDomainProvider,
} from "../_shared/siteDomains.ts";

type JsonObject = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Client = any;

export const DOMAIN_FAILURE_MESSAGES = {
  FORBIDDEN: "Only brand admins and owners can change your website's addresses.",
  NOT_FOUND: "Mingla couldn't find that address on this website.",
  VALIDATION_FAILED: "Check the address and try again.",
  DOMAIN_INVALID: "Enter a domain you own, like yourbrand.com or www.yourbrand.com.",
  DOMAIN_TAKEN: "That address is already connected to a Mingla website.",
  DOMAIN_LIMIT: "A website can have up to 4 of your own addresses. Disconnect one first.",
  DOMAIN_IN_USE:
    "That address is connected to another website service. Remove it there, then add it here again.",
  INVALID_STATE: "That address isn't ready for this step yet.",
  IDEMPOTENCY_CONFLICT: "That request was already used for something else. Try again.",
  CHECK_UNAVAILABLE: "Mingla couldn't check your address right now. Try again in a few minutes.",
  SERVICE_TEMPORARILY_UNAVAILABLE: "Website addresses are temporarily unavailable.",
} as const;
export type DomainFailureCode = keyof typeof DOMAIN_FAILURE_MESSAGES;

function failure(code: DomainFailureCode, status: number, operationId: string | null = null): Response {
  return sitesJson({
    ok: false,
    error: {
      code,
      message: DOMAIN_FAILURE_MESSAGES[code],
      retryable: code === "CHECK_UNAVAILABLE" || code === "SERVICE_TEMPORARILY_UNAVAILABLE",
      operation_id: operationId,
    },
  }, status);
}

/** Core RPC error text -> customer code. */
export function failureForRpc(message: string | undefined, operationId: string | null): Response {
  const text = message ?? "";
  if (text.includes("sites_forbidden")) return failure("FORBIDDEN", 403, operationId);
  if (text.includes("sites_domain_taken")) return failure("DOMAIN_TAKEN", 409, operationId);
  if (text.includes("sites_domain_limit")) return failure("DOMAIN_LIMIT", 409, operationId);
  if (text.includes("sites_domain_invalid")) return failure("DOMAIN_INVALID", 400, operationId);
  if (text.includes("sites_idempotency_conflict")) return failure("IDEMPOTENCY_CONFLICT", 409, operationId);
  if (text.includes("sites_not_found")) return failure("NOT_FOUND", 404, operationId);
  if (text.includes("sites_invalid_state")) return failure("INVALID_STATE", 409, operationId);
  if (text.includes("sites_validation_failed")) return failure("VALIDATION_FAILED", 400, operationId);
  return failure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
}

export interface DomainDeps {
  mode: "local" | "production";
  provider: DomainProvider | null;
  dns: DnsResolver;
  probe: SiteProbe;
}

const LOCAL_PROBE_ORIGIN_RE =
  /^http:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5}$/;

/**
 * Which adapters this call uses. Local adapters only when the service config
 * row is 'local' AND the environment guard accepts it (a local row reaching a
 * hosted project is refused, AD-12); production adapters otherwise.
 */
export async function resolveDomainDeps(service: Client): Promise<DomainDeps | null> {
  const { data } = await service
    .from("brand_site_service_config")
    .select("environment,cms_origin")
    .eq("config_key", "sites_v1")
    .maybeSingle();
  if (!data) return null;
  try {
    guardSitesEnvironment(data.environment, data.cms_origin);
  } catch {
    return null;
  }
  if (data.environment === "local") {
    const origin = Deno.env.get("SITES_LOCAL_PROBE_ORIGIN") ?? "";
    return {
      mode: "local",
      provider: new LocalDomainProvider(service),
      dns: new LocalDnsResolver(service),
      // No probe origin configured -> the probe fails and nothing activates.
      probe: LOCAL_PROBE_ORIGIN_RE.test(origin)
        ? new LocalSiteProbe(origin)
        : { probe: () => Promise.resolve(false) },
    };
  }
  let provider: DomainProvider | null = null;
  try {
    provider = new VercelDomainProvider({
      token: Deno.env.get("VERCEL_SITES_API_TOKEN") ?? "",
      projectId: Deno.env.get("VERCEL_SITES_PROJECT_ID") ?? "",
      teamId: Deno.env.get("VERCEL_SITES_TEAM_ID") ?? "",
    });
  } catch {
    provider = null;
  }
  return { mode: "production", provider, dns: new DohDnsResolver(), probe: new HttpsSiteProbe() };
}

function relativePath(req: Request): string {
  const path = new URL(req.url).pathname;
  const marker = "/brand-site-domains";
  const index = path.indexOf(marker);
  return index < 0 ? path : (path.slice(index + marker.length) || "/");
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

interface HostRow {
  id: string;
  site_id: string;
  hostname: string;
  kind: string;
  status: string;
  is_apex: boolean;
  provider_ref: string | null;
  redirect_until: string | null;
}

async function hostOfSite(service: Client, siteId: string, hostId: string): Promise<HostRow | null> {
  const { data } = await service
    .from("brand_site_hosts")
    .select("id,site_id,hostname,kind,status,is_apex,provider_ref,redirect_until")
    .eq("id", hostId)
    .eq("site_id", siteId)
    .maybeSingle();
  return (data as HostRow | null) ?? null;
}

/** Runs one check and records it. Provider outages throw (no drift). */
export async function runCheck(
  deps: DomainDeps,
  service: Client,
  host: HostRow,
  initial?: ProviderDomainState,
): Promise<JsonObject> {
  if (!deps.provider) throw new DomainProviderError("provider_unavailable");
  const state = initial ?? (host.provider_ref
    ? await deps.provider.get(host.hostname, host.is_apex)
    : await deps.provider.add(host.hostname, host.is_apex));
  const facts = await checkDomain(
    { provider: deps.provider, dns: deps.dns, probe: deps.probe },
    { hostname: host.hostname, isApex: host.is_apex, siteId: host.site_id },
    Date.now(),
    state,
  );
  const { data, error } = await service.rpc("brand_site_domain_record_check", {
    p_host_id: host.id,
    p_dns_state: facts.dnsState,
    p_tls_state: facts.tlsState,
    p_verification: facts.verification,
    p_provider_ref: facts.providerRef,
  });
  if (error) throw new Error(error.message ?? "record_check_failed");
  return data as JsonObject;
}

/**
 * The brand's addresses (rank-checked in Core), each with the domain the
 * owner manages at their registrar (`apex`), which the DNS guide needs to
 * tell them what to type in the Name field.
 */
async function listFor(user: Client, siteId: string): Promise<{ data: JsonObject | null; error: { message?: string } | null }> {
  const { data, error } = await user.rpc("brand_site_domains_list", { p_site_id: siteId });
  if (error || !data) return { data: data as JsonObject | null, error };
  const list = data as JsonObject;
  const hosts = Array.isArray(list.hosts) ? list.hosts as JsonObject[] : [];
  return {
    data: {
      ...list,
      hosts: hosts.map((host) => ({
        ...host,
        apex: typeof host.hostname === "string"
          ? registrableDomain(host.hostname) ?? host.hostname
          : null,
      })),
    },
    error: null,
  };
}

export async function handleSweep(service: Client, deps: DomainDeps | null): Promise<Response> {
  const summary = { checked: 0, released: 0, failed: 0, skipped: 0 };
  if (!deps?.provider) return sitesJson({ ok: true, data: { ...summary, skipped: -1 } });
  const { data, error } = await service.rpc("brand_site_domains_due", { p_limit: 200 });
  if (error) return failure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
  for (const due of (data ?? []) as Array<HostRow & { host_id: string }>) {
    const host: HostRow = { ...due, id: due.host_id, kind: "custom_domain" };
    try {
      if (host.status === "detaching") {
        if (host.redirect_until && Date.parse(host.redirect_until) <= Date.now()) {
          await deps.provider.remove(host.hostname);
          const { error: releaseError } = await service.rpc("brand_site_domain_release", {
            p_host_id: host.id,
            p_reason_code: "REDIRECT_WINDOW_ENDED",
          });
          if (releaseError) throw new Error(releaseError.message);
          summary.released += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }
      await runCheck(deps, service, host);
      summary.checked += 1;
    } catch {
      // One domain's provider or DNS trouble never stops the others, and an
      // outage is never counted as the owner's misconfiguration.
      summary.failed += 1;
    }
  }
  return sitesJson({ ok: true, data: summary });
}

export async function handleBrandSiteDomainsRequest(
  req: Request,
  overrides: { deps?: DomainDeps | null; clients?: { user: Client; service: Client } } = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const db = overrides.clients ?? {
    user: createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    }),
    service: createClient(url, serviceKey, { auth: { persistSession: false } }),
  };
  const transportPath = relativePath(req);

  // The sweep: service-role bearer only, compared in code.
  if (transportPath === "/internal/v1/domains/sweep") {
    if (req.method !== "POST") return failure("NOT_FOUND", 404);
    const bearer = authorization.replace(/^Bearer\s+/i, "");
    if (!serviceKey || !timingSafeEqual(bearer, serviceKey)) return failure("FORBIDDEN", 403);
    const deps = overrides.deps !== undefined ? overrides.deps : await resolveDomainDeps(db.service);
    return await handleSweep(db.service, deps);
  }

  const { data: authData } = await db.user.auth.getUser();
  if (!authData?.user) return failure("FORBIDDEN", 403);

  let input: JsonObject = {};
  try {
    if (req.method !== "GET") {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body");
      input = parsed as JsonObject;
    }
  } catch {
    return failure("VALIDATION_FAILED", 400);
  }
  const path = transportPath === "/" && typeof input.route === "string" ? input.route : transportPath;
  const method = transportPath === "/" && typeof input.method === "string"
    ? input.method.toUpperCase()
    : req.method;
  if (path === "/internal/v1/domains/sweep") return failure("FORBIDDEN", 403);

  const listMatch = path.match(/^\/v1\/sites\/([^/]+)\/domains$/);
  const hostMatch = path.match(/^\/v1\/sites\/([^/]+)\/domains\/([^/]+)$/);
  const actionMatch = path.match(/^\/v1\/sites\/([^/]+)\/domains\/([^/]+)\/(check|primary)$/);

  try {
    if (listMatch && method === "GET") {
      const siteId = requireUuid(listMatch[1]);
      const { data, error } = await listFor(db.user, siteId);
      if (error) return failureForRpc(error.message, null);
      return sitesJson({ ok: true, data });
    }

    if (listMatch && method === "POST") {
      const siteId = requireUuid(listMatch[1]);
      const operationId = requireUuid(input.operation_id);
      const deps = overrides.deps !== undefined ? overrides.deps : await resolveDomainDeps(db.service);
      if (!deps?.provider) return failure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
      const name = classifyCustomHostname(input.hostname, { local: deps.mode === "local" });
      if (!name.ok) return failure("DOMAIN_INVALID", 400, operationId);
      const { data: attached, error } = await db.user.rpc("brand_site_domain_attach", {
        p_site_id: siteId,
        p_hostname: name.hostname,
        p_is_apex: name.isApex,
        p_operation_id: operationId,
      });
      if (error) return failureForRpc(error.message, operationId);
      const hostId = String((attached as JsonObject).host_id);
      const host = await hostOfSite(db.service, siteId, hostId);
      if (!host) return failure("NOT_FOUND", 404, operationId);
      let check: JsonObject | null = null;
      try {
        const added = await deps.provider.add(host.hostname, host.is_apex);
        check = await runCheck(deps, db.service, host, added);
      } catch (cause) {
        if (cause instanceof DomainProviderError && cause.code === "domain_in_use") {
          // Never live, never ours at the provider: give the name back.
          await db.service.rpc("brand_site_domain_release", {
            p_host_id: hostId,
            p_reason_code: "NEVER_LIVE",
          });
          return failure("DOMAIN_IN_USE", 409, operationId);
        }
        // Provider slow or down: the address stays waiting; Check now (or the
        // sweep) adds it at the provider later.
        check = null;
      }
      const { data: list } = await listFor(db.user, siteId);
      return sitesJson({
        ok: true,
        data: { host_id: hostId, hostname: host.hostname, checked: check !== null, domains: list },
      }, 201);
    }

    if (actionMatch && actionMatch[3] === "check" && method === "POST") {
      const siteId = requireUuid(actionMatch[1]);
      const hostId = requireUuid(actionMatch[2]);
      const { data: list, error } = await listFor(db.user, siteId);
      let allowed = !error && list?.can_manage === true;
      if (!allowed) {
        // A Mingla admin may recheck any address (Admin "Recheck").
        const { data: isAdmin } = await db.user.rpc("is_admin_user");
        allowed = isAdmin === true;
      }
      if (!allowed) return failure("FORBIDDEN", 403);
      const host = await hostOfSite(db.service, siteId, hostId);
      if (!host || host.kind !== "custom_domain" || host.status === "retired") {
        return failure("NOT_FOUND", 404);
      }
      const deps = overrides.deps !== undefined ? overrides.deps : await resolveDomainDeps(db.service);
      if (!deps?.provider) return failure("CHECK_UNAVAILABLE", 503);
      try {
        const result = await runCheck(deps, db.service, host);
        return sitesJson({ ok: true, data: result });
      } catch {
        return failure("CHECK_UNAVAILABLE", 503);
      }
    }

    if (actionMatch && actionMatch[3] === "primary" && method === "POST") {
      const siteId = requireUuid(actionMatch[1]);
      const hostId = requireUuid(actionMatch[2]);
      const operationId = requireUuid(input.operation_id);
      const { data, error } = await db.user.rpc("brand_site_domain_set_primary", {
        p_site_id: siteId,
        p_host_id: hostId,
        p_operation_id: operationId,
      });
      if (error) return failureForRpc(error.message, operationId);
      return sitesJson({ ok: true, data });
    }

    if (hostMatch && method === "DELETE") {
      const siteId = requireUuid(hostMatch[1]);
      const hostId = requireUuid(hostMatch[2]);
      const operationId = requireUuid(input.operation_id);
      const before = await hostOfSite(db.service, siteId, hostId);
      const { data, error } = await db.user.rpc("brand_site_domain_detach", {
        p_site_id: siteId,
        p_host_id: hostId,
        p_operation_id: operationId,
      });
      if (error) return failureForRpc(error.message, operationId);
      const result = data as JsonObject;
      if (result.release_now === true && before) {
        const deps = overrides.deps !== undefined ? overrides.deps : await resolveDomainDeps(db.service);
        try {
          if (deps?.provider && before.provider_ref) await deps.provider.remove(before.hostname);
          await db.service.rpc("brand_site_domain_release", {
            p_host_id: hostId,
            p_reason_code: before.status === "detaching" ? "OWNER_CONFIRMED" : "NEVER_LIVE",
          });
        } catch {
          // The sweep releases it when the window ends; the owner's site is
          // already on its Mingla address.
        }
      }
      return sitesJson({ ok: true, data: result });
    }

    return failure("NOT_FOUND", 404);
  } catch {
    return failure("VALIDATION_FAILED", 400);
  }
}

export async function handleBrandSiteDomains(req: Request): Promise<Response> {
  const response = await observeSitesRequest(req, {
    service: "brand-site-domains",
    direction: "customer_to_core",
    handler: (request) => handleBrandSiteDomainsRequest(request),
  });
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

if (import.meta.main) serve(handleBrandSiteDomains);
