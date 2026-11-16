// #4452 §2.6 — a form's own page at /apply/<slug>. Static with the site-pages
// tag. The current slug renders; an old slug 308-redirects to the current
// one; an unknown slug or an archived form is the 404 page. noindex unless the
// form's own_page.index is on.
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { siteContent } from '@/lib/site-pages/content'
import type { PublicForm } from '@/lib/site-pages/model'
import { SitePage } from '@/components/site/site-page'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'
import { ApplyClient } from './apply-client'
import '@/components/forms/forms.css'

const BG: Record<string, string> = { night: '#15171c', moss: '#2f3a2e', clay: '#8c5a3c', paper: '#f5f4f0' }
const TERMS: Record<string, { href: string; label: string }> = {
  creator: { href: '/creator-agreement', label: 'Creator terms' },
  local: { href: '/local-agreement', label: 'Local agreement' },
  host: { href: '/organiser-terms', label: 'Organiser terms' },
}

async function resolve(slug: string): Promise<{ redirect: string } | { form: PublicForm } | null> {
  const content = await siteContent()
  const hit = content.form_pages[slug]
  if (!hit) return null
  if (hit.current_slug && hit.current_slug !== slug) return { redirect: hit.current_slug }
  const form = content.forms[hit.form_id]
  return form ? { form } : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await resolve((await params).slug)
  if (!r || !('form' in r)) return { robots: { index: false, follow: false } }
  const own = (r.form.own_page ?? {}) as { h?: string; em?: string; lead?: string; index?: boolean }
  return {
    title: `${[own.h, own.em].filter(Boolean).join(' ') || r.form.name} | Mingla`,
    description: own.lead,
    robots: own.index ? undefined : { index: false, follow: false },
  }
}

export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug
  const r = await resolve(slug)
  if (!r) notFound()
  if ('redirect' in r) permanentRedirect(`/apply/${r.redirect}`)
  const form = r.form
  const own = (form.own_page ?? {}) as { h?: string; em?: string; lead?: string; bg?: string }
  const bg = BG[own.bg ?? 'night'] ?? BG.night
  const dark = (own.bg ?? 'night') !== 'paper'
  const terms = TERMS[form.audience]
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface={form.audience === 'host' ? 'host' : 'explorer'}>
        <section className="ap-sec" style={{ background: bg, color: dark ? '#fff' : '#111110' }}>
          <div className="wrap ap-grid">
            <div className="ap-copy">
              <h1 className="ap-title">
                {own.h ?? form.name} {own.em ? <em>{own.em}</em> : null}
              </h1>
              {own.lead ? <p className="ap-lead">{own.lead}</p> : null}
            </div>
            <div className="ap-card">
              <ApplyClient form={form} slug={slug} />
              <p className="fk-legal">
                By sending this you agree to the <a href={terms.href}>{terms.label}</a> and <a href="/privacy-policy">Privacy policy</a>.
              </p>
            </div>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
