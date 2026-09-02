import Link from 'next/link'
import { type ReactNode } from 'react'

interface Breadcrumb {
  readonly label: string
  readonly href?: string
}

interface EditorialHeroProps {
  readonly eyebrow: string
  readonly title: string
  readonly lede: string
  readonly primary: { readonly label: string; readonly href: string }
  readonly secondary?: { readonly label: string; readonly href: string }
  readonly breadcrumbs: readonly Breadcrumb[]
  readonly visual: ReactNode
  readonly hostMark?: boolean
}

export function EditorialHero({
  eyebrow,
  title,
  lede,
  primary,
  secondary,
  breadcrumbs,
  visual,
  hostMark = false,
}: EditorialHeroProps) {
  return (
    <section className="ps-hero" aria-labelledby="page-title">
      <div className="ps-hero-copy">
        <nav aria-label="Breadcrumb">
          <ol className="ps-breadcrumbs">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
        {hostMark ? (
          <div className="ps-hero-brand-row">
            <div className="ps-host-identity" aria-label="Mingla Host">
              <img src="/brand/mingla-business-logo.svg" alt="Mingla Host" width="82" height="82" />
            </div>
            <p className="ps-eyebrow">{eyebrow}</p>
          </div>
        ) : <p className="ps-eyebrow">{eyebrow}</p>}
        <h1 id="page-title">{title}</h1>
        <p className="ps-hero-lede">{lede}</p>
        <div className="ps-hero-actions" data-hero-actions>
          <a className="ps-button ps-button-primary" href={primary.href} data-hero-action="primary">
            {primary.label}
          </a>
          {secondary ? (
            <a className="ps-button ps-button-secondary" href={secondary.href} data-hero-action="secondary">
              {secondary.label}
            </a>
          ) : null}
        </div>
      </div>
      <div className="ps-hero-visual">{visual}</div>
    </section>
  )
}
