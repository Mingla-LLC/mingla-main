import { sha256 } from "./crypto";
import { runtimeConfig } from "./config";
import { signedHostResolution } from "./coreGateway";
import {
  assertSiteArtifact,
  isV2Artifact,
  siteCanonicalUrl,
  type SiteArtifact,
} from "./siteArtifact";
import { emitPublicObservation } from "./observability";
import { readPrivateObject } from "./storageReader";

/**
 * #2829 — what Core says a host resolves to. This object, not a bare site id,
 * is what every later Core call for the request is bound to (coreGateway).
 */
export type ResolvedSite = {
  site_id: string;
  brand_id: string;
  publication_id: string;
  artifact_key: string;
  artifact_digest: string;
  artifact_schema_version: number;
  renderer_key: string;
  renderer_version: number;
  hostname: string;
  primary_hostname: string;
  is_primary: boolean;
  host_kind: string;
  design_key: string | null;
  /**
   * #2829 W8 — every address this site has ever had (its subdomain and its
   * own domains, live or released). An artifact published while another of
   * them was the main address still renders; its canonical is presented as
   * the CURRENT primary. Absent on an older Core.
   */
  site_hostnames?: string[];
};
/** Kept for existing imports. */
export type Resolution = ResolvedSite;

/** Which hostnames this deployment answers for at all. */
export type PublicHostScope = {
  /** `<label>.<suffix>` is the only subdomain shape served. */
  suffix: string;
  /** Local mode only: exact extra hostnames (custom-domain tests). */
  extraHosts: readonly string[];
  /** Local mode only: the dev server's `:port` is stripped, never trusted. */
  allowPort: boolean;
  /**
   * #2829 W8 — a brand's own domain (production). Any well-formed name outside
   * Mingla's and its providers' domains is a CANDIDATE: whether it belongs to
   * a site is Core's answer (brand_site_hosts), exactly like a subdomain, and
   * an unknown name 404s with no brand data. Off by default.
   */
  customDomains?: boolean;
};

export const PRODUCTION_HOST_SCOPE: PublicHostScope = Object.freeze({
  suffix: "sites.usemingla.com",
  extraHosts: [],
  allowPort: false,
});

/** Never a brand's own domain (mirrors the Core attach refusal). */
const NOT_A_CUSTOM_DOMAIN =
  /(^|\.)(usemingla\.com|mingla\.app|sites\.localhost|localhost|vercel\.app|vercel\.com|vercel-dns\.com|now\.sh|supabase\.co|supabase\.in|b-cdn\.net|bunny\.net)$|\.(test|local|invalid|example|internal|onion)$|^[0-9.]+$/;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * #2829 — the request host, generic across brands. A host is accepted when it
 * passes the shared shape rule (sitesContracts.isValidSiteHostname, SQL CHECK)
 * AND is `<one label>.<suffix>` or an explicit local extra host. Whether that
 * host is a live site is Core's answer, never this function's. Only the first
 * hop of a forwarding header is considered; ports, trailing dots and anything
 * outside the scope are refused.
 */
