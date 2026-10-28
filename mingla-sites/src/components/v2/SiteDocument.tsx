import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { DESIGN_RENDERERS } from "../../designs/registry";
import type { ArtifactPage } from "../../lib/pageRouting";
import type { LiveOfferings } from "../../lib/offeringCards";
import type { FormsContext } from "../../lib/siteForms";
import type { CollectionEntry } from "../../lib/siteCollections";
import { FontFaces } from "./FontFaces";
import { TokenStyle } from "./TokenStyle";

/*
 * #2829 AD-1 — one v2 page: the design's stylesheet, the site's tokens and
 * fonts, then the design's page (header, main, footer). The <html> element
 * carries `data-design` (layout.tsx), which scopes the stylesheet.
 */
export function SiteDocument({ artifact, page, previewKey, live, forms, entry, saveData, nonce, notFound }: { artifact: ArtifactV2; page?: ArtifactPage; previewKey?: string; live?: LiveOfferings; forms?: FormsContext; entry?: CollectionEntry; saveData?: boolean; nonce?: string; notFound?: boolean }) {
  const design = DESIGN_RENDERERS[artifact.design.key];
  if (!design) return null;
  const { Page } = design;
  return (
    <>
      <link rel="stylesheet" href={design.stylesheet(artifact.design.version)} precedence="design" />
      <TokenStyle artifact={artifact} />
      <FontFaces artifact={artifact} previewKey={previewKey} />
      <Page artifact={artifact} page={page} live={live} forms={forms} entry={entry} saveData={saveData} nonce={nonce} notFound={notFound} />
    </>
  );
}
