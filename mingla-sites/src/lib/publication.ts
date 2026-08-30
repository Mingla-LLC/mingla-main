import { sha256 } from "./crypto";
import { runtimeConfig } from "./config";
import { signedCorePost } from "./coreGateway";
import {
  assertRestaurantArtifact,
  type RestaurantArtifact,
} from "../contracts/artifact";
import { emitPublicObservation } from "./observability";

type Resolution = {
  site_id: string;
  brand_id: string;
  publication_id: string;
  artifact_key: string;
  artifact_digest: string;
  artifact_schema_version: number;
  renderer_key: string;
  renderer_version: number;
  hostname: string;
};

const staleResolution = new Map<
  string,
  { value: Resolution; expires: number }
>();

export function normalizePublicHost(raw: string | null): string {
  if (!raw) throw new Error("NOT_FOUND");
  const first = raw.split(",", 1)[0].trim().toLowerCase();
  if (first.includes(":")) throw new Error("NOT_FOUND");
  if (first !== "gogi.sites.usemingla.com" || first.endsWith(".")) {
    throw new Error("NOT_FOUND");
  }
  return first;
}

async function signedResolution(hostname: string): Promise<Resolution> {
  const config = runtimeConfig();
  const path = `/internal/v1/hosts/${hostname}/publication`;
  const response = await signedCorePost({
    edgeFunction: "brand-site-runtime-resolve",
    path,
    siteId: config.pilotSiteId,
    body: { hostname },
  });
  if (!response.ok) throw new Error("NOT_FOUND");
  const responseEnvelope = await response.json();
  if (!responseEnvelope?.ok || !responseEnvelope.data) {
    throw new Error("NOT_FOUND");
  }
  return responseEnvelope.data as Resolution;
}

async function resolve(
  hostname: string,
): Promise<{ value: Resolution; stale: boolean }> {
  try {
    const value = await signedResolution(hostname);
    if (
      value.hostname !== hostname || value.artifact_schema_version !== 1 ||
      value.renderer_key !== "restaurant-website-v1"
    ) throw new Error("NOT_FOUND");
    staleResolution.set(hostname, { value, expires: Date.now() + 5 * 60_000 });
    return { value, stale: false };
  } catch (error) {
    const prior = staleResolution.get(hostname);
    if (prior && prior.expires >= Date.now()) {
      return { value: prior.value, stale: true };
    }
    throw error;
  }
}

export async function loadPublication(
  hostname: string,
): Promise<{ artifact: RestaurantArtifact; resolution: Resolution }> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  let siteId: string | null = null;
  let publicationId: string | null = null;
  try {
    const resolved = await resolve(hostname);
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
  resolution: Resolution,
): Promise<RestaurantArtifact> {
  const config = runtimeConfig();
  const expectedKey =
    `publications/${resolution.site_id}/${resolution.publication_id}/${resolution.artifact_digest}.json`;
  if (
    resolution.artifact_key !== expectedKey ||
    !/^[0-9a-f]{64}$/.test(resolution.artifact_digest)
  ) throw new Error("NOT_FOUND");
  const response = await fetch(
    `${config.artifactReadBaseUrl}/${
      encodeURIComponent(config.artifactBucket)
    }/${resolution.artifact_key}`,
    {
      headers: { authorization: `Bearer ${config.artifactReadToken}` },
      cache: "force-cache",
    },
  );
  if (!response.ok) throw new Error("NOT_FOUND");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== resolution.artifact_digest) {
    throw new Error("NOT_FOUND");
  }
  const artifact: unknown = JSON.parse(new TextDecoder().decode(bytes));
  assertRestaurantArtifact(artifact);
  if (
    artifact.site_id !== resolution.site_id ||
    artifact.brand_id !== resolution.brand_id ||
    artifact.publication_id !== resolution.publication_id ||
    artifact.renderer_version !== resolution.renderer_version
  ) throw new Error("NOT_FOUND");
  return artifact;
}
