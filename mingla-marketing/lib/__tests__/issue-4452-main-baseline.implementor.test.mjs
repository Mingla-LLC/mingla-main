// #4452 rework 2 (P3-C): the TR-1 baseline loader.
//   MB-1 a resolve error while compiling origin/main's views skips the comparison and logs why
//   MB-2 a non-resolve error (a real bug) is rethrown, never swallowed
//   MB-3 when every view loads, the modules are returned and nothing is logged
//   MB-4 the TR-1 test uses the loader, and TR-1b (the written-out order) is not skippable
// FAILS-ON-REVERT: removing the isResolveError branch fails MB-1; swallowing every error fails MB-2;
// putting a skip on TR-1b fails MB-4.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { isResolveError, loadMainViews } from './issue-4452-main-baseline.mjs'

const VIEWS = { venues: ['a.tsx', 'A'], events: ['b.tsx', 'B'] }

test('MB-1 a resolve error skips the origin/main comparison with a clear log line', () => {
  const lines = []
  const boom = new Error('tsx-render: cannot resolve @mingla/shared-ui/index')
  const r = loadMainViews({ load: () => { throw boom } }, VIEWS, (l) => lines.push(l))
  assert.ok(r.skip && !r.modules)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^TR-1: skipping the origin\/main order comparison/)
  assert.match(lines[0], /cannot resolve @mingla\/shared-ui/)
  assert.match(lines[0], /TR-1b .* still runs/)
  const nm = Object.assign(new Error("Cannot find module '@mingla/x'"), { code: 'MODULE_NOT_FOUND' })
  assert.ok(loadMainViews({ load: () => { throw nm } }, VIEWS, () => {}).skip)
})

test('MB-2 any other error is rethrown', () => {
  assert.throws(() => loadMainViews({ load: () => { throw new TypeError('x is not a function') } }, VIEWS, () => {}), TypeError)
  assert.equal(isResolveError(new Error('boom')), false)
  assert.equal(isResolveError(null), false)
})

test('MB-3 every view loads: modules returned, no log', () => {
  const lines = []
  const r = loadMainViews({ load: (f) => ({ A: 'viewA', B: 'viewB' }) }, VIEWS, (l) => lines.push(l))
  assert.deepEqual(r.modules, { venues: 'viewA', events: 'viewB' })
  assert.equal(r.skip, undefined)
  assert.deepEqual(lines, [])
})

test('MB-4 TR-1 uses the loader and TR-1b still runs unconditionally', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'issue-4452-tool-reports.implementor.test.mjs'), 'utf8')
  assert.match(src, /loadMainViews\(MAIN, VIEWS\)/)
  assert.match(src, /test\('TR-1 SC-141[^\n]*\{ skip: MAIN_VIEWS\.skip \?\? false \}/)
  assert.match(src, /test\('TR-1b the redesigned order, written out \(the binding list in §6\.7\)', \(\) =>/, 'TR-1b has no skip option')
  assert.match(src, /assert\.deepEqual\(sections\(renderNew\('venues', VENUE\)\)/, 'TR-1b still asserts the written-out order')
})
