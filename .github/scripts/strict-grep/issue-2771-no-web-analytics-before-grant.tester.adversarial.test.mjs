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
  const attacks = [
    { business: sources.business.replace('readStoredConsent() !== "granted" || !adPixelsBootstrapped', '!adPixelsBootstrapped') },
    { business: sources.business.replace('readStoredConsent() !== "granted" || input.eventId.length', 'input.eventId.length') },
    { marketingProvider: sources.marketingProvider.replace("): void {\n  if (readMarketingConsent() !== 'granted') return\n  try {", "): void {\n  try {") },
    { marketingLayout: sources.marketingLayout.replace('<PostHogProvider>', '<PostHogProvider>{null}</PostHogProvider>\n        ').replace('</PostHogProvider>', '') },
    { business: sources.business.replace('        cross_subdomain_cookie: false,\n', '') },
    { marketingProvider: sources.marketingProvider.replace('      cross_subdomain_cookie: false,\n', '') },
    { business: sources.business.replace('        cross_subdomain_cookie: false,\n', '        // cross_subdomain_cookie: false,\n') },
    { marketingProvider: sources.marketingProvider.replace('      cross_subdomain_cookie: false,\n', '      // cross_subdomain_cookie: false,\n') },
  ]
  for (const attack of attacks) {
    assert.notEqual(evaluateSources({ ...sources, ...attack }).length, 0)
  }
})

test('comments cannot satisfy the executable grant checks', () => {
  const changed = sources.business.replace(
    'if (!hasWindow() || readStoredConsent() !== "granted") return;\n  await ensureGrantedAnalyticsBoot();',
    '// if (!hasWindow() || readStoredConsent() !== "granted") return;\n  await ensureGrantedAnalyticsBoot();',
  )
  assert.match(evaluateSources({ ...sources, business: changed }).join('\n'), /Business init/)
})
