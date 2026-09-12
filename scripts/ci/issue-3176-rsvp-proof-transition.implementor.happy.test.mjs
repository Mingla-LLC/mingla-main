#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const SELF_TEST = process.argv.includes('--self-test')
const BUNDLES = process.argv.includes('--bundles')
const CONTROL_ID = 'mingla-capture-scene-rsvp'
const CONTROL_TEMPLATE = 'mingla-capture-scene-${item}'
const EVENT_TITLE = 'Sample rooftop listening session'
const PASS_LABEL = 'Sample pass · QR not valid'
const INERT_QR = 'mingla-demo://not-valid/sample-rsvp-3176'

function ordered(source, values, label) {
  let cursor = -1
  for (const value of values) {
    const next = source.indexOf(value, cursor + 1)
    assert(next > cursor, `${label} is missing ordered step: ${value}`)
    cursor = next
  }
}

function validateApp(source) {
  assert.match(source, /testID={`mingla-capture-scene-\${item}`}/, 'RSVP control has no stable native selector')
  assert.match(source, /onPress=\{\(\) => setScene\(item\)\}/, 'scene control no longer changes scene state')
  assert.match(source, /scene === "rsvp" \? [\s\S]*<RsvpPassSheet visible/, 'RSVP scene no longer mounts the real visible RsvpPassSheet')
  assert.match(source, /LogBox\.ignoreLogs\(\["forwardRef render functions accept exactly two parameters"\]\)/, 'capture-only warning suppression was removed')
}

function validateFlow(source) {
  assert.doesNotMatch(source, /point:/, 'RSVP flow must not use geometry-dependent coordinate taps')
  ordered(source, [
    'assertVisible: "Saved for later"',
    `id: "${CONTROL_ID}"`,
    `assertVisible: "RSVP pass for ${EVENT_TITLE}"`,
    `assertVisible: "${EVENT_TITLE}"`,
    'assertVisible: "Going"',
    'assertVisible: "Show at door"',
    `assertVisible: "${PASS_LABEL}"`,
  ], 'RSVP Maestro flow')
}

function validateFixture(fixture, adapter) {
  for (const source of [fixture, adapter]) {
    assert(source.includes(INERT_QR), 'RSVP fixture lost its nonredeemable sample QR payload')
    assert(source.includes(PASS_LABEL), 'RSVP fixture lost its visible nonredeemable sample state')
  }
}

function validateRetainedCapture() {
  const manifest = JSON.parse(read('tools/product-proof-capture/rights-manifest.json'))
  const output = manifest.outputs.find((row) => row.scene === 'explorer_rsvp_pass')
  assert(output, 'rights manifest lost the Explorer RSVP proof')
  assert.equal(output.networkAttempts, 0, 'RSVP manifest must remain zero-network')
  assert.deepEqual(output.fixtureIds, ['sample-rsvp-3176', 'sample-event-3176'])
  const capturePath = path.join(ROOT, output.path)
  const digest = crypto.createHash('sha256').update(fs.readFileSync(capturePath)).digest('hex')
  assert.equal(digest, output.sha256, 'retained RSVP PNG and manifest hash differ')
}

function validateBundles(production, capture) {
  for (const marker of [CONTROL_TEMPLATE, EVENT_TITLE, PASS_LABEL, INERT_QR]) {
    assert(!production.includes(marker), `Explorer production bundle leaked RSVP fixture: ${marker}`)
    assert(capture.includes(marker), `Explorer capture bundle is missing RSVP fixture: ${marker}`)
  }
}

const app = read('tools/product-proof-capture/explorer/App.tsx')
const flow = read('tools/product-proof-capture/maestro/explorer-rsvp.yaml')
const fixture = read('tools/product-proof-capture/explorer/fixtures.ts')
const adapter = read('tools/product-proof-capture/explorer/adapters.ts')

validateApp(app)
validateFlow(flow)
validateFixture(fixture, adapter)
validateRetainedCapture()
if (BUNDLES) {
  const productionPath = process.env.MINGLA_EXPLORER_PROD_BUNDLE
  const capturePath = process.env.MINGLA_EXPLORER_CAPTURE_BUNDLE
  assert(productionPath && fs.existsSync(productionPath), 'missing Explorer production bundle')
  assert(capturePath && fs.existsSync(capturePath), 'missing Explorer capture bundle')
  validateBundles(fs.readFileSync(productionPath, 'utf8'), fs.readFileSync(capturePath, 'utf8'))
}

if (SELF_TEST) {
  assert.throws(
    () => validateApp(app.replace('testID={`mingla-capture-scene-${item}`}', '')),
    /stable native selector/,
  )
  assert.throws(
    () => validateFlow(flow.replace(`id: "${CONTROL_ID}"`, 'text: "Show rsvp sample"')),
    /missing ordered step/,
  )
  assert.throws(
    () => validateFixture(fixture.replace(INERT_QR, 'https://example.invalid/redeemable'), adapter),
    /nonredeemable sample QR payload/,
  )
  assert.throws(
    () => validateBundles(`${CONTROL_TEMPLATE}${EVENT_TITLE}${PASS_LABEL}${INERT_QR}`, `${CONTROL_TEMPLATE}${EVENT_TITLE}${PASS_LABEL}${INERT_QR}`),
    /production bundle leaked/,
  )
  process.stdout.write('RED proof: removing the stable control, restoring the text selector, making the QR redeemable, or leaking the fixture into production is rejected\n')
}

process.stdout.write('PASS #3176 reproducible real RSVP pass transition and inert sample proof\n')
