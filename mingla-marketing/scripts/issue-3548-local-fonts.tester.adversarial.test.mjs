#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_ROOT = path.join(ROOT, '.next')
const read = (relativePath, encoding = 'utf8') => readFileSync(path.join(ROOT, relativePath), encoding)
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex')

const EXPECTED_ASSETS = [
  {
    localFile: 'MochiyPopOne-latin-400-normal.woff2',
    family: 'Mochiy Pop One',
    style: 'normal',
    representedWeights: ['400'],
    subset: 'latin',
    googleFontsRepository: {
      commit: '23e54b51ddffbc7713c583748e3bd86f62b1fa4a',
      path: 'ofl/mochiypopone',
    },
    upstreamProject: {
      repositoryUrl: 'https://github.com/fontdasu/Mochiypop',
      commit: '438f3dd27a236961a705b1363eef4130241203ae',
    },
    versionedGstaticSourceUrl:
      'https://fonts.gstatic.com/s/mochiypopone/v12/QdVPSTA9Jh-gg-5XZP2UmU4O9nw3BXoYZ7Aj.woff2',
    byteLength: 18_284,
    sha256: '5b66adb405feda34a6bf45eadc404aebedcf0858873805fd6a4ba71f12396a63',
    copyright:
      'Copyright 2020 The MochiyPop Project Authors (https://github.com/fontdasu/Mochiypop)',
    oflFile: 'OFL-Mochiy-Pop-One.txt',
    oflSha256: '76be26178f13ef82866cf6a5c54272191bb583c203ad7035021c7681c9043558',
    oflNotice:
      'Copyright 2020 The Mochiypop Project Authors (https://github.com/fontdasu/Mochiypop)',
  },
  {
    localFile: 'NunitoSans-latin-wght-normal.woff2',
    family: 'Nunito Sans',
    style: 'normal',
    representedWeights: ['400', '500', '600', '700'],
    subset: 'latin',
    googleFontsRepository: {
      commit: '23e54b51ddffbc7713c583748e3bd86f62b1fa4a',
      path: 'ofl/nunitosans',
    },
    upstreamProject: {
      repositoryUrl: 'https://github.com/googlefonts/NunitoSans',
      commit: '058bd7a2f33d6ad5ef1df985b3db403622016a8c',
    },
    versionedGstaticSourceUrl:
      'https://fonts.gstatic.com/s/nunitosans/v19/pe0TMImSLYBIv1o4X1M8ce2xCx3yop4tQpF_MeTm0lfGWVpNn64CL7U8upHZIbMV51Q42ptCp7t1R-tQKr51.woff2',
    byteLength: 30_948,
    sha256: '39184f4d011106f5bfbe3813d3a8c3673663f04a45a9c9f55b1ed15f4d5b1cc9',
    copyright:
      'Copyright 2016 The Nunito Sans Project Authors (https://github.com/Fonthausen/NunitoSans)',
    oflFile: 'OFL-Nunito-Sans.txt',
    oflSha256: 'efbb0c9e864cef973982d9a17567e6be5c3d1759695574586f3f18c7ecca064b',
    oflNotice:
      'Copyright 2016 The Nunito Sans Project Authors (https://github.com/Fonthausen/NunitoSans)',
  },
  {
    localFile: 'Inter-latin-wght-normal.woff2',
    family: 'Inter',
    style: 'normal',
    representedWeights: ['400', '500', '600', '700', '800', '900'],
    subset: 'latin',
    googleFontsRepository: {
      commit: '23e54b51ddffbc7713c583748e3bd86f62b1fa4a',
      path: 'ofl/inter',
    },
    upstreamProject: {
      repositoryUrl: 'https://www.github.com/rsms/inter',
      commit: '66647c0bbbe41a850d79d9c76fb13add3378940f',
    },
    versionedGstaticSourceUrl:
      'https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2',
    byteLength: 48_432,
    sha256: 'c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4',
    copyright: 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)',
    oflFile: 'OFL-Inter.txt',
    oflSha256: '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57',
    oflNotice: 'Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)',
  },
]

