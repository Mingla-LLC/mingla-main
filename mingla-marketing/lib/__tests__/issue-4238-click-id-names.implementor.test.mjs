// MINGLA-INVARIANT: I-4238-CLICK-ID-KEEPS-NETWORK | issue #4238 | on usemingla.com an ad click id is never stored or forwarded under another network's parameter name: the landing campaign keeps {key, value}, the touch carries external_click_id_type, host web gets the id under its own name plus mc_click, and the OneLink gets af_sub3 = <key>:<value> and af_sub1 = cmp:<campaign>.
//
// #4238 W3-2 (D9) and the usemingla.com sender half of W3-3 (D7) — implementor
// regression test. Runs the real modules (round B type-strip loader) in a fake
// browser (issue-4238-fake-browser.mjs):
//   1. ?fbclid=abc is kept as fbclid (it was relabelled gclid before, L3);
//      ?ScCid=x is kept as sccid; the stored campaign rebuilds under its key,
//      and a record from before (a bare string) carries no click id;
//   2. the host web hand-off href carries fbclid=abc and mc_click=<uuid>; the
//      OneLink carries af_sub3=fbclid:abc and af_sub1=cmp:<campaign>;
//   3. the first-party touch sends external_click_id_type, gbraid and wbraid
//      as Google clicks, and stores the minted click id;
//   4. the ad context for a host lead: ads on (click id, cookies, page URL
//      without its query), ads off (the opt-out only);
//   5. book a call sends `ad` for a Host call only and returns lead_event_id;
//      the browser Lead fires with it; a Creators call sends no `ad`;
//   6. the tools email gate sends `ad` and fires the browser Lead with the
//      server's lead:tool:<id>; with ads off it sends the opt-out and fires
//      nothing.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4238-click-id-names.implementor.test.mjs

import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { makeLoader } from './issue-4339-round-b-load.mjs'
import { installFakeBrowser, savePrivacy, vendorCalls } from './issue-4238-fake-browser.mjs'

const loader = makeLoader()
after(() => loader.cleanup())

const UUID = '7d4f2a90-1b3c-4e5f-8a9b-0c1d2e3f4a5b'
const IDS = { meta: '1949011972638955', tiktok: 'TTCODE4238', snap: 'snap-4238', reddit: 'a2_4238' }
const tick = () => new Promise((r) => setTimeout(r, 0))

let browser
let lc
let handoff
let capture
let privacy
let links
beforeEach(async () => {
  browser = installFakeBrowser({ url: 'https://usemingla.com/host/events' })
  lc ??= await loader.load('lib/landing-campaign.ts')
  handoff ??= await loader.load('lib/app-handoff.ts')
  capture ??= await loader.load('lib/ad-click-capture.ts')
  privacy ??= await loader.load('components/marketing/marketing-capture.ts')
  links ??= await loader.load('lib/links-src.ts')
  privacy.setMarketingPageChoice(undefined)
})

test('1. a click id keeps its network name, in the parse and in the stored campaign', () => {
  const fb = lc.parseLandingCampaign('?utm_source=meta&utm_campaign=t4238&fbclid=abc')
  assert.deepEqual(fb.clickId, { key: 'fbclid', value: 'abc' })
  assert.deepEqual(lc.parseLandingCampaign('?ScCid=x').clickId, { key: 'sccid', value: 'x' })
  assert.deepEqual(lc.parseLandingCampaign('?sccid=y').clickId, { key: 'sccid', value: 'y' })
  assert.deepEqual(lc.parseLandingCampaign('?gbraid=g1').clickId, { key: 'gbraid', value: 'g1' })
  assert.deepEqual(lc.parseLandingCampaign('?rdt_cid=r1&gclid=Cj0').clickId, { key: 'rdt_cid', value: 'r1' }, "host web's precedence")

  lc.rememberLandingCampaign('?utm_source=meta&utm_campaign=t4238&fbclid=abc', true)
  const read = lc.readLandingCampaign(true)
  assert.deepEqual(read.clickId, { key: 'fbclid', value: 'abc' })
  assert.deepEqual(read.utm, { utm_source: 'meta', utm_campaign: 't4238' })
  const rebuilt = new URLSearchParams()
  rebuilt.set(read.clickId.key, read.clickId.value)
  assert.equal(rebuilt.toString(), 'fbclid=abc')
  assert.equal(new URLSearchParams(JSON.stringify(read)).has('gclid'), false)

  // A record written before #4238 (a bare string) is never relabelled as a Google click.
  browser.window.sessionStorage.setItem(lc.LANDING_CAMPAIGN_KEY, JSON.stringify({ utm: { utm_source: 'meta' }, clickId: 'abc' }))
  assert.equal(lc.readLandingCampaign(true).clickId, null)
  // Ads off: nothing is read.
  assert.deepEqual(lc.readLandingCampaign(false), lc.EMPTY_CAMPAIGN)
})