export function normalizePublicHost(
  raw: string | null,
  scope: PublicHostScope = PRODUCTION_HOST_SCOPE,
): string {
  if (!raw) throw new Error("NOT_FOUND");
  let first = raw.split(",", 1)[0].trim().toLowerCase();
  if (scope.allowPort) first = first.replace(/:[0-9]{2,5}$/, "");
  if (
    first.includes(":") || first.endsWith(".") || first.length < 4 ||
    first.length > 253 || /[*/?#@]/.test(first) || !HOSTNAME.test(first)
  ) throw new Error("NOT_FOUND");
  if (scope.extraHosts.includes(first)) return first;
  const tail = `.${scope.suffix}`;
  if (!first.endsWith(tail)) {
    if (scope.customDomains && !NOT_A_CUSTOM_DOMAIN.test(first)) return first;
    throw new Error("NOT_FOUND");
  }
  if (!LABEL.test(first.slice(0, -tail.length))) throw new Error("NOT_FOUND");
  return first;
}

export function publicHostScope(): PublicHostScope {
  const config = runtimeConfig();
  return {
    suffix: config.allowedHostSuffix,
    extraHosts: config.localExtraHosts,
    allowPort: config.mode === "local",
    // #2829 W8 — production serves brands' own domains (Core decides which);
    // local mode serves only its explicit extra hosts.
    customDomains: config.mode === "production",
  };
}

/** The host a request arrived on, normalized for this deployment. */
export function requestHost(incoming: Headers): string {
  return normalizePublicHost(
    incoming.get("x-forwarded-host") || incoming.get("host"),
    publicHostScope(),
  );
}

/**
 * #2829 — the same path on the site's primary address, for a non-primary or
 * detaching host (308). Null when the request is already on the primary.
 */
export function primaryRedirectUrl(
  resolution: Pick<ResolvedSite, "is_primary" | "primary_hostname" | "hostname">,
  pathAndQuery: string,
  incoming?: Headers,
): string | null {
  if (resolution.is_primary || resolution.primary_hostname === resolution.hostname) {
    return null;
  }
  const local = runtimeConfig().mode === "local";
  const port = local
    ? (incoming?.get("host")?.match(/:([0-9]{2,5})$/)?.[1] ?? "")
    : "";
  const origin = `${local ? "http" : "https"}://${resolution.primary_hostname}${port ? `:${port}` : ""}`;
  return new URL(pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`, origin)
    .toString();
}

/*
 * #2829 — caches are per HOST and never shared across hosts: a positive answer
 * for 30 s, a negative one for 30 s, and the last good answer for 5 minutes
 * only while Core is unreachable. The positive window is 30 s, not the 60 s
 * the spec's runtime note names, because SC-4/SC-5 require a revoked,
 * offline or deleted site to 404 within 30 s; a 60 s positive cache would keep
 * serving it for up to a minute (measured locally: 59.97 s).
 */
const POSITIVE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 30_000;
const LAST_GOOD_TTL_MS = 5 * 60_000;
const positive = new Map<string, { value: ResolvedSite; expires: number }>();
const negative = new Map<string, number>();
const lastGood = new Map<string, { value: ResolvedSite; expires: number }>();

/** Test hook: forget every cached answer. */
export function clearResolutionCaches(): void {
  positive.clear();
  negative.clear();
  lastGood.clear();
}

class ResolutionRefused extends Error {}

async function signedResolution(hostname: string): Promise<ResolvedSite> {
  const response = await signedHostResolution(hostname, "publication");
  if (response.status === 404) throw new ResolutionRefused("NOT_FOUND");
  if (!response.ok) throw new Error("CORE_UNAVAILABLE");
  const responseEnvelope = await response.json();
  if (!responseEnvelope?.ok || !responseEnvelope.data) {
    throw new ResolutionRefused("NOT_FOUND");
  }
  return responseEnvelope.data as ResolvedSite;
}

/**
 * #2829 — which site a host belongs to, published or not (previews of a
 * draft). Never cached: a preview is rare and must see revocation at once.
 */
export async function resolveHostSite(
  hostname: string,
): Promise<{ site_id: string; brand_id: string; hostname: string }> {
  const response = await signedHostResolution(hostname, "site");
  if (!response.ok) throw new Error("NOT_FOUND");
  const payload = await response.json();
  const data = payload?.ok ? payload.data : null;
  if (!data || data.hostname !== hostname || typeof data.site_id !== "string") {
    throw new Error("NOT_FOUND");
  }
  return data as { site_id: string; brand_id: string; hostname: string };
}

/** The renderer/schema pairs this runtime accepts from Core. */
export function supportedRenderer(value: Pick<ResolvedSite, "artifact_schema_version" | "renderer_key">): boolean {
  return (value.artifact_schema_version === 1 && value.renderer_key === "restaurant-website-v1") ||
    (value.artifact_schema_version === 2 && value.renderer_key === "sites-v2");
}

export async function resolveHost(
  hostname: string,
  now = Date.now(),
): Promise<{ value: ResolvedSite; stale: boolean }> {
  const cached = positive.get(hostname);
  if (cached && cached.expires > now) return { value: cached.value, stale: false };
  const refused = negative.get(hostname);
  if (refused !== undefined && refused > now) throw new Error("NOT_FOUND");
  try {
    const value = await signedResolution(hostname);
    if (value.hostname !== hostname || !supportedRenderer(value)) {
      throw new ResolutionRefused("NOT_FOUND");
    }
    positive.set(hostname, { value, expires: now + POSITIVE_TTL_MS });
    lastGood.set(hostname, { value, expires: now + LAST_GOOD_TTL_MS });
    negative.delete(hostname);
    return { value, stale: false };
  } catch (error) {
    if (error instanceof ResolutionRefused) {
      // Core said no: never fall back to an old answer for a refused host.
      positive.delete(hostname);
      lastGood.delete(hostname);
      negative.set(hostname, now + NEGATIVE_TTL_MS);
      throw new Error("NOT_FOUND");
    }
    const prior = lastGood.get(hostname);
    if (prior && prior.expires >= now) return { value: prior.value, stale: true };
    throw error;
  }
}

export async function loadPublication(
  hostname: string,
): Promise<{ artifact: SiteArtifact; resolution: ResolvedSite }> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  let siteId: string | null = null;
  let publicationId: string | null = null;
  try {
    const resolved = await resolveHost(hostname);
    const resolution = resolved.value;
    siteId = resolution.site_id;
    publicationId = resolution.publication_id;
    const artifact = await loadResolvedArtifact(resolution);
    emitPublicObservation({
      event: "mingla_sites_request",
      metric: resolved.stale ? "public.stale_last_good" : "public.request.2xx",
      request_id: requestId,
      operation_id: null,
      site_id: siteId,
      publication_id: publicationId,
      direction: "public_runtime",
      route: "/",
      state_transition: resolved.stale
        ? "resolution_failed->last_good_served"
        : "request_started->artifact_verified",
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      retry_count: 0,
      safe_error_code: null,
      status_code: 200,
      version: "sites-v1",
    });
    return { artifact, resolution };
  } catch (error) {
    emitPublicObservation({
      event: "mingla_sites_request",
      metric: "public.request.4xx",
      request_id: requestId,
      operation_id: null,
      site_id: siteId,
      publication_id: publicationId,
      direction: "public_runtime",
      route: "/",
      state_transition: "request_started->request_rejected",
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      retry_count: 0,
      safe_error_code: "NOT_FOUND",
      status_code: 404,
      version: "sites-v1",
    });
    throw error;
  }
}

export async function loadResolvedArtifact(
  resolution: ResolvedSite,
): Promise<SiteArtifact> {
  const config = runtimeConfig();
  const expectedKey =
    `publications/${resolution.site_id}/${resolution.publication_id}/${resolution.artifact_digest}.json`;
  if (
    resolution.artifact_key !== expectedKey ||
    !/^[0-9a-f]{64}$/.test(resolution.artifact_digest) ||
    !supportedRenderer(resolution)
  ) throw new Error("NOT_FOUND");
  const response = await readPrivateObject(
    config.artifactBucket,
    resolution.artifact_key,
    "force-cache",
  );
  if (!response.ok) throw new Error("NOT_FOUND");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== resolution.artifact_digest) {
    throw new Error("NOT_FOUND");
  }
  const artifact: unknown = JSON.parse(new TextDecoder().decode(bytes));
  // #2829 AD-1 — the artifact must be the generation Core recorded for this
  // publication (v2, or a v1 kept for rollback), and pass that contract.
  assertSiteArtifact(artifact, resolution.artifact_schema_version, bytes.byteLength);
  if (
    artifact.site_id !== resolution.site_id ||
    artifact.brand_id !== resolution.brand_id ||
    artifact.publication_id !== resolution.publication_id ||
    artifact.renderer_version !== resolution.renderer_version ||
    artifact.renderer_key !== resolution.renderer_key ||
    (isV2Artifact(artifact) && resolution.design_key !== null && artifact.design.key !== resolution.design_key) ||
    // #2829 — the canonical address is one of the site's OWN addresses, so
    // an artifact can never claim another brand's address. (W8: an artifact
    // published before the main address changed keeps rendering.)
    !isOwnCanonical(siteCanonicalUrl(artifact), resolution)
  ) throw new Error("NOT_FOUND");
  return artifact;
}

/**
 * #2829 W8 — is `canonical` https on the site's primary host or on any address
 * Core says this site has had? Nothing else, and never another site's.
 */
export function isOwnCanonical(
  canonical: string | undefined,
  resolution: Pick<ResolvedSite, "primary_hostname" | "site_hostnames">,
): boolean {
  if (canonical === canonicalOrigin(resolution)) return true;
  if (typeof canonical !== "string" || !canonical.startsWith("https://")) return false;
  const host = canonical.slice("https://".length);
  return Array.isArray(resolution.site_hostnames) && resolution.site_hostnames.includes(host);
}

/**
 * #2829 W8 — the same URL on the CURRENT primary origin. A canonical frozen
 * into an artifact before the main address changed is presented on the
 * address visitors and search engines should use now.
 */
export function onPrimaryOrigin(
  url: string | undefined,
  resolution: Pick<ResolvedSite, "primary_hostname">,
): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const bareOrigin = url === parsed.origin;
    return bareOrigin
      ? canonicalOrigin(resolution)
      : `${canonicalOrigin(resolution)}${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

/** The canonical origin of a resolved site: https on its primary host. */
export function canonicalOrigin(
  resolution: Pick<ResolvedSite, "primary_hostname">,
): string {
  return `https://${resolution.primary_hostname}`;
}
