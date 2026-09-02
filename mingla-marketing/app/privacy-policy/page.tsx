import Link from 'next/link'
import { PRIVACY_SECTIONS, PRIVACY_EFFECTIVE_DATE } from '@/lib/privacyContent'
import { cn } from '@/lib/cn'
import { searchRouteMetadata } from '@/lib/search/metadata'

export const metadata = searchRouteMetadata('/privacy-policy')

export default function PrivacyPolicyPage() {
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
            Effective Date: {PRIVACY_EFFECTIVE_DATE}
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-6xl">
            Privacy Policy
          </h1>

          <div className="mt-8 space-y-6">
            {PRIVACY_SECTIONS.map((section) => {
              const hasContact = 'contact' in section

              return (
                <section
                  key={section.title}
                  className={cn(
                    'space-y-3',
                    hasContact &&
                      'rounded-3xl border border-warm/25 bg-warm/10 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
                  )}
                >
                  <h2 className="font-display text-xl leading-tight text-white/95 sm:text-2xl">
                    {section.title}
                  </h2>
                  <div className="space-y-3 text-sm leading-7 text-white/72 sm:text-base">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    {'bullets' in section ? (
                      <ul className="space-y-2 pl-5">
                        {section.bullets.map((bullet) => (
                          <li key={bullet} className="list-disc marker:text-warm/80">
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {'footer' in section ? <p>{section.footer}</p> : null}
                    {hasContact ? (
                      <div className="space-y-3 rounded-2xl border border-white/12 bg-black/20 p-4 text-white/82">
                        <p className="font-semibold text-white">
                          {section.contact.name}
                        </p>
                        <p>
                          Email:{' '}
                          <a
                            href={`mailto:${section.contact.email}`}
                            className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                          >
                            {section.contact.email}
                          </a>
                        </p>
                        <p>
                          Website:{' '}
                          <a
                            href={section.contact.website}
                            className="font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                          >
                            {section.contact.website}
                          </a>
                        </p>
                      </div>
                    ) : null}
                  </div>
                </section>
              )
            })}
          </div>
        </article>
      </div>
    </main>
  )
}