test('2. the hand-off: host web gets fbclid + mc_click, the OneLink gets af_sub1 cmp: and af_sub3 key:value', () => {
  lc.rememberLandingCampaign('?utm_source=meta&utm_campaign=t4238&fbclid=abc', true)
  browser.window.sessionStorage.setItem(lc.AD_CLICK_KEY, JSON.stringify({ clickId: UUID }))
  const campaign = lc.readLandingCampaign(true)
  assert.equal(campaign.firstPartyClickId, UUID)
  const hrefs = handoff.withLandingCampaign(handoff.appHandoffHrefs('host', links.siteAttribution('business_hero')), campaign)

  const web = new URL(hrefs.computerHref)
  assert.equal(web.host, 'host.usemingla.com')
  assert.equal(web.searchParams.get('fbclid'), 'abc')
  assert.equal(web.searchParams.get('mc_click'), UUID)
  assert.equal(web.searchParams.get('utm_campaign'), 't4238')
  assert.equal(web.searchParams.get('gclid'), null, 'never under another network')
  assert.match(hrefs.computerHref, /fbclid=abc&mc_click=/)

  const phone = new URL(hrefs.phoneHref)
  assert.equal(phone.searchParams.get('af_sub1'), 'cmp:t4238')
  assert.equal(phone.searchParams.get('af_sub2'), 'meta')
  assert.equal(phone.searchParams.get('af_sub3'), 'fbclid:abc')
  assert.match(hrefs.phoneHref, /af_sub3=fbclid%3Aabc/)
  assert.match(hrefs.phoneHref, /af_sub1=cmp%3At4238/)
  assert.equal(phone.searchParams.get('mc_click'), null, 'the first-party id goes to host web only')

  // A forged first-party id in storage is never forwarded.
  browser.window.sessionStorage.setItem(lc.AD_CLICK_KEY, JSON.stringify({ clickId: 'x"><script>' }))
  assert.equal(lc.readLandingCampaign(true).firstPartyClickId, null)
})

test('3. the first-party touch sends the click id type (gbraid as Google) and stores the minted id', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  try {
    for (const [query, network, type, value] of [
      ['?gbraid=G4238&utm_source=google', 'google', 'gbraid', 'G4238'],
      ['?wbraid=W4238', 'google', 'wbraid', 'W4238'],
      ['?ScCid=S4238', 'snapchat', 'sccid', 'S4238'],
      ['?fbclid=T4238&gclid=Cj0', 'meta', 'fbclid', 'T4238'],
    ]) {
      browser = installFakeBrowser({ url: `https://usemingla.com/host/events${query}` })
      privacy.setMarketingPageChoice(undefined)
      browser.answer(() => ({ status: 200, body: { click_id: UUID } }))
      capture.captureMarketingAdClickIds()
      await tick()
      const touch = browser.requests.find((r) => r.url.endsWith('/attribution-capture'))?.body
      assert.equal(touch?.kind, 'touch', query)
      assert.equal(touch.network, network, query)
      assert.equal(touch.external_click_id, value, query)
      assert.equal(touch.external_click_id_type, type, query)
      await tick()
      assert.deepEqual(JSON.parse(browser.window.sessionStorage.getItem(lc.AD_CLICK_KEY)), { clickId: UUID })
    }
    // Ads off: no touch is recorded and nothing is stored.
    browser = installFakeBrowser({ url: 'https://usemingla.com/host/events?fbclid=T4238' })
    savePrivacy(browser.window, { ads: false })
    privacy.setMarketingPageChoice(undefined)
    capture.captureMarketingAdClickIds()
    await tick()
    assert.deepEqual(browser.requests, [])
  } finally {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
})

