import { HOST_EVENT_PROMOTER_GUIDE as content } from '@/content/page-system/host-event-promoter-guide'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import {
  BeforeAfter,
  DemoDisclosure,
  DirectAnswer,
  FinalConversion,
  PersistentFaq,
  SectionIntro,
  SemanticFlow,
  Sources,
} from '@/components/page-system/content-blocks'
import { EditorialHero } from '@/components/page-system/editorial-hero'
import { LaunchToDoorTimeline } from '@/components/page-system/launch-to-door-timeline'
import { PageSystemShell } from '@/components/page-system/page-system-shell'

const CURRENT_PATH = '/internal/page-system/host-event-promoter-guide' as const

export const metadata = publicNoindexMetadata('/internal/page-system/host-event-promoter-guide', {
  title: 'Mingla Host event-promotion guide review',
  description: content.description,
})

function HostGuideVisual() {
  return (
    <figure className="ps-host-hero-figure">
      <div className="ps-host-image-frame">
        <img
          src="/marketing/host-icp/events-hall.jpg"
          alt="A fictional event-hall scene used to illustrate an organiser preparing an experience"
          width="1600"
          height="1211"
        />
        <div className="ps-host-image-overlay" aria-hidden="true">
          <span>page ready</span><span>action checked</span><span>door rehearsed</span>
        </div>
      </div>
      <figcaption>Illustrative concept image — not a real event, customer or performance claim.</figcaption>
    </figure>
  )
}