const EXPECTED_DEFINITIONS = [
  {
    exportName: 'mochiy',
    nextName: 'nunito',
    asset: EXPECTED_ASSETS[0],
    weights: ['400'],
    variable: '--font-mochiy',
    fallback: 'MinglaMochiyArialFallback',
  },
  {
    exportName: 'nunito',
    nextName: 'inter',
    asset: EXPECTED_ASSETS[1],
    weights: ['400', '500', '600', '700'],
    variable: '--font-nunito',
    fallback: 'MinglaNunitoArialFallback',
  },
  {
    exportName: 'inter',
    nextName: 'previewInter',
    asset: EXPECTED_ASSETS[2],
    weights: ['400', '500', '600', '700'],
    variable: '--font-inter',
    fallback: 'MinglaInterRootArialFallback',
  },
  {
    exportName: 'previewInter',
    asset: EXPECTED_ASSETS[2],
    weights: ['400', '500', '600', '700', '800', '900'],
    fallback: 'MinglaInterPreviewArialFallback',
  },
]

const EXPECTED_FALLBACKS = [
  {
    family: 'MinglaMochiyArialFallback',
    ascent: '91.04%',
    descent: '22.60%',
    lineGap: '0.00%',
    sizeAdjust: '127.41%',
  },
  {
    family: 'MinglaNunitoArialFallback',
    ascent: '99.71%',
    descent: '34.82%',
    lineGap: '0.00%',
    sizeAdjust: '101.39%',
  },
  {
    family: 'MinglaInterRootArialFallback',
    ascent: '90.44%',
    descent: '22.52%',
    lineGap: '0.00%',
    sizeAdjust: '107.12%',
  },
  {
    family: 'MinglaInterPreviewArialFallback',
    ascent: '90.44%',
    descent: '22.52%',
    lineGap: '0.00%',
    sizeAdjust: '107.12%',
  },
]

const collectFiles = (directory, predicate = () => true) => {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(absolutePath, predicate))
    else if (predicate(absolutePath)) files.push(absolutePath)
  }
  return files
}

const parseDeclarations = (block) =>
  Object.fromEntries(
    block
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(':')
        assert.notEqual(separator, -1, `invalid CSS declaration: ${declaration}`)
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]
      }),
  )

