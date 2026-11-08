// #4318 — the pinned contract for the /links brand fonts (Instrument Serif,
// Geist, Geist Mono). Shared by the two #3548 font gates
// (scripts/issue-3548-local-fonts.implementor.happy.test.mjs and
// scripts/issue-3548-local-fonts.tester.adversarial.test.mjs), so the bytes,
// licences, definitions and route scoping are pinned in one place.
//
// The faces live in app/links/fonts.ts and are imported by app/links/page.tsx
// alone, so they load and preload on /links and nowhere else.

import assert from 'node:assert/strict'

const PACK = 'Mingla brand pack "Mingla, Edited" (approved 2026-11-06), out/brand-pack/04-type/'
const CONVERSION =
  'fontTools 4.68.0: latin subset (U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-2027, U+202A-206F, U+20A6, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD), all layout features, WOFF2'
const SERIF_COPYRIGHT =
  'Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)'
const GEIST_COPYRIGHT = 'Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)'
const SERIF_OFL = { oflFile: 'OFL-Instrument-Serif.txt', oflSha256: '129ed7618959716959f2941fdd5b49e0ad6e6c1d78726761786a00253d865521', oflNotice: SERIF_COPYRIGHT }
const GEIST_OFL = { oflFile: 'OFL-Geist.txt', oflSha256: 'f7281de1f4c3a2531a0487f463d8cf734a5906a44702bc5124a7ffaf36f70449', oflNotice: GEIST_COPYRIGHT }

const asset = (localFile, family, style, representedWeights, file, sourceSha256, extra, byteLength, sha256, copyright, licence, repositoryUrl) => ({
  localFile,
  family,
  style,
  representedWeights,
  subset: 'latin',
  brandPackSource: { pack: PACK, file, sha256: sourceSha256 },
  upstreamProject: { repositoryUrl },
  conversion: CONVERSION + extra,
  byteLength,
  sha256,
  copyright,
  oflFile: licence.oflFile,
  oflSha256: licence.oflSha256,
  oflNotice: licence.oflNotice,
})

export const LINKS_FONT_MODULE = 'app/links/fonts.ts'
export const LINKS_FONT_CONSUMER = 'app/links/page.tsx'

export const LINKS_FONT_ASSETS = [
  asset('InstrumentSerif-latin-400-normal.woff2', 'Instrument Serif', 'normal', ['400'], 'instrumentserif-regular.ttf',
    '498efd461f6ddfcb7a111bf9a565709d2085d48201d501ead960d93e84ffbb88', '', 22_104,
    '99d20a6f467784655629e070bcb7448b7975a11ce6d44ec592fd4897971b475d', SERIF_COPYRIGHT, SERIF_OFL,
    'https://github.com/Instrument/instrument-serif'),
  asset('InstrumentSerif-latin-400-italic.woff2', 'Instrument Serif', 'italic', ['400'], 'instrumentserif-italic.ttf',
    '08939b8bdf534afec24ae0ef5e03f948940cd9a8fe08e7fecbad040e62327385', '', 22_796,
    'f6ebf374abd171f0048790308921c489164d40c254c98d2a929af9bd144f0441', SERIF_COPYRIGHT, SERIF_OFL,
    'https://github.com/Instrument/instrument-serif'),
  asset('Geist-latin-wght-normal.woff2', 'Geist', 'normal', ['400', '500', '600'], 'geist.ttf',
    '73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659', '; wght axis limited to 400-600', 23_296,
    'c788a5996f13a0286455a948f16631982bf5a389187dec51f57d9255ff354d5a', GEIST_COPYRIGHT, GEIST_OFL,
    'https://github.com/vercel/geist-font'),
  asset('GeistMono-latin-500-normal.woff2', 'Geist Mono', 'normal', ['500'], 'geistmono.ttf',
    'd00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196', '; instanced at wght 500', 16_580,
    'dd0dadefa95da7d8c08d94d76322403571f2758f0c2e7731cffdcc67553b0d76', GEIST_COPYRIGHT, GEIST_OFL,
    'https://github.com/vercel/geist-font'),
]

