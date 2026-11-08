// #4339 — the pinned contract for the Host landing pages' brand fonts
// (Instrument Serif, Geist, Geist Mono), shared by the two #3548 font gates
// (scripts/issue-3548-local-fonts.implementor.happy.test.mjs and
// scripts/issue-3548-local-fonts.tester.adversarial.test.mjs).
//
// The faces are the SAME pinned WOFF2 files as /links (#4318,
// scripts/issue-4318-links-fonts.contract.mjs owns their bytes and licences).
// They are defined in app/host/[icp]/fonts.ts and imported by
// app/host/[icp]/page.tsx alone, so they load and preload on /host/<icp> and
// nowhere else.

import assert from 'node:assert/strict'

export const LANDING_FONT_MODULE = 'app/host/[icp]/fonts.ts'
export const LANDING_FONT_CONSUMER = 'app/host/[icp]/page.tsx'

export const LANDING_FONT_DEFINITIONS = [
  {
    exportName: 'landingSerif',
    nextName: 'landingSans',
    faces: [
      ['InstrumentSerif-latin-400-normal.woff2', '400', 'normal'],
      ['InstrumentSerif-latin-400-italic.woff2', '400', 'italic'],
    ],
    variable: '--font-landing-serif',
    fallback: ['Georgia', 'Times New Roman', 'serif'],
  },
  {
    exportName: 'landingSans',
    nextName: 'landingMono',
    faces: [
      ['Geist-latin-wght-normal.woff2', '400', 'normal'],
      ['Geist-latin-wght-normal.woff2', '500', 'normal'],
      ['Geist-latin-wght-normal.woff2', '600', 'normal'],
    ],
    variable: '--font-landing-sans',
    fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  },
  {
    exportName: 'landingMono',
    faces: [['GeistMono-latin-500-normal.woff2', '500', 'normal']],
    variable: '--font-landing-mono',
    fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  },
]

/** Every pinned file the landing faces may use (a subset of the /links pins). */
export const LANDING_FONT_FILES = [...new Set(LANDING_FONT_DEFINITIONS.flatMap((d) => d.faces.map(([file]) => file)))]

/**
 * Source contract for app/host/[icp]/fonts.ts: three exact definitions over
 * the pinned /links files, imported by the landing page alone.
 * @param {(relativePath: string) => string} read
 * @param {string[]} sourceFiles every app/components/lib source file, relative
 */
export function checkLandingFontSource(read, sourceFiles) {
  const source = read(LANDING_FONT_MODULE)
  assert.equal((source.match(/localFont\s*\(/g) ?? []).length, 3, '#4339: app/host/[icp]/fonts.ts must define exactly three faces')
  for (const definition of LANDING_FONT_DEFINITIONS) {
    const start = source.indexOf(`export const ${definition.exportName} = localFont(`)
    assert.notEqual(start, -1, `#4339: ${definition.exportName} must exist`)
    const end = definition.nextName ? source.indexOf(`export const ${definition.nextName} = localFont(`, start) : source.length
    assert.notEqual(end, -1, `#4339: ${definition.exportName} must end before ${definition.nextName}`)
    const block = source.slice(start, end)
    assert.deepEqual(
      [...block.matchAll(/\{ path: '\.\.\/\.\.\/fonts\/([\w.-]+)', weight: '(\d+)', style: '(normal|italic)' \}/g)].map((m) => [m[1], m[2], m[3]]),
      definition.faces,
      `#4339: ${definition.exportName} must keep its exact pinned faces`,
    )
    assert.match(block, /display: 'swap'/, `#4339: ${definition.exportName} must be display swap`)
    assert.match(block, /preload: true/, `#4339: ${definition.exportName} must preload on the landing pages`)
    assert.equal((block.match(/adjustFontFallback: false/g) ?? []).length, 1, `#4339: ${definition.exportName} adds no generated fallback`)
    assert.match(block, new RegExp(`variable: '${definition.variable}'`), `#4339: ${definition.exportName} variable`)
    assert.ok(
      block.includes(`fallback: [${definition.fallback.map((f) => `'${f}'`).join(', ')}]`),
      `#4339: ${definition.exportName} must keep its system fallback stack`,
    )
  }
  const importers = sourceFiles.filter((file) => {
    const text = read(file)
    return file.startsWith('app/host/[icp]/')
      ? /from '\.\/fonts'/.test(text)
      : /host\/\[icp\]\/fonts/.test(text)
  })
  assert.deepEqual(importers, [LANDING_FONT_CONSUMER], '#4339: only the Host landing page may use the landing brand faces')
  assert.match(
    read(LANDING_FONT_CONSUMER),
    /className=\{`\$\{landingSerif\.variable\} \$\{landingSans\.variable\} \$\{landingMono\.variable\}`\}/,
    '#4339: the landing page applies the three face variables',
  )
}
