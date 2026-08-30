import { sha256 } from "./crypto";
import { runtimeConfig } from "./config";
import { signedCorePost } from "./coreGateway";
import {
  assertRestaurantArtifact,
  type RestaurantArtifact,
} from "../contracts/artifact";

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

async function resolve(hostname: string): Promise<Resolution> {
  try {
    const value = await signedResolution(hostname);
    if (
      value.hostname !== hostname || value.artifact_schema_version !== 1 ||
      value.renderer_key !== "restaurant-website-v1"
    ) throw new Error("NOT_FOUND");
    staleResolution.set(hostname, { value, expires: Date.now() + 5 * 60_000 });
    return value;
  } catch (error) {
    const prior = staleResolution.get(hostname);
    if (prior && prior.expires >= Date.now()) return prior.value;
    throw error;
  }
}

export async function loadPublication(
  hostname: string,
): Promise<{ artifact: RestaurantArtifact; resolution: Resolution }> {
  const resolution = await resolve(hostname);
  return { artifact: await loadResolvedArtifact(resolution), resolution };
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
