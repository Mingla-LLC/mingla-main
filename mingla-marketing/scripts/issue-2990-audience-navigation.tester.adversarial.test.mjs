#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const sideMenu = read('components/ui/side-menu.tsx')
const packageJson = JSON.parse(read('package.json'))

const panelStart = sideMenu.indexOf('<motion.div\n            ref={panelRef}')
const panelEnd = sideMenu.indexOf('className={cn(', panelStart)
assert(panelStart >= 0 && panelEnd > panelStart,
  'SideMenu must retain a separately inspectable animated dialog panel')

const panelMotionProps = sideMenu.slice(panelStart, panelEnd)
const reducedPanelTransition =
  /transition=\{reduced\s*\?\s*\{\s*duration:\s*0\s*\}\s*:/s.test(panelMotionProps)
  || /transition=\{\{[\s\S]*duration:\s*reduced\s*\?\s*0\s*:/s.test(panelMotionProps)

assert.equal(
  reducedPanelTransition,
  true,
  'reduced-motion SideMenu panel must enter and exit with an explicit zero-duration transition; a shared spring is not motion-safe',
)

assert.match(
  panelMotionProps,
  /initial=\{reduced\s*\?\s*false\s*:/,
  'reduced-motion SideMenu panel must mount in its complete final position',
)

const guardCommand = 'node scripts/issue-2990-audience-navigation.tester.adversarial.test.mjs'
assert(
  packageJson.scripts.build.includes(guardCommand),
  'production build must enforce the tester reduced-motion navigation guard',
)
assert.equal(
  packageJson.scripts['posttest:page-system'],
  guardCommand,
  'focused page-system QA must enforce the tester reduced-motion navigation guard',
)

process.stdout.write('PASS issue #2990 audience navigation tester reduced-motion adversarial guard\n')
