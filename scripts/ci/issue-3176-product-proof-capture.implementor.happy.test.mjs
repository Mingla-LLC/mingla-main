#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(ROOT, relative))
const SELF_TEST = process.argv.includes('--self-test')
const BUNDLES = process.argv.includes('--bundles')
const SENTINEL = 'MINGLA_3176_PRODUCT_PROOF_CAPTURE_ONLY'
const FIXTURE_MARKERS = ['sample-saved-3176', 'sample-session-3176', 'sample-live-event-3176', 'Sample sunset gallery plan', 'Sample rooftop listening session']

const REQUIRED = [
  'tools/product-proof-capture/run.mjs',
  'tools/product-proof-capture/capture-manifest.schema.json',
  'tools/product-proof-capture/rights-manifest.json',
  'tools/product-proof-capture/assets/asset-index.json',
  'tools/product-proof-capture/explorer/index.tsx',
  'tools/product-proof-capture/explorer/App.tsx',
  'tools/product-proof-capture/explorer/fixtures.ts',
  'tools/product-proof-capture/explorer/metroOverlay.js',
  'tools/product-proof-capture/host/index.tsx',
  'tools/product-proof-capture/host/App.tsx',
  'tools/product-proof-capture/host/fixtures.ts',
  'tools/product-proof-capture/host/metroOverlay.js',
  'tools/product-proof-capture/shared/networkDeny.ts',
  'tools/product-proof-capture/maestro/explorer-saved-details.yaml',
  'tools/product-proof-capture/maestro/explorer-collaboration.yaml',
  'tools/product-proof-capture/maestro/explorer-rsvp.yaml',
  'tools/product-proof-capture/maestro/host-live-public.yaml',
]

function validateShippingMain(value, surface) {
  assert.doesNotMatch(value, /product-proof-capture|mingla-product-proof-entry|MINGLA_CAPTURE_HARNESS/, `${surface} shipping main imports capture harness`)
}

