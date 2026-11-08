// #4339 round B (B) — implementor regression test for the tracking needed
// before paid ads:
//   6. GA4 page_location keeps only utm_* and the Google click ids (ids only
//      while ads are on); page_referrer is the referrer's origin;
//   7. page_family `host_landing`, `icp` on page_view and both hand-off
//      events, and the three new SEARCH_ICPS;
//   8. the seven /host/<icp> pages and the ten city pages are ad
//      destinations in MARKETING_ROUTES, its edge twin, adChannel and the
//      registry migration (one id per slug everywhere);
//   9. the landing campaign rides into the OneLink (af_sub1–3) and the host
//      web URL (utm_*) through lib/app-handoff.ts, only while ads are on;
//  10. the funnel events exist where they fire, every captureMarketing event
//      is in the PostHog allowlist, tool_book_confirmed mirrors to GA4
//      generate_lead {icp} and tool_report_ready to tool_interaction.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-round-b-tracking.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { MARKETING, makeLoader } from './issue-4339-round-b-load.mjs'

const REPO = path.resolve(MARKETING, '..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const readRepo = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const loader = makeLoader()
after(() => loader.cleanup())

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(path.join(MARKETING, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...walk(rel))
    } else if (/\.(tsx?)$/.test(entry.name)) out.push(rel)
  }
  return out
}

test('6. GA4 attribution: allowlisted campaign query and the referrer origin', async () => {
  const sm = await loader.load(path.join(REPO, 'packages/search-measurement/src/index.ts'))
  const landing = 'https://usemingla.com/host/events?utm_source=google&utm_campaign=ng&email=a%40b.c&gclid=Cj0&name=Ada#x'
  assert.equal(sm.attributedPageLocation(landing), 'https://usemingla.com/host/events?utm_source=google&utm_campaign=ng')
  assert.equal(sm.attributedPageLocation(landing, { clickIds: true }), 'https://usemingla.com/host/events?utm_source=google&utm_campaign=ng&gclid=Cj0')
  assert.equal(sm.attributedPageLocation('https://usemingla.com/?gbraid=1&wbraid=2', { clickIds: true }), 'https://usemingla.com/?gbraid=1&wbraid=2')
  assert.ok(sm.sanitizeSearchMeasurement('page_view', { audience: 'host', page_family: 'host_landing', icp: 'event_promoter', page_location: 'https://usemingla.com/host/events?utm_source=google', source_kind: 'direct' }))
  assert.equal(sm.sanitizeSearchMeasurement('page_view', { audience: 'host', page_family: 'host_landing', page_location: 'https://usemingla.com/host/events?email=x', source_kind: 'direct' }), null)

  const provider = code(read('components/marketing/posthog-provider.tsx'))
  assert.match(provider, /return attributedPageLocation\(withQuery, \{ clickIds: isMarketingAdsOn\(\) \}\) \?\? canonical/)
  assert.match(provider, /const origin = cleanReferrerOrigin\(document\.referrer\)/)
  // The GA config and the page_view both use them; the city events too.
  assert.match(provider, /const pageLocation = gaPageLocation\(new URL\(pathname \|\| '\/', SITE_ORIGIN\)\.toString\(\)\)/)
  assert.equal((provider.match(/page_referrer: pageReferrer/g) ?? []).length, 2, 'config call and inline config')
  assert.match(provider, /page_referrer: gaReferrerOrigin\(\)/)
  assert.match(provider, /page_location: gaPageLocation\(new URL\(pathname, SITE_ORIGIN\)\.toString\(\)\)/)
  assert.doesNotMatch(provider, /page_referrer: ''/, 'no hard-coded empty referrer outside the receipt comment')
})

