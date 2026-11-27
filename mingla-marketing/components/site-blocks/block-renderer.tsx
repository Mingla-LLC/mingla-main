// #4636 — renders a page's block list through the ONE registry
// (lib/site-blocks/registry.ts), inside the same wrapper the original pages use
// (R6): LandingRoot ([data-landing], reveal / lit / feature behaviours) and
// landing.css + site.css + pages.css (through SitePage). The three brand-face
// variables (app/site-fonts.ts) are applied by the ROUTE that renders this, as
// on every page: the #3548 per-route font gate
// (scripts/issue-4339-landing-fonts.contract.mjs) lists the route modules that
// may load the faces, so the catch-all and preview routes (build 2) wrap
// <BlockRenderer> in the same three variables. Blocks that declare the city wrapper get the
// `page-system-root city-hub-root city-page-v2 city-page-v3` wrapper and the
// city stylesheets.
//
// Consecutive `programme` blocks share one `<section className="pb-100"><div
// className="wrap">` frame, as on Creators, Locals and Careers.
//
// An unknown block, an invalid one, or one over its per-page limit renders
// NOTHING and is reported (console.error, tagged [site-blocks]); the rest of
// the page still renders. A hidden block renders nothing, silently.
// Invariant I-4636-BLOCKS-ARE-EXISTING-SECTIONS (declared in its test): every registry block renders through the same component its original page uses (lib/__tests__/issue-4636-block-registry.implementor.test.mjs).
import type { ComponentType } from 'react'
import { SitePage } from '@/components/site/site-page'
import type { SiteFooterSurface } from '@/components/marketing/footer'
import type { SiteNavKey } from '@/components/site/site-nav'
import { resolveLibraryRefs, type MediaMap } from '@/lib/site-blocks/media'
import type { Colour } from '@/lib/site-blocks/registry'
import { planBlocks, usableBlockCount, type BlockReporter, type PlannedBlock } from '@/lib/site-blocks/render-plan'
// The city wrapper's four stylesheets (the same set app/cities/layout.tsx loads).
import '@/components/cutout/cutout.css'
import '@/components/page-system/page-system.css'
import '@/components/cities/city-hubs.css'
import '@/components/cities/city-page.css'

import { AnswerBlock } from './sections/answer-block'
import { BlogStoriesBlock } from './sections/blog-stories-block'
import { ChipsBlock } from './sections/chips-block'
import { CitiesRowBlock } from './sections/cities-row-block'
import { CityHeroBlock } from './sections/city-hero-block'
import { CityHostBandBlock } from './sections/city-host-band-block'
import { CityLinksBlock } from './sections/city-links-block'
import { CityPlansBlock } from './sections/city-plans-block'
import { CityWeekendBlock } from './sections/city-weekend-block'
import { ClipGridBlock } from './sections/clip-grid-block'
import { FactsBlock } from './sections/facts-block'
import { FaqBlock } from './sections/faq-block'
import { FilterGridBlock } from './sections/filter-grid-block'
import { FinePrintBlock } from './sections/fine-print-block'
import { GetAppBlock } from './sections/get-app-block'
import { HelpVideosBlock } from './sections/help-videos-block'
import { HeroWordsBlock } from './sections/hero-words-block'
import { IcpFeaturesBlock } from './sections/icp-features-block'
import { IcpHeroBlock } from './sections/icp-hero-block'
import { LitAboutBlock } from './sections/lit-about-block'
import { MarqueeBlock } from './sections/marquee-block'
import { OpenRolesBlock } from './sections/open-roles-block'
import { PageHeroBlock } from './sections/page-hero-block'
import { ParasBlock } from './sections/paras-block'
import { PromptDemoBlock } from './sections/prompt-demo-block'
import { QuickLinksBlock } from './sections/quick-links-block'
import { ReelHeroBlock } from './sections/reel-hero-block'
import { SchedulerBlock } from './sections/scheduler-block'
import { SpotBlock } from './sections/spot-block'
import { StepsBlock } from './sections/steps-block'
import { StillStuckBlock } from './sections/still-stuck-block'
import { TilesBlock } from './sections/tiles-block'
import { ToolCardBlock } from './sections/tool-card-block'
import { ToolCardsBlock } from './sections/tool-cards-block'
import { ToolkitBlock } from './sections/toolkit-block'
import { TopPlacesBlock } from './sections/top-places-block'
import { VCardsBlock } from './sections/vcards-block'
import { VideoBandBlock } from './sections/video-band-block'
import { WideClipBlock } from './sections/wide-clip-block'

interface AnyBlockProps {
  content: never
  colour?: Colour
  blockId: string
}

/** Block key → the extracted section component (one per registry entry). */
/** The section components (each typed for its own content; cast at the call site). */
type BlockComponent = unknown

