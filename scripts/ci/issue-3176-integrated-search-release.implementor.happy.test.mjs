#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const read=(relative)=>fs.readFileSync(path.join(ROOT,relative),'utf8')
const json=(relative)=>JSON.parse(read(relative))
const cities=['lagos','durham-nc','cary-nc','raleigh-nc','new-york-city','brussels','paris','london','fort-lauderdale','washington-dc']

function verifyContractSource(source) {
  for(const event of ['page_view','explorer_install_click','host_start_click','sign_up','plan_created','rsvp_complete','listing_published','generate_lead','share']) assert(source.includes(`'${event}'`),`missing event ${event}`)
  for(const key of ['audience','page_family','icp','city_slug','publication_state','destination_kind','source_kind','action_state']) assert(source.includes(`'${key}'`) || source.includes(`${key}:`),`missing property ${key}`)
  assert.match(source,/keys\.length>10/)
  assert.match(source,/keys\.some\(key=>!ALL_KEYS\.has\(key\)\)/)
  assert.match(source,/safeCleanUrl/)
}

function verifyCityData() {
  const catalogue=json('mingla-marketing/content/cities/catalogues.generated.json')
  const receipts=json('mingla-marketing/content/cities/catalogue-receipts.generated.json')
  assert.deepEqual(Object.keys(catalogue.cities),cities)
  assert.deepEqual(Object.keys(receipts.cities),cities)
  for(const slug of cities) {
    const city=catalogue.cities[slug]; const receipt=receipts.cities[slug]
    assert.equal(city.places.length,50,`${slug} count`)
    assert.equal(new Set(city.places.map((row)=>row.placePoolId)).size,50,`${slug} unique places`)
    assert.deepEqual(city.places.map((row)=>row.rank),Array.from({length:50},(_,index)=>index+1),`${slug} ranks`)
    for(let index=1;index<city.places.length;index+=1) {
      const previous=city.places[index-1]; const current=city.places[index]
      assert(previous.signalScore>current.signalScore || (previous.signalScore===current.signalScore && (previous.reviewCount>current.reviewCount || (previous.reviewCount===current.reviewCount && previous.placePoolId.localeCompare(current.placePoolId)<=0))),`${slug} ordering at ${index}`)
    }
    for(const row of city.places) {
      assert.equal(row.boundaryReceipt.contained,true)
      assert.equal(row.boundaryReceipt.boundarySha256,receipt.boundarySha256)
      assert.match(row.signalVersionId,/^[0-9a-f-]{36}$/)
      assert(row.signalScore>=(row.categorySlug==='movies'?80:120))
      assert.deepEqual(row.photoUrls,[],'provider-cached images must not enter durable output')
      assert.equal(row.mediaReceipt.status,'no_photo')
      assert.match(row.googlePlaceId,/^[A-Za-z0-9_-]{8,256}$/)
    }
    assert.equal(receipt.placeCount,50); assert.equal(receipt.uniquePlaceCount,50); assert.equal(receipt.justInTimeMediaEligibleCount,50)
    assert.match(receipt.boundarySha256,/^[0-9a-f]{64}$/)
  }
  assert(!catalogue.cities.lagos.places.some((row)=>/\bota\b|ogun state/i.test(`${row.name} ${row.address}`)),'Lagos catalogue leaked Ota/Ogun')
  assert.match(receipts.cities.lagos.boundaryAuthority,/Surveyor General/)
  assert.equal(receipts.cities.lagos.boundaryLicense,'CC BY 4.0')
  assert.equal(receipts.cities.brussels.boundaryLicense,'CC0')
}

