import { searchRouteMetadata } from '@/lib/search/metadata'
import {
  BreadcrumbSchema,
  CutoutFooter,
  CutoutHeading,
  CutoutNav,
  CutoutSection,
  CutoutShell,
} from '@/components/cutout'
import { HelpBrowser } from '@/components/help/help-browser'
import { HELP_VIDEOS } from '@/content/help/registry'

// The help centre. Every feature of the platform, shown rather than described.
//
// Discovery here is by intent, not by chapter number: people arrive knowing the
// job they are stuck on ("get paid", "run the door"), not which episode covers
// it. Chapters are the resting state; the chips and the search are the way in.

export const metadata = searchRouteMetadata('/help')

export default function HelpCentrePage() {
  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/host" />
      <BreadcrumbSchema
        crumbs={[
          { name: 'Mingla', path: '/' },
          { name: 'Help centre', path: '/help' },
        ]}
      />

      <CutoutSection aria-label="Help centre">
        <CutoutHeading
          as="h1"
          align="center"
          eyebrow="Help centre"
          lede="Short videos that walk through every part of Mingla — on the web, on iPhone and on Android, side by side. Find the one for what you are doing right now."
        >
          Learn Mingla <span className="cut-gradient-brand">in minutes.</span>
        </CutoutHeading>

        <div className="mt-14">
          <HelpBrowser videos={HELP_VIDEOS} />
        </div>
      </CutoutSection>

      <CutoutSection band="dark" aria-label="Still stuck">
        <CutoutHeading
          align="center"
          lede="If a video does not answer it, a person will. We usually reply the same day."
        >
          Still stuck?
        </CutoutHeading>
        <p className="mt-8 text-center">
          <a
            href="mailto:support@usemingla.com"
            className="cut-btn cut-btn-brand inline-flex items-center rounded-full px-7 py-3.5 text-[0.9375rem] font-semibold"
          >
            Email support@usemingla.com
          </a>
        </p>
      </CutoutSection>

      <CutoutFooter surface="host" />
    </CutoutShell>
  )
}
