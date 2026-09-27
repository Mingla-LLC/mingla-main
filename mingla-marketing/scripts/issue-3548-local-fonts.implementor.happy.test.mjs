#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath, encoding = 'utf8') => readFileSync(path.join(ROOT, relativePath), encoding)
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex')

const GOOGLE_FONTS_COMMIT = '23e54b51ddffbc7713c583748e3bd86f62b1fa4a'
const EXPECTED_FALLBACKS = [
  {
    exportName: 'mochiy',
    family: 'MinglaMochiyArialFallback',
    ascent: '91.04%',
    descent: '22.60%',
    lineGap: '0.00%',
    sizeAdjust: '127.41%',
  },
  {
    exportName: 'nunito',
    family: 'MinglaNunitoArialFallback',
    ascent: '99.71%',
    descent: '34.82%',
    lineGap: '0.00%',
    sizeAdjust: '101.39%',
  },
  {
    exportName: 'inter',
    family: 'MinglaInterRootArialFallback',
    ascent: '90.44%',
    descent: '22.52%',
    lineGap: '0.00%',
    sizeAdjust: '107.12%',
  },
  {
    exportName: 'previewInter',
    family: 'MinglaInterPreviewArialFallback',
    ascent: '90.44%',
    descent: '22.52%',
    lineGap: '0.00%',
    sizeAdjust: '107.12%',
  },
]
const EXPECTED_ASSETS = [
  {
    localFile: 'MochiyPopOne-latin-400-normal.woff2',
    family: 'Mochiy Pop One',
    style: 'normal',
    representedWeights: ['400'],
    subset: 'latin',
    googleFontsRepository: { commit: GOOGLE_FONTS_COMMIT, path: 'ofl/mochiypopone' },
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
  },
  {
    localFile: 'NunitoSans-latin-wght-normal.woff2',
    family: 'Nunito Sans',
    style: 'normal',
    representedWeights: ['400', '500', '600', '700'],
    subset: 'latin',
    googleFontsRepository: { commit: GOOGLE_FONTS_COMMIT, path: 'ofl/nunitosans' },
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
  },
  {
    localFile: 'Inter-latin-wght-normal.woff2',
    family: 'Inter',
    style: 'normal',
    representedWeights: ['400', '500', '600', '700', '800', '900'],
    subset: 'latin',
    googleFontsRepository: { commit: GOOGLE_FONTS_COMMIT, path: 'ofl/inter' },
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
  },
]

const productionAppFiles = []
const visit = (relativeDirectory) => {
  for (const entry of readdirSync(path.join(ROOT, relativeDirectory))) {
    const relativePath = path.join(relativeDirectory, entry)
    if (statSync(path.join(ROOT, relativePath)).isDirectory()) visit(relativePath)
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) productionAppFiles.push(relativePath)
  }
}
visit('app')

