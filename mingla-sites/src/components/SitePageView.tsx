import type { RestaurantArtifact } from "../contracts/artifact";
import { LEGACY_V1_STYLESHEET } from "../designs/registry";
import type { ArtifactPage } from "../lib/pageRouting";
import type { LiveOfferings } from "../lib/offeringCards";
import type { FormsContext } from "../lib/siteForms";
import type { CollectionEntry } from "../lib/siteCollections";
import { isV2Artifact, type SiteArtifact } from "../lib/siteArtifact";
import { RestaurantV1 } from "./RestaurantV1";
import { SiteDocument } from "./v2/SiteDocument";

/*
 * #2829 AD-1 — the one entry the public page, the preview and the probe use:
 * a v2 artifact is drawn by its design; a v1 artifact (a rollback to an
 * earlier gögi publication) by the v1 renderer and its own stylesheet.
 */
export function SitePageView({ artifact, page, previewKey, live, forms, entry, saveData, nonce }: { artifact: SiteArtifact; page?: ArtifactPage; previewKey?: string; live?: LiveOfferings; forms?: FormsContext; entry?: CollectionEntry; saveData?: boolean; nonce?: string }) {
  if (isV2Artifact(artifact)) return <SiteDocument artifact={artifact} page={page} previewKey={previewKey} live={live} forms={forms} entry={entry} saveData={saveData} nonce={nonce} />;
  return (
    <>
      <link rel="stylesheet" href={LEGACY_V1_STYLESHEET} precedence="design" />
      <RestaurantV1 artifact={artifact as RestaurantArtifact} page={page} />
    </>
  );
}
