import Link from 'next/link'
import { Suspense } from 'react'
import { UnsubscribeForm } from './UnsubscribeForm'
import { publicNoindexMetadata } from '@/lib/search/metadata'

export const metadata = publicNoindexMetadata('/unsubscribe', {
  title: 'Unsubscribe',
  description:
    'Opt out of Mingla marketing messages by email or text. No login required — your request is honored immediately.',
})

export default function UnsubscribePage() {
  return (
    <main
      id="main"
      className="relative min-h-screen overflow-hidden bg-[#08090b] px-5 py-8 text-text-primary sm:px-8 sm:py-10"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_12%,rgba(235,120,37,0.18),transparent_32%),radial-gradient(ellipse_at_84%_18%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,#08090b_0%,#0d0d10_58%,#07080a_100%)]" />
        <div className="absolute inset-0 opacity-[0.09] [background-image:linear-gradient(rgba(235,120,37,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:72px_72px]" />
        <div className="absolute left-[-18%] top-[12%] h-[34rem] w-[70%] rotate-[-14deg] rounded-[50%] border border-dashed border-warm/20" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />
      </div>

      <div className="relative mx-auto w-full max-w-2xl">
        <Link
          href="/"
          className="mb-8 inline-flex w-fit min-h-10 items-center rounded-full border border-white/12 bg-white/8 px-4 text-sm font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
        >
          Back to Mingla
        </Link>

        <article className="rounded-[28px] border border-white/12 bg-[#0d0d10]/94 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
            Manage your messages
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-5xl">
            Unsubscribe
          </h1>

          <div className="mt-8">
            <Suspense
              fallback={
                <p className="text-sm text-white/55">Loading the opt-out form…</p>
              }
            >
              <UnsubscribeForm />
            </Suspense>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 border-t border-white/10 pt-6 text-sm">
            <Link
              href="/sms-terms"
              className="inline-flex min-h-10 items-center rounded-full border border-white/14 bg-white/8 px-4 font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
            >
              SMS Terms
            </Link>
            <Link
              href="/privacy-policy"
              className="inline-flex min-h-10 items-center rounded-full border border-white/14 bg-white/8 px-4 font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms-of-service"
              className="inline-flex min-h-10 items-center rounded-full border border-white/14 bg-white/8 px-4 font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
            >
              Terms of Service
            </Link>
          </div>
        </article>
      </div>
    </main>
  )
}
