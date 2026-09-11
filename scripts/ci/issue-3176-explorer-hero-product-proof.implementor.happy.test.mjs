#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function verify(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const explorer = source('mingla-marketing/app/(core)/explorer/page.tsx')
  const css = source('mingla-marketing/components/core-pages/core-pages.css')
  const manifest = JSON.parse(source('tools/product-proof-capture/rights-manifest.json'))
  const proof = manifest.outputs.find((entry) => entry.scene === 'explorer_saved_details')

  assert.match(explorer, /import Image from 'next\/image'/, 'Explorer hero must use the optimized image owner')
  assert.match(explorer, /className="core-explorer-hero-proof"/, 'Explorer hero must use the rounded product-proof frame')
  assert.match(explorer, /src="\/product-proof\/explorer-saved-details\.png"/, 'Explorer hero must show the approved real product capture')
  assert.match(explorer, /priority\s*\/>/, 'Explorer hero proof must be prioritized as above-the-fold media')
  assert.doesNotMatch(explorer, /core-proof-mark|mingla-logo-white-on-orange\.png/, 'Explorer hero must not fall back to the flat logo tile')
  assert.match(css, /\.core-explorer-hero-proof\s*\{[^}]*aspect-ratio:1206\/2050;[^}]*overflow:hidden;[^}]*border-radius:2rem;[^}]*box-shadow:var\(--cut-mould-dark\);/, 'Explorer hero proof must keep the approved rounded, cropped card treatment')
  assert.match(css, /\.core-explorer-hero-proof img\s*\{[^}]*height:100%;[^}]*object-fit:cover;[^}]*object-position:top;/, 'Explorer hero proof must crop the real capture intentionally')
  assert(proof, 'Explorer saved-details proof must remain registered')
  assert(proof.allowedSurfaces.includes('usemingla.com/explorer'), 'Explorer saved-details proof must remain approved for /explorer')
  assert.equal(proof.altText, 'Mingla Explorer showing the saved Sample sunset gallery plan open in its details sheet.')
}

verify()

if (process.argv.includes('--self-test')) {
  const relative = 'mingla-marketing/app/(core)/explorer/page.tsx'
  const reverted = read(relative).replace(
    '<figure className="core-explorer-hero-proof"><Image src="/product-proof/explorer-saved-details.png" alt="Mingla Explorer showing the saved Sample sunset gallery plan open in its details sheet." width={1206} height={2622} sizes="(min-width: 1024px) 21rem, 18rem" priority /></figure>',
    '<div className="core-proof-mark"><img src="/brand/mingla-logo-white-on-orange.png" alt="Mingla Explorer app icon" /></div>',
  )
  assert.throws(
    () => verify({ [relative]: reverted }),
    /rounded product-proof frame|approved real product capture|flat logo tile/,
    'restoring the flat logo tile must prove RED',
  )
  process.stdout.write('RED proof: restoring the flat Explorer logo tile was rejected\n')
}

process.stdout.write('PASS #3176 Explorer hero product proof\n')
