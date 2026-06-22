// META-ORCH-1222 [Careers site] — index (DESIGN §2). Server component: fetches
// the OPEN roles via listOpenRoles() for instant SSR + SEO, renders the hero +
// the RoleGrid (client, motion). Empty (zero open roles) + error states per
// DESIGN §2.4 are rendered here.

import { listOpenRoles, type JobPosting } from '@/lib/careers-data'
import { RoleGrid } from './_components/role-grid'
import { GhostCtaLink } from './_components/careers-button'

export const dynamic = 'force-dynamic'

function Hero() {
  return (
    <div className="mx-auto max-w-[720px] px-5 pt-10 text-center sm:px-6 sm:pt-16">
      <p
        className="text-[13px] font-semibold uppercase tracking-[0.08em] font-[family-name:var(--font-inter)]"
        style={{ color: 'var(--coral-500)' }}
      >
        We&apos;re hiring
      </p>
      <h1
        className="mt-3 font-[family-name:var(--font-mochiy)] leading-[1.12]"
        style={{ color: 'var(--ink)', fontSize: 'clamp(32px, 5vw, 44px)' }}
      >
        Build Mingla with us.
      </h1>
      <p
        className="mx-auto mt-4 max-w-[60ch] text-[18px] leading-[1.6]"
        style={{ color: 'var(--ink-muted)' }}
      >
        We&apos;re a small, fast team making it easier to find something to do — in
        the US and Nigeria. Remote, high-ownership, real work.
      </p>
    </div>
  )
}

function EmptyPanel() {
  return (
    <div className="mx-auto mt-12 max-w-[460px] px-5 text-center">
      <h2
        className="font-[family-name:var(--font-mochiy)] text-[22px]"
        style={{ color: 'var(--ink)' }}
      >
        No open roles right now.
      </h2>
      <p className="mt-2 text-[15.5px] leading-[1.6]" style={{ color: 'var(--ink-muted)' }}>
        We&apos;re not hiring at the moment — but we grow fast. Check back soon.
      </p>
    </div>
  )
}

function ErrorPanel() {
  return (
    <div className="mx-auto mt-12 max-w-[460px] px-5 text-center">
      <h2
        className="font-[family-name:var(--font-mochiy)] text-[22px]"
        style={{ color: 'var(--ink)' }}
      >
        We couldn&apos;t load the roles.
      </h2>
      <p className="mt-2 text-[15.5px] leading-[1.6]" style={{ color: 'var(--ink-muted)' }}>
        That&apos;s on us. Give it another shot.
      </p>
      <div className="mt-5 flex justify-center">
        <GhostCtaLink href="/">Try again</GhostCtaLink>
      </div>
    </div>
  )
}

export default async function CareersIndexPage() {
  let roles: JobPosting[] | null = null
  let errored = false
  try {
    roles = await listOpenRoles()
  } catch {
    errored = true
  }

  return (
    <div className="pb-20">
      <Hero />
      <div className="mx-auto mt-12 w-full max-w-[1120px] px-5 sm:px-6">
        {errored ? (
          <ErrorPanel />
        ) : !roles || roles.length === 0 ? (
          <EmptyPanel />
        ) : (
          <RoleGrid roles={roles} />
        )}
      </div>
    </div>
  )
}