function validateFixtureSource(value, surface) {
  assert.doesNotMatch(value, /https?:\/\//, `${surface} fixture contains a remote URI`)
  assert.match(value, /Sample/, `${surface} fixture must remain visibly sample data`)
}

function validateProductionBundle(value, surface) {
  assert(!value.includes(SENTINEL), `${surface} production bundle contains capture sentinel`)
  for (const marker of FIXTURE_MARKERS) assert(!value.includes(marker), `${surface} production bundle contains capture fixture ${marker}`)
}

function validateCaptureBundle(value, surface) {
  assert(value.includes(SENTINEL), `${surface} capture bundle is missing its capture-only sentinel`)
  assert(FIXTURE_MARKERS.some((marker) => value.includes(marker)), `${surface} capture bundle is missing visible sample fixtures`)
}

function validateNetworkDeny(value) {
  for (const boundary of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'external_link']) assert(value.includes(boundary), `network deny is missing ${boundary}`)
  assert.match(value, /globalThis\.fetch\s*=/, 'capture fetch can escape the network deny')
  assert.match(value, /Object\.assign\(Linking,/, 'capture Linking can escape the network deny')
  assert.match(value, /blockedAttempts\.push/)
}

function pngSize(relative) {
  const data = fs.readFileSync(path.join(ROOT, relative))
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG', `${relative} is not PNG`)
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`
}

function sha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex')
}

function sourceContract() {
  for (const relative of REQUIRED) assert(exists(relative), `missing capture asset ${relative}`)
  const explorerApp = read('tools/product-proof-capture/explorer/App.tsx')
  assert.match(explorerApp, /components\/activity\/SavedTab/)
  assert.match(explorerApp, /components\/ExpandedCardModal|<SavedTab/)
  assert.match(explorerApp, /components\/board\/BoardDiscussionTab/)
  assert.match(explorerApp, /components\/activity\/RsvpPassSheet/)
  const hostApp = read('tools/product-proof-capture/host/App.tsx')
  assert.match(hostApp, /components\/event\/EventListCard/)
  assert.match(hostApp, /components\/event\/PublicEventPage/)
  for (const app of [explorerApp, hostApp]) assert.doesNotMatch(app, /(?:^|\/)_(?:layout)|src\/(?:store|services)\//, 'capture App imported a shipping layout/store/service')

  validateFixtureSource(read('tools/product-proof-capture/explorer/fixtures.ts'), 'Explorer')
  validateFixtureSource(read('tools/product-proof-capture/host/fixtures.ts'), 'Host')
  const deny = read('tools/product-proof-capture/shared/networkDeny.ts')
  validateNetworkDeny(deny)
  const identity = read('tools/product-proof-capture/shared/captureIdentity.ts')
  assert.match(identity, /NODE_ENV === "production"/)
  assert.match(identity, /EAS_BUILD_PROFILE/)
  assert.match(identity, /capture_harness_commit_mismatch/)
  for (const entry of [read('tools/product-proof-capture/explorer/index.tsx'), read('tools/product-proof-capture/host/index.tsx')]) {
    assert.match(entry, /__MINGLA_CAPTURE_HARNESS__ === "1"/)
    assert.doesNotMatch(entry, /enabled:\s*true/)
  }

  const explorerPackage = JSON.parse(read('app-mobile/package.json'))
  const hostPackage = JSON.parse(read('mingla-business/package.json'))
  validateShippingMain(String(explorerPackage.main ?? ''), 'Explorer')
  validateShippingMain(String(hostPackage.main ?? ''), 'Host')
  assert.match(read('app-mobile/metro.config.js'), /MINGLA_CAPTURE_SURFACE === "explorer"/)
  assert.match(read('mingla-business/metro.config.js'), /MINGLA_CAPTURE_SURFACE === "host"/)

  const manifest = JSON.parse(read('tools/product-proof-capture/rights-manifest.json'))
  assert.equal(manifest.baselineCommit, '925aab769cd4970336c16d80391db15773012607')
  assert.equal(manifest.outputs.length, 4)
  for (const output of manifest.outputs) {
    assert(exists(output.path), `missing retained capture ${output.path}`)
    assert.equal(pngSize(output.path), '1206x2622', `${output.path} lost native simulator dimensions`)
    assert.equal(sha256(output.path), output.sha256, `${output.path} differs from approved manifest`)
    assert.equal(output.networkAttempts, 0)
    assert.equal(output.sampleStateVisible, true)
    assert.match(output.approvedBy, /independent tester pending/)
  }
  const proofGrid = read('mingla-marketing/components/core-pages/explorer-proof-grid.tsx')
  for (const output of manifest.outputs.filter((row) => row.surface === 'explorer')) assert(proofGrid.includes(`/${output.path.split('/public/')[1]}`), `Explorer page omits ${output.path}`)
  assert.match(read('mingla-marketing/app/(core)/about/page.tsx'), /product-proof\/host-live-public-page\.png/)
  const publicCore = read('mingla-marketing/app/(core)/about/page.tsx') + proofGrid
  assert.doesNotMatch(publicCore, /illustrative concept|not a real (?:event|customer)|concept image/i)
}

function bundleContract() {
  const paths = {
    explorerProd: process.env.MINGLA_EXPLORER_PROD_BUNDLE,
    hostProd: process.env.MINGLA_HOST_PROD_BUNDLE,
    explorerCapture: process.env.MINGLA_EXPLORER_CAPTURE_BUNDLE,
    hostCapture: process.env.MINGLA_HOST_CAPTURE_BUNDLE,
  }
  for (const [name, value] of Object.entries(paths)) assert(value && fs.existsSync(value), `missing ${name} bundle path`)
  validateProductionBundle(fs.readFileSync(paths.explorerProd, 'utf8'), 'Explorer')
  validateProductionBundle(fs.readFileSync(paths.hostProd, 'utf8'), 'Host')
  validateCaptureBundle(fs.readFileSync(paths.explorerCapture, 'utf8'), 'Explorer')
  validateCaptureBundle(fs.readFileSync(paths.hostCapture, 'utf8'), 'Host')
}

sourceContract()
if (BUNDLES) bundleContract()
if (SELF_TEST) {
  assert.throws(() => validateShippingMain('product-proof-capture/explorer/index.tsx', 'mutant'), /imports capture harness/)
  assert.throws(() => validateProductionBundle(`${SENTINEL} sample-saved-3176`, 'mutant'), /capture sentinel/)
  assert.throws(() => validateFixtureSource('export const media = "https://example.test/a.png"; export const name = "Sample"', 'mutant'), /remote URI/)
  assert.throws(() => validateCaptureBundle('ordinary application bundle', 'mutant'), /capture-only sentinel/)
  const deny = read('tools/product-proof-capture/shared/networkDeny.ts')
  assert.throws(() => validateNetworkDeny(deny.replace('globalThis.fetch =', 'globalThis.__escapedFetch =')), /fetch can escape/)
  process.stdout.write('RED proof: production import, sentinel leak, remote fixture, missing capture sentinel and network escape mutants were rejected\n')
}
process.stdout.write('PASS #3176 controlled product-proof capture isolation and retained-asset contract\n')