test('7. page families and ICPs: host_landing, icp on page_view and both hand-offs', async () => {
  const sm = await loader.load(path.join(REPO, 'packages/search-measurement/src/index.ts'))
  assert.ok(sm.SEARCH_PAGE_FAMILIES.includes('host_landing'))
  for (const icp of ['hotel_resort', 'art_space', 'play_space']) assert.ok(sm.SEARCH_ICPS.includes(icp), icp)
  const pm = await loader.load('lib/page-measurement.ts')
  const icps = await loader.load('content/host-landing/icps.ts')
  for (const slug of icps.ICP_SLUGS) {
    const page = pm.pageMeasurement(`/host/${slug}`)
    assert.equal(page.page_family, 'host_landing', slug)
    assert.equal(page.audience, 'host')
    assert.ok(sm.SEARCH_ICPS.includes(page.icp), `${slug} → ${page.icp}`)
  }
  assert.deepEqual(pm.pageMeasurement('/host'), { audience: 'host', page_family: 'host_pillar' })
  assert.deepEqual(pm.pageMeasurement('/host/download'), { audience: 'host', page_family: 'host_pillar' })
  assert.deepEqual(pm.pageMeasurement('/going-out'), { audience: 'explorer', page_family: 'explorer_pillar' })
  assert.equal(pm.landingIcp('other'), undefined)
  assert.equal(pm.landingIcp('constructor'), undefined)
  for (const tool of Object.keys(pm.TOOL_ICP)) assert.ok(sm.SEARCH_ICPS.includes(pm.TOOL_ICP[tool]), tool)

  const provider = code(read('components/marketing/posthog-provider.tsx'))
  assert.match(provider, /const page = pageMeasurement\(pathname\)[\s\S]*captureSearchMeasurement\('page_view', \{\s*\.\.\.page,/)
  for (const [file, event] of [['components/landing/explorer-handoff.tsx', 'explorer_install_click'], ['components/landing/host-handoff.tsx', 'host_start_click']]) {
    const src = code(read(file))
    assert.match(src, new RegExp(`const page = pageMeasurement\\(window\\.location\\.pathname\\)[\\s\\S]*captureSearchMeasurement\\('${event}', \\{[\\s\\S]*page_family: page\\.page_family,\\s*\\.\\.\\.\\(page\\.icp \\? \\{ icp: page\\.icp \\} : \\{\\}\\)`), file)
  }
})

test('8. ad destinations: Host landing and city pages, one id per slug in every copy', async () => {
  const icps = await loader.load('content/host-landing/icps.ts')
  const cities = await loader.load('content/cities/registry.ts')
  const expected = [
    ...icps.ICP_SLUGS.map((s) => [`host-${s}`, `/host/${s}`]),
    ...cities.CITY_HUBS.map((c) => [`city-${c.slug}`, `/cities/${c.slug}`]),
  ]
  const routes = await loader.load('lib/ad-marketing-routes.ts')
  const edge = readRepo('supabase/functions/_shared/adDestination.ts')
  const channel = readRepo('supabase/functions/_shared/adChannel.ts')
  const migration = readRepo('supabase/migrations/20280522004339_issue_4339_ad_marketing_destinations.sql')
  for (const [slug, p] of expected) {
    assert.equal(routes.marketingSlugFromPathname(p), slug, `${p} maps to ${slug}`)
    const m = new RegExp(`slug: "${slug}",\\s*path: "${p.replace(/\//g, '\\/')}",\\s*title: "[^"]+",\\s*result_kind: "installs",\\s*id: "(43390000-0001-4000-8000-\\d{12})"`).exec(edge)
    assert.ok(m, `edge twin has ${slug}`)
    assert.match(channel, new RegExp(`"${slug}",`), `adChannel lists ${slug}`)
    assert.match(migration, new RegExp(`\\('${m[1]}','marketing_page','${slug}','[^']+','https://usemingla\\.com${p.replace(/\//g, '\\/')}','installs',NULL,NULL,'active'\\)`), `migration row ${slug}`)
  }
  assert.match(migration, /ON CONFLICT DO NOTHING;/)
})

test('9. campaign pass-through: OneLink af_sub1–3 and host web utm_*, ads-gated', async () => {
  const handoff = await loader.load('lib/app-handoff.ts')
  const lc = await loader.load('lib/landing-campaign.ts')
  const links = await loader.load('lib/links-src.ts')
  const stores = await loader.load('lib/store-links.ts')
  const campaign = lc.parseLandingCampaign('?utm_source=google&utm_medium=cpc&utm_campaign=ng_events&gclid=Cj0abc&email=a@b.c')
  assert.deepEqual(campaign, { utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ng_events' }, clickId: 'Cj0abc' })
  const hrefs = handoff.appHandoffHrefs('host', links.siteAttribution('business_hero'))
  const out = handoff.withLandingCampaign(hrefs, campaign)
  const phone = new URL(out.phoneHref)
  assert.ok(out.phoneHref.startsWith(stores.BUSINESS_ONELINK_URL))
  assert.equal(phone.searchParams.get('af_sub1'), 'ng_events')
  assert.equal(phone.searchParams.get('af_sub2'), 'google')
  assert.equal(phone.searchParams.get('af_sub3'), 'Cj0abc')
  assert.equal(phone.searchParams.get('pid'), 'mingla_web', 'attribution kept')
  const web = new URL(out.computerHref)
  assert.ok(out.computerHref.startsWith(stores.BUSINESS_WEB_URL))
  assert.equal(web.searchParams.get('utm_campaign'), 'ng_events')
  assert.equal(web.searchParams.get('utm_source'), 'google')
  assert.equal(web.searchParams.get('gclid'), null, 'click ids never go to host web')
  assert.deepEqual(out.stores, hrefs.stores, 'store listings untouched')
  // Explorer: /download is not touched; no campaign leaves the URLs as they were.
  const explorer = handoff.appHandoffHrefs('explorer', links.siteAttribution('explorer_nav'))
  assert.equal(handoff.withLandingCampaign(explorer, campaign).computerHref, explorer.computerHref)
  assert.deepEqual(handoff.withLandingCampaign(hrefs, lc.EMPTY_CAMPAIGN), hrefs)
  // A deep link's own values win.
  const deep = 'https://go.usemingla.com/w36m?pid=mingla_web&c=explorer_nav&af_sub1=keep'
  assert.equal(new URL(handoff.withLandingCampaignHref(deep, campaign)).searchParams.get('af_sub1'), 'keep')
  // Ads off: nothing is read or stored.
  assert.deepEqual(lc.readLandingCampaign(false), lc.EMPTY_CAMPAIGN)
  // cta-destination.ts is not edited for this.
  assert.doesNotMatch(read('lib/cta-destination.ts'), /af_sub|LandingCampaign/)
  for (const file of ['components/landing/explorer-handoff.tsx', 'components/landing/host-handoff.tsx']) {
    assert.match(code(read(file)), /withLandingCampaignHref\([^)]*readLandingCampaign\(isMarketingAdsOn\(\)\)\)/, file)
  }
  assert.match(code(read('components/landing/handoff-sheet.tsx')), /withLandingCampaign\(\s*appHandoffHrefs\(sheet === 'host' \? 'host' : 'explorer', attribution\),\s*readLandingCampaign\(isMarketingAdsOn\(\)\),\s*\)/)
  assert.match(code(read('components/marketing/posthog-provider.tsx')), /rememberLandingCampaign\(window\.location\.search, isMarketingAdsOn\(\)\)/)
})

test('10. funnel events fire where they should and every event is allowlisted', async () => {
  const { MARKETING_EVENT_NAMES } = await loader.load('lib/marketing-events.ts')
  const allowed = new Set(MARKETING_EVENT_NAMES)
  const used = new Set()
  for (const file of ['app', 'components', 'lib'].flatMap(walk)) {
    for (const m of code(read(file)).matchAll(/captureMarketing\(\s*'([a-z_]+)'/g)) used.add(m[1])
  }
  for (const name of used) assert.ok(allowed.has(name), `${name} is in lib/marketing-events.ts`)
  const expected = {
    'components/landing/handoff-sheet.tsx': ['handoff_sheet_opened', 'handoff_store_clicked', 'handoff_host_web_clicked', 'handoff_sheet_closed'],
    'components/site/site-prompt-demo.tsx': ['website_prompt_started', 'website_prompt_generated', 'ari_handoff_clicked'],
    'app/schedule/ScheduleClient.tsx': ['schedule_slot_selected', 'schedule_details_submitted'],
    'components/site/download-toggle.tsx': ['download_toggle_changed'],
  }
  for (const [file, events] of Object.entries(expected)) {
    for (const e of events) assert.match(code(read(file)), new RegExp(`captureMarketing\\('${e}'`), `${file} fires ${e}`)
  }
  const sheet = code(read('components/landing/handoff-sheet.tsx'))
  assert.match(sheet, /captureMarketing\('handoff_sheet_opened', \{ sheet: kind, icp: pageIcp \?\? null, source_kind: source \?\? null \}\)/)
  assert.match(sheet, /captureMarketing\('handoff_store_clicked', \{ store, sheet, icp: icp \?\? null \}\)/)
  // ICP pages: the delegated listener and the tagged elements.
  const landing = code(read('components/landing/icp-landing.tsx'))
  for (const e of ['icp_talk_to_team_clicked', 'icp_see_inside_clicked', 'icp_tool_card_clicked']) assert.match(landing, new RegExp(`data-icp-event="${e}"`))
  assert.match(landing, /<details key=\{q\} open=\{i === 0\} data-icp-faq=\{i\}>/)
  assert.match(landing, /<IcpLandingAnalytics slug=\{slug\} \/>/)
  const listener = code(read('components/landing/icp-landing-analytics.tsx'))
  assert.match(listener, /captureMarketing\(name, \{ icp \}\)/)
  assert.match(listener, /captureMarketing\('icp_faq_opened', \{ icp, faq_index: Number\(details\.dataset\.icpFaq\) \}\)/)
  // GA4 mirrors.
  const schedule = code(read('app/schedule/ScheduleClient.tsx'))
  assert.match(schedule, /captureMarketing\('tool_book_confirmed'[\s\S]*const leadIcp = landingIcp\(icp\)\s*if \(leadIcp\) \{\s*captureSearchMeasurement\('generate_lead', \{ audience: 'host', page_family: 'host_pillar', icp: leadIcp, action_state: 'succeeded' \}\)/)
  const provider = code(read('components/marketing/posthog-provider.tsx'))
  assert.match(provider, /if \(event === 'tool_report_ready'\) \{[\s\S]*captureSearchMeasurement\('tool_interaction', \{ audience: 'host', page_family: 'tools', icp, action_state: 'succeeded' \}\)/)
  assert.match(provider, /if \(!isMarketingEventName\(event\)\) \{[\s\S]*return\s*\}/, 'unlisted events never reach PostHog')
  // Consent: every new event goes through captureMarketing / captureSearchMeasurement,
  // both of which return while analytics is off.
  assert.match(provider, /export function captureMarketing\([\s\S]*?\{\s*if \(!isMarketingAnalyticsOn\(\)\) return/)
  assert.match(provider, /export function captureSearchMeasurement\([\s\S]*?\{\s*if \(!isMarketingAnalyticsOn\(\)\) return/)
  // Server and host-web halves of the Ari funnel.
  assert.match(readRepo('supabase/functions/site-prompt-draft/index.ts'), /event: "ari_draft_created"/)
  assert.match(readRepo('mingla-business/src/services/ariPolishAnalytics.ts'), /capture\("ari_draft_claimed", \{ surface: "website", outcome \}\)/)
  assert.match(readRepo('mingla-business/src/hooks/useSitePromptDraftHandoff.ts'), /latest\.current\.track\(result\.status\)/)
})
