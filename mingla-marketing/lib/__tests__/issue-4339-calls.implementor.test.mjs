// #4339 Creators and Locals calls (Seth approved, 9 Nov) — implementor
// regression test for /creators, /locals, /schedule/creators and
// /schedule/locals.
//
// Source mode (default, no install): runs the real lib/booking-social.ts and
// lib/schedule-cities.ts (with #4318's lib/links-data.ts underneath and
// PostgREST stubbed) through node's type stripping, and reads the page source.
// Built mode (ISSUE_4339_BUILT=1 after `npm run build`) also reads the built
// /creators and /locals pages and the two new route bundles.
//
// Pins:
//   - every link on /creators and /locals goes to a real route; none goes to
//     host.usemingla.com/creator/setup (it was never a page); Creators joins
//     through the Explorer hand-off;
//   - "Your city" comes from the live `links_page_cities()` reader, sorted by
//     name with "Somewhere else" last, and is never a literal list; a failed
//     read leaves "Somewhere else" (and the page adds a free-text city);
//   - per-audience validation in the browser, from the same fixture table the
//     growth-tools-book Deno suite asserts;
//   - the call pages say the design's words; a creator or local booking never
//     fires the Host generate_lead and its events carry `audience`;
//   - both routes are noindex, registered like /schedule, and budgeted.
//
// FAILS-ON-REVERT: putting the creator setup link back fails the links test;
// replacing liveCityOptions with a literal list fails the live-city test;
// dropping the creator `makes` check fails the validation test.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-calls.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'

// ---- strip-types loader (lib/*.ts with their relative lib imports) ---------
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-calls-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
const seen = new Set()
function emit(name) {
  if (seen.has(name)) return
  seen.add(name)
  const deps = []
  const js = stripTypeScriptTypes(read(`lib/${name}.ts`)).replace(IMPORT, (_m, _p, dep) => {
    deps.push(dep)
    return `from './${dep}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${name}.mjs`), js)
  for (const dep of deps) emit(dep)
}
emit('schedule-cities')
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const social = await load('booking-social')
const cities = await load('schedule-cities')
const fixtures = JSON.parse(read('lib/booking-social.fixtures.json'))

// The 14 cities live on 9 Nov 2026, in the database's own order (by id).
const LIVE_14 = ['Lagos', 'Raleigh', 'Durham', 'Cary', 'Washington', 'New York', 'Fort Lauderdale', 'London', 'Paris', 'Brussels', 'Abuja', 'Ibadan', 'Kano', 'Kaduna']
const cityRow = (name, i) => ({ city_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name, country_code: 'NG', center_lat: 6.5, center_lng: 3.4, has_places: true })

async function withPostgrest(reply, run) {
  const realFetch = globalThis.fetch
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon'
  const calls = []
  globalThis.fetch = async (url) => {
    const name = String(url).split('/rpc/')[1]
    calls.push(name)
    const body = reply(name)
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    await run(calls)
  } finally {
    globalThis.fetch = realFetch
    if (env.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = env.url
    if (env.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.key
  }
}

// ---- the two pages ------------------------------------------------------------
/** Every app route this repo serves, as a URL path ("/schedule/creators"). */
function appRoutes() {
  const routes = new Set()
  const walk = (dir, url) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) routes.add(url || '/')
        continue
      }
      const seg = entry.name
      if (seg.startsWith('_') || seg.startsWith('@')) continue
      walk(path.join(dir, seg), /^\(.*\)$/.test(seg) ? url : `${url}/${seg}`)
    }
  }
  walk(path.join(MARKETING, 'app'), '')
  return routes
}

