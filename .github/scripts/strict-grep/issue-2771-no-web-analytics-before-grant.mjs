#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.ISSUE_2771_REPO_ROOT
  ? path.resolve(process.env.ISSUE_2771_REPO_ROOT)
  : path.resolve(HERE, '../../..')

export const FILES = {
  business: 'mingla-business/src/analytics/webAnalytics.web.ts',
  marketingProvider: 'mingla-marketing/components/marketing/posthog-provider.tsx',
  marketingBanner: 'mingla-marketing/components/marketing/consent-banner.tsx',
  marketingLayout: 'mingla-marketing/app/layout.tsx',
}

export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:function|async function)\\s+${name}\\s*\\(`))
  if (start < 0) return ''
  const paramsOpen = source.indexOf('(', start)
  let parenDepth = 0
  let paramsClose = -1
  for (let index = paramsOpen; index < source.length; index += 1) {
    if (source[index] === '(') parenDepth += 1
    if (source[index] === ')') parenDepth -= 1
    if (parenDepth === 0) {
      paramsClose = index
      break
    }
  }
  const open = source.indexOf('{', paramsClose)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }
  return ''
}

function requiresGrant(body, readyPattern = null) {
  const prefix = body.slice(0, 320)
  const consent = /readStoredConsent\(\)\s*(?:!==|===)\s*['"]granted['"]/.test(prefix)
  return consent && (readyPattern === null || readyPattern.test(prefix))
}

export function evaluateSources(input) {
  const errors = []
  const business = stripComments(input.business)
  const provider = stripComments(input.marketingProvider)
  const banner = stripComments(input.marketingBanner)
  const layout = stripComments(input.marketingLayout)

  if (/import\s+posthog\s+from\s+['"]posthog-js['"]/.test(business)) {
    errors.push('Business must not eagerly import posthog-js')
  }
  const initBody = functionBody(business, 'initWebAnalytics')
  if (!requiresGrant(initBody) || !/ensureGrantedAnalyticsBoot\(\)/.test(initBody)) {
    errors.push('Business init must fail closed before the private single-flight boot')
  }
  const bootBody = functionBody(business, 'bootGrantedAnalytics')
  if (!requiresGrant(bootBody) || !/await import\(['"]posthog-js['"]\)/.test(bootBody)) {
    errors.push('Business private boot must re-check grant and dynamically import PostHog')
  }
  for (const name of ['captureWeb', 'identifyWeb', 'getFeatureFlagWeb']) {
    if (!requiresGrant(functionBody(business, name), /posthogClient/)) {
      errors.push(`Business ${name} must require grant and a ready PostHog client`)
    }
  }
  if (!requiresGrant(functionBody(business, 'gaEvent'), /window\.gtag/)) {
    errors.push('Business gaEvent must require grant and ready gtag')
  }
  for (const name of [
    'fireAdPageView', 'fireAdViewContent', 'fireAdPurchase', 'fireAdReservation',
    'captureAdClickIds', 'postAttributionTouch', 'postAttributionConversion',
    'getStoredClickAttribution',
  ]) {
    if (!requiresGrant(functionBody(business, name))) {
      errors.push(`Business ${name} must explicitly require grant`)
    }
  }

  if (/import\s+posthog\s+from\s+['"]posthog-js['"]/.test(provider)) {
    errors.push('Marketing must not eagerly import posthog-js')
  }
  if (!/await import\(['"]posthog-js['"]\)/.test(provider)) {
    errors.push('Marketing grant-only boot must dynamically import PostHog')
  }
  if (!/return\s+enabled\s*\?\s*children\s*:\s*null/.test(provider)) {
    errors.push('Marketing provider must withhold analytics children until booted grant')
  }
  if (!/readMarketingConsent\(\)\s*!==\s*['"]granted['"]/.test(provider)) {
    errors.push('Marketing controller must fail closed on non-granted consent')
  }
  const marketingCapture = functionBody(provider, 'captureMarketing')
  if (!/readMarketingConsent\(\)\s*!==\s*['"]granted['"]/.test(marketingCapture) || !/posthogClient\s*===\s*null/.test(marketingCapture)) {
    errors.push('Marketing capture facade must require grant and a ready client')
  }
  if (/from\s+['"]next\/script['"]|strategy\s*=\s*['"]beforeInteractive['"]/.test(layout)) {
    errors.push('Marketing root must not eagerly mount a script loader')
  }
  if (!/<PostHogProvider>\s*<GoogleAnalytics\s+gaId=[^>]+\/>\s*<\/PostHogProvider>/.test(layout)) {
    errors.push('GoogleAnalytics must be a grant-gated provider child')
  }
  if (/posthogOptOut\(|consent_denied|['"]consent['"]\s*,\s*['"]update['"]/.test(banner)) {
    errors.push('Marketing Reject path must not call an analytics facade or emit a deny event')
  }
  if (/maskAllInputs\s*:\s*false|api_host\s*:\s*['"](?!https:\/\/us\.i\.posthog\.com)/.test(provider)) {
    errors.push('Post-grant PostHog US-host and masking controls must remain intact')
  }
  return errors
}

function readSources(root = ROOT) {
  return Object.fromEntries(
    Object.entries(FILES).map(([key, rel]) => [key, fs.readFileSync(path.join(root, rel), 'utf8')]),
  )
}

function runSelfTest() {
  const clean = readSources()
  const cases = [
    ['Business eager SDK', { business: clean.business.replace('import type { PostHog }', 'import posthog') }],
    ['Business init loses grant', { business: clean.business.replace('if (!hasWindow() || readStoredConsent() !== "granted") return;\n  await ensureGrantedAnalyticsBoot();', 'await ensureGrantedAnalyticsBoot();') }],
    ['Attribution loses grant', { business: clean.business.replace('if (!hasWindow() || readStoredConsent() !== "granted") return;\n  try {\n    const params', 'if (!hasWindow()) return;\n  try {\n    const params') }],
    ['Marketing eager SDK', { marketingProvider: clean.marketingProvider.replace("import type { PostHog } from 'posthog-js'", "import posthog from 'posthog-js'") }],
    ['Marketing unconditional children', { marketingProvider: clean.marketingProvider.replace('return enabled ? children : null', 'return children') }],
    ['Marketing eager GA', { marketingLayout: clean.marketingLayout.replace('<PostHogProvider>\n          <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} />\n        </PostHogProvider>', '<PostHogProvider>{null}</PostHogProvider>\n        <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} />') }],
    ['Reject analytics ping', { marketingBanner: clean.marketingBanner.replace('persistMarketingConsent(value)', "persistMarketingConsent(value)\n    if (value === 'denied') posthogOptOut()") }],
    ['Replay masking disabled', { marketingProvider: clean.marketingProvider.replace('maskAllInputs: true', 'maskAllInputs: false') }],
  ]
  if (evaluateSources(clean).length > 0) throw new Error('clean implementation failed before mutations')
  for (const [label, changed] of cases) {
    const mutated = { ...clean, ...changed }
    if (evaluateSources(mutated).length === 0) throw new Error(`mutation escaped: ${label}`)
  }
  console.log(`OK: issue-2771 self-test — ${cases.length}/${cases.length} regressions rejected`)
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }
  const errors = evaluateSources(readSources())
  if (errors.length > 0) {
    console.error('FAIL: I-PROPOSED-2771-NO-WEB-ANALYTICS-BEFORE-GRANT')
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  console.log('OK: I-PROPOSED-2771-NO-WEB-ANALYTICS-BEFORE-GRANT — both web roots are grant-before-load')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
