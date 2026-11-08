#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const page = read('app/host/page.tsx')
const grid = read('components/ui/aurora-bento-grid.tsx')
const tripPlan = read('components/ui/trip-plan-card.tsx')
const cutoutCss = read('components/cutout/cutout.css')
const bentoContent = read('lib/design-preview/host-bento.ts')
const packageJson = JSON.parse(read('package.json'))

// #4339 phase 2a: /host was replaced in place by the approved redesign
// (components/site/host-page.tsx) and no longer mounts the capability bento.
// The page-level pins (row heights, figures, chip spacing) are retired; the
// shared bento primitives below still guard the components that remain.
assert.doesNotMatch(page + read('components/site/host-page.tsx'), /<BentoGrid\b|<HostFigure\b/, '#4339: /host no longer mounts the bento')
assert.match(page, /<HostPage \/>/, '#4339: /host renders the redesigned page')
assert.match(
  grid,
  /grid grid-cols-1 gap-4 lg:grid-cols-6 lg:auto-rows-\[14rem\]/,
  'the shared BentoGrid primitive must retain its default sizing contract',
)
assert.match(grid, /cut-host-bento-card/, 'the Host bento card must expose its reduced-motion first-paint fallback')
assert.match(tripPlan, /useMinglaReducedMotion/, 'the Trips figure must use the marketing reduced-motion source of truth')
assert.match(tripPlan, /cut-host-trip-figure/, 'the Trips figure must expose its reduced-motion first-paint fallback')
assert.match(
  cutoutCss,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cut-host-bento-card, \.cut-host-trip-figure \{[\s\S]*opacity: 1 !important;[\s\S]*transform: none !important;/,
  'reduced motion must force the Host bento and Trips figure visible without a hydration race',
)
assert.match(bentoContent, /id: 'trips'[\s\S]*points: \['Group chat', 'Instalments', 'Itineraries'\]/)
assert.match(bentoContent, /id: 'trips'[\s\S]*span: 'lg:col-span-2 lg:row-span-2'/)
assert.match(
  packageJson.scripts.build,
  /issue-2983-host-trip-bento-overlap\.implementor\.happy\.test\.mjs/,
  'the overlap regression contract must run in the production build gate',
)

process.stdout.write('PASS #2983 Host Trips bento reserves compact-desktop space without hiding content\n')
