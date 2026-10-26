import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateSources, FILES } from './issue-2771-no-web-analytics-before-grant.mjs'

// [TEST-MOD-APPROVED #2331] The gate now enforces
// I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF. These independent mutations attack
// the turn-off boundaries and the default-on rule directly.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sources = Object.fromEntries(
  Object.entries(FILES).map(([key, rel]) => [key, fs.readFileSync(path.join(root, rel), 'utf8')]),
)

test('independent mutations cannot leak a vendor past a turn-off or restore a grant gate', () => {
  const attacks = [
    {
      business: sources.business.replace(
        'if (!isAdsOn() || !adPixelsBootstrapped) return;',
        'if (!adPixelsBootstrapped) return;',
      ),
    },
    {
      business: sources.business.replace(
        'export function captureAdClickIds(dest?: CaptureAdClickDest): void {\n  if (!hasWindow() || !isAdsOn()) return;',
        'export function captureAdClickIds(dest?: CaptureAdClickDest): void {\n  if (!hasWindow()) return;',
      ),
    },
    {
      business: sources.business.replace(
        '  // #2331: first-party touch runs while ads are on; a turn-off blocks it.\n  if (!isAdsOn()) return null;',
        '',
      ),
    },
    {
      business: sources.business.replace(
        'export function captureWeb(\n  name: string,\n  props?: Record<string, unknown>,\n): void {\n  if (!isAnalyticsOn() || posthogClient === null) return;',
        'export function captureWeb(\n  name: string,\n  props?: Record<string, unknown>,\n): void {\n  if (posthogClient === null) return;',
      ),
    },
    { business: sources.business.replace('posthogClient.opt_out_capturing();', '') },
    { business: sources.business.replace('if (!adsOn) stopAdPixels();', '') },
    { business: sources.business.replace('if (!isAnalyticsOn()) return Promise.resolve();', 'if (readStoredConsent() !== "granted") return Promise.resolve();') },
    { marketingProvider: sources.marketingProvider.replace("): void {\n  if (!isMarketingAnalyticsOn()) return\n  try {", "): void {\n  try {") },
    { marketingProvider: sources.marketingProvider.replace("return choice === null ? true : choice.analytics", "return choice === null ? false : choice.analytics") },
    { marketingLayout: sources.marketingLayout.replace('<PostHogProvider>', '<PostHogProvider>{null}</PostHogProvider>\n        ').replace('</PostHogProvider>', '') },
    { business: sources.business.replace('      cross_subdomain_cookie: false,\n', '') },
    { marketingProvider: sources.marketingProvider.replace('      cross_subdomain_cookie: false,\n', '') },
    { business: sources.business.replace('      cross_subdomain_cookie: false,\n', '      // cross_subdomain_cookie: false,\n') },
    { marketingProvider: sources.marketingProvider.replace('      cross_subdomain_cookie: false,\n', '      // cross_subdomain_cookie: false,\n') },
  ]
  for (const attack of attacks) {
    assert.notDeepEqual(attack, {}, 'every mutation must change a named source')
    for (const [key, changed] of Object.entries(attack)) {
      assert.notEqual(changed, sources[key], `mutation for ${key} must match current source`)
    }
    assert.notEqual(evaluateSources({ ...sources, ...attack }).length, 0)
  }
})

test('comments cannot satisfy the executable on-unless-turned-off checks', () => {
  const changed = sources.business.replace(
    '  if (isAnalyticsOn()) await ensureAnalyticsBoot();',
    '  // if (isAnalyticsOn()) await ensureAnalyticsBoot();',
  )
  assert.notEqual(changed, sources.business, 'boot mutation must match current source')
  assert.match(evaluateSources({ ...sources, business: changed }).join('\n'), /Business init/)
})
