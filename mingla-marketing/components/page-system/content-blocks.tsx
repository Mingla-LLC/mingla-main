import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { LAUNCH_CITIES, REVIEW_STATUS, type FaqEntry, type SourceEntry } from '@/content/page-system/shared'

export function SectionIntro({
  eyebrow,
  title,
  lede,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly lede?: string
}) {
  return (
    <header className="ps-section-intro">
      <p className="ps-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {lede ? <p>{lede}</p> : null}
    </header>
  )
}

export function DirectAnswer({
  heading,
  paragraphs,
  note,
}: {
  readonly heading: string
  readonly paragraphs: readonly string[]
  readonly note?: string
}) {
  return (
    <section id="answer" className="ps-section ps-answer" aria-labelledby="answer-heading">
      <div className="ps-answer-grid">
        <div>
          <p className="ps-eyebrow">The 60-second answer</p>
          <h2 id="answer-heading">{heading}</h2>
          <div className="ps-answer-copy">
            {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          {note ? <p className="ps-qualifier">{note}</p> : null}
        </div>
        <EvidenceReviewNotice />
      </div>
    </section>
  )
}

export function EvidenceReviewNotice({ detail = REVIEW_STATUS.detail }: { readonly detail?: string }) {
  return (
    <aside className="ps-evidence-notice" aria-label="Evidence status">
      <span className="ps-status-dot" aria-hidden="true" />
      <div>
        <strong>{REVIEW_STATUS.label}</strong>
        <p>{detail}</p>
      </div>
    </aside>
  )
}

export function PersistentFaq({ items }: { readonly items: readonly FaqEntry[] }) {
  return (
    <div className="ps-faq-list">
      {items.map((item) => (
        <Fragment key={item.question}>
          <details className="ps-faq">
            <summary>
              <span>{item.question}</span>
              <span aria-hidden="true" className="ps-faq-mark">+</span>
            </summary>
            <div className="ps-faq-answer"><p>{item.answer}</p></div>
          </details>
          <article className="ps-faq-print-answer" data-print-faq-answer>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        </Fragment>
      ))}
    </div>
  )
}

export function AudienceFork({
  items,
  heading = 'Choose your Mingla path.',
}: {
  readonly items: readonly {
    readonly audience: string
    readonly title: string
    readonly description: string
    readonly href: string
    readonly action: string
  }[]
  readonly heading?: string
}) {
  return (
    <section id="choose-lagos-path" className="ps-section" aria-labelledby="audience-fork-heading">
      <SectionIntro eyebrow="Two sides, one useful plan" title={heading} />
      <div className="ps-audience-fork">
        {items.map((item) => (
          <article key={item.audience} className="ps-cut-card ps-audience-card">
            <p className="ps-card-kicker">{item.audience}</p>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <Link href={item.href} className="ps-button ps-button-secondary">{item.action}</Link>
          </article>
        ))}
      </div>
    </section>
  )
}

export function SemanticFlow({
  title,
  steps,
  conclusion,
}: {
  readonly title: string
  readonly steps: readonly string[]
  readonly conclusion: string
}) {
  return (
    <article className="ps-flow-card">
      <h3>{title}</h3>
      <ol className="ps-flow" aria-label={`${title} steps`}>
        {steps.map((step, index) => (
          <li key={step}>
            <span aria-hidden="true">{index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>
      <p>{conclusion}</p>
    </article>
  )
}

export function DemoDisclosure({
  title = 'Illustrative product demo',
  description,
  children,
}: {
  readonly title?: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <section className="ps-section ps-demo-section" aria-labelledby="demo-heading">
      <div className="ps-demo-disclosure">
        <p className="ps-eyebrow">{title}</p>
        <h2 id="demo-heading">See the method without mistaking fiction for fact.</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  )
}

export function CityNavigator() {
  return (
    <section className="ps-section ps-city-navigator" aria-labelledby="city-navigator-heading">
      <SectionIntro
        eyebrow="Launch cities"
        title="Ten cities, shown one by one."
        lede="These labels are not links in this private fixture. Each city will need its own approved evidence before publication."
      />
      <h3 id="city-navigator-heading" className="sr-only">Mingla launch cities</h3>
      <ul>
        {LAUNCH_CITIES.map((city) => <li key={city}>{city}</li>)}
      </ul>
    </section>
  )
}

export function Sources({ items }: { readonly items: readonly SourceEntry[] }) {
  return (
    <aside className="ps-sources" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources used in this guide</h2>
      <ul>
        {items.map((source) => (
          <li key={source.href}>
            <a href={source.href} target="_blank" rel="noreferrer">
              {source.label}
            </a>{' '}
            <span>— {source.publisher}</span>
          </li>
        ))}
      </ul>
      <p>Reviewed for this private page-system fixture on 2 September 2026. Publication review remains pending.</p>
    </aside>
  )
}

export function BeforeAfter({
  rows,
}: {
  readonly rows: readonly (readonly [string, string, string, string])[]
}) {
  return (
    <div className="ps-before-after">
      {rows.map(([state, title, detail, action]) => (
        <article key={state} className="ps-cut-card">
          <p className="ps-card-kicker">{state}</p>
          <h3>{title}</h3>
          <p>{detail}</p>
          <strong>{action}</strong>
        </article>
      ))}
    </div>
  )
}

export function FinalConversion({
  title,
  body,
  actions,
}: {
  readonly title: string
  readonly body: string
  readonly actions: readonly { readonly label: string; readonly href: string }[]
}) {
  return (
    <section className="ps-section ps-conversion" aria-labelledby="conversion-heading" data-print-hide>
      <h2 id="conversion-heading">{title}</h2>
      <p>{body}</p>
      <div>
        {actions.map((action) => (
          <Link key={action.href} href={action.href} className="ps-button ps-button-primary">{action.label}</Link>
        ))}
      </div>
    </section>
  )
}
