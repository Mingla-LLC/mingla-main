// META-ORCH-1221 [Careers site] — application form page (DESIGN §4). Server
// component: fetches the OPEN role for the context banner, then mounts the
// client ApplyForm pre-bound to the slug. A closed/draft/unknown slug shows the
// "not open" panel (you cannot apply to a role that isn't open).

import type { Metadata } from 'next'
import Link from 'next/link'
import { getOpenRoleBySlug } from '@/lib/careers-data'
import { ApplyForm } from '../../../_components/apply-form'
import { SolidCtaLink } from '../../../_components/careers-button'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  try {
    const role = await getOpenRoleBySlug(slug)
    if (role) return { title: `Apply — ${role.title}` }
  } catch {
    /* default */
  }
  return { title: 'Apply' }
}

function NotOpenPanel() {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-20 text-center sm:px-6">
      <h1 className="font-[family-name:var(--font-mochiy)] text-[24px]" style={{ color: 'var(--ink)' }}>
        This role isn&apos;t open.
      </h1>
      <p className="mt-3 text-[16px] leading-[1.6]" style={{ color: 'var(--ink-muted)' }}>
        It may have been filled or closed. See what else we&apos;re hiring for.
      </p>
      <div className="mt-6 flex justify-center">
        <SolidCtaLink href="/">View all roles</SolidCtaLink>
      </div>
    </div>
  )
}

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  let role
  try {
    role = await getOpenRoleBySlug(slug)
  } catch {
    return <NotOpenPanel />
  }
  if (!role) return <NotOpenPanel />

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-24 pt-8 sm:px-6">
      <Link
        href={`/roles/${role.slug}`}
        className="text-[14px] font-medium transition-colors hover:text-[var(--coral-500)]"
        style={{ color: 'var(--ink-muted)' }}
      >
        ← Back to role
      </Link>

      <div className="mt-6 mb-8">
        <p
          className="text-[12.5px] font-medium uppercase tracking-wide font-[family-name:var(--font-inter)]"
          style={{ color: 'var(--ink-muted)' }}
        >
          Applying for
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-mochiy)] text-[24px]" style={{ color: 'var(--ink)' }}>
          {role.title}
        </h1>
        <p className="mt-1 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          {role.salary_display}
        </p>
      </div>

      <ApplyForm slug={role.slug} roleTitle={role.title} />
    </div>
  )
}
