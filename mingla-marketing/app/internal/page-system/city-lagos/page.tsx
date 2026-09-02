import { LAGOS_CITY_CONTENT as content } from '@/content/page-system/city-lagos'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import {
  AudienceFork,
  CityNavigator,
  DemoDisclosure,
  DirectAnswer,
  FinalConversion,
  PersistentFaq,
  SectionIntro,
  SemanticFlow,
} from '@/components/page-system/content-blocks'
import { EditorialHero } from '@/components/page-system/editorial-hero'
import { MotionAwareMontage } from '@/components/page-system/motion-aware-montage'
import { PageSystemShell } from '@/components/page-system/page-system-shell'

const CURRENT_PATH = '/internal/page-system/city-lagos' as const

export const metadata = publicNoindexMetadata('/internal/page-system/city-lagos', {
  title: 'Lagos city page-system review — Mingla',
  description: 'Private noindex review of the balanced Mingla Explorer and Mingla Host city-page system for Lagos.',
})

function LagosAbstractVisual() {
  return (
    <figure className="ps-abstract-figure">
      <MotionAwareMontage label="Abstract planning cards moving around a shared Mingla plan">
        <div className="ps-orbit ps-orbit-a"><span>mood</span><strong>social</strong></div>
        <div className="ps-orbit ps-orbit-b"><span>time</span><strong>evening</strong></div>
        <div className="ps-orbit ps-orbit-c"><span>action</span><strong>confirm</strong></div>
        <div className="ps-plan-core">
          <span>the plan</span>
          <strong>Lagos</strong>
          <small>people · place · action</small>
        </div>
      </MotionAwareMontage>
      <figcaption>Illustrative concept — an abstract planning composition, not Lagos location evidence.</figcaption>
    </figure>
  )
}

export default function LagosCityReviewPage() {
  return (
    <PageSystemShell currentPath={CURRENT_PATH} futurePath={content.futurePath} audience="city">
      <EditorialHero
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.lede}
        primary={{ label: 'Choose your side', href: '#choose-lagos-path' }}
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Lagos' }]}
        visual={<LagosAbstractVisual />}
      />

      <DirectAnswer
        heading={content.answerHeading}
        paragraphs={[content.answer]}
        note={content.availability}
      />

      <AudienceFork items={content.audiencePaths} />

      <DemoDisclosure
        description="Fictional choices demonstrate the planning method. They are not live Lagos listings or recommendations."
      >
        <div className="ps-demo-grid">
          {content.demoChoices.map((choice) => (
            <article key={choice.name} className="ps-demo-card">
              <h3>{choice.name}</h3>
              <dl>
                <div><dt>Occasion</dt><dd>{choice.occasion}</dd></div>
                <div><dt>Mood</dt><dd>{choice.mood}</dd></div>
                <div><dt>Time</dt><dd>{choice.time}</dd></div>
                <div><dt>Known cost</dt><dd>{choice.cost}</dd></div>
                <div><dt>Travel</dt><dd>{choice.travel}</dd></div>
                <div><dt>Entry</dt><dd>{choice.entry}</dd></div>
                <div><dt>Comfort</dt><dd>{choice.comfort}</dd></div>
                <div><dt>Evidence needed</dt><dd>{choice.evidence}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </DemoDisclosure>

      <section className="ps-section ps-dark-band" aria-labelledby="paired-flow-heading">
        <SectionIntro
          eyebrow="One city, two complete paths"
          title="Discovery and hosting meet at a supported action."
          lede="The visual flow and the ordered text carry the same meaning."
        />
        <h3 id="paired-flow-heading" className="sr-only">Paired Mingla flows</h3>
        <div className="ps-flow-grid">
          {content.flows.map((flow) => <SemanticFlow key={flow.title} {...flow} />)}
        </div>
      </section>

      <section className="ps-section" aria-labelledby="lagos-evidence-heading">
        <SectionIntro eyebrow="Publication boundary" title="Local truth comes before local claims." />
        <div className="ps-evidence-feature">
          <span aria-hidden="true">!</span>
          <div>
            <h3 id="lagos-evidence-heading">Evidence review pending</h3>
            <p>{content.evidence}</p>
          </div>
        </div>
      </section>

      <CityNavigator />

      <section className="ps-section" aria-labelledby="lagos-faq-heading">
        <SectionIntro eyebrow="Clear limits" title="Questions this review page should answer." />
        <h3 id="lagos-faq-heading" className="sr-only">Lagos page questions</h3>
        <PersistentFaq items={content.faqs} />
      </section>

      <FinalConversion
        title="Choose the side of the plan you are on."
        body="Explore ideas and shape a plan, or use Mingla Host to publish what people can join."
        actions={[
          { label: 'Explore Mingla', href: '/' },
          { label: 'Explore Mingla Host', href: '/host' },
        ]}
      />
    </PageSystemShell>
  )
}