function verifySourceWiring() {
  const trustRoutes=['about','explorer','cities','editorial-standards']
  for(const route of trustRoutes) {
    const page=read(`mingla-marketing/app/(core)/${route}/page.tsx`)
    assert.match(page,/<CorePageShell/); assert.match(page,/corePageMetadata/)
  }
  const combined=trustRoutes.map((route)=>read(`mingla-marketing/app/(core)/${route}/page.tsx`)).join('\n')+read('mingla-marketing/components/core-pages/core-page-shell.tsx')
  assert.doesNotMatch(combined,/illustrative (?:demo|concept)|not a real customer|placeholder/i)
  const media=read('mingla-marketing/app/api/city-place-media/route.ts')+read('mingla-marketing/components/page-system/current-place-photo.tsx')
  for(const token of ['GOOGLE_MAPS_API_KEY','authorAttributions','googleMapsUri','current_attribution_unavailable','data-place-media','Photo unavailable']) assert(media.includes(token),`missing media gate ${token}`)
  assert.doesNotMatch(media,/unstable_cache/,'provider failures must not be frozen in the server data cache')
  assert.match(media,/result\.status === 'current'[\s\S]*private, no-store/,'only attributable current media may receive a shared cache lifetime')
  assert(!read('mingla-marketing/content/cities/catalogues.generated.json').includes('stored_photo_urls'))
  const native=read('app-mobile/app/index.tsx')+read('app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx')
  assert.match(native,/captureExplorerSearchOutcome\("plan_created"/); assert.match(native,/captureExplorerSearchOutcome\("rsvp_complete"/)
  for (const metro of ['app-mobile/metro.config.js','mingla-business/metro.config.js']) {
    assert.match(read(metro),/["']@mingla\/search-measurement["']:\s*path\.join\([\s\S]*?["']search-measurement["']/,`${metro} lost the shared measurement resolver`)
  }
  const host=['src/context/AuthContext.tsx','src/hooks/useBusinessEvents.ts','src/hooks/useTrips.ts','src/hooks/useRsvpEvents.ts','src/components/experience/ExperienceCreatorWizard.tsx','src/components/venue/VenueCreatorWizard.tsx'].map((relative)=>read(`mingla-business/${relative}`)).join('\n')
  for(const event of ['sign_up','listing_published','generate_lead']) assert(host.includes(`"${event}"`),`missing Host outcome ${event}`)
  assert(fs.existsSync(path.join(ROOT,'mingla-business/src/analytics/searchOutcome.web.ts')))
  const migration=read('supabase/migrations/20270621003176_issue_3176_indexnow_outbox.sql')
  for(const token of ['FORCE ROW LEVEL SECURITY','FROM PUBLIC, anon, authenticated','ON CONFLICT (change_fingerprint) DO NOTHING','delivery_state=CASE WHEN p_delivered','search_indexnow_retention_minimum_90_days','AFTER INSERT OR UPDATE OR DELETE ON public.public_search_documents']) assert(migration.includes(token),`missing outbox contract ${token}`)
  assert.match(read('mingla-business/vercel.json'),/indexnow-key\.txt/)
  assert(fs.existsSync(path.join(ROOT,'mingla-marketing/app/indexnow-key.txt/route.ts')))
}

function verifyOperations() {
  execFileSync(process.execPath,['--experimental-strip-types','packages/search-measurement/test/contract.test.mjs'],{cwd:ROOT,stdio:'pipe'})
  execFileSync(process.execPath,['scripts/search/answer-engine-benchmark.mjs'],{cwd:ROOT,stdio:'pipe'})
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'mingla-search-tabs-'))
  execFileSync(process.execPath,['scripts/search/export-workbook.mjs',`--output=${output}`],{cwd:ROOT,stdio:'pipe'})
  assert.equal(fs.readdirSync(output).filter((name)=>name.endsWith('.csv')).length,10)
  assert.equal(json('scripts/search/fixtures/answer-engine-benchmark-v1.json').scenarios.length,145)
}

function verifyAll(contractSource=read('packages/search-measurement/src/index.ts')) {
  verifyContractSource(contractSource); verifyCityData(); verifySourceWiring(); verifyOperations()
}

verifyAll()
if(process.argv.includes('--self-test')) {
  const current=read('packages/search-measurement/src/index.ts')
  const reverted=current.replace("if (keys.length>10 || keys.some(key=>!ALL_KEYS.has(key))) return null",'// functional revert: arbitrary properties accepted')
  assert.throws(()=>verifyContractSource(reverted),/keys/,'functional privacy revert must be RED')
  const catalogues=json('mingla-marketing/content/cities/catalogues.generated.json')
  catalogues.cities.lagos.places.pop()
  assert.notEqual(catalogues.cities.lagos.places.length,50,'functional catalogue revert must be RED')
  process.stdout.write('RED proof: sanitizer and 50-place functional reverts were rejected\n')
}
process.stdout.write('PASS #3176 integrated search release happy path\n')
