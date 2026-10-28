import type { BlockVariantMap } from "../../components/v2/Blocks";
import { HoursNeutral, LinkNeutral, MenuNeutral, TickerNeutral } from "../../components/v2/neutral/RestaurantNeutral";
import type { VoyageBlockProps } from "./parts";
import { ContactDetailsTiles } from "./blocks/ContactDetailsTiles";
import { ContactFormPanel } from "./blocks/ContactFormPanel";
import { CtaDarkPanelGlow } from "./blocks/CtaDarkPanelGlow";
import { DestinationGridBadgeTile } from "./blocks/DestinationGridBadgeTile";
import { DividerVoyage, GalleryVoyage, MapEmbedVoyage, PullQuoteVoyage, SpacerVoyage, StatsVoyage, TeamVoyage } from "./blocks/Extras";
import { FaqAccordionColumns } from "./blocks/FaqAccordionColumns";
import { FeatureCardsStatement } from "./blocks/FeatureCardsStatement";
import { FeatureCardsTileBar } from "./blocks/FeatureCardsTileBar";
import { Hero } from "./blocks/Hero";
import { MediaFeaturePanelCaption } from "./blocks/MediaFeaturePanelCaption";
import { MediaFeatureSplitPanel } from "./blocks/MediaFeatureSplitPanel";
import { NewsletterCard } from "./blocks/NewsletterCard";
import { OfferingGridPhotoCard } from "./blocks/OfferingGridPhotoCard";
import { OfferingHistoryLedger } from "./blocks/OfferingHistoryLedger";
import { PageHeader } from "./blocks/PageHeader";
import { RichTextProse } from "./blocks/RichTextProse";
import { StoryGridCard } from "./blocks/StoryGridCard";
import { TestimonialsQuoteWall } from "./blocks/TestimonialsQuoteWall";
import { VideoFeatureBrandFilm } from "./blocks/VideoFeatureBrandFilm";

/*
 * #2829 W7 (AD-4) — voyage's layout for each (block type, variant), exactly
 * the variants site-contracts VOYAGE_VARIANTS lists (a test pins the two
 * together). The restaurant types draw the design-neutral layout.
 */
const Menu = ({ block }: VoyageBlockProps) => <MenuNeutral block={block} />;
const LinkBlock = ({ block }: VoyageBlockProps) => <LinkNeutral block={block} />;
const Hours = ({ block }: VoyageBlockProps) => <HoursNeutral block={block} />;
const Ticker = ({ block }: VoyageBlockProps) => <TickerNeutral block={block} />;

export const VOYAGE_BLOCK_VARIANTS: BlockVariantMap<VoyageBlockProps> = {
  hero: { "cover-bottom-search": Hero },
  page_header: { "cover-center": PageHeader },
  feature_cards: { "tile-bar": FeatureCardsTileBar, statement: FeatureCardsStatement },
  offering_grid: { "photo-card": OfferingGridPhotoCard },
  offering_history: { ledger: OfferingHistoryLedger },
  testimonials: { "quote-wall": TestimonialsQuoteWall },
  destination_grid: { "badge-tile": DestinationGridBadgeTile },
  story_grid: { card: StoryGridCard },
  media_feature: { "split-panel": MediaFeatureSplitPanel, "panel-caption": MediaFeaturePanelCaption },
  rich_text: { prose: RichTextProse },
  faq: { "accordion-columns": FaqAccordionColumns },
  cta: { "dark-panel-glow": CtaDarkPanelGlow },
  newsletter_signup: { card: NewsletterCard },
  video_feature: { "brand-film": VideoFeatureBrandFilm },
  contact_form: { panel: ContactFormPanel },
  contact_details: { tiles: ContactDetailsTiles },
  gallery: { voyage: GalleryVoyage },
  divider: { voyage: DividerVoyage },
  spacer: { voyage: SpacerVoyage },
  stats: { voyage: StatsVoyage },
  team: { voyage: TeamVoyage },
  pull_quote: { voyage: PullQuoteVoyage },
  map_embed: { voyage: MapEmbedVoyage },
  menu_board: { neutral: Menu },
  menu_preview: { neutral: Menu },
  menu_link: { neutral: LinkBlock },
  venue_reservation: { neutral: LinkBlock },
  contact_handoff: { neutral: LinkBlock },
  hours_location: { neutral: Hours },
  marquee: { neutral: Ticker },
};
