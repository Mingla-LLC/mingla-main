import type { ComponentType } from "react";
import { showsDraftHints } from "../../lib/previewPublication";
import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import type { BlockType } from "../../contracts/generated/blocks.ts";
import { isSafeHref } from "../../contracts/generated/safety.ts";
import { compositionFooter, compositionHeader, type DesignDefinition } from "../../contracts/generated/designs.ts";
import { pickVariant, type BlockVariantMap } from "../../components/v2/Blocks";
import { PreviewSection } from "../../components/v2/PreviewSection";
import { SiteRuntimeClient } from "../../components/SiteRuntimeClient";
import { CollectionEntryView } from "../../components/v2/neutral/CollectionTemplates";
import { headerCta, headerWordmark, homePage, hrefForPage, siteNavigation, type ArtifactPage } from "../../lib/pageRouting";
import type { LiveOfferings } from "../../lib/offeringCards";
import type { FormsContext } from "../../lib/siteForms";
import type { CollectionEntry } from "../../lib/siteCollections";
import { SharedFooter, SharedHeader } from "./chrome/SharedChrome";
import { SHARED_BLOCK_LAYOUTS, motionAttributes } from "./library";
import { MotionRoot } from "./MotionRoot";
import { PageBookingChrome } from "./blocks/Booking";
import { OfferingDetailTemplate } from "./blocks/Detail";
import type { OfferingDetailView } from "../../lib/offeringDetail";
import type { SharedBlock, SharedBlockProps, SharedContext } from "./parts";
import {
  CalloutBasic, ContactDetailsBasic, ContactFormBasic, DividerBasic, MapEmbedBasic, MediaFeatureBasic, MenuPreviewBasic,
  PageHeaderBasic, PullQuoteBasic, SpacerBasic, StatsBasic, StoryGridBasic, TeamBasic, VideoFeatureBasic,
} from "./blocks/Basics";

/*
 * #4453 6a — the page every gallery design (Nocturne, Haven, Maison) draws:
 * the skip link, the shared header, the page's blocks through the design's
 * variant map, the shared footer and the motion module. A gallery design has
 * no stored pre-#4453 sites, so it always draws the shared chrome; the
 * header and footer layout come from the artifact (validated against the
 * design's `chrome`), else the design's default.
 */

/** The design-neutral layout of each type the shared library has no gallery layout for. */
export const NEUTRAL_LAYOUTS: Readonly<Partial<Record<BlockType, ComponentType<SharedBlockProps>>>> = {
  page_header: PageHeaderBasic,
  media_feature: MediaFeatureBasic,
  cta: CalloutBasic,
  menu_link: CalloutBasic,
  venue_reservation: CalloutBasic,
  contact_handoff: CalloutBasic,
  video_feature: VideoFeatureBasic,
  stats: StatsBasic,
  team: TeamBasic,
  pull_quote: PullQuoteBasic,
  map_embed: MapEmbedBasic,
  menu_preview: MenuPreviewBasic,
  story_grid: StoryGridBasic,
  contact_form: ContactFormBasic,
  contact_details: ContactDetailsBasic,
  divider: DividerBasic,
  spacer: SpacerBasic,
};

/**
 * A gallery design's renderer map, exactly its `variants`: each listed layout
 * from the design's own signature layouts, else the shared library, else
 * (for `neutral`) the design-neutral layout. A listed layout with no
 * component is a programming error and throws at module load (the parity
 * test pins every design).
 */
export function galleryBlockMap(
  design: DesignDefinition,
  signature: Readonly<Partial<Record<BlockType, Readonly<Record<string, ComponentType<SharedBlockProps>>>>>> = {},
): BlockVariantMap<SharedBlockProps> {
  const map = {} as Record<BlockType, Record<string, ComponentType<SharedBlockProps>>>;
  for (const [type, variants] of Object.entries(design.variants) as Array<[BlockType, readonly string[]]>) {
    map[type] = {};
    for (const variant of variants) {
      const Component = signature[type]?.[variant] ?? SHARED_BLOCK_LAYOUTS[type]?.[variant] ?? (variant === "neutral" ? NEUTRAL_LAYOUTS[type] : undefined);
      if (!Component) throw new Error(`#4453 ${design.key}: no layout for ${type}:${variant}`);
      map[type][variant] = Component;
    }
  }
  return map;
}

