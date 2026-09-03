import { sha256 } from "./crypto";
import { runtimeConfig } from "./config";
import {
  assertRestaurantArtifact,
  type RestaurantArtifact,
} from "../contracts/artifact";
import { readPrivateObject } from "./storageReader";

/**
 * #2830 — load a PRIVATE PREVIEW artifact so the runtime can render it with the
 * same `RestaurantV1` component it renders published sites with.
 *
 * WHY THIS EXISTS. The CMS used to render previews itself, with its own inline
 * HTML. That made two renderers out of one product: the CMS one dropped images,
 * galleries, CTAs, offering grids, menu links, FAQs and testimonials, and used a
 * different typeface, so a brand owner reviewed one website and published a
 * different one. The CMS no longer renders at all — it builds the artifact with
 * the publication builder and redirects here.
 *
 * THE KEY IS THE CAPABILITY. It carries a 128-bit nonce the CMS minted, exactly
 * as the signed token in the CMS preview URL already did, so this introduces no
 * new secret and no new trust boundary. What it must never do is become a way to
 * read arbitrary storage, or a way to serve a REAL publication (which would let
 * an unlisted host be reached through the preview route), so the key is parsed
 * against an exact shape and the `preview-` marker is REQUIRED.
 */
const PREVIEW_KEY = new RegExp(
  "^publications/" +
    "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/" +
    "(preview-[0-9a-f]{32})/" +
    "([0-9a-f]{64})\\.json$",
);

export type PreviewArtifactKey = {
  key: string;
  siteId: string;
  publicationId: string;
  digest: string;
};

export function parsePreviewArtifactKey(
  raw: string | null | undefined,
): PreviewArtifactKey | null {
  if (typeof raw !== "string" || raw.length > 256) return null;
  const match = PREVIEW_KEY.exec(raw);
  if (!match) return null;
  return {
    key: raw,
    siteId: match[1],
    publicationId: match[2],
    digest: match[3],
  };
}

export async function loadPreviewArtifact(
  parsed: PreviewArtifactKey,
): Promise<RestaurantArtifact> {
  const config = runtimeConfig();
  // The pilot runtime serves exactly one site; a preview for any other site is
  // not something this deployment is entitled to render.
  if (parsed.siteId !== config.pilotSiteId) throw new Error("NOT_FOUND");
  // `no-store`, never `force-cache`: a draft changes between previews, and a
  // cached preview is the same lie in a different shape.
  const response = await readPrivateObject(
    config.artifactBucket,
    parsed.key,
    "no-store",
  );
  if (!response.ok) throw new Error("NOT_FOUND");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256(bytes)) !== parsed.digest) throw new Error("NOT_FOUND");
  const artifact: unknown = JSON.parse(new TextDecoder().decode(bytes));
  assertRestaurantArtifact(artifact);
  if (
    artifact.site_id !== parsed.siteId ||
    artifact.publication_id !== parsed.publicationId
  ) throw new Error("NOT_FOUND");
  return artifact;
}
