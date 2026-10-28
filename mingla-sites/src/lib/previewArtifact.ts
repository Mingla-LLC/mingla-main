import { sha256 } from "./crypto";
import { runtimeConfig } from "./config";
import { assertSiteArtifact, declaredSchema, type SiteArtifact } from "./siteArtifact";
import { readPrivateObject } from "./storageReader";
import type { SiteBinding } from "./coreGateway";

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

/** #2829 W3 — the header proxy.ts sets on /preview requests (the preview key), read by the layout. */
export const PREVIEW_KEY_HEADER = "x-mingla-preview-key";

/** Stands in for a preview's `preview-…` id while the contract checks the rest. */
const PREVIEW_CONTRACT_ID = "00000000-0000-4000-8000-000000000000";

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
  hostSite: SiteBinding,
): Promise<SiteArtifact> {
  const config = runtimeConfig();
  // #2829 — a preview renders only on its OWN site's host: the site in the
  // key must be the site Core resolved for the host the request arrived on.
  if (parsed.siteId !== hostSite.site_id) throw new Error("NOT_FOUND");
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
  const artifact = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  if (
    artifact?.site_id !== parsed.siteId ||
    artifact?.publication_id !== parsed.publicationId
  ) throw new Error("NOT_FOUND");
  /*
   * #2829 W2 — a preview's publication id is `preview-<32 hex>` by design (it
   * is what keeps real publications out of this route), while the public
   * contract requires a UUID publication id. Validating the bytes as they are
   * refused EVERY preview (ARTIFACT_ID_MISMATCH → 404): the private preview
   * never rendered. The id was matched against the key just above; the
   * contract then validates everything else with a fixed placeholder id.
   */
  // #2829 W3 — either generation: a draft built by the v2 builder previews as
  // v2; the contract it passes is the one its own declaration names.
  const schema = declaredSchema(artifact);
  if (schema === null) throw new Error("NOT_FOUND");
  assertSiteArtifact({ ...artifact, publication_id: PREVIEW_CONTRACT_ID }, schema, bytes.byteLength);
  return artifact as unknown as SiteArtifact;
}