test('every link on /creators and /locals goes to a real route; none to host.usemingla.com/creator/setup', () => {
  const routes = appRoutes()
  for (const rel of ['app/creators/page.tsx', 'app/locals/page.tsx']) {
    const source = code(read(rel))
    assert.doesNotMatch(source, /creator\/setup|hostWebPageHref|host\.usemingla\.com|CREATOR_SETUP/, `${rel}: no host web creator setup link`)
    const hrefs = [...source.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    assert.ok(hrefs.length >= 3, `${rel}: links found`)
    for (const href of hrefs) {
      assert.ok(href.startsWith('/'), `${rel}: ${href} is a site route`)
      assert.ok(routes.has(href), `${rel}: ${href} is a real route in app/`)
    }
  }
  const creators = code(read('app/creators/page.tsx'))
  assert.match(creators, /<ExplorerHandoffButton location="creators_join" className="btn cta" withArrow>\s*Get Mingla to join\s*<\/ExplorerHandoffButton>/)
  assert.match(creators, /<Link className="btn soft" href="\/schedule\/creators">\s*Book a call\s*<\/Link>/)
  assert.match(creators, /<span className="bring">Talk to the Creators team<\/span>\s*<Link className="btn white" href="\/schedule\/creators">\s*Book a call/)
  assert.match(creators, /Questions <em>first\?<\/em>/)
  assert.match(creators, /Build your profile in Mingla\. Creator mode stays private until every readiness check is complete\./)
  assert.match(creators, /You’ll read and accept the <Link href="\/creator-agreement">Creator agreement<\/Link> inside Mingla before\s+your first gig\./)
  const locals = code(read('app/locals/page.tsx'))
  assert.match(locals, /<Link className="btn soft" href="\/schedule\/locals">\s*Book a call\s*<\/Link>/)
  assert.match(locals, /<div className="band-actions">\s*<ExplorerHandoffButton location="locals_band" className="btn white">\s*Get Mingla to apply[\s\S]*?<Link className="btn glass" href="\/schedule\/locals">\s*Book a call/)
  assert.match(locals, /You’ll read and accept the <Link href="\/local-agreement">Local agreement<\/Link> inside Mingla when you\s+apply\./)
  assert.doesNotMatch(locals, />\s*Local agreement\s*<\/Link>\s*<\/div>/, 'the agreement is no longer a hero button')
  // The Explorer store constants the hand-off resolves to (Seth, 9 Nov).
  const stores = read('lib/store-links.ts')
  assert.match(stores, /id6760440898/)
  assert.match(stores, /com\.mingla\.app\.v2/)
  // The dead helper is gone from the seam.
  assert.doesNotMatch(code(read('lib/app-handoff.ts')), /hostWebPageHref|creator\/setup/)
})

// ---- the live city list ------------------------------------------------------
test('"Your city" is the live links_page_cities() list, sorted, with "Somewhere else" last', async () => {
  await withPostgrest((name) => (name === 'links_page_cities' ? LIVE_14.map(cityRow) : []), async (calls) => {
    const options = await cities.liveCityOptions()
    assert.ok(calls.includes('links_page_cities'), 'read through the #4318 reader')
    assert.deepEqual(options, [
      'Abuja', 'Brussels', 'Cary', 'Durham', 'Fort Lauderdale', 'Ibadan', 'Kaduna', 'Kano', 'Lagos', 'London', 'New York', 'Paris', 'Raleigh', 'Washington',
      'Somewhere else',
    ])
  })
  // A city that goes live appears with no code change; one switched off goes.
  await withPostgrest((name) => (name === 'links_page_cities' ? [...LIVE_14.filter((c) => c !== 'Kano'), 'Accra'].map(cityRow) : []), async () => {
    const options = await cities.liveCityOptions()
    assert.ok(options.includes('Accra'), 'a newly live city is listed')
    assert.ok(!options.includes('Kano'), 'a city switched off is not')
    assert.equal(options.at(-1), 'Somewhere else')
    assert.equal(options.length, 15)
  })
  // The read fails: "Somewhere else" alone (the form adds a free-text city).
  await withPostgrest((name) => (name === 'links_page_cities' ? new Response('nope', { status: 500 }) : []), async () => {
    const realError = console.error
    console.error = () => {}
    try {
      assert.deepEqual(await cities.liveCityOptions(), ['Somewhere else'])
    } finally {
      console.error = realError
    }
  })
  // Bad rows never become options.
  assert.deepEqual(social.cityOptions([{ name: ' Lagos ' }, { name: 'Lagos' }, { name: '' }, { name: 42 }, {}, { name: 'Somewhere else' }]), ['Lagos', 'Somewhere else'])
})

test('no city list is written in the call pages', () => {
  const sources = ['lib/schedule-cities.ts', 'lib/booking-social.ts', 'app/schedule/ScheduleClient.tsx', 'app/schedule/ProgramCallPage.tsx', 'app/schedule/creators/page.tsx', 'app/schedule/locals/page.tsx'].map((rel) => [rel, code(read(rel))])
  for (const [rel, source] of sources) {
    for (const name of LIVE_14) assert.ok(!source.includes(`'${name}'`) && !source.includes(`"${name}"`) && !source.includes(`>${name}<`), `${rel}: no literal "${name}"`)
  }
  assert.match(code(read('lib/schedule-cities.ts')), /const data = await getLinksData\(\)\s+return cityOptions\(data\.failed\.includes\('cities'\) \? \[\] : data\.cities\)/)
  const page = code(read('app/schedule/ProgramCallPage.tsx'))
  assert.match(page, /await connection\(\)\s+const cities = await liveCityOptions\(\)/, 'read at request time')
  assert.match(page, /<ScheduleClient audience=\{audience\} cities=\{cities\} \/>/)
})

// ---- validation per audience -------------------------------------------------
test('per-audience validation in the browser: the shared fixture table', () => {
  assert.ok(fixtures.audiences.length >= 16)
  for (const [audience, body, field] of fixtures.audiences) {
    const errors = social.programBookingErrors({
      audience,
      name: 'Ada Okafor',
      email: 'ada@hey.com',
      city: body.city ?? '',
      socialPlatform: body.social_platform ?? '',
      socialHandle: body.social_handle ?? '',
      makes: body.makes ?? '',
      workUrl: body.work_url ?? '',
      firstPlace: body.first_place ?? '',
    })
    assert.deepEqual(Object.keys(errors), field ? [field] : [], `${audience} ${JSON.stringify(body)}`)
  }
  // Creators must say what they make; Locals are never asked.
  const base = { name: 'Ada Okafor', email: 'ada@hey.com', city: 'Lagos', socialPlatform: 'tiktok', socialHandle: '@ada', makes: '', workUrl: '', firstPlace: '' }
  assert.ok('makes' in social.programBookingErrors({ ...base, audience: 'creator' }))
  assert.deepEqual(social.programBookingErrors({ ...base, audience: 'local' }), {})
  assert.deepEqual(social.CREATOR_MAKES.map((m) => m.value), ['video', 'photo', 'both'])
  assert.deepEqual(social.BOOKING_AUDIENCES, ['host', 'creator', 'local'])
  // Name and email as for a Host call.
  assert.ok('name' in social.programBookingErrors({ ...base, audience: 'local', name: 'A' }))
  assert.ok('email' in social.programBookingErrors({ ...base, audience: 'local', email: 'nope' }))
})

// ---- the call pages ----------------------------------------------------------
test('the call pages: the design copy, the fields, Get Mingla when booked, and Host leads only from Host calls', () => {
  const client = code(read('app/schedule/ScheduleClient.tsx'))
  for (const words of [
    'Mingla Creators', 'Creators team.', 'Twenty minutes with the people who run the program. You’ll get a calendar invite with a video link.',
    'How gigs are posted, and how you raise your hand', 'What hosts look for in your work', 'Contracts, delivery and how you get paid',
    'Creator setup lives in the Mingla app. Get it before the call and we can walk through your profile together.', 'Back to Creators',
    'Mingla Locals', 'Locals team.', 'Twenty minutes on how the monthly review works. You’ll get a calendar invite with a video link.',
    'When your city opens, and how the three seats are chosen', 'Which places are eligible for a review', 'Approval, disclosure and how the $150 is paid',
    'You apply inside Mingla when your city opens. Get it now so you’re ready.', 'Back to Locals',
    'Locals open city by city, with up to three per city.', 'We look at your work before the call.', 'Link to your best work', 'A place you’d review first',
  ]) {
    assert.ok(client.includes(words), `says "${words}"`)
  }
  assert.match(client, /Talk to the <em>\{PROGRAM_COPY\[audience\]\.team\}<\/em>/)
  assert.match(client, /What do you make\? <span className="req" aria-hidden="true">\*<\/span>/)
  assert.match(client, /<div className="seg" role="radiogroup"/)
  assert.match(client, /<ExplorerHandoffButton location=\{PROGRAM_COPY\[audience\]\.handoff\} className="btn cta">\s*Get Mingla\s*<\/ExplorerHandoffButton>/)
  // The booking: audience, city and the program fields go to growth-tools-book.
  assert.match(client, /audience,\s+city: bookedCity,\s+social_platform: socialPlatform,\s+social_handle: socialHandle\.trim\(\),/)
  assert.match(client, /\{ makes, work_url: workUrl\.trim\(\) \|\| undefined \}/)
  assert.match(client, /\{ first_place: firstPlace\.trim\(\) \|\| undefined \}/)
  // Analytics: every event carries the audience; generate_lead is Host only.
  for (const event of ['tool_book_view', 'schedule_details_submitted', 'tool_book_confirmed', 'schedule_slot_selected']) {
    assert.match(client, new RegExp(`captureMarketing\\('${event}', [^)]*audience`), `${event} carries audience`)
  }
  assert.match(client, /const leadIcp = isHost \? landingIcp\(icp\) : null\s+if \(leadIcp\) \{\s+captureSearchMeasurement\('generate_lead', \{ audience: 'host'/)
  assert.equal((client.match(/captureSearchMeasurement\(/g) ?? []).length, 1, 'one GA4 lead call, the Host one')
  // The Host form is unchanged: ICP + social required.
  assert.deepEqual(Object.keys(social.bookingErrors({ name: 'Ada', email: 'a@b.co', icp: '', socialPlatform: 'instagram', socialHandle: '', venue: '', website: '' })), ['icp', 'social'])
})

test('the routes: noindex like /schedule, registered, budgeted', async () => {
  for (const [rel, route] of [['app/schedule/creators/page.tsx', '/schedule/creators'], ['app/schedule/locals/page.tsx', '/schedule/locals']]) {
    assert.match(code(read(rel)), new RegExp(`publicNoindexMetadata\\('${route.replace(/\//g, '\\/')}'`))
    assert.match(read('lib/search/route-registry.ts'), new RegExp(`\\['${route.replace(/\//g, '\\/')}', 'schedule-(creators|locals)'\\]`))
    assert.match(read('scripts/verify-search-foundation.mjs'), new RegExp(`'${route.replace(/\//g, '\\/')}',`))
  }
  const budget = await import(pathToFileURL(path.join(MARKETING, 'scripts/issue-4339-first-load-budget.mjs')).href)
  for (const entry of ['/schedule/creators/page', '/schedule/locals/page']) assert.ok(budget.BUDGET_ROUTES.some(([e]) => e === entry), `${entry} is budgeted`)
})

// ---- built ---------------------------------------------------------------------
test('built: /creators and /locals link to the call pages, not to host web', { skip: !BUILT }, () => {
  const html = (rel) => fs.readFileSync(path.join(MARKETING, '.next/server/app', rel), 'utf8')
  const creators = html('creators.html')
  assert.doesNotMatch(creators, /creator\/setup/)
  assert.match(creators, /href="\/schedule\/creators"/)
  assert.match(creators, /href="\/creator-agreement"/)
  const locals = html('locals.html')
  assert.match(locals, /href="\/schedule\/locals"/)
  assert.match(locals, /href="\/local-agreement"/)
  for (const route of ['schedule/creators', 'schedule/locals']) {
    assert.ok(fs.existsSync(path.join(MARKETING, '.next/server/app', route, 'page.js')), `${route} is built`)
  }
})
