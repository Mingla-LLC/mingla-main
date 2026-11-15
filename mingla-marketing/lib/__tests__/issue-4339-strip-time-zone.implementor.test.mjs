// #4339 — a /links strip shows only within its dates, in its own time zone.
//
// I-4339-LINKS-STRIP-WINDOW (website side): the database owns the window
// (links_strip_window) and links_page_strips() sends it as starts_at /
// ends_at; the page keeps those instants (normalisePins) and only checks
// startsAt <= now < endsAt (pinLive). It never recomputes the window, so the
// old end-only UTC-12 cut-off (LATEST_ZONE) is gone.
//
// Runs the REAL pure module (links-week) with no install.
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-strip-time-zone.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-tz-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
fs.writeFileSync(path.join(out, 'links-week.mjs'), stripTypeScriptTypes(read('lib/links-week.ts')))
const week = await import(pathToFileURL(path.join(out, 'links-week.mjs')).href)

// "Lagos: Beach Unwind 2.0" as production had it on 14 Nov: shows_on Mon 16,
// until Sat 28, Lagos time. The window links_page_strips() sends for it.
const beach = {
  id: 'beach', shows_on: '2026-11-16', shows_until: '2026-11-28', title: 'Lagos: Beach Unwind 2.0, Sat 28 Nov',
  label: 'Featured', opens: 'web', url: 'host.usemingla.com/e/apexmanager/beach-unwind-2-0', blog_slug: null, position: 1,
  time_zone: 'Africa/Lagos', starts_at: '2026-11-15T23:00:00+00:00', ends_at: '2026-11-28T23:00:00+00:00',
}

test('normalisePins keeps the server window as ISO instants', () => {
  const [pin] = week.normalisePins([beach])
  assert.equal(pin.startsAt, '2026-11-15T23:00:00.000Z')
  assert.equal(pin.endsAt, '2026-11-28T23:00:00.000Z')
})

test('a future strip is not live; it goes live at 00:00 on its first day in its zone and leaves at 00:00 after its last', () => {
  const [pin] = week.normalisePins([beach])
  // 14 Nov (the live check): dated Mon 16, so not on /links yet.
  assert.equal(week.pinLive(pin, '2026-11-14T23:43:00.000Z'), false)
  // 23:59 Sun 15 in Lagos: still not; 00:00 Mon 16 in Lagos: live.
  assert.equal(week.pinLive(pin, '2026-11-15T22:59:59.999Z'), false)
  assert.equal(week.pinLive(pin, '2026-11-15T23:00:00.000Z'), true)
  // 23:59 Sat 28 in Lagos: live; 00:00 Sun 29: gone (the end is exclusive).
  assert.equal(week.pinLive(pin, '2026-11-28T22:59:59.999Z'), true)
  assert.equal(week.pinLive(pin, '2026-11-28T23:00:00.000Z'), false)
})

test('a strip without a usable window from the server is never shown (the page does not guess one)', () => {
  const variants = [
    { starts_at: undefined, ends_at: undefined },
    { starts_at: null, ends_at: '2026-11-28T23:00:00Z' },
    { starts_at: 'soon', ends_at: '2026-11-28T23:00:00Z' },
    { starts_at: '2026-11-28T23:00:00Z', ends_at: '2026-11-15T23:00:00Z' }, // backwards
    { starts_at: '2026-11-15T23:00:00Z', ends_at: '2026-11-15T23:00:00Z' }, // empty
  ]
  for (const variant of variants) {
    const [pin] = week.normalisePins([{ ...beach, ...variant }])
    assert.equal(pin.startsAt, null, JSON.stringify(variant))
    assert.equal(pin.endsAt, null, JSON.stringify(variant))
    assert.equal(week.pinLive(pin, '2026-11-20T12:00:00.000Z'), false, JSON.stringify(variant))
  }
  assert.equal(week.pinLive(week.normalisePins([beach])[0], 'not a time'), false)
})

test('the same days in New York are a different window, and the clock change is the server’s answer', () => {
  // Sun 8 Mar 2026 in New York: 05:00Z to 04:00Z the next day (a 23-hour day).
  const [pin] = week.normalisePins([{ ...beach, shows_on: '2026-03-08', shows_until: null, time_zone: 'America/New_York',
    starts_at: '2026-03-08T05:00:00Z', ends_at: '2026-03-09T04:00:00Z' }])
  assert.equal(week.pinLive(pin, '2026-03-08T04:59:59.999Z'), false)
  assert.equal(week.pinLive(pin, '2026-03-08T05:00:00.000Z'), true)
  assert.equal(week.pinLive(pin, '2026-03-09T03:59:59.999Z'), true)
  assert.equal(week.pinLive(pin, '2026-03-09T04:00:00.000Z'), false)
})

test('/links filters with pinLive, and the old UTC-12 cut-off is gone from the source', () => {
  const page = code(read('app/links/page.tsx'))
  assert.match(page, /normalisePins\(strips\)\.filter\(\(pin\) => pinLive\(pin, nowIso\)\)/)
  const lib = code(read('lib/links-week.ts'))
  assert.doesNotMatch(lib, /LATEST_ZONE|Etc\/GMT\+12/)
  assert.match(lib, /Date\.parse\(pin\.startsAt\) <= now && now < Date\.parse\(pin\.endsAt\)/)
  assert.equal(week.LATEST_ZONE, undefined)
})