export const BLOCK_COMPONENTS: Readonly<Record<string, BlockComponent>> = {
  reelHero: ReelHeroBlock,
  heroWords: HeroWordsBlock,
  pageHero: PageHeroBlock,
  icpHero: IcpHeroBlock,
  cityHero: CityHeroBlock,
  steps: StepsBlock,
  litAbout: LitAboutBlock,
  icpFeatures: IcpFeaturesBlock,
  paras: ParasBlock,
  answer: AnswerBlock,
  facts: FactsBlock,
  toolkit: ToolkitBlock,
  chips: ChipsBlock,
  faq: FaqBlock,
  marquee: MarqueeBlock,
  tiles: TilesBlock,
  clipGrid: ClipGridBlock,
  wideClip: WideClipBlock,
  vcards: VCardsBlock,
  filterGrid: FilterGridBlock,
  videoBand: VideoBandBlock,
  toolCard: ToolCardBlock,
  toolCards: ToolCardsBlock,
  promptDemo: PromptDemoBlock,
  getApp: GetAppBlock,
  quickLinks: QuickLinksBlock,
  stillStuck: StillStuckBlock,
  finePrint: FinePrintBlock,
  form: SpotBlock,
  buttons: SpotBlock,
  banner: SpotBlock,
  citiesRow: CitiesRowBlock,
  cityLinks: CityLinksBlock,
  cityWeekend: CityWeekendBlock,
  topPlaces: TopPlacesBlock,
  cityPlans: CityPlansBlock,
  cityHostBand: CityHostBandBlock,
  blogStories: BlogStoriesBlock,
  helpVideos: HelpVideosBlock,
  openRoles: OpenRolesBlock,
  scheduler: SchedulerBlock,
}

const defaultReport: BlockReporter = (message) => console.error(`[site-blocks] ${message}`)

interface BlockRendererProps {
  blocks: readonly unknown[]
  /** The nav and footer surface. */
  surface?: SiteFooterSurface
  /** #4636: the nav item to mark as current (as the coded page does). */
  current?: SiteNavKey
  /** #4636: the route's layout already renders <main id="main"> (explorer and host layouts). */
  layoutMain?: boolean
  /** #4636: a host-type page's ICP slug for the landing root. */
  slug?: string
  /** #4636: the media library items the blocks use (`m:<uuid>` → the file); a block naming one it lacks is skipped. */
  media?: MediaMap
  /** #4636: extra props per block type that are not content (the /download toggle's starting app). */
  blockProps?: Readonly<Record<string, Record<string, unknown>>>
  /**
   * #4636: inside the Admin editor's preview, each block is wrapped in a
   * `display: contents` element carrying its index and type, so the editor
   * bridge can measure it and report clicks. Never on the live site.
   */
  editor?: boolean
  /** Stable prefix for block ids on the page. */
  idPrefix?: string
  report?: BlockReporter
}

/** How many blocks of a list would render (0: nothing usable, so a converted page stays coded). */
export function renderableCount(blocks: unknown, media: MediaMap | undefined): number {
  return usableBlockCount(blocks, media, (type) => BLOCK_COMPONENTS[type] !== undefined)
}

/** One page from its block list, in the original pages' wrapper. */
export function BlockRenderer({ blocks, surface = 'explorer', current, layoutMain = false, slug, media, blockProps, editor = false, idPrefix = 'b', report = defaultReport }: BlockRendererProps) {
  const plan = planBlocks(blocks, report, (type) => BLOCK_COMPONENTS[type] !== undefined)

  const render = ({ block, index }: PlannedBlock) => {
    const Component = BLOCK_COMPONENTS[block.type] as ComponentType<AnyBlockProps & Record<string, unknown>> | undefined
    if (!Component) return null
    const resolved = resolveLibraryRefs(block.content, media)
    if (resolved.missing.length) {
      report(`block ${index} skipped: media library item ${resolved.missing.join(', ')} is not available`)
      return null
    }
    const extra = blockProps?.[block.type] ?? {}
    const node = <Component key={index} {...extra} content={resolved.value as never} colour={block.colour as Colour | undefined} blockId={`${idPrefix}-${index}-${block.type}`} />
    if (!editor) return node
    const id = typeof (block as { id?: unknown }).id === 'string' ? String((block as { id?: unknown }).id) : undefined
    return (
      <div key={index} data-ed-block={index} data-ed-type={block.type} data-ed-id={id} style={{ display: 'contents' }}>
        {node}
      </div>
    )
  }

  const body = (
    <SitePage surface={surface} current={current} layoutMain={layoutMain} slug={slug}>
      {plan.groups.map((g, gi) =>
        g.frame === 'programme' ? (
          <section className="pb-100" key={`frame-${gi}`}>
            <div className="wrap">{g.items.map(render)}</div>
          </section>
        ) : (
          g.items.map(render)
        ),
      )}
    </SitePage>
  )

  return plan.city ? <div className="page-system-root city-hub-root city-page-v2 city-page-v3">{body}</div> : body
}
