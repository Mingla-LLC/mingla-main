#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = path.basename(fileURLToPath(import.meta.url))
const SHELL_SELECTOR = '.city-hub-root > [data-cutout] > .cut-shell'
const NAV_SELECTOR = ".page-system-root.city-hub-root[data-host-acquisition='true'] .ps-nav"

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function blocksFor(css, selector) {
  const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'g')
  return [...css.matchAll(pattern)].map((match) => match[1])
}

const css = withoutComments(read('components/cities/city-hubs.css'))
const shellBlocks = blocksFor(css, SHELL_SELECTOR)
assert(shellBlocks.length > 0, 'the direct city Cutout shell selector must remain present')
assert(shellBlocks.some((block) => /(?:^|;)\s*position:\s*static\s*(?:;|$)/.test(block)),
  'the direct city shell must preserve position: static')
assert.equal(shellBlocks.filter((block) => /(?:^|;)\s*display:\s*flow-root\s*(?:;|$)/.test(block)).length, 1,
  'the direct city shell must establish exactly one flow-root formatting context')

const lifecycleBlocks = blocksFor(css, '.city-lifecycle-notice')
assert(lifecycleBlocks.length > 0, 'the lifecycle notice styling must remain present')
const lifecycleOwner = lifecycleBlocks[0]
assert.match(lifecycleOwner, /margin:\s*calc\(var\(--city-host-bar-height\) \+ 84px\) auto 0\s*;/,
  'the existing lifecycle notice offset must remain the sole header-clearance owner')
assert.doesNotMatch(lifecycleOwner, /(?:^|;)\s*(?:margin-top|padding-top|position|top|transform|translate):/,
  'the lifecycle notice must not gain a compensating offset workaround')

const navBlocks = blocksFor(css, NAV_SELECTOR)
assert.equal(navBlocks.length, 1, 'the city navigation must keep one positioning owner')
assert.match(navBlocks[0], /position:\s*absolute\s*;/, 'the city navigation must keep scrolling naturally')
assert.match(navBlocks[0], /top:\s*calc\(var\(--city-host-bar-height\) \+ 12px\)\s*;/,
  'the city navigation must keep its existing vertical position')
assert.doesNotMatch(navBlocks[0], /(?:^|;)\s*(?:margin|margin-top|transform|translate):/,
  'the city navigation must not gain a compensating offset workaround')

const globalCutoutCss = withoutComments(read('components/cutout/cutout.css'))
const globalShellBlocks = blocksFor(globalCutoutCss, '.cut-shell')
assert(globalShellBlocks.every((block) => !/(?:^|;)\s*display:\s*flow-root\s*(?:;|$)/.test(block)),
  'flow-root must remain city-scoped instead of changing every Cutout page')

const scripts = JSON.parse(read('package.json')).scripts
assert(scripts.build.includes(`node scripts/${SELF}`),
  'the city-review spacing guard must execute in the required marketing build path')

console.log('PASS #3135 city-review spacing: the direct city shell contains header clearance without moving the notice or navigation')