test('4. the host lead ad context: ads on carries the ids, ads off only the opt-out', async () => {
  const ctx = await loader.load('lib/marketing-ad-context.ts')
  browser = installFakeBrowser({ url: 'https://usemingla.com/schedule?icp=venue&email=a%40b.c#x', cookie: '_fbp=fb.1.1.2; _fbc=fb.1.1.T4238; _ttp=tt1; _scid=sc1; other=1' })
  privacy.setMarketingPageChoice(undefined)
  browser.window.sessionStorage.setItem(lc.AD_CLICK_KEY, JSON.stringify({ clickId: UUID }))
  assert.deepEqual(ctx.marketingAdContext(), {
    tracking_opt_out: false,
    page_url: 'https://usemingla.com/schedule',
    click_id: UUID,
    fbp: 'fb.1.1.2',
    fbc: 'fb.1.1.T4238',
    ttp: 'tt1',
    scid: 'sc1',
  })
  savePrivacy(browser.window, { ads: false })
  privacy.setMarketingPageChoice(undefined)
  assert.deepEqual(ctx.marketingAdContext(), { tracking_opt_out: true, page_url: 'https://usemingla.com/schedule' })
  assert.equal(ctx.leadEventIdFrom({ lead_event_id: 'lead:tool:abc-123' }), 'lead:tool:abc-123')
  assert.equal(ctx.leadEventIdFrom({ lead_event_id: 'host_signup:1' }), null)
  assert.equal(ctx.leadEventIdFrom({ ok: true }), null)
})

test('5. book a call: a Host call sends `ad`, returns lead_event_id and the browser Lead fires with it', async () => {
  const booking = await loader.load('lib/booking-call.ts')
  const ctx = await loader.load('lib/marketing-ad-context.ts')
  browser = installFakeBrowser({ url: 'https://usemingla.com/schedule', cookie: '_fbc=fb.1.1.T4238' })
  privacy.setMarketingPageChoice(undefined)
  const leadId = `lead:${UUID}`
  browser.answer(() => ({ status: 200, body: { ok: true, start: '2026-12-01T10:00:00Z', event_url: null, meet_url: null, lead_event_id: leadId } }))
  const ad = ctx.marketingAdContext()
  const res = await booking.bookCall({ start: '2026-12-01T10:00:00Z', name: 'Ada', email: 'a@b.c', icp: 'venue', social_platform: 'instagram', social_handle: 'ada', ad })
  assert.equal(res.ok, true)
  assert.equal(res.lead_event_id, leadId)
  const sent = browser.requests.at(-1)
  assert.ok(sent.url.endsWith('/growth-tools-book'))
  assert.deepEqual(sent.body.ad, { tracking_opt_out: false, page_url: 'https://usemingla.com/schedule', fbc: 'fb.1.1.T4238' })

  // The browser twin (ScheduleClient calls this with res.lead_event_id).
  for (const [k, v] of Object.entries({ NEXT_PUBLIC_META_PIXEL_ID: IDS.meta, NEXT_PUBLIC_TIKTOK_PIXEL_CODE: IDS.tiktok, NEXT_PUBLIC_SNAP_PIXEL_ID: IDS.snap, NEXT_PUBLIC_REDDIT_PIXEL_ID: IDS.reddit })) process.env[k] = v
  try {
    await ctx.fireBrowserHostLead(res.lead_event_id)
    assert.deepEqual(vendorCalls(browser.window).fbq.at(-1), ['track', 'Lead', {}, { eventID: leadId }])
  } finally {
    for (const k of ['NEXT_PUBLIC_META_PIXEL_ID', 'NEXT_PUBLIC_TIKTOK_PIXEL_CODE', 'NEXT_PUBLIC_SNAP_PIXEL_ID', 'NEXT_PUBLIC_REDDIT_PIXEL_ID']) delete process.env[k]
  }

  // A server without a lead (an older function, a Creators call) answers no id: nothing fires.
  browser = installFakeBrowser({ url: 'https://usemingla.com/schedule/creators' })
  privacy.setMarketingPageChoice(undefined)
  browser.answer(() => ({ status: 200, body: { ok: true, start: '2026-12-01T10:00:00Z' } }))
  const creator = await booking.bookCall({ start: '2026-12-01T10:00:00Z', name: 'Ada', email: 'a@b.c', audience: 'creator', city: 'Lagos', social_platform: 'instagram', social_handle: 'ada' })
  assert.equal(creator.lead_event_id, null)
  assert.equal('ad' in browser.requests.at(-1).body, false)
  await ctx.fireBrowserHostLead(creator.lead_event_id)
  assert.equal(browser.window.fbq, undefined)
})

