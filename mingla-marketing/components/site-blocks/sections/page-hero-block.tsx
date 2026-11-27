// #4636 block `pageHero` — the inner pages' headline and lead (the design's
// `head()`), with Support's note and buttons. Moved as-is (R1):
//   plain    PageHero (Going out, Cities, Help, Support, Careers, Free tools);
//   centred  About's centred hero (`page-hero about-hero`).
import { PageHero } from '@/components/site/site-page'
import { ActionButton, Em, type BlockAction, type BlockProps } from './shared'

export interface PageHeroContent {
  variant: 'plain' | 'centred'
  title: string
  lead?: string
  note?: string
  actions?: readonly { action: BlockAction }[]
}

export function PageHeroBlock({ content }: BlockProps<PageHeroContent>) {
  if (content.variant === 'centred') {
    return (
      <section className="page-hero about-hero">
        <div className="wrap">
          <h1>
            <Em text={content.title} />
          </h1>
          {content.lead ? <p className="lead">{content.lead}</p> : null}
        </div>
      </section>
    )
  }
  const actions = content.actions ?? []
  return (
    <PageHero title={<Em text={content.title} />} lead={content.lead}>
      {content.note ? <p className="support-note">{content.note}</p> : null}
      {actions.length ? (
        <div className="row">
          {actions.map(({ action }, i) => (
            <ActionButton
              key={`${action.to}-${i}`}
              action={action}
              className={i === 0 ? 'btn ink' : 'btn soft'}
              location="hero"
              icon={action.to.startsWith('mailto:') ? 'mail' : undefined}
            />
          ))}
        </div>
      ) : null}
    </PageHero>
  )
}