/** The SOURCES.json `linksRouteAssets` rows (the licence pins live here only). */
export const linksManifestRows = () =>
  LINKS_FONT_ASSETS.map(({ oflSha256: _sha, oflNotice: _notice, ...row }) => row)

export const LINKS_FONT_DEFINITIONS = [
  {
    exportName: 'linksSerif',
    nextName: 'linksSans',
    faces: [
      ['InstrumentSerif-latin-400-normal.woff2', '400', 'normal'],
      ['InstrumentSerif-latin-400-italic.woff2', '400', 'italic'],
    ],
    variable: '--font-links-serif',
    fallback: ['Georgia', 'Times New Roman', 'serif'],
  },
  {
    exportName: 'linksSans',
    nextName: 'linksMono',
    faces: [
      ['Geist-latin-wght-normal.woff2', '400', 'normal'],
      ['Geist-latin-wght-normal.woff2', '500', 'normal'],
      ['Geist-latin-wght-normal.woff2', '600', 'normal'],
    ],
    variable: '--font-links-sans',
    fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  },
  {
    exportName: 'linksMono',
    faces: [['GeistMono-latin-500-normal.woff2', '500', 'normal']],
    variable: '--font-links-mono',
    fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  },
]

/** The distinct OFL files the /links faces ship with. */
export const LINKS_FONT_LICENCES = [SERIF_OFL, GEIST_OFL]

/**
 * Source contract for app/links/fonts.ts: three exact definitions, and
 * imported by the /links page alone.
 * @param {(relativePath: string) => string} read
 * @param {string[]} sourceFiles every app/components/lib source file, relative
 */
export function checkLinksFontSource(read, sourceFiles) {
  const source = read(LINKS_FONT_MODULE)
  assert.equal((source.match(/localFont\s*\(/g) ?? []).length, 3, '#4318: app/links/fonts.ts must define exactly three faces')
  for (const definition of LINKS_FONT_DEFINITIONS) {
    const start = source.indexOf(`export const ${definition.exportName} = localFont(`)
    assert.notEqual(start, -1, `#4318: ${definition.exportName} must exist`)
    const end = definition.nextName ? source.indexOf(`export const ${definition.nextName} = localFont(`, start) : source.length
    assert.notEqual(end, -1, `#4318: ${definition.exportName} must end before ${definition.nextName}`)
    const block = source.slice(start, end)
    assert.deepEqual(
      [...block.matchAll(/\{ path: '\.\.\/fonts\/([\w.-]+)', weight: '(\d+)', style: '(normal|italic)' \}/g)].map((m) => [m[1], m[2], m[3]]),
      definition.faces,
      `#4318: ${definition.exportName} must keep its exact pinned faces`,
    )
    assert.match(block, /display: 'swap'/, `#4318: ${definition.exportName} must be display swap`)
    assert.match(block, /preload: true/, `#4318: ${definition.exportName} must preload on /links`)
    assert.equal((block.match(/adjustFontFallback: false/g) ?? []).length, 1, `#4318: ${definition.exportName} adds no generated fallback`)
    assert.match(block, new RegExp(`variable: '${definition.variable}'`), `#4318: ${definition.exportName} variable`)
    assert.ok(
      block.includes(`fallback: [${definition.fallback.map((f) => `'${f}'`).join(', ')}]`),
      `#4318: ${definition.exportName} must keep its system fallback stack`,
    )
  }
  const importers = sourceFiles.filter((file) => {
    const text = read(file)
    return file.startsWith('app/links/')
      ? /from '\.\/fonts'/.test(text)
      : /app\/links\/fonts|links\/fonts'/.test(text)
  })
  assert.deepEqual(importers, [LINKS_FONT_CONSUMER], '#4318: only the /links page may use the /links brand faces')
  assert.match(
    read(LINKS_FONT_CONSUMER),
    /className=\{`\$\{linksSerif\.variable\} \$\{linksSans\.variable\} \$\{linksMono\.variable\}`\}/,
    '#4318: the /links page applies the three face variables',
  )
}
