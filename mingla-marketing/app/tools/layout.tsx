import Link from 'next/link'
import { Footer } from '@/components/marketing/footer'
import { ToolsBreadcrumb } from '@/components/marketing/tools-breadcrumb'

// #1003 [Venue Website Grader — growth tools, test cut] — the /tools shell.
//
// Dark stage (the site's default :root theme — body is bg-smoke), following the
// standalone dark-page pattern (app/unsubscribe). Deliberately NOT the GlassNav:
// on a non-/business path it would render the CONSUMER surface (explorer logo +
// "Get the app"), which is the wrong funnel for a business-facing tool. A
// minimal top bar routes back to Mingla Business instead. The shared site
// Footer mounts below, wrapped in data-theme="light" because it is a light
// (bg-vellum) band and its text tokens are theme-aware.
export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-smoke text-text-primary">
      <header className="px-6 pt-6 md:px-10 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link
            href="/business"
            aria-label="Mingla Business home"
            className="inline-flex shrink-0 items-center rounded-md px-0.5 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 focus-ring"
          >
            <img
              src="/brand/mingla-wordmark.svg"
              alt="Mingla"
              className="h-7 w-auto select-none"
              draggable={false}
            />
          </Link>
          <Link
            href="/business"
            className="inline-flex min-h-10 items-center rounded-full border border-white/12 bg-white/8 px-4 text-sm font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
          >
            Mingla Business
          </Link>
        </div>
      </header>
      <ToolsBreadcrumb />
      <main id="main" className="flex-1">{children}</main>
      <div data-theme="light">
        <Footer surface="organiser" />
      </div>
    </div>
  )
}
