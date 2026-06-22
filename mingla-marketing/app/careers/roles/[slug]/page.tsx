// META-ORCH-1222 [Careers site] — role detail / JD (DESIGN §3). Server component:
// fetches the OPEN role by slug; renders header, salary, Apply CTAs (top +
// bottom), markdown JD body, mobile sticky Apply bar. A slug that does not
// resolve to a status='open' row → DESIGN §3.3 "not open" panel (closed/draft
// roles NEVER render their JD publicly — RLS + the open-only filter enforce it).

import type { Metadata } from 'next'
import Link from 'next/link'
import { getOpenRoleBySlug, employmentLabel } from '@/lib/careers-data'
import { renderJobBody } from '@/lib/careers-markdown'
import { SolidCtaLink } from '../../_components/careers-button'
import { StickyApplyBar } from '../../_components/sticky-apply-bar'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  try {
    const role = await getOpenRoleBySlug(slug)
    if (role) {
      return { title: role.title, description: role.summary }
    }
  } catch {
    /* fall through to default */
  }
  return { title: 'Role' }
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-medium"
      style={{ background: 'var(--coral-050)', color: 'var(--ink-muted)' }}
    >
      {children}
    </span>
  )
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

function ErrorPanel() {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-20 text-center sm:px-6">
      <h1 className="font-[family-name:var(--font-mochiy)] text-[24px]" style={{ color: 'var(--ink)' }}>
        We couldn&apos;t load this role.
      </h1>
      <p className="mt-3 text-[16px] leading-[1.6]" style={{ color: 'var(--ink-muted)' }}>
        That&apos;s on us. Give it another shot.
      </p>
      <div className="mt-6 flex justify-center">
        <SolidCtaLink href="/">View all roles</SolidCtaLink>
      </div>
    </div>
  )
}

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  let role
  try {
    role = await getOpenRoleBySlug(slug)
  } catch {
    return <ErrorPanel />
  }
  if (!role) return <NotOpenPanel />

  const bodyHtml = renderJobBody(role.body ?? '')

  return (
    <div className="mx-auto max-w-[760px] px-5 pb-24 pt-8 sm:px-6">
      <Link
        href="/"
        className="text-[14px] font-medium transition-colors hover:text-[var(--coral-500)]"
        style={{ color: 'var(--ink-muted)' }}
      >
        ← All roles
      </Link>

      <div className="mt-6 flex flex-wrap gap-2">
        <Chip>{role.department}</Chip>
        <Chip>{role.location}</Chip>
        <Chip>{employmentLabel(role.employment_type)}</Chip>
      </div>

      <h1
        className="mt-4 font-[family-name:var(--font-mochiy)] leading-[1.15]"
        style={{ color: 'var(--ink)', fontSize: 'clamp(30px, 4.5vw, 40px)' }}
      >
        {role.title}
      </h1>

      <p className="mt-2.5 flex items-center gap-2 text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: 'var(--coral-500)' }}
        />
        {role.salary_display}
      </p>

      <div className="my-8">
        <SolidCtaLink href={`/roles/${role.slug}/apply`}>Apply for this role</SolidCtaLink>
      </div>

      {/* Mobile/tablet sticky Apply bar (reveals when top CTA scrolls out). */}
      <StickyApplyBar slug={role.slug} roleTitle={role.title} />

      {/* JD body — admin-authored markdown, escaped-then-rendered (trust boundary
          in careers-markdown.ts). */}
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />

      <div className="mt-10 flex justify-center">
        <SolidCtaLink href={`/roles/${role.slug}/apply`}>Apply for this role</SolidCtaLink>
      </div>
    </div>
  )
}
