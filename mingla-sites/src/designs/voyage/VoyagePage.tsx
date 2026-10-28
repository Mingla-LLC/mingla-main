import { Fragment } from "react";
import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { isSafeHref } from "../../contracts/generated/safety.ts";
import { pickVariant } from "../../components/v2/Blocks";
import { SiteRuntimeClient } from "../../components/SiteRuntimeClient";
import { headerCta, headerWordmark, homePage, siteNavigation, type ArtifactPage } from "../../lib/pageRouting";
import type { LiveOfferings } from "../../lib/offeringCards";
import type { FormsContext } from "../../lib/siteForms";
import type { CollectionEntry } from "../../lib/siteCollections";
import { VOYAGE_HEAD_SCRIPT } from "./headScript";
import { VoyageFooter } from "./VoyageFooter";
import { VoyageHeader, type VoyageNavItem } from "./VoyageHeader";
import { VOYAGE_BLOCK_VARIANTS } from "./voyageBlocks";
import { DestinationTemplate } from "./templates/DestinationTemplate";
import { StoryTemplate } from "./templates/StoryTemplate";
import { NotFoundTemplate } from "./templates/NotFoundTemplate";
import type { VoyageBlock, VoyageContext } from "./parts";

/*
 * #2829 W7 — one voyage page: the head script, the skip link, the header,
 * the page (its blocks, a destination or story template, or the 404), the
 * footer. The stylesheet (public/designs/voyage/1.css) is scoped to
 * html[data-design="voyage"], set by the layout from the artifact.
 */
export function VoyagePage({ artifact, page, live, forms, entry, saveData, nonce, notFound }: {
  artifact: ArtifactV2;
  page?: ArtifactPage;
  live?: LiveOfferings;
  forms?: FormsContext;
  entry?: CollectionEntry;
  saveData?: boolean;
  nonce?: string;
  notFound?: boolean;
}) {
  const current = page ?? homePage(artifact);
  const analytics = { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id };
  const items: VoyageNavItem[] = siteNavigation(artifact).map((item) => ({
    label: String(item.label ?? ""),
    href: item.href,
    ...(item.children?.length ? { children: item.children.map((child) => ({ label: child.label, href: child.href })) } : {}),
  }));
  const logo = artifact.brand.logo && isSafeHref(artifact.brand.logo.url)
    ? { url: artifact.brand.logo.url, width: artifact.brand.logo.width, height: artifact.brand.logo.height }
    : null;
  const siteName = headerWordmark(artifact) ?? artifact.brand.display_name;
  let content: React.ReactNode = null;
  if (notFound || !current) {
    content = <NotFoundTemplate artifact={artifact} />;
  } else if (entry) {
    content = entry.collection === "destinations"
      ? <DestinationTemplate destination={entry.entry} artifact={artifact} live={live} analytics={analytics} />
      : <StoryTemplate story={entry.entry} artifact={artifact} />;
  } else {
    const ctx: VoyageContext = { artifact, page: current, live, forms, analytics, saveData };
    content = current.blocks.map((raw, index) => {
      const block = raw as unknown as VoyageBlock;
      const Variant = pickVariant(VOYAGE_BLOCK_VARIANTS, raw);
      return Variant ? <Fragment key={`${block.type}-${index}`}><Variant block={block} index={index} ctx={ctx} /></Fragment> : null;
    });
  }
  return (
    <div className="v-page">
      {/* The 404 has no cover and no reveals, and may render on the client, where a script never runs. */}
      {notFound || !current ? null : <script nonce={nonce} dangerouslySetInnerHTML={{ __html: VOYAGE_HEAD_SCRIPT }} />}
      <SiteRuntimeClient context={analytics} />
      <a href="#main" className="skip-link">Skip to content</a>
      <VoyageHeader items={items} logo={logo} siteName={siteName} cta={headerCta(artifact)} />
      <main id="main" className="v-main">{content}</main>
      <VoyageFooter artifact={artifact} />
    </div>
  );
}
