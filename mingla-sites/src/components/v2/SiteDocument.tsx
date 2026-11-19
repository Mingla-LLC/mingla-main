import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { DESIGN_RENDERERS } from "../../designs/registry";
import type { ArtifactPage } from "../../lib/pageRouting";
import type { LiveOfferings } from "../../lib/offeringCards";
import type { FormsContext } from "../../lib/siteForms";
import type { CollectionEntry } from "../../lib/siteCollections";
import type { OfferingDetailView } from "../../lib/offeringDetail";
import { DETAIL_STYLESHEET, SHARED_STYLESHEET } from "../../designs/registry";
import type { AssetCredential } from "../../lib/assetCredential";
import { FontFaces } from "./FontFaces";
import { TokenStyle } from "./TokenStyle";

/*
 * #2829 AD-1 — one v2 page: the design's stylesheet, the site's tokens and
 * fonts, then the design's page (header, main, footer). The <html> element
 * carries `data-design` (layout.tsx), which scopes the stylesheet.
 */
export function SiteDocument({ artifact, page, previewKey, live, forms, entry, detail, saveData, nonce, notFound }: { artifact: ArtifactV2; page?: ArtifactPage; previewKey?: AssetCredential; live?: LiveOfferings; forms?: FormsContext; entry?: CollectionEntry; detail?: OfferingDetailView; saveData?: boolean; nonce?: string; notFound?: boolean }) {
  const design = DESIGN_RENDERERS[artifact.design.key];
  if (!design) return null;
  const { Page } = design;
  return (
    <>
      {design.sharedStylesheet || detail || live?.detailPages ? <link rel="stylesheet" href={design.sharedStylesheet ?? SHARED_STYLESHEET} precedence="design-shared" /> : null}
      <link rel="stylesheet" href={design.stylesheet(artifact.design.version)} precedence="design" />
      {/* #4453 milestone 9 — the detail template's own sheet, on detail pages only (a design without the shared library gets it too, for the template's buttons and hand-off sheet). */}
      {detail || live?.detailPages ? <link rel="stylesheet" href={DETAIL_STYLESHEET} precedence="design-shared" /> : null}
      <TokenStyle artifact={artifact} />
      <FontFaces artifact={artifact} previewKey={previewKey} />
      <Page artifact={artifact} page={page} live={live} forms={forms} entry={entry} detail={detail} saveData={saveData} nonce={nonce} notFound={notFound} />
    </>
  );
}
