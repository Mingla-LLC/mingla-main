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

// MINGLA-INVARIANT: I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF | issue #2331 | Analytics (PostHog, GA4) and ads (Meta/TikTok/Snap/Reddit pixels) are each on unless this visitor turned it off, in every country; GPC starts ads off; nothing loads or sends after a turn-off.
//
// #2331 converts this gate from the retired #2771 "no web analytics before an
// explicit grant" rule. It now proves: every facade and boot fails closed on
// the visitor's saved turn-off, a turn-off stops the vendors and clears their
// cookies, no per-country read survives, and the old grant gate is gone.

function requiresOn(body, guard, readyPattern = null) {
  const prefix = body.slice(0, 320)
  return guard.test(prefix) && (readyPattern === null || readyPattern.test(prefix))
}

const BUSINESS_ANALYTICS_ON = /isAnalyticsOn\(\)/
const BUSINESS_ADS_ON = /isAdsOn\(\)/
const MARKETING_ANALYTICS_ON = /isMarketingAnalyticsOn\(\)/

export function evaluateSources(input) {
  const errors = []
  const business = stripComments(input.business)
  const provider = stripComments(input.marketingProvider)
  const banner = stripComments(input.marketingBanner)
  const layout = stripComments(input.marketingLayout)

  if (/import\s+posthog\s+from\s+['"]posthog-js['"]/.test(business)) {
    errors.push('Business must not eagerly import posthog-js')
  }
  const isAnalyticsOnBody = functionBody(business, 'isAnalyticsOn')
  if (!/return choice === null \? true : choice\.analytics;/.test(isAnalyticsOnBody)) {
    errors.push('Business analytics must be on unless the saved choice turned it off')
  }
  const isAdsOnBody = functionBody(business, 'isAdsOn')
  if (!/return choice === null \? !globalPrivacyControlOn\(\) : choice\.ads;/.test(isAdsOnBody)) {
    errors.push('Business ads must be on unless turned off, with GPC starting them off')
  }
  const initBody = functionBody(business, 'initWebAnalytics')
  if (!/if \(isAdsOn\(\)\) await bootstrapAdPixels\(\);/.test(initBody) || !/if \(isAnalyticsOn\(\)\) await ensureAnalyticsBoot\(\);/.test(initBody)) {
    errors.push('Business init must boot each vendor only while it is on')
  }
  const bootBody = functionBody(business, 'bootAnalytics')
  if (!requiresOn(bootBody, BUSINESS_ANALYTICS_ON) || !/await import\(['"]posthog-js['"]\)/.test(bootBody)) {
    errors.push('Business boot must check analytics is on and dynamically import PostHog')
  }
  if (!/await import\(['"]posthog-js['"]\);\s*if \(!isAnalyticsOn\(\)\) return;/.test(bootBody)) {
    errors.push('Business boot must re-check the choice after the dynamic import (a mid-boot turn-off wins)')
  }
  if (!/^[ \t]*cross_subdomain_cookie\s*:\s*false\s*,?\s*$/m.test(bootBody)) {
    errors.push('Business PostHog init must keep privacy cookies origin-local')
  }
  for (const name of ['captureWeb', 'identifyWeb', 'getFeatureFlagWeb']) {
    if (!requiresOn(functionBody(business, name), BUSINESS_ANALYTICS_ON, /posthogClient/)) {
      errors.push(`Business ${name} must require analytics on and a ready PostHog client`)
    }
  }
  if (!requiresOn(functionBody(business, 'gaEvent'), BUSINESS_ANALYTICS_ON, /window\.gtag/)) {
    errors.push('Business gaEvent must require analytics on and ready gtag')
  }
  const stopBody = functionBody(business, 'stopAnalytics')
  if (!/opt_out_capturing\(\)/.test(stopBody) || !/expireCookie\(name\)/.test(stopBody) || !/ga-disable-/.test(stopBody)) {
    errors.push('Business analytics turn-off must opt PostHog out, disable GA and clear their cookies')
  }
  const transitionBody = functionBody(business, 'applyPrivacyTransition')
  if (!/if \(!adsOn\) stopAdPixels\(\);/.test(transitionBody) || !/if \(!analyticsOn\) stopAnalytics\(\);/.test(transitionBody)) {
    errors.push('Business save must stop whatever was turned off')
  }
  for (const name of [
    'fireAdPageView', 'fireAdViewContent', 'fireAdPurchase', 'fireAdReservation',
    'fireAdInitiateCheckout', 'identifyAdBuyer',
  ]) {
    if (!requiresOn(functionBody(business, name), BUSINESS_ADS_ON, /adPixelsBootstrapped/)) {
      errors.push(`Business ${name} must require ads on and bootstrapped pixels`)
    }
  }
  for (const name of ['captureAdClickIds', 'postAttributionTouch']) {
    if (!requiresOn(functionBody(business, name), /!isAdsOn\(\)/)) {
      errors.push(`Business ${name} must block first-party attribution after ads are turned off`)
    }
  }
  const conversionBody = functionBody(business, 'postAttributionConversion')
  if (/postAttr\s*\(|kind:\s*['"]conversion['"]/.test(conversionBody)) {
    errors.push('Business postAttributionConversion must remain a no-op (trusted server path only)')
  }
  for (const [label, source] of [['Business', business], ['Marketing provider', provider], ['Marketing banner', banner]]) {
    if (/\/api\/ad-pixel-config|ad_pixel_public_config|__minglaAdPixelConsentMode/.test(source)) {
      errors.push(`${label} must not read a per-country privacy mode`)
    }
    if (/readStoredConsent\(\)\s*(?:!==|===)\s*['"]granted['"]|readMarketingConsent\(\)/.test(source)) {
      errors.push(`${label} must not restore the retired explicit-grant gate`)
    }
  }

  if (/import\s+posthog\s+from\s+['"]posthog-js['"]/.test(provider)) {
    errors.push('Marketing must not eagerly import posthog-js')
  }
  const marketingBootBody = functionBody(provider, 'bootGrantedMarketingAnalytics')
  if (!/await import\(['"]posthog-js['"]\)/.test(marketingBootBody) || !requiresOn(marketingBootBody, MARKETING_ANALYTICS_ON)) {
    errors.push('Marketing boot must check analytics is on and dynamically import PostHog')
  }
  if (!/^[ \t]*cross_subdomain_cookie\s*:\s*false\s*,?\s*$/m.test(marketingBootBody)) {
    errors.push('Marketing PostHog init must keep privacy cookies origin-local')
  }
  if (!/return\s+enabled\s*\?\s*children\s*:\s*null/.test(provider)) {
    errors.push('Marketing provider must withhold analytics children while analytics is off')
  }
  const marketingAnalyticsOn = functionBody(provider, 'isMarketingAnalyticsOn')
  if (!/return choice === null \? true : choice\.analytics/.test(marketingAnalyticsOn)) {
    errors.push('Marketing analytics must be on unless the saved choice turned it off')
  }
  const marketingCapture = functionBody(provider, 'captureMarketing')
  if (!requiresOn(marketingCapture, MARKETING_ANALYTICS_ON) || !/posthogClient\s*===\s*null\s*\|\|\s*posthogOptedOut/.test(marketingCapture)) {
    errors.push('Marketing capture facade must require analytics on and a live client')
  }
  const marketingStop = functionBody(provider, 'stopMarketingAnalytics')
  if (!/opt_out_capturing\(\)/.test(marketingStop) || !/expireCookie\(name\)/.test(marketingStop)) {
    errors.push('Marketing analytics turn-off must opt PostHog out and clear its cookies')
  }
  if (/from\s+['"]next\/script['"]|strategy\s*=\s*['"]beforeInteractive['"]/.test(layout)) {
    errors.push('Marketing root must not eagerly mount a script loader')
  }
  if (!/<PostHogProvider>\s*<GoogleAnalytics\s+gaId=[^>]+\/>\s*<\/PostHogProvider>/.test(layout)) {
    errors.push('GoogleAnalytics must be an analytics-gated provider child')
  }
  if (/posthogOptOut\(|consent_denied|consent_granted/.test(banner)) {
    errors.push('Marketing choices must not emit an analytics event of their own')
  }
  if (/maskAllInputs\s*:\s*false|api_host\s*:\s*['"](?!https:\/\/us\.i\.posthog\.com)/.test(provider)) {
    errors.push('PostHog US-host and masking controls must remain intact')
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
    ['Business eager SDK', { business: clean.business.replace('import type { CaptureResult, PostHog }', 'import posthog') }],
    ['Business boot loses the on check', { business: clean.business.replace('async function bootAnalytics(): Promise<void> {\n  if (!isAnalyticsOn()) return;', 'async function bootAnalytics(): Promise<void> {') }],
    ['Business mid-boot turn-off ignored', { business: clean.business.replace('const { default: posthog } = await import("posthog-js");\n    if (!isAnalyticsOn()) return;', 'const { default: posthog } = await import("posthog-js");') }],
    ['Business analytics off by default', { business: clean.business.replace('return choice === null ? true : choice.analytics;', 'return choice === null ? false : choice.analytics;') }],
    ['Business ads ignore GPC', { business: clean.business.replace('return choice === null ? !globalPrivacyControlOn() : choice.ads;', 'return choice === null ? true : choice.ads;') }],
    ['Business pixel fire loses the ads gate', { business: clean.business.replace('if (!isAdsOn() || !adPixelsBootstrapped) return;', 'if (!adPixelsBootstrapped) return;') }],
    ['Business turn-off keeps cookies', { business: clean.business.replace('if (isAnalyticsStorageName(name)) expireCookie(name);', '') }],
    ['Business turn-off forgets analytics', { business: clean.business.replace('if (!analyticsOn) stopAnalytics();', '') }],
    ['Attribution loses the ads gate', { business: clean.business.replace('if (!hasWindow() || !isAdsOn()) return;', 'if (!hasWindow()) return;') }],
    ['Region read restored', { business: clean.business.replace('export async function initWebAnalytics(): Promise<void> {', 'export async function initWebAnalytics(): Promise<void> {\n  void fetch("/api/ad-pixel-config");') }],
    ['Marketing eager SDK', { marketingProvider: clean.marketingProvider.replace("import type { PostHog } from 'posthog-js'", "import posthog from 'posthog-js'") }],
    ['Marketing unconditional children', { marketingProvider: clean.marketingProvider.replace('return enabled ? children : null', 'return children') }],
    ['Marketing eager GA', { marketingLayout: clean.marketingLayout.replace('<PostHogProvider>\n          <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} />\n        </PostHogProvider>', '<PostHogProvider>{null}</PostHogProvider>\n        <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} />') }],
    ['Marketing choice emits an event', { marketingBanner: clean.marketingBanner.replace('saveMarketingPrivacy(choice)', "saveMarketingPrivacy(choice)\n    posthogOptOut()") }],
    ['Replay masking disabled', { marketingProvider: clean.marketingProvider.replace('maskAllInputs: true', 'maskAllInputs: false') }],
    ['Business cross-subdomain cookie restored', { business: clean.business.replace('      cross_subdomain_cookie: false,\n', '') }],
    ['Marketing cross-subdomain cookie restored', { marketingProvider: clean.marketingProvider.replace('      cross_subdomain_cookie: false,\n', '') }],
  ]
  if (evaluateSources(clean).length > 0) throw new Error('clean implementation failed before mutations')
  for (const [label, changed] of cases) {
    const mutated = { ...clean, ...changed }
    if (evaluateSources(mutated).length === 0) throw new Error(`mutation escaped: ${label}`)
  }
  console.log(`OK: issue-2771/#2331 self-test — ${cases.length}/${cases.length} regressions rejected`)
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }
  const errors = evaluateSources(readSources())
  if (errors.length > 0) {
    console.error('FAIL: I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF')
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  console.log('OK: I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF — both web roots boot unless turned off, stop on a turn-off, and stay origin-local')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