function ChecklistCards({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  return (
    <article className="ps-editorial-card">
      <h3>{title}</h3>
      <ul className="ps-compact-list">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </article>
  )
}

export default function HostEventPromoterGuideReviewPage() {
  return (
    <PageSystemShell currentPath={CURRENT_PATH} futurePath={content.futurePath} audience="host">
      <EditorialHero
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.description}
        primary={{ label: 'Build the launch checklist', href: '#launch-checklist' }}
        secondary={{ label: 'Read the 60-second answer', href: '#answer' }}
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Guides' }, { label: 'Event promotion' }]}
        visual={<HostGuideVisual />}
        hostMark
      />

      <DirectAnswer
        heading="What does a useful event-promotion plan do?"
        paragraphs={content.answer}
      />

      <section className="ps-section ps-answer-steps" aria-labelledby="thirty-days-out-heading">
        <SectionIntro
          eyebrow="Thirty days out"
          title="Keep one event truth connected to the door."
          lede="Shorter launches compress this order. They do not justify skipping event truth or door readiness."
        />
        <h3 id="thirty-days-out-heading" className="sr-only">Seven launch principles</h3>
        <ol>{content.answerSteps.map((step) => <li key={step}>{step}</li>)}</ol>
      </section>

      <section className="ps-section" aria-labelledby="event-foundation-heading">
        <SectionIntro
          eyebrow="Before promotion"
          title="Define the outcome, page and fact source."
          lede="A poster can create attention. It should not carry the entire buyer journey."
        />
        <h3 id="event-foundation-heading" className="sr-only">Event promotion foundation</h3>
        <div className="ps-editorial-grid">
          <ChecklistCards title="Define the operational outcome" items={content.outcomeGuidance} />
          <ChecklistCards title="Build one decision-ready page" items={content.pageTruth} />
          <ChecklistCards title="Create one campaign fact source" items={content.factSource} />
        </div>
      </section>

      <section className="ps-section ps-dark-band" aria-labelledby="channel-matrix-heading">
        <SectionIntro
          eyebrow="Channels by purpose"
          title="Choose the smallest channel set the team can keep accurate."
          lede="Every channel should return to the same current event truth and one supported action."
        />
        <h3 id="channel-matrix-heading" className="sr-only">Event-promotion channel-purpose matrix</h3>
        <div className="ps-table-scroll">
          <table>
            <caption>Channel purpose and truth requirements</caption>
            <thead><tr><th scope="col">Channel</th><th scope="col">Useful job</th><th scope="col">Weak use</th><th scope="col">Required truth</th></tr></thead>
            <tbody>
              {content.channels.map(([channel, job, weakUse, truth]) => (
                <tr key={channel}><th scope="row">{channel}</th><td>{job}</td><td>{weakUse}</td><td>{truth}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ps-utm-card">
          <div>
            <h3>Keep campaign names readable and privacy-safe.</h3>
            <p>Use consistent lower-case source and medium values. Never put names, emails, phone numbers, ticket IDs, private audience details or other personal data in campaign parameters.</p>
          </div>
          <dl>
            {content.utmGuidance.map(([key, meaning]) => <div key={key}><dt>{key}</dt><dd>{meaning}</dd></div>)}
          </dl>
          <code>{content.utmExample}</code>
        </div>
      </section>

      <LaunchToDoorTimeline />

      <section className="ps-section" aria-labelledby="information-quality-heading">
        <SectionIntro
          eyebrow="Before and after"
          title="Improve information quality before increasing volume."
          lede="A clearer path makes the event easier to understand. It does not promise attendance or sales."
        />
        <h3 id="information-quality-heading" className="sr-only">Event information before and after</h3>
        <BeforeAfter rows={content.beforeAfter} />
      </section>

      <section className="ps-section ps-flow-feature" aria-labelledby="host-flow-heading">
        <SectionIntro
          eyebrow="Connected operating path"
          title="One event truth from page to learning."
        />
        <h3 id="host-flow-heading" className="sr-only">Mingla Host event operating path</h3>
        <SemanticFlow
          title="Event operating path"
          steps={content.minglaFlow}
          conclusion="The guide keeps channel, action and door work connected without claiming that promotion produced a result."
        />
      </section>

      <DemoDisclosure
        description="This fictional workflow demonstrates information structure. It is not a customer, campaign send, attendance record or performance result."
      >
        <div className="ps-demo-grid">
          {([
            ['Fictional event page', content.demo.eventPage],
            ['Campaign checklist', content.demo.campaign],
            ['Guest and door flow', content.demo.guestFlow],
          ] as const).map(([title, items]) => (
            <article key={title} className="ps-demo-card">
              <p className="ps-card-kicker">Illustrative workflow</p>
              <h3>{title}</h3>
              <ul className="ps-compact-list">{items.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
        <p className="ps-product-boundary">
          Verified Mingla Host claims on this fixture are limited to event creation or editing, a buyer-facing page, supported ticket or RSVP action, and supported guest-list or QR entry. It does not claim an autonomous AI action, a campaign send, reach, attendance, sales or reporting result.
        </p>
      </DemoDisclosure>

      <section className="ps-section" aria-labelledby="door-rehearsal-heading">
        <SectionIntro
          eyebrow="Door rehearsal"
          title="Write the real answer for each exception before doors."
          lede="This guide does not invent the policy. The organiser records the policy that actually applies."
        />
        <h3 id="door-rehearsal-heading" className="sr-only">Door rehearsal exception table</h3>
        <div className="ps-table-scroll">
          <table>
            <caption>Door states that need an authorised team answer</caption>
            <thead><tr><th scope="col">State</th><th scope="col">Team answer must exist before doors</th></tr></thead>
            <tbody>{content.doorRehearsal.map(([state, answer]) => <tr key={state}><th scope="row">{state}</th><td>{answer}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="ps-section ps-measurement" aria-labelledby="measurement-heading">
        <SectionIntro
          eyebrow="Measurement and limits"
          title="Separate real actions, operations and quality failures."
          lede="Never report illustrative activity as a real outcome."
        />
        <h3 id="measurement-heading" className="sr-only">Event-promotion measurement</h3>
        <div className="ps-editorial-grid">
          <ChecklistCards title="Explorer or buyer outcomes" items={content.measurement.explorer} />
          <ChecklistCards title="Host outcomes" items={content.measurement.host} />
          <ChecklistCards title="Quality failures" items={content.measurement.failures} />
        </div>
      </section>

      <section className="ps-section" aria-labelledby="master-checklist-heading">
        <SectionIntro eyebrow="Printable master checklist" title="Truth, campaign, buyer, door and learning." />
        <h3 id="master-checklist-heading" className="sr-only">Event-promotion master checklist</h3>
        <div className="ps-master-checklist">
          {content.masterChecklist.map(([title, detail]) => (
            <article key={title}><span aria-hidden="true" /><div><h3>{title}</h3><p>{detail}</p></div></article>
          ))}
        </div>
      </section>

      <section className="ps-section" aria-labelledby="host-faq-heading">
        <SectionIntro eyebrow="Clear limits" title="Common event-promotion questions." />
        <h3 id="host-faq-heading" className="sr-only">Mingla Host event-promotion questions</h3>
        <PersistentFaq items={content.faqs} />
      </section>

      <section className="ps-section ps-review-and-sources">
        <Sources items={content.sources} />
      </section>

      <FinalConversion
        title="Give the event one path people can follow."
        body="Use Mingla Host to create a clearer event page and connect the supported action and guest workflow."
        actions={[{ label: 'Explore Mingla Host', href: '/host' }]}
      />
    </PageSystemShell>
  )
}
