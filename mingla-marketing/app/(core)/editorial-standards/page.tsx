import type { Metadata } from 'next'
import { AnswerBlock, CutoutSection } from '@/components/cutout'
import { CoreHero } from '@/components/core-pages/core-hero'
import { CorePageShell } from '@/components/core-pages/core-page-shell'
import { EditorialPolicy, type PolicySection } from '@/components/core-pages/editorial-policy'
import { CORE_PAGES } from '@/content/core-pages'
import { corePageMetadata } from '@/lib/search/metadata'
import { corePageStructuredData, serializeCorePageStructuredData } from '@/lib/search/core-page-schema'

const record = CORE_PAGES['editorial-standards']
export const metadata: Metadata = corePageMetadata(record)

const sections: readonly PolicySection[] = [
  { id:'people-first', title:'People first, search second', paragraphs:['Mingla creates pages to help someone make a better real-world decision or help a Host explain and run a better experience. We do not publish an arbitrary quota of pages, listings or articles to occupy search results.','Search titles, headings, summaries and structured data can make an answer easier to find. They cannot change its factual meaning. People and crawlers receive the same material answer.'] },
  { id:'source-hierarchy', title:'Our source hierarchy', paragraphs:['We prefer the source closest to the fact being checked. Where sources disagree, Mingla shows the uncertainty, uses the most authoritative current source available or withholds the claim.'], bullets:['The organiser, venue, operator or other primary owner','An authorised ticket, reservation, RSVP or booking source','An official civic, tourism or public calendar within its real scope','A reliable local editorial or community source for discovery and corroboration','An aggregator only as a lead to the primary fact'] },
  { id:'city-boundaries', title:'City boundaries and local language', paragraphs:['Mingla’s ten launch cities are independent identities. Nearby, county-wide, metropolitan, regional or national evidence does not automatically belong to the named city.','Original names and diacritics are retained. Automatic translation is not presented as local human work.'] },
  { id:'best', title:'What “best” means', paragraphs:['“Best” is a comparative claim, not a decorative adjective. A ranked claim explains its audience, boundary, criteria, eligible set, exclusions, source coverage, review date, sponsor separation and limitations. A Host does not become best because it pays or publishes on Mingla.'] },
  { id:'relationships', title:'Hosts, contributors, sponsors and affiliates', paragraphs:['A Host may be the primary source for its own offering; that relationship does not become independent praise. Sponsored or affiliate material is labelled before the relevant recommendation or action, and payment never silently changes an editorial rank.'] },
  { id:'ai', title:'How Mingla uses AI', paragraphs:['AI may help organise research, expand questions, draft structure, summarise permitted sources and run quality checks. A human remains responsible for the public result.'], bullets:['No invented place, event, customer, source, quote, award, review, rating or outcome','No inferred price, availability, accessibility, safety, capacity or legal status','No fabricated citations, product screens, people or translations'] },
  { id:'imagery', title:'Generated and stock imagery', paragraphs:['Every published image needs an explainable origin, rights state and editorial job. Generated imagery may support a marketing idea but never proves a real city, venue, event, customer, crowd, result or Mingla product screen. Named-place photography must be location-proven and licensed or authorised.'] },
  { id:'product-truth', title:'Product truth', paragraphs:['Product claims and captures are checked against the current Mingla runtime or another authoritative product record. A capture records the surface, version, environment, date, tested action, observed result, privacy state and rights owner. Mingla does not promise reach, sell-outs, attendance or revenue merely because a workflow can be demonstrated.'] },
  { id:'events', title:'Events, prices and actions', paragraphs:['A visible event record identifies its owner, source, date, timezone, status, available action, reviewed date and expiry. Cancelled, postponed and ended events are not current. Unknown price is written as Price not verified. A ticket, reservation or RSVP action is named only when actually available.'] },
  { id:'freshness', title:'Freshness, expiry and page state', paragraphs:['Each factual record has a reviewed date and, where needed, a next review or expiry date. Drafts do not publish; review pages stay out of search; ready pages enter public discovery; stale pages leave current discovery; replaced pages redirect; removed pages return a real 404 or 410. Deploy time is not an editorial date.'] },
  { id:'reviewers', title:'Authors and reviewers', paragraphs:['A byline or reviewer identifies a real person or organisation, relevant role and relationship. Mingla does not create fictional experts or empty author pages. Where individual attribution is not appropriate, Mingla states its editorial responsibility without inventing a person.'] },
  { id:'corrections', title:'Corrections', paragraphs:['Email support@usemingla.com with the page URL, exact statement or image, best primary source, date checked and whether the issue is urgent. Supported material corrections update the visible record and any metadata or structured data that depended on the old claim.'] },
  { id:'privacy', title:'Privacy and sensitive information', paragraphs:['Public content and measurement do not expose private CRM notes, credentials, precise user location, attendee identity, private chat, RSVP, ticket or QR information, personal free text, private payment data or an unapproved person’s image or quote. Analytics remain consent-gated and low-cardinality.'] },
  { id:'quality', title:'How we measure quality', paragraphs:['Success is not more URLs indexed. Mingla asks whether the right city and question reach the right page, whether Explorers and Hosts reach useful actions, whether sources and corrections stay healthy, and whether answer engines describe Mingla accurately. Search rank or traffic never excuses an inaccurate page.'] },
]

function SourcePath() { return <ol className="core-flow"><li>Primary owner of the fact</li><li>Authorised action source</li><li>Official source within its scope</li><li>Reliable local editorial discovery</li><li>Aggregator used only as a lead</li></ol> }

export default function EditorialStandardsPage() {
  const schema=corePageStructuredData(record)
  return <CorePageShell>
    {schema?<script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeCorePageStructuredData(schema)}}/>:null}
    <CoreHero eyebrow={record.eyebrow} title={record.h1} answer={record.directAnswer} visual={<SourcePath/>}/>
    <AnswerBlock question={record.directQuestion} answer={record.directAnswer} crumbs={[{name:'Home',path:'/'},{name:'Editorial Standards',path:'/editorial-standards'}]} />
    <CutoutSection id="policy"><EditorialPolicy sections={sections}/></CutoutSection>
    <CutoutSection band="dark" id="report-correction"><div className="core-final"><h2>See something that needs correcting?</h2><a className="cut-btn cut-btn-brand h-[3.25rem] px-7 font-display focus-ring" href="mailto:support@usemingla.com?subject=Mingla%20page%20correction">Report a correction</a></div></CutoutSection>
  </CorePageShell>
}
