import type { CSSProperties } from 'react'
import { EXPLORER_EVENT_GUIDE as content } from '@/content/page-system/explorer-event-guide'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import {
  DemoDisclosure,
  DirectAnswer,
  FinalConversion,
  PersistentFaq,
  SectionIntro,
  SemanticFlow,
  Sources,
} from '@/components/page-system/content-blocks'
import { EditorialHero } from '@/components/page-system/editorial-hero'
import { MotionAwareMontage } from '@/components/page-system/motion-aware-montage'
import { PageSystemShell } from '@/components/page-system/page-system-shell'
import { PlanFitCheck } from '@/components/page-system/plan-fit-check'

const CURRENT_PATH = '/internal/page-system/explorer-event-guide' as const

export const metadata = publicNoindexMetadata('/internal/page-system/explorer-event-guide', {
  title: 'Explorer event guide review — Mingla',
  description: content.description,
})

function ExplorerGuideVisual() {
  return (
    <figure className="ps-guide-figure">
      <MotionAwareMontage label="Eight event decision checks arranged around one plan">
        <div className="ps-check-wheel" aria-hidden="true">
          {content.checks.map((check, index) => <span key={check.id} style={{ '--check-index': index } as CSSProperties}>{index + 1}</span>)}
          <div><small>weekend</small><strong>PLAN</strong><small>fit check</small></div>
        </div>
      </MotionAwareMontage>
      <figcaption>Eight facts around one decision. No popularity or recommendation score.</figcaption>
    </figure>
  )
}

export default function ExplorerEventGuideReviewPage() {
  return (
    <PageSystemShell currentPath={CURRENT_PATH} futurePath={content.futurePath} audience="explorer">
      <EditorialHero
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.description}
        primary={{ label: 'Run the Plan Fit Check', href: '#plan-fit-check' }}
        secondary={{ label: 'Read the 60-second answer', href: '#answer' }}
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Guides' }, { label: 'Choosing an event' }]}
        visual={<ExplorerGuideVisual />}
      />

      <DirectAnswer
        heading="How do you choose an event this weekend?"
        paragraphs={content.answer}
      />

      <PlanFitCheck />

      <DemoDisclosure
        title="Illustrative product demo — three fictional choices"
        description="These examples demonstrate the Plan Fit Check. They are not live listings, local recommendations or evidence."
      >
        <div className="ps-table-scroll ps-demo-table">
          <table>
            <caption>Three fictional event choices</caption>
            <thead><tr><th scope="col">Fictional option</th><th scope="col">Known shape</th><th scope="col">Uncertainty</th><th scope="col">Practical verdict</th></tr></thead>
            <tbody>
              {content.demoChoices.map(([option, shape, uncertainty, verdict]) => (
                <tr key={option}>
                  <th scope="row" data-label="Fictional option">{option}</th>
                  <td data-label="Known shape">{shape}</td>
                  <td data-label="Uncertainty">{uncertainty}</td>
                  <td data-label="Practical verdict">{verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ps-product-fiction">
          <SectionIntro
            eyebrow="How Mingla supports the decision"
            title="Discover → inspect → save and share → make the plan."
            lede="This product-shaped explanation is illustrative. Real product captures remain omitted until their reviewed runtime evidence exists."
          />
          <SemanticFlow
            title="Explorer planning path"
            steps={content.minglaSteps}
            conclusion="Mingla does not turn an unknown into a product claim. The wording narrows if a reviewed runtime cannot prove a step."
          />
        </div>
      </DemoDisclosure>

      <section className="ps-section" aria-labelledby="event-method-heading">
        <SectionIntro
          eyebrow="The complete method"
          title="Fit first. Practical truth next. Safe commitment last."
        />
        <h3 id="event-method-heading" className="sr-only">Event choice method</h3>
        <div className="ps-editorial-grid">
          {content.editorialGroups.map((group) => (
            <article key={group.id} className="ps-editorial-card">
              <p className="ps-card-kicker">{group.eyebrow}</p>
              <h3>{group.title}</h3>
              {group.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </article>
          ))}
        </div>
      </section>

      <section className="ps-section ps-dark-band" aria-labelledby="ticket-safety-heading">
        <SectionIntro
          eyebrow="Invitation and ticket safety"
          title="Do not let urgency replace verification."
        />
        <h3 id="ticket-safety-heading" className="sr-only">Invitation and ticket checks</h3>
        <ul className="ps-large-checklist">
          {content.safetyChecks.map((check) => <li key={check}>{check}</li>)}
        </ul>
      </section>

      <section className="ps-section" aria-labelledby="before-commit-heading">
        <SectionIntro eyebrow="Before you commit" title="Keep the final eight checks together." />
        <h3 id="before-commit-heading" className="sr-only">Before you commit checklist</h3>
        <ul className="ps-print-checklist">
          {content.finalChecklist.map((item) => <li key={item}><span aria-hidden="true" />{item}</li>)}
        </ul>
      </section>

      <section className="ps-section" aria-labelledby="explorer-faq-heading">
        <SectionIntro eyebrow="Useful answers" title="Common questions before choosing." />
        <h3 id="explorer-faq-heading" className="sr-only">Explorer event guide questions</h3>
        <PersistentFaq items={content.faqs} />
      </section>

      <section className="ps-section ps-review-and-sources">
        <Sources items={content.sources} />
      </section>

      <FinalConversion
        title="Turn the choice into a plan."
        body="Use Mingla to discover an idea, keep the facts together and make the plan easier to share."
        actions={[{ label: 'Start a plan with Mingla', href: '/' }]}
      />
    </PageSystemShell>
  )
}