const unquote = (value) => value.replace(/^['"]|['"]$/g, '')
const fontFaces = (css) =>
  [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => parseDeclarations(match[1]))
const normalizePercent = (value) => Number.parseFloat(value)

const checkDenialTransports = () => {
  const denialPath = path.join(ROOT, 'scripts/issue-3548-deny-google-font-network.cjs')
  const probe = spawnSync(
    process.execPath,
    [
      '--require',
      denialPath,
      '-e',
      `
        const assert = require('node:assert/strict');
        const http = require('node:http');
        const https = require('node:https');
        const { assertAllowed, requestHostname } = require(${JSON.stringify(denialPath)});
        const denied = /#3548 marketing builds must use pinned local fonts/;

        assert.throws(() => http.request('http://fonts.googleapis.com/css2'), denied);
        assert.throws(() => http.get('http://FONTS.GOOGLEAPIS.COM.:80/css2'), denied);
        assert.throws(() => https.request(new URL('https://fonts.gstatic.com/font.woff2')), denied);
        assert.throws(
          () => https.request({ protocol: 'https:', hostname: 'FONTS.GSTATIC.COM.', port: 443 }),
          denied,
        );
        assert.throws(() => https.get({ host: 'fonts.gstatic.com:443', path: '/font.woff2' }), denied);
        assert.throws(
          () => https.request('https://example.invalid/', { hostname: 'fonts.googleapis.com' }),
          denied,
        );
        assert.throws(() => fetch('https://fonts.googleapis.com/css2'), denied);
        assert.throws(() => fetch(new URL('https://FONTS.GSTATIC.COM.:443/font.woff2')), denied);
        assert.throws(
          () => fetch(new Request('https://fonts.googleapis.com/css2?family=Inter')),
          denied,
        );

        assert.equal(
          requestHostname(new URL('https://FONTS.GOOGLEAPIS.COM.:443/css2')),
          'fonts.googleapis.com',
        );
        for (const allowed of [
          'https://fonts.googleapis.com.evil.invalid/',
          'https://notfonts.gstatic.com/',
          'https://gstatic.com/',
          'http://127.0.0.1:43210/',
        ]) {
          assert.doesNotThrow(() => assertAllowed(allowed));
        }
      `,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  )
  assert.equal(
    probe.status,
    0,
    `denial hook must reject exact Google hosts across request/get/fetch and delegate lookalikes:\n${probe.stderr || probe.stdout}`,
  )
}

const checkSourceTopology = () => {
  const source = read('app/fonts.ts')
  assert.equal((source.match(/localFont\s*\(/g) ?? []).length, 4, 'exactly four local font roles must exist')

  for (const definition of EXPECTED_DEFINITIONS) {
    const start = source.indexOf(`export const ${definition.exportName} = localFont(`)
    assert.notEqual(start, -1, `${definition.exportName} definition must exist`)
    const end = definition.nextName
      ? source.indexOf(`export const ${definition.nextName} = localFont(`, start)
      : source.length
    assert.notEqual(end, -1, `${definition.exportName} definition must have a stable boundary`)
    const block = source.slice(start, end)
    assert.deepEqual(
      [...block.matchAll(/weight:\s*['"](\d+)['"]/g)].map((match) => match[1]),
      definition.weights,
      `${definition.exportName} must keep its exact weight topology`,
    )
    assert.equal(
      (block.match(new RegExp(definition.asset.localFile.replaceAll('.', '\\.'), 'g')) ?? []).length,
      definition.weights.length,
      `${definition.exportName} must map every approved weight to its pinned asset`,
    )
    assert.equal((block.match(/style:\s*['"]normal['"]/g) ?? []).length, definition.weights.length)
    assert.match(block, /display:\s*['"]swap['"]/)
    assert.match(block, /preload:\s*true/)
    assert.equal((block.match(/adjustFontFallback:\s*false/g) ?? []).length, 1)
    assert.match(
      block,
      new RegExp(`fallback:\\s*\\[\\s*['"]${definition.fallback}['"]\\s*\\]`),
      `${definition.exportName} must retain its distinct approved fallback identity`,
    )
    if (definition.variable) {
      assert.match(block, new RegExp(`variable:\\s*['"]${definition.variable}['"]`))
    } else {
      assert.doesNotMatch(block, /variable\s*:/, 'preview Inter must remain wrapper-only')
    }
  }

  assert.equal(
    new Set(EXPECTED_DEFINITIONS.map(({ fallback }) => fallback)).size,
    4,
    'root and preview roles must not alias a fallback identity',
  )

  const sourceFaces = fontFaces(read('app/globals.css'))
  for (const expected of EXPECTED_FALLBACKS) {
    const matching = sourceFaces.filter((face) => unquote(face['font-family'] ?? '') === expected.family)
    assert.equal(matching.length, 1, `${expected.family} must have exactly one source face`)
    const face = matching[0]
    assert.deepEqual(
      Object.keys(face).sort(),
      ['ascent-override', 'descent-override', 'font-family', 'line-gap-override', 'size-adjust', 'src'],
      `${expected.family} must not gain a weight/style/display descriptor`,
    )
    assert.equal(face.src, 'local("Arial")')
    assert.equal(face['ascent-override'], expected.ascent)
    assert.equal(face['descent-override'], expected.descent)
    assert.equal(face['line-gap-override'], expected.lineGap)
    assert.equal(face['size-adjust'], expected.sizeAdjust)
  }

  const layout = read('app/layout.tsx')
  assert.match(layout, /import\s*\{\s*inter,\s*mochiy,\s*nunito\s*\}\s*from\s*['"]\.\/fonts['"]/)
  assert.match(layout, /className=\{`\$\{mochiy\.variable\} \$\{nunito\.variable\} \$\{inter\.variable\}`\}/)
  for (const preview of ['app/event-preview/page.tsx', 'app/trip-preview/page.tsx']) {
    const previewSource = read(preview)
    assert.match(previewSource, /import\s*\{\s*previewInter\s*\}\s*from\s*['"]@\/app\/fonts['"]/)
    assert.match(previewSource, /<div\s+className=\{previewInter\.className\}>/)
    assert.doesNotMatch(previewSource, /localFont|next\/font|const\s+previewInter/)
  }
}

const checkForbiddenProductionHosts = () => {
  const roots = ['app', 'components', 'content', 'lib', 'scripts']
  const allowed = new Set([
    'app/fonts/SOURCES.json',
    'scripts/issue-3548-deny-google-font-network.cjs',
    'scripts/issue-3548-local-fonts.implementor.happy.test.mjs',
    'scripts/issue-3548-local-fonts.tester.adversarial.test.mjs',
  ])
  const hostPattern =
    /(?:https?:)?\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\.?(?::\d+)?(?:[/?#]|(?=['"`\s)]))/i
  for (const root of roots) {
    for (const absolutePath of collectFiles(path.join(ROOT, root), (candidate) =>
      /\.(?:ts|tsx|js|jsx|mjs|cjs|css|json)$/.test(candidate),
    )) {
      const relativePath = path.relative(ROOT, absolutePath)
      if (allowed.has(relativePath)) continue
      const contents = readFileSync(absolutePath, 'utf8')
      assert.doesNotMatch(contents, /['"]next\/font\/google['"]/, `${relativePath} reintroduced next/font/google`)
      assert.doesNotMatch(
        contents,
        hostPattern,
        `${relativePath} contains a Google Fonts host, including alternate case/trailing-dot forms`,
      )
    }
  }
}

const checkSourceBinariesAndLicenses = () => {
  const fontDirectory = path.join(ROOT, 'app/fonts')
  const expectedFiles = [
    'SOURCES.json',
    ...EXPECTED_ASSETS.flatMap(({ localFile, oflFile }) => [localFile, oflFile]),
  ].sort()
  assert.deepEqual(readdirSync(fontDirectory).sort(), expectedFiles, 'the pinned font directory must be exact')

  for (const asset of EXPECTED_ASSETS) {
    const bytes = read(`app/fonts/${asset.localFile}`, null)
    assert.equal(bytes.byteLength, asset.byteLength, `${asset.localFile} byte length must match the pin`)
    assert.equal(sha256(bytes), asset.sha256, `${asset.localFile} source hash must match the pin`)
    const license = read(`app/fonts/${asset.oflFile}`, null)
    assert.equal(sha256(license), asset.oflSha256, `${asset.oflFile} must retain exact upstream bytes`)
    assert.equal(
      license.toString('utf8').split('\n')[0],
      asset.oflNotice,
      `${asset.oflFile} must retain its upstream copyright notice verbatim`,
    )
  }
}

const checkSourceAssetsAndLicenses = () => {
  checkSourceBinariesAndLicenses()
  const manifest = JSON.parse(read('app/fonts/SOURCES.json'))
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    investigationDate: '2026-09-27',
    assets: EXPECTED_ASSETS.map(({ oflSha256: _oflSha256, oflNotice: _oflNotice, ...asset }) => asset),
  })
}

const checkPackageRouting = () => {
  const packageJson = JSON.parse(read('package.json'))
  const packageLock = JSON.parse(read('package-lock.json'))
  const tester = 'node scripts/issue-3548-local-fonts.tester.adversarial.test.mjs'
  const implementor = 'node scripts/issue-3548-local-fonts.implementor.happy.test.mjs'
  assert.equal(packageJson.scripts['test:issue-3548'], implementor)
  assert.equal(packageJson.scripts['test:issue-3548:tester'], tester)
  assert.match(packageJson.scripts.prebuild, new RegExp(`${implementor.replaceAll('.', '\\.') } && ${tester.replaceAll('.', '\\.')}$`))
  assert.match(
    packageJson.scripts.build,
    /^node scripts\/issue-2990-restructured-page-system\.implementor\.happy\.test\.mjs --source-only && next\(\) \{ node scripts\/issue-3548-deny-google-font-network\.cjs "\$@" && node scripts\/issue-3548-local-fonts\.implementor\.happy\.test\.mjs --built-only; \} && /,
    'the frozen implementor wrapper contract must remain byte-for-byte present',
  )
  assert.match(
    packageJson.scripts.build,
    /next\(\) \{ node scripts\/issue-3548-deny-google-font-network\.cjs "\$@" && node scripts\/issue-3548-local-fonts\.implementor\.happy\.test\.mjs --built-only && node scripts\/issue-3548-local-fonts\.tester\.adversarial\.test\.mjs --built-only; \}/,
  )
  assert.deepEqual(packageLock.packages?.['']?.dependencies ?? {}, packageJson.dependencies ?? {})
  assert.deepEqual(packageLock.packages?.['']?.devDependencies ?? {}, packageJson.devDependencies ?? {})
  assert.deepEqual(
    [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.devDependencies ?? {})].filter(
      (name) => /(?:fontsource|typeface|google-fonts?|next-font)/i.test(name),
    ),
    [],
    'local fonts must not add an external font dependency',
  )
}

const readBuiltCss = () => {
  assert(existsSync(BUILD_ROOT), 'a completed .next artifact is required for --built-only')
  const cssFiles = collectFiles(path.join(BUILD_ROOT, 'static/css'), (candidate) => candidate.endsWith('.css'))
  assert(cssFiles.length > 0, 'compiled CSS must exist')
  return cssFiles.map((absolutePath) => readFileSync(absolutePath, 'utf8')).join('\n')
}

const checkBuiltAssets = () => {
  const mediaDirectory = path.join(BUILD_ROOT, 'static/media')
  const woffFiles = collectFiles(mediaDirectory, (candidate) => candidate.endsWith('.woff2'))
  const emitted = woffFiles.map((absolutePath) => ({
    file: path.basename(absolutePath),
    sha256: sha256(readFileSync(absolutePath)),
  }))
  assert.equal(emitted.length, 3, 'the build must emit exactly three WOFF2 files')
  assert.deepEqual(
    emitted.map(({ sha256: hash }) => hash).sort(),
    EXPECTED_ASSETS.map(({ sha256: hash }) => hash).sort(),
    'the exact three approved source hashes must reach emitted media',
  )
}

const checkBuiltCss = () => {
  const css = readBuiltCss()
  const faces = fontFaces(css)
  const mediaDirectory = path.join(BUILD_ROOT, 'static/media')
  for (const definition of EXPECTED_DEFINITIONS) {
    const matching = faces.filter((face) => unquote(face['font-family'] ?? '') === definition.exportName)
    assert.deepEqual(
      matching.map((face) => face['font-weight']),
      definition.weights,
      `${definition.exportName} compiled weights must remain exact`,
    )
    for (const face of matching) {
      assert.equal(face['font-display'], 'swap')
      assert.equal(face['font-style'], 'normal')
      const source = face.src?.match(/^url\((\/_next\/static\/media\/([^)]*\.woff2))\) format\(["']woff2["']\)$/)
      assert(source, `${definition.exportName} must use same-origin emitted WOFF2 media`)
      assert.equal(
        sha256(readFileSync(path.join(mediaDirectory, source[2]))),
        definition.asset.sha256,
        `${definition.exportName} must resolve to its approved emitted bytes`,
      )
    }
  }

  for (const expected of EXPECTED_FALLBACKS) {
    const matching = faces.filter((face) => unquote(face['font-family'] ?? '') === expected.family)
    assert.equal(matching.length, 1, `${expected.family} must compile exactly once`)
    const face = matching[0]
    assert.deepEqual(
      Object.keys(face).sort(),
      ['ascent-override', 'descent-override', 'font-family', 'line-gap-override', 'size-adjust', 'src'],
    )
    assert.equal(face.src, 'local(Arial)')
    assert.equal(normalizePercent(face['ascent-override']), normalizePercent(expected.ascent))
    assert.equal(normalizePercent(face['descent-override']), normalizePercent(expected.descent))
    assert.equal(normalizePercent(face['line-gap-override']), normalizePercent(expected.lineGap))
    assert.equal(normalizePercent(face['size-adjust']), normalizePercent(expected.sizeAdjust))
  }

  const allowedFallbacks = new Set(EXPECTED_FALLBACKS.map(({ family }) => family))
  for (const face of faces) {
    const family = unquote(face['font-family'] ?? '')
    if (/fallback$/i.test(family)) {
      assert(allowedFallbacks.has(family), `unexpected automatic fallback face emitted: ${family}`)
    }
  }

  for (const definition of EXPECTED_DEFINITIONS) {
    if (definition.variable) {
      assert.match(
        css,
        new RegExp(
          `${definition.variable.replaceAll('-', '\\-')}:['"]?${definition.exportName}['"]?,${definition.fallback}(?:;|})`,
        ),
        `${definition.exportName} variable must put its unique named fallback second`,
      )
    } else {
      assert.match(
        css,
        new RegExp(`font-family:${definition.exportName},${definition.fallback}(?:;|})`),
        'preview Inter wrapper must put its unique named fallback second',
      )
    }
  }
}

const checkBuiltManifests = () => {
  const fontManifest = JSON.parse(readFileSync(path.join(BUILD_ROOT, 'server/next-font-manifest.json'), 'utf8'))
  assert.deepEqual(fontManifest.pages, {})
  assert.equal(fontManifest.appUsingSizeAdjust, false)
  assert.equal(fontManifest.pagesUsingSizeAdjust, false)
  const appEntries = Object.entries(fontManifest.app)
  assert.equal(appEntries.length, 1, 'one root layout must own all local font emissions')
  assert.match(appEntries[0][0], /\/app\/layout$/)
  const expectedMediaByHash = new Map(
    collectFiles(path.join(BUILD_ROOT, 'static/media'), (candidate) => candidate.endsWith('.woff2')).map(
      (absolutePath) => [sha256(readFileSync(absolutePath)), `static/media/${path.basename(absolutePath)}`],
    ),
  )
  assert.deepEqual(
    appEntries[0][1].sort(),
    [
      expectedMediaByHash.get(EXPECTED_ASSETS[0].sha256),
      expectedMediaByHash.get(EXPECTED_ASSETS[1].sha256),
      expectedMediaByHash.get(EXPECTED_ASSETS[2].sha256),
      expectedMediaByHash.get(EXPECTED_ASSETS[2].sha256),
    ].sort(),
    'the font manifest must retain root roles plus a distinct preview Inter role',
  )

  const appBuildManifest = JSON.parse(readFileSync(path.join(BUILD_ROOT, 'app-build-manifest.json'), 'utf8'))
  for (const route of ['/layout', '/careers/page', '/event-preview/page', '/trip-preview/page']) {
    assert(Array.isArray(appBuildManifest.pages?.[route]), `${route} must remain in the app build manifest`)
  }
  const layoutCss = appBuildManifest.pages['/layout'].filter((entry) => entry.endsWith('.css'))
  assert(layoutCss.length > 0, 'root layout must publish compiled font CSS')
  assert(
    layoutCss.some((relativePath) => readFileSync(path.join(BUILD_ROOT, relativePath), 'utf8').includes('previewInter')),
    'the inherited layout CSS must expose the distinct preview family topology',
  )
}

const checkBuiltForbiddenHosts = () => {
  const hostPattern = /(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\.?/i
  for (const absolutePath of collectFiles(BUILD_ROOT, (candidate) =>
    /\.(?:css|js|json|html|txt)$/.test(candidate),
  )) {
    assert.doesNotMatch(
      readFileSync(absolutePath, 'utf8'),
      hostPattern,
      `${path.relative(BUILD_ROOT, absolutePath)} must not retain a Google Fonts endpoint`,
    )
  }
}

const checks = {
  transports: checkDenialTransports,
  topology: checkSourceTopology,
  'forbidden-hosts': checkForbiddenProductionHosts,
  'source-binaries': checkSourceBinariesAndLicenses,
  assets: checkSourceAssetsAndLicenses,
  routing: checkPackageRouting,
  'built-assets': checkBuiltAssets,
  'built-css': checkBuiltCss,
  'built-manifests': checkBuiltManifests,
  'built-hosts': checkBuiltForbiddenHosts,
}

const probe = process.argv.find((argument) => argument.startsWith('--probe='))?.slice('--probe='.length)
let selected
if (probe) {
  assert(Object.hasOwn(checks, probe), `unknown probe ${probe}`)
  selected = [probe]
} else if (process.argv.includes('--built-only')) {
  selected = ['built-assets', 'built-css', 'built-manifests', 'built-hosts']
} else {
  selected = ['transports', 'topology', 'forbidden-hosts', 'assets', 'routing']
}

for (const name of selected) {
  checks[name]()
  console.log(`PASS #3548 tester ${name}`)
}
