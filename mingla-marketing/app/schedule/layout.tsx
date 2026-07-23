import Link from 'next/link'
import { Footer } from '@/components/marketing/footer'

// #1086 [Standalone scheduler] — the /schedule shell.
//
// Mirrors the /tools shell (app/tools/layout.tsx): dark stage (bg-smoke, the
// site's default :root theme), a minimal Mingla Business top bar instead of the
// consumer GlassNav (this is a business-facing funnel), and the shared site
// Footer below in a light band (data-theme="light"). Kept as its own layout so
// the scheduler lives at the clean top-level /schedule URL any lead can share.
export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
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
      <main id="main" className="flex-1">{children}</main>
      <div data-theme="light">
        <Footer surface="organiser" />
      </div>
    </div>
  )
}
