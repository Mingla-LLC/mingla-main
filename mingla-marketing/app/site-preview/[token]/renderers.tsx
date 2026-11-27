// #4636 — PREVIEW_RENDERERS: every page key of the site registry
// (lib/site-pages/registry.json) drawn by its REAL route module inside its REAL
// route layouts, so the preview is the page at true size (investigation F-1:
// 30 of 40 keys used to show only a one-line note).
//
//   - a converted page renders through its own route, so a draft block list
//     (the token's content) replaces its sections exactly as the published one
//     would (components/site-blocks/published-page.tsx);
//   - a pattern page (/cities/[city], /blog/[slug], …) takes `?sample=<slug>`,
//     else its first item;
//   - layouts that decide their frame from the address (RouteFrame) are told
//     the page's real address through PreviewPathProvider.
//
// Invariant I-4636-PREVIEW-EVERY-PAGE (declared in lib/__tests__/issue-4636-preview-editor.implementor.test.mjs): every site registry key has a preview renderer.
import type { ReactNode } from 'react'
import { PreviewPathProvider } from '@/components/site/preview-path'
import ExplorerLayout from '@/app/(explorer)/layout'
import CoreLayout from '@/app/(core)/layout'
import BlogLayout from '@/app/blog/layout'
import CitiesLayout from '@/app/cities/layout'
import HelpLayout from '@/app/help/layout'
import HostLayout from '@/app/host/layout'
import ScheduleLayout from '@/app/schedule/layout'
import ToolsLayout from '@/app/tools/layout'
import HomePage from '@/app/(explorer)/page'
import AboutPage from '@/app/(core)/about/page'
import CitiesPage from '@/app/(core)/cities/page'
import GoingOutPage from '@/app/(core)/going-out/page'
import * as CityRoute from '@/app/cities/[city]/page'
import DownloadPage from '@/app/download/page'
import BlogPage from '@/app/blog/page'
import BlogPostPage from '@/app/blog/[slug]/page'
import * as BlogCategoryRoute from '@/app/blog/category/[category]/page'
import HelpCentrePage from '@/app/help/page'
import * as HelpVideoRoute from '@/app/help/[slug]/page'
import LinksPage from '@/app/links/page'
import CreatorsPage from '@/app/creators/page'
import LocalsPage from '@/app/locals/page'
import SupportPage from '@/app/support/page'
import CreatorAgreementPage from '@/app/creator-agreement/page'
import LocalAgreementPage from '@/app/local-agreement/page'
import OrganiserTermsPage from '@/app/organiser-terms/page'
import PrivacyPolicyPage from '@/app/privacy-policy/page'
import TermsOfServicePage from '@/app/terms-of-service/page'
import SmsTermsPage from '@/app/sms-terms/page'
import DeleteAccountPage from '@/app/delete-account/page'
import HostPage from '@/app/host/page'
import HostDownloadPage from '@/app/host/download/page'
import HostIcpPage from '@/app/host/[icp]/page'
import SchedulePage from '@/app/schedule/page'
import CreatorCallPage from '@/app/schedule/creators/page'
import LocalCallPage from '@/app/schedule/locals/page'
import ToolsHubPage from '@/app/tools/page'
import VenueGraderPage from '@/app/tools/venues/page'
import EventPredictorPage from '@/app/tools/events/page'
import TripQuoterPage from '@/app/tools/trips/page'
import PricingAuditPage from '@/app/tools/pricing/page'
import ApplyPage from '@/app/apply/[slug]/page'
import { listBlogSitemapEntries } from '@/lib/blog/data'

export interface PreviewContext {
  /** `?sample=` for a pattern page (a city, post, category, video or form page slug). */
  sample: string | null
  /** Live form page slugs (for /apply/[slug]). */
  formPages: readonly string[]
}

type Renderer = (ctx: PreviewContext) => Promise<{ path: string; node: ReactNode }>

const params = <T,>(value: T) => Promise.resolve(value)
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/

/** The sample slug for a pattern page: `?sample=` when it is one of the choices, else the first. */
function pick(sample: string | null, choices: readonly string[]): string | null {
  if (sample && SLUG.test(sample) && (choices.length === 0 || choices.includes(sample))) return sample
  return choices[0] ?? null
}

function nothingToShow(what: string): ReactNode {
  return (
    <main className="sp-expired">
      <h1>No {what} to preview yet.</h1>
      <p>This page shows one {what} at a time; there is none live right now.</p>
    </main>
  )
}

const at = (path: string, node: ReactNode) => ({ path, node: <PreviewPathProvider path={path}>{node}</PreviewPathProvider> })