export type GalleryPageProps = {
  artifact: ArtifactV2;
  page?: ArtifactPage;
  live?: LiveOfferings;
  forms?: FormsContext;
  entry?: CollectionEntry;
  /** #4453 milestone 9 — an offering detail page. */
  detail?: OfferingDetailView;
  saveData?: boolean;
  nonce?: string;
  notFound?: boolean;
};

export function GalleryPage({ design, blocks, artifact, page, live, forms, entry, detail, saveData }: GalleryPageProps & { design: DesignDefinition; blocks: BlockVariantMap<SharedBlockProps> }) {
  const current = page ?? homePage(artifact);
  const analytics = { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id };
  const items = siteNavigation(artifact).map((item) => ({
    label: String(item.label ?? ""),
    href: item.href,
    ...(item.children?.length ? { children: item.children.map((child) => ({ label: child.label, href: child.href })) } : {}),
  }));
  const logo = artifact.brand.logo && isSafeHref(artifact.brand.logo.url)
    ? { url: artifact.brand.logo.url, width: artifact.brand.logo.width, height: artifact.brand.logo.height }
    : null;
  const siteName = headerWordmark(artifact) ?? artifact.brand.display_name;
  const headerVariant = artifact.navigation.header_variant ?? compositionHeader(design) ?? "glass";
  const footerVariant = artifact.footer.footer_variant ?? compositionFooter(design) ?? "giant";
  const motion = motionAttributes(design, artifact.tokens.motion, saveData === true);
  let content: React.ReactNode = null;
  let booking: React.ReactNode = null;
  if (current && detail) {
    // #4453 milestone 9 — the shared detail template (its own hand-off sheet and sticky bar).
    content = <OfferingDetailTemplate artifact={artifact} detail={detail} analytics={analytics} designKey={design.key} />;
  } else if (current && entry) {
    content = <div className="mg-blk mg-basic mg-basic--entry"><div className="mg-wrap"><CollectionEntryView entry={entry} artifact={artifact} live={live} /></div></div>;
  } else if (current) {
    const ctx: SharedContext = { artifact, page: current, live, forms, analytics, saveData, preview: showsDraftHints(artifact.publication_id) };
    // #4453 milestone 5 — the hand-off sheet and the sticky phone bar.
    booking = <PageBookingChrome ctx={ctx} />;
    const marked = current.previewSectionIds !== undefined;
    content = current.blocks.map((raw, index) => {
      const block = raw as unknown as SharedBlock;
      const Variant = pickVariant(blocks, raw);
      // #4453 website workspace — in the owner's private preview every block is findable (no visual change: PreviewSection).
      if (marked) return <PreviewSection key={`${block.type}-${index}`} marked>{Variant ? <Variant block={block} index={index} ctx={ctx} /> : null}</PreviewSection>;
      return Variant ? <PreviewSection key={`${block.type}-${index}`} marked={false}><Variant block={block} index={index} ctx={ctx} /></PreviewSection> : null;
    });
  }
  const path = current ? hrefForPage(current) : "/";
  return (
    <div
      id="mg-scope"
      className={`mg-scope mg-page mg-page--${design.key}`}
      data-mg-look="gallery"
      data-mg-cover={artifact.design.options?.cover}
      data-mg-photos={artifact.design.options?.photos}
      data-motion={motion["data-motion"]}
      data-mg-profile={motion["data-mg-profile"]}
      style={motion.style}
    >
      <SiteRuntimeClient context={analytics} />
      <a href="#main" className="skip-link mg-skip">Skip to content</a>
      <SharedHeader variant={headerVariant} items={items} path={path} logo={logo} siteName={siteName} cta={headerCta(artifact)} place={artifact.footer.location} />
      <main id="main" className="mg-main">{content}</main>
      <SharedFooter variant={footerVariant} artifact={artifact} items={items} />
      {booking}
      {current ? <MotionRoot rootId="mg-scope" /> : null}
    </div>
  );
}