for (const relativePath of productionAppFiles) {
  assert.doesNotMatch(
    read(relativePath),
    /next\/font\/google|\b(?:Mochiy_Pop_One|Nunito_Sans|Inter)\s*\(/,
    `${relativePath} must not construct a Google font`,
  )
}

const fontDefinition = read('app/fonts.ts')
assert.equal(
  productionAppFiles.filter((relativePath) => read(relativePath).includes('next/font/local')).join(','),
  'app/fonts.ts',
  'app/fonts.ts must be the one production local-font definition module',
)
assert.equal((fontDefinition.match(/localFont\s*\(/g) ?? []).length, 4, 'exactly four local definitions must exist')

const block = (name, nextName) => {
  const start = fontDefinition.indexOf(`export const ${name} = localFont(`)
  assert.notEqual(start, -1, `${name} local definition must exist`)
  const end = nextName ? fontDefinition.indexOf(`export const ${nextName} = localFont(`, start) : fontDefinition.length
  assert.notEqual(end, -1, `${name} definition must end before ${nextName}`)
  return fontDefinition.slice(start, end)
}

const assertDefinition = ({ name, nextName, asset, weights, variable, fallback }) => {
  const source = block(name, nextName)
  assert.equal(
    (source.match(new RegExp(asset.replaceAll('.', '\\.'), 'g')) ?? []).length,
    weights.length,
    `${name} must declare one explicit source entry per approved weight`,
  )
  assert.deepEqual(
    [...source.matchAll(/weight: '(\d+)'/g)].map((match) => match[1]),
    weights,
    `${name} must preserve its exact weight contract`,
  )
  assert.equal(
    (source.match(/style: 'normal'/g) ?? []).length,
    weights.length,
    `${name} must keep every source normal-style`,
  )
  assert.match(source, /display: 'swap'/, `${name} must remain display swap`)
  assert.match(source, /preload: true/, `${name} must remain preloaded`)
  assert.equal(
    (source.match(/adjustFontFallback: false/g) ?? []).length,
    1,
    `${name} must disable Next's generated fallback exactly once`,
  )
  assert.equal(
    (source.match(/fallback:/g) ?? []).length,
    1,
    `${name} must declare exactly one explicit fallback option`,
  )
  assert.match(
    source,
    new RegExp(`fallback: \\['${fallback}'\\]`),
    `${name} must use its one-item approved fallback stack`,
  )
  assert.doesNotMatch(source, /weight:\s*'\d+ \d+'/, `${name} must not broaden to a variable weight range`)
  if (variable) assert.match(source, new RegExp(`variable: '${variable}'`), `${name} variable must remain stable`)
  else assert.doesNotMatch(source, /variable:/, `${name} must remain wrapper-only with no CSS variable`)
}

assertDefinition({
  name: 'mochiy',
  nextName: 'nunito',
  asset: 'MochiyPopOne-latin-400-normal.woff2',
  weights: ['400'],
  variable: '--font-mochiy',
  fallback: 'MinglaMochiyArialFallback',
})
assertDefinition({
  name: 'nunito',
  nextName: 'inter',
  asset: 'NunitoSans-latin-wght-normal.woff2',
  weights: ['400', '500', '600', '700'],
  variable: '--font-nunito',
  fallback: 'MinglaNunitoArialFallback',
})
assertDefinition({
  name: 'inter',
  nextName: 'previewInter',
  asset: 'Inter-latin-wght-normal.woff2',
  weights: ['400', '500', '600', '700'],
  variable: '--font-inter',
  fallback: 'MinglaInterRootArialFallback',
})
assertDefinition({
  name: 'previewInter',
  asset: 'Inter-latin-wght-normal.woff2',
  weights: ['400', '500', '600', '700', '800', '900'],
  fallback: 'MinglaInterPreviewArialFallback',
})

assert.equal(
  new Set(EXPECTED_FALLBACKS.map(({ family }) => family)).size,
  EXPECTED_FALLBACKS.length,
  'every local font role must keep a unique named fallback identity',
)

const expectedGlobalsPreamble = `@import "tailwindcss";
@import "tw-animate-css";

${EXPECTED_FALLBACKS.map(
  ({ family, ascent, descent, lineGap, sizeAdjust }) => `@font-face {
  font-family: "${family}";
  src: local("Arial");
  ascent-override: ${ascent};
  descent-override: ${descent};
  line-gap-override: ${lineGap};
  size-adjust: ${sizeAdjust};
}`,
).join('\n\n')}

`
const globalsCss = read('app/globals.css')
assert.equal(
  globalsCss.slice(0, globalsCss.indexOf('@theme inline')),
  expectedGlobalsPreamble,
  'globals.css must keep only the four exact approved fallback faces between its imports and @theme',
)

const layout = read('app/layout.tsx')
const eventPreview = read('app/event-preview/page.tsx')
const tripPreview = read('app/trip-preview/page.tsx')
assert.match(layout, /import \{ inter, mochiy, nunito \} from '\.\/fonts'/)
assert.match(layout, /<html lang="en" className=\{`\$\{mochiy\.variable\} \$\{nunito\.variable\} \$\{inter\.variable\}`\}>/)
for (const [name, source] of [
  ['event preview', eventPreview],
  ['trip preview', tripPreview],
]) {
  assert.match(source, /import \{ previewInter \} from '@\/app\/fonts'/, `${name} must share preview Inter`)
  assert.match(source, /<div className=\{previewInter\.className\}>/, `${name} must retain wrapper class placement`)
  assert.doesNotMatch(source, /const previewInter|next\/font/, `${name} must not own another font constructor`)
}

const manifest = JSON.parse(read('app/fonts/SOURCES.json'))
assert.deepEqual(manifest, {
  schemaVersion: 1,
  investigationDate: '2026-09-27',
  assets: EXPECTED_ASSETS.map(({ oflSha256: _oflSha256, ...asset }) => asset),
})
for (const asset of EXPECTED_ASSETS) {
  const binary = read(`app/fonts/${asset.localFile}`, null)
  assert.equal(binary.byteLength, asset.byteLength, `${asset.localFile} byte length must stay pinned`)
  assert.equal(sha256(binary), asset.sha256, `${asset.localFile} SHA-256 must stay pinned`)
  const license = read(`app/fonts/${asset.oflFile}`, null)
  assert(license.byteLength > 0, `${asset.oflFile} must be present and nonempty`)
  assert.equal(sha256(license), asset.oflSha256, `${asset.oflFile} must match the pinned Google Fonts OFL`)
}

const packageJson = JSON.parse(read('package.json'))
const packageLock = JSON.parse(read('package-lock.json'))
const lockRoot = packageLock.packages?.['']
assert(lockRoot, 'package-lock.json must retain its root package entry')
assert.deepEqual(
  lockRoot.dependencies ?? {},
  packageJson.dependencies ?? {},
  'package-lock root dependencies must stay consistent with package.json',
)
assert.deepEqual(
  lockRoot.devDependencies ?? {},
  packageJson.devDependencies ?? {},
  'package-lock root devDependencies must stay consistent with package.json',
)
assert(packageJson.dependencies?.next, 'the marketing app must retain Next.js')
const externalFontPackages = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
].filter((name) => /(?:fontsource|typeface|google-fonts?|next-font)/i.test(name))
assert.deepEqual(
  externalFontPackages,
  [],
  '#3548 must remain dependency-free: pinned WOFF2 assets are loaded through next/font/local',
)
assert.equal(
  packageJson.scripts['test:issue-3548'],
  'node scripts/issue-3548-local-fonts.implementor.happy.test.mjs',
  '#3548 must have a focused package test route',
)
assert.match(packageJson.scripts.prebuild, /issue-3548-local-fonts\.implementor\.happy\.test\.mjs/)
const nextBuildCommands = packageJson.scripts.build
  .split('&&')
  .map((command) => command.trim())
  .filter((command) => command.endsWith('next build'))
assert.equal(nextBuildCommands.length, 2, 'the production build route must retain exactly two next builds')
for (const command of nextBuildCommands) {
  assert.equal(
    command,
    'next build',
    'the two production next builds must retain their established guard adjacency',
  )
}
assert.match(
  packageJson.scripts.build,
  /^node scripts\/issue-2990-restructured-page-system\.implementor\.happy\.test\.mjs --source-only && next\(\) \{ node scripts\/issue-3548-deny-google-font-network\.cjs "\$@" && node scripts\/issue-3548-local-fonts\.implementor\.happy\.test\.mjs --built-only; \} && /,
  'the build shell must route both established next invocations through denial and built-font verification',
)

const sourceRoots = ['app', 'components', 'content', 'lib', 'scripts']
const sourceFiles = []
const collectSources = (relativeDirectory) => {
  for (const entry of readdirSync(path.join(ROOT, relativeDirectory))) {
    const relativePath = path.join(relativeDirectory, entry)
    if (statSync(path.join(ROOT, relativePath)).isDirectory()) collectSources(relativePath)
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs|css|json)$/.test(entry)) sourceFiles.push(relativePath)
  }
}
for (const sourceRoot of sourceRoots) collectSources(sourceRoot)
const allowedGoogleUrlFiles = new Set([
  'app/fonts/SOURCES.json',
  'scripts/issue-3548-local-fonts.implementor.happy.test.mjs',
  'scripts/issue-3548-local-fonts.tester.adversarial.test.mjs',
])
for (const relativePath of sourceFiles) {
  if (allowedGoogleUrlFiles.has(relativePath)) continue
  assert.doesNotMatch(
    read(relativePath),
    /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)(?:\/|\b)/,
    `${relativePath} must not contain a live Google Fonts endpoint`,
  )
}

