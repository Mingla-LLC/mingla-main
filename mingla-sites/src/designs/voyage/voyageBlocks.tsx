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
import { SHARED_BLOCK_LAYOUTS } from "../shared/library";

/*
 * #2829 W7 (AD-4) — voyage's layout for each (block type, variant), exactly
 * the variants site-contracts VOYAGE_VARIANTS lists (a test pins the two
 * together). The restaurant types draw the design-neutral layout.
 */
const Menu = ({ block }: VoyageBlockProps) => <MenuNeutral block={block} />;
const LinkBlock = ({ block }: VoyageBlockProps) => <LinkNeutral block={block} />;
const Hours = ({ block }: VoyageBlockProps) => <HoursNeutral block={block} />;
const Ticker = ({ block }: VoyageBlockProps) => <TickerNeutral block={block} />;

/* #4453 §3.4 — the shared layouts voyage offers, after its own first layout (stored blocks render as before). */
const shared = SHARED_BLOCK_LAYOUTS;

export const VOYAGE_BLOCK_VARIANTS: BlockVariantMap<VoyageBlockProps> = {
  hero: { "cover-bottom-search": Hero, fullbleed: shared.hero!.fullbleed! },
  page_header: { "cover-center": PageHeader },
  feature_cards: { "tile-bar": FeatureCardsTileBar, statement: FeatureCardsStatement },
  offering_grid: { "photo-card": OfferingGridPhotoCard, poster: shared.offering_grid!.poster! },
  offering_history: { ledger: OfferingHistoryLedger, "ledger-count": shared.offering_history!["ledger-count"]! },
  testimonials: { "quote-wall": TestimonialsQuoteWall, rail: shared.testimonials!.rail! },
  destination_grid: { "badge-tile": DestinationGridBadgeTile },
  story_grid: { card: StoryGridCard },
  media_feature: { "split-panel": MediaFeatureSplitPanel, "panel-caption": MediaFeaturePanelCaption },
  rich_text: { prose: RichTextProse, manifesto: shared.rich_text!.manifesto! },
  faq: { "accordion-columns": FaqAccordionColumns, split: shared.faq!.split! },
  cta: { "dark-panel-glow": CtaDarkPanelGlow },
  newsletter_signup: { card: NewsletterCard, photo: shared.newsletter_signup!.photo! },
  video_feature: { "brand-film": VideoFeatureBrandFilm },
  contact_form: { panel: ContactFormPanel },
  contact_details: { tiles: ContactDetailsTiles },
  gallery: { voyage: GalleryVoyage, mosaic: shared.gallery!.mosaic! },
  divider: { voyage: DividerVoyage },
  spacer: { voyage: SpacerVoyage },
  stats: { voyage: StatsVoyage },
  team: { voyage: TeamVoyage },
  pull_quote: { voyage: PullQuoteVoyage },
  map_embed: { voyage: MapEmbedVoyage },
  menu_board: { neutral: Menu, columns: shared.menu_board!.columns! },
  menu_preview: { neutral: Menu },
  menu_link: { neutral: LinkBlock },
  venue_reservation: { neutral: LinkBlock },
  contact_handoff: { neutral: LinkBlock },
  hours_location: { neutral: Hours, split: shared.hours_location!.split! },
  marquee: { neutral: Ticker, ticker: shared.marquee!.ticker! },
};