// #4452 §4.6: every audience's booking is a labelled Lead (and a booked call), so
// /schedule sends the ad context for every audience and fires both twins.
test('5b. /schedule sends the ad context for every audience and fires the labelled Lead and call twins', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { MARKETING } = await import('./issue-4339-round-b-load.mjs')
  const src = fs.readFileSync(path.join(MARKETING, 'app/schedule/ScheduleClient.tsx'), 'utf8')
  assert.match(src, /const adContext = marketingAdContext\(\)/)
  assert.match(src, /\.\.\.\(adContext \? \{ ad: adContext \} : \{\}\)/)
  assert.match(src, /if \(res\.lead_event_id\) fireMarketingLead\(audience, res\.lead_event_id\)/)
  assert.match(src, /if \(res\.goal_event_id\) fireMarketingGoal\(audience, res\.goal_event_id\)/)
})

test('6. the tools email gate sends `ad` and fires the browser Lead with lead:tool:<id>; ads off sends the opt-out only', async () => {
  const submit = await loader.load('lib/growth-tools-submit.ts')
  for (const [k, v] of Object.entries({ NEXT_PUBLIC_META_PIXEL_ID: IDS.meta, NEXT_PUBLIC_REDDIT_PIXEL_ID: IDS.reddit })) process.env[k] = v
  try {
    browser = installFakeBrowser({ url: 'https://usemingla.com/tools/venues', cookie: '_fbp=fb.1.1.2' })
    privacy.setMarketingPageChoice(undefined)
    browser.window.sessionStorage.setItem(lc.AD_CLICK_KEY, JSON.stringify({ clickId: UUID }))
    browser.answer(() => ({ status: 200, body: { ok: true, lead_event_id: 'lead:tool:run-4238' } }))
    assert.deepEqual(await submit.submitGrowthToolsGate('run-4238', 'a@b.c'), { ok: true })
    const sent = browser.requests.at(-1)
    assert.ok(sent.url.endsWith('/growth-tools-gate'))
    assert.deepEqual(sent.body.ad, { tracking_opt_out: false, page_url: 'https://usemingla.com/tools/venues', click_id: UUID, fbp: 'fb.1.1.2' })
    await tick()
    await tick()
    const calls = vendorCalls(browser.window)
    assert.deepEqual(calls.fbq.at(-1), ['track', 'Lead', {}, { eventID: 'lead:tool:run-4238' }])
    assert.deepEqual(calls.rdt.at(-1), ['track', 'Lead', { conversionId: 'lead:tool:run-4238' }])
    assert.equal(browser.window.snaptr, undefined, 'no Snap id configured: Snap stays off')

    browser = installFakeBrowser({ url: 'https://usemingla.com/tools/venues', cookie: '_fbp=fb.1.1.2' })
    savePrivacy(browser.window, { ads: false })
    privacy.setMarketingPageChoice(undefined)
    browser.answer(() => ({ status: 200, body: { ok: true, lead_event_id: 'lead:tool:run-4238' } }))
    await submit.submitGrowthToolsGate('run-4238', 'a@b.c')
    assert.deepEqual(browser.requests.at(-1).body.ad, { tracking_opt_out: true, page_url: 'https://usemingla.com/tools/venues' })
    await tick()
    await tick()
    assert.equal(browser.window.fbq, undefined, 'ads off: no browser Lead')
  } finally {
    for (const k of ['NEXT_PUBLIC_META_PIXEL_ID', 'NEXT_PUBLIC_REDDIT_PIXEL_ID']) delete process.env[k]
  }
})
