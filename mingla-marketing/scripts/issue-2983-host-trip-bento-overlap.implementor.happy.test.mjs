#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const page = read('app/host/page.tsx')
const grid = read('components/ui/aurora-bento-grid.tsx')
const bentoContent = read('lib/design-preview/host-bento.ts')
const packageJson = JSON.parse(read('package.json'))

assert.equal(
  (page.match(/<BentoGrid className="mt-14 lg:auto-rows-\[15\.5rem\] xl:auto-rows-\[14rem\]">/g) ?? []).length,
  1,
  'the Host page must give the compact-desktop bento rows enough vertical room exactly once',
)
assert.match(
  grid,
  /grid grid-cols-1 gap-4 lg:grid-cols-6 lg:auto-rows-\[14rem\]/,
  'the shared BentoGrid primitive must retain its default sizing contract',
)
assert.match(page, /<HostFigure id=\{card\.id\} \/>/, 'Host figures must remain visible')
assert.match(page, /mt-6 flex flex-wrap gap-2/, 'Host capability chips must keep their standard spacing and wrapping')
assert.match(
  page,
  /card\.id === 'trips' && 'mt-7 sm:mt-6'/,
  'only the Trips chip row must gain the narrow-screen spacing needed to clear its figure',
)
assert.match(page, /\{card\.points\.map\(\(p\) => \(/, 'all Host capability chips must remain rendered')
assert.match(bentoContent, /id: 'trips'[\s\S]*points: \['Group chat', 'Instalments', 'Itineraries'\]/)
assert.match(bentoContent, /id: 'trips'[\s\S]*span: 'lg:col-span-2 lg:row-span-2'/)
assert.match(
  packageJson.scripts.build,
  /issue-2983-host-trip-bento-overlap\.implementor\.happy\.test\.mjs/,
  'the overlap regression contract must run in the production build gate',
)

process.stdout.write('PASS #2983 Host Trips bento reserves compact-desktop space without hiding content\n')
