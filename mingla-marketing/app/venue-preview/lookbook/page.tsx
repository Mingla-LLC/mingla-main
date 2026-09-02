// ISSUE-1080 — skins lookbook. Renders each venue-homepage skin with sample
// content so the set can be reviewed and signed off in one place. Each preview
// is the real skin (an iframe of /venue-preview?sample=1&skin=…), scaled down.

import { SKIN_ORDER, skinMeta } from '../venueSkins'
import { publicNoindexMetadata } from '@/lib/search/metadata'

export const metadata = publicNoindexMetadata('/venue-preview/lookbook', {
  title: 'Venue skins — lookbook',
})

export const dynamic = 'force-dynamic'

export default function LookbookPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warm-ink">
        Venue Website Grader
      </p>
      <h1 className="mt-2 text-[clamp(1.6rem,4vw,2.4rem)] font-bold leading-tight text-text-primary">
        Redesign skins — lookbook
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
        Every graded venue&rsquo;s &ldquo;after&rdquo; homepage is rendered in the skin that best
        fits it — auto-picked from the venue&rsquo;s vibe. Here they are with sample content for
        sign-off. Each is the real, live skin.
      </p>

      <div className="mt-10 space-y-12">
        {SKIN_ORDER.map((id) => {
          const meta = skinMeta(id)
          return (
            <section key={id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold text-text-primary">
                  {meta.label}
                  <span className="ml-2 rounded-full border border-divider-strong bg-stripe-strong px-2 py-0.5 align-middle text-[11px] font-semibold text-text-muted">
                    skin={id}
                  </span>
                </h2>
                <a
                  href={`/venue-preview?sample=1&skin=${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm text-sm font-semibold text-warm-ink underline-offset-4 hover:underline"
                >
                  Open full-screen ↗
                </a>
              </div>
              <p className="mt-1 text-sm text-text-secondary">{meta.description}</p>
              <div className="mt-4 overflow-x-auto rounded-md border border-divider-strong bg-black">
                {/* 1280×800 skin scaled to a 640×400 thumbnail. */}
                <div className="relative h-[400px] w-[640px]">
                  <iframe
                    title={`${meta.label} skin preview`}
                    src={`/venue-preview?sample=1&skin=${id}`}
                    className="absolute left-0 top-0 origin-top-left"
                    style={{ width: 1280, height: 800, transform: 'scale(0.5)', border: 0 }}
                    loading="lazy"
                  />
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
