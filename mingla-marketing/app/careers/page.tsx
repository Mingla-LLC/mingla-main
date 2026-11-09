// META-ORCH-1222 [Careers site] — index. Server component: fetches the OPEN
// roles via listOpenRoles() for instant SSR + SEO. Empty (zero open roles) and
// error states are rendered here.
//
// #4339 phase 2b — redesigned ("Mingla, Edited"): the site nav and the
// canonical footer with every link absolute on usemingla.com (this page is
// served on career.usemingla.com, where a relative link would stay inside the
// careers segment), the headline, three values, then the live roles. With no
// open roles it says "No open roles right now." and offers "Follow
// @usemingla". There is NO email sign-up form: nothing would receive it (§7).
// Role cards open /roles/<slug> on the careers host, unchanged.

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PageHero, SitePage } from '@/components/site/site-page'
import { employmentLabel, listOpenRoles, type JobPosting } from '@/lib/careers-data'
import { SITE_ORIGIN } from '@/lib/site'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

export const dynamic = 'force-dynamic'

const INSTAGRAM_URL = 'https://www.instagram.com/usemingla'

const VALUES = [
  { title: 'Plans over pins', body: 'We build for the moment someone decides what to do.' },
  { title: 'Real places first', body: 'Every feature should help a place with soul get found.' },
  { title: 'Say it plainly', body: 'Clear words, honest numbers, no promises we can’t keep.' },
]

function EmptyPanel() {
  return (
    <div className="empty reveal" data-careers-state="empty">
      <h2 className="h2">
        No open roles <em>right now.</em>
      </h2>
      <p className="lead">New roles are posted here first, and on @usemingla.</p>
      <div className="row">
        <a className="btn ink" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
          Follow @usemingla
        </a>
      </div>
    </div>
  )
}

function ErrorPanel() {
  return (
    <div className="empty" data-careers-state="error" role="alert">
      <h2 className="h2">
        We couldn’t load <em>the roles.</em>
      </h2>
      <p className="lead">That’s on us. Give it another shot.</p>
      <div className="row">
        <Link className="btn ink" href="/">
          Try again
        </Link>
      </div>
    </div>
  )
}

function RoleCards({ roles }: { roles: JobPosting[] }) {
  return (
    <ul className="grid2" data-careers-state="open">
      {roles.map((role) => (
        <li key={role.slug}>
          <Link className="card pad role-card" href={`/roles/${role.slug}`}>
            <span className="for">
              {role.department} · {role.location} · {employmentLabel(role.employment_type)}
            </span>
            <h2 className="h3">{role.title}</h2>
            <p className="muted">{role.summary}</p>
            <span className="role-foot">
              <b>{role.salary_display}</b>
              <span className="btn soft sm">
                View role <ArrowRight aria-hidden="true" />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
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
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer" origin={SITE_ORIGIN}>
        <PageHero
          title={
            <>
              Build the app for <em>what to do.</em>
            </>
          }
          lead="We’re a small team making real life easier to find, for the people going out and the places that make it worth it."
        />
        <section className="pb-100" aria-label="Open roles">
          <div className="wrap">
            <ol className="grid3 steps-list">
              {VALUES.map((value, index) => (
                <li key={value.title} className="step reveal values">
                  <span className="n">{String(index + 1).padStart(2, '0')}</span>
                  <h2 className="step-title">{value.title}</h2>
                  <p className="muted">{value.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-24">
              {errored ? <ErrorPanel /> : !roles || roles.length === 0 ? <EmptyPanel /> : <RoleCards roles={roles} />}
            </div>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
