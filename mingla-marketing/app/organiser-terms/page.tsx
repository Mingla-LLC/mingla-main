import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ORGANISER_TERMS_COMPANIES,
  ORGANISER_TERMS_LAST_UPDATED,
  ORGANISER_TERMS_SECTIONS,
  ORGANISER_TERMS_VERSION,
  organiserTermsHeading,
} from '@/lib/organiserTermsContent'
import { publicNoindexMetadata } from '@/lib/search/metadata'

// #3645 — registered `draft` in the route registry: reachable by link (the
// footer, the Terms of Service and the Host app), but noindex and absent from
// the sitemap until legal review clears it for search.
export const metadata = publicNoindexMetadata('/organiser-terms', {
  title: 'Mingla Organiser Terms',
  description:
    'The terms for anyone who lists, sells, messages or advertises with Mingla Host: who you contract with, fees, payouts, refunds, Buyer data and disputes.',
})

const linkClass = 'font-semibold text-warm underline-offset-4 hover:underline focus-ring'

// The content module's only markup is `**bold**`.
function inline(text: string): ReactNode[] {
  return text.split('**').map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold text-white">
        {part}
      </strong>
    ) : (
      part
    ),
  )
}

export default function OrganiserTermsPage() {
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

      <div className="relative mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="mb-8 inline-flex w-fit min-h-10 items-center rounded-full border border-white/12 bg-white/8 px-4 text-sm font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
        >
          Back to Mingla
        </Link>

        <article className="rounded-[28px] border border-white/12 bg-[#0d0d10]/94 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
            Last updated {ORGANISER_TERMS_LAST_UPDATED} · Version {ORGANISER_TERMS_VERSION}
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-6xl">
            Organiser Terms
          </h1>
          <p className="mt-4 text-sm leading-7 text-white/72 sm:text-base">
            For anyone who lists, sells, messages or advertises with Mingla Host. They sit on top
            of our{' '}
            <Link href="/terms-of-service" className={linkClass}>
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy-policy" className={linkClass}>
              Privacy Policy
            </Link>
            .
          </p>

          <section
            aria-labelledby="which-company"
            className="mt-8 rounded-3xl border border-warm/25 bg-warm/10 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <h2 id="which-company" className="font-display text-xl leading-tight text-white/95">
              Which company am I agreeing with?
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {ORGANISER_TERMS_COMPANIES.map((company) => (
                <div
                  key={company.name}
                  className="space-y-2 rounded-2xl border border-white/12 bg-black/20 p-4 text-sm leading-6 text-white/76"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-warm">
                    {company.who}
                  </p>
                  <p className="font-semibold text-white">{company.name}</p>
                  {company.registration ? <p>{company.registration}.</p> : null}
                  <p>{company.address}</p>
                  <p className="text-white/60">{company.law}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-white/60">
              Details in{' '}
              <a href="#section-1" className={linkClass}>
                section 1
              </a>
              .
            </p>
          </section>

          <nav aria-labelledby="contents" className="mt-8 rounded-3xl border border-white/12 bg-black/20 p-5">
            <h2 id="contents" className="font-display text-xl leading-tight text-white/95">
              Contents
            </h2>
            <ol className="mt-3 space-y-1.5 text-sm leading-6">
              {ORGANISER_TERMS_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="text-white/76 underline-offset-4 hover:text-warm hover:underline focus-ring">
                    {organiserTermsHeading(section)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-8 space-y-8">
            {ORGANISER_TERMS_SECTIONS.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-6 space-y-3">
                <h2 className="font-display text-xl leading-tight text-white/95 sm:text-2xl">
                  {organiserTermsHeading(section)}
                </h2>
                <div className="space-y-3 text-sm leading-7 text-white/72 sm:text-base">
                  {section.blocks.map((block, index) =>
                    block.type === 'list' ? (
                      <ul key={index} className="space-y-2 pl-5">
                        {block.items.map((item) => (
                          <li key={item} className="list-disc marker:text-warm/80">
                            {inline(item)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p key={index}>
                        {block.lead ? (
                          <>
                            <strong className="font-semibold text-white">{block.lead}</strong>{' '}
                          </>
                        ) : null}
                        {inline(block.text)}
                      </p>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  )
}