const denialPath = path.join(ROOT, 'scripts/issue-3548-deny-google-font-network.cjs')
const denialSource = read('scripts/issue-3548-deny-google-font-network.cjs')
assert.match(
  denialSource,
  /process\.env\.NODE_OPTIONS = \[inheritedNodeOptions, preloadOption\]/,
  'the scoped Next runner must propagate the denial preload into build workers',
)
const denialProbe = spawnSync(
  process.execPath,
  [
    '--require',
    denialPath,
    '-e',
    `
      const assert = require('node:assert/strict');
      const http = require('node:http');
      const https = require('node:https');
      const denied = /#3548 marketing builds must use pinned local fonts/;
      assert.throws(() => http.request('http://fonts.googleapis.com/css2'), denied);
      assert.throws(() => https.request(new URL('https://fonts.gstatic.com/font.woff2')), denied);
      assert.throws(() => http.get({ hostname: 'fonts.googleapis.com', path: '/css2' }), denied);
      assert.throws(() => https.get({ host: 'fonts.gstatic.com:443', path: '/font.woff2' }), denied);
      assert.throws(() => fetch('https://fonts.googleapis.com/css2'), denied);
      assert.throws(() => fetch(new URL('https://fonts.gstatic.com/font.woff2')), denied);

      const lookalike = https.request('https://fonts.googleapis.com.evil.invalid/');
      lookalike.on('error', () => {});
      lookalike.destroy();

      const server = http.createServer((_request, response) => response.end('delegated'));
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        try {
          const response = await fetch('http://127.0.0.1:' + address.port + '/ok');
          assert.equal(await response.text(), 'delegated');
          http.get({ hostname: '127.0.0.1', port: address.port, path: '/ok' }, (localResponse) => {
            let body = '';
            localResponse.setEncoding('utf8');
            localResponse.on('data', (chunk) => { body += chunk; });
            localResponse.on('end', () => {
              try {
                assert.equal(body, 'delegated');
                server.close(() => process.exit(0));
              } catch (error) {
                console.error(error);
                server.close(() => process.exit(1));
              }
            });
          }).on('error', (error) => {
            console.error(error);
            server.close(() => process.exit(1));
          });
        } catch (error) {
          console.error(error);
          server.close(() => process.exit(1));
        }
      });
    `,
  ],
  { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
)
assert.equal(denialProbe.status, 0, `denial preload contract failed:\n${denialProbe.stderr || denialProbe.stdout}`)

if (process.argv.includes('--built-only')) {
  const builtCssFiles = []
  const collectBuiltCss = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) collectBuiltCss(absolutePath)
      else if (entry.name.endsWith('.css')) builtCssFiles.push(absolutePath)
    }
  }
  collectBuiltCss(path.join(ROOT, '.next/static/css'))
  assert(builtCssFiles.length > 0, 'the final Next artifact must contain compiled CSS')
  const builtCss = builtCssFiles.map((absolutePath) => readFileSync(absolutePath, 'utf8')).join('\n')
  const faceBlocks = [...builtCss.matchAll(/@font-face\{([^}]*)\}/g)].map((match) => match[1])
  const declarations = (cssBlock) =>
    Object.fromEntries(
      cssBlock
        .split(';')
        .filter(Boolean)
        .map((declaration) => {
          const separator = declaration.indexOf(':')
          return [declaration.slice(0, separator), declaration.slice(separator + 1)]
        }),
    )
  const unquote = (value) => value.replace(/^['"]|['"]$/g, '')

  for (const { family, ascent, descent, lineGap, sizeAdjust } of EXPECTED_FALLBACKS) {
    const matchingFaces = faceBlocks.filter((cssBlock) => {
      const parsed = declarations(cssBlock)
      return unquote(parsed['font-family'] ?? '') === family
    })
    assert.equal(matchingFaces.length, 1, `${family} must appear exactly once in compiled CSS`)
    const parsed = declarations(matchingFaces[0])
    assert.deepEqual(
      Object.keys(parsed).sort(),
      ['ascent-override', 'descent-override', 'font-family', 'line-gap-override', 'size-adjust', 'src'],
      `${family} compiled descriptor names must remain exact and complete`,
    )
    assert.equal(unquote(parsed['font-family']), family, `${family} compiled family name must remain exact`)
    assert.equal(parsed.src, 'local(Arial)', `${family} must compile to local Arial`)
    for (const [descriptor, expected] of [
      ['ascent-override', ascent],
      ['descent-override', descent],
      ['line-gap-override', lineGap],
      ['size-adjust', sizeAdjust],
    ]) {
      assert.equal(
        Number.parseFloat(parsed[descriptor]),
        Number.parseFloat(expected),
        `${family} ${descriptor} must retain its exact numeric percentage through CSS minification`,
      )
    }
  }

  for (const cssBlock of faceBlocks) {
    const family = unquote(declarations(cssBlock)['font-family'] ?? '')
    assert.doesNotMatch(
      family,
      /^(?:mochiy|nunito|inter|previewInter) Fallback$/,
      'compiled CSS must not contain a Next-generated adjusted fallback face',
    )
  }

  for (const { exportName, family } of EXPECTED_FALLBACKS) {
    const escapedFamily = family.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const stackPattern = new RegExp(
      `font-family:${exportName},["']?${escapedFamily}["']?(?:;|})|--font-${exportName === 'previewInter' ? 'never' : exportName}:${exportName},["']?${escapedFamily}["']?(?:;|})`,
    )
    assert.match(builtCss, stackPattern, `${exportName} must compile with its exact named fallback stack`)
  }
}

console.log('PASS #3548 exact local font definitions, consumers, weights and class placement')
console.log('PASS #3548 pinned WOFF2 bytes, source manifest and exact OFL files')
console.log('PASS #3548 exact manual Arial fallback descriptors, identities and source stacks')
console.log('PASS #3548 dependency-free local fonts and both production build denials')
console.log('PASS #3548 exact-host http, https and fetch denial with non-Google delegation')
if (process.argv.includes('--built-only')) {
  console.log('PASS #3548 compiled manual fallback faces and exact named stacks with no auto fallback')
}