const icp = (slug: string): Renderer => async () => at(`/host/${slug}`, <HostLayout><HostIcpPage params={params({ icp: slug })} /></HostLayout>)
const tool = (path: string, Page: () => ReactNode): Renderer => async () => at(path, <ToolsLayout><Page /></ToolsLayout>)

export const PREVIEW_RENDERERS: Readonly<Record<string, Renderer>> = {
  home: async () => at('/', <ExplorerLayout><HomePage /></ExplorerLayout>),
  'going-out': async () => at('/going-out', <CoreLayout><GoingOutPage /></CoreLayout>),
  cities: async () => at('/cities', <CoreLayout><CitiesPage /></CoreLayout>),
  city: async ({ sample }) => {
    const slug = pick(sample, CityRoute.generateStaticParams().map((p) => p.city))
    return slug ? at(`/cities/${slug}`, <CitiesLayout><CityRoute.default params={params({ city: slug })} /></CitiesLayout>) : at('/cities', nothingToShow('city'))
  },
  download: async () => at('/download', <DownloadPage searchParams={params({})} />),
  blog: async () => at('/blog', <BlogLayout><BlogPage searchParams={params({})} /></BlogLayout>),
  'blog-post': async ({ sample }) => {
    const slugs = (await listBlogSitemapEntries().catch(() => [])).map((e) => e.slug)
    const slug = pick(sample, slugs)
    return slug ? at(`/blog/${slug}`, <BlogLayout><BlogPostPage params={params({ slug })} /></BlogLayout>) : at('/blog', nothingToShow('story'))
  },
  'blog-category': async ({ sample }) => {
    const slug = pick(sample, BlogCategoryRoute.generateStaticParams().map((p) => p.category))
    return slug
      ? at(`/blog/category/${slug}`, <BlogLayout><BlogCategoryRoute.default params={params({ category: slug })} searchParams={params({})} /></BlogLayout>)
      : at('/blog', nothingToShow('category'))
  },
  help: async () => at('/help', <HelpLayout><HelpCentrePage /></HelpLayout>),
  'help-video': async ({ sample }) => {
    const slug = pick(sample, HelpVideoRoute.generateStaticParams().map((p) => p.slug))
    return slug ? at(`/help/${slug}`, <HelpLayout><HelpVideoRoute.default params={params({ slug })} /></HelpLayout>) : at('/help', nothingToShow('video'))
  },
  links: async () => at('/links', <LinksPage searchParams={params({})} />),
  about: async () => at('/about', <CoreLayout><AboutPage /></CoreLayout>),
  creators: async () => at('/creators', <CreatorsPage />),
  locals: async () => at('/locals', <LocalsPage />),
  support: async () => at('/support', <SupportPage />),
  'creator-agreement': async () => at('/creator-agreement', <CreatorAgreementPage />),
  'local-agreement': async () => at('/local-agreement', <LocalAgreementPage />),
  'organiser-terms': async () => at('/organiser-terms', <OrganiserTermsPage />),
  'privacy-policy': async () => at('/privacy-policy', <PrivacyPolicyPage />),
  'terms-of-service': async () => at('/terms-of-service', <TermsOfServicePage />),
  'sms-terms': async () => at('/sms-terms', <SmsTermsPage />),
  'delete-account': async () => at('/delete-account', <DeleteAccountPage />),
  host: async () => at('/host', <HostLayout><HostPage /></HostLayout>),
  'host-download': async () => at('/host/download', <HostLayout><HostDownloadPage /></HostLayout>),
  schedule: async () => at('/schedule', <ScheduleLayout><SchedulePage /></ScheduleLayout>),
  'schedule-creators': async () => at('/schedule/creators', <ScheduleLayout><CreatorCallPage /></ScheduleLayout>),
  'schedule-locals': async () => at('/schedule/locals', <ScheduleLayout><LocalCallPage /></ScheduleLayout>),
  tools: tool('/tools', ToolsHubPage),
  'tools-venues': tool('/tools/venues', VenueGraderPage),
  'tools-events': tool('/tools/events', EventPredictorPage),
  'tools-trips': tool('/tools/trips', TripQuoterPage),
  'tools-pricing': tool('/tools/pricing', PricingAuditPage),
  events: icp('events'),
  trips: icp('trips'),
  experiences: icp('experiences'),
  restaurants: icp('restaurants'),
  hotels: icp('hotels'),
  art: icp('art'),
  play: icp('play'),
  apply: async ({ sample, formPages }) => {
    const slug = pick(sample, formPages)
    return slug ? at(`/apply/${slug}`, <ApplyPage params={params({ slug })} />) : at('/', nothingToShow('form page'))
  },
}
