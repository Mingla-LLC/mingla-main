import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateSources, FILES } from './issue-2771-no-web-analytics-before-grant.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sources = Object.fromEntries(
  Object.entries(FILES).map(([key, rel]) => [key, fs.readFileSync(path.join(root, rel), 'utf8')]),
)

test('independent mutations cannot restore advanced-consent or unguarded attribution', () => {
  // [TEST-MOD-APPROVED #3697] browser conversion POST retired; attribution
  // and arrival pixels gate on Reject (denied), not grant. Attack the live
  // opt-out boundaries directly while the separate PostHog/GA grant gates stay.
  const attacks = [
    {
      business: sources.business.replace(
        'if (!adTrackingAllowed() || !adPixelsBootstrapped) return;',
        'if (!adPixelsBootstrapped) return;',
      ),
    },
    {
      business: sources.business.replace(
        'export function captureAdClickIds(dest?: CaptureAdClickDest): void {\n  if (!hasWindow() || readStoredConsent() === "denied") return;',
        'export function captureAdClickIds(dest?: CaptureAdClickDest): void {\n  if (!hasWindow()) return;',
      ),
    },
    {
      business: sources.business.replace(
        'export async function postAttributionTouch(\n  input: PostTouchInput,\n): Promise<string | null> {\n  // toward #3697: first-party touch allowed before a banner choice; the region\n  // mode decides whether server sharing is granted now or remains pending.\n  if (readStoredConsent() === "denied") return null;',
        'export async function postAttributionTouch(\n  input: PostTouchInput,\n): Promise<string | null> {',
      ),
    },
    { marketingProvider: sources.marketingProvider.replace("): void {\n  if (readMarketingConsent() !== 'granted') return\n  try {", "): void {\n  try {") },
    { marketingLayout: sources.marketingLayout.replace('<PostHogProvider>', '<PostHogProvider>{null}</PostHogProvider>\n        ').replace('</PostHogProvider>', '') },
    { business: sources.business.replace('        cross_subdomain_cookie: false,\n', '') },
    { marketingProvider: sources.marketingProvider.replace('      cross_subdomain_cookie: false,\n', '') },
    { business: sources.business.replace('        cross_subdomain_cookie: false,\n', '        // cross_subdomain_cookie: false,\n') },
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

test('comments cannot satisfy the executable grant checks', () => {
  const changed = sources.business.replace(
    'if (readStoredConsent() === "granted") await ensureGrantedAnalyticsBoot();',
    '// if (readStoredConsent() === "granted") await ensureGrantedAnalyticsBoot();',
  )
  assert.notEqual(changed, sources.business, 'grant-check mutation must match current source')
  assert.match(evaluateSources({ ...sources, business: changed }).join('\n'), /Business init/)
})
