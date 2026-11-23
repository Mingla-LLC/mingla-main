// #4571 W4 — a host card's own scheduler link (usemingla.com/schedule?for=<token>)
// passes its token through to growth-tools-book, so the booking links itself
// to that card in Admin. Nothing the booker sees changes.
//   SF-1 scheduleTokenFrom keeps a UUID (lower case) and drops anything else
//   SF-2 bookCall sends `for` in the body with the rest of the booking
//   SF-3 the page reads `for` from its URL for Host calls only and sends it only when it is a UUID
// FAILS-ON-REVERT: without scheduleTokenFrom and the pass-through, SF-1 and SF-2 fail.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import * as nodeModule from 'node:module'
import { MARKETING } from './issue-4452-ts-loader.mjs'

// booking-call.ts imports the ads context (an '@/components' module the loader
// cannot reach), so the pure helper is lifted out of the source and run alone.
const SRC = fs.readFileSync(path.join(MARKETING, 'lib/booking-call.ts'), 'utf8')
const helper = SRC.slice(SRC.indexOf('const SCHEDULE_TOKEN_RE'), SRC.indexOf('export async function bookCall('))
const js = nodeModule.stripTypeScriptTypes(helper.replace('export function', 'function'))
const bc = { scheduleTokenFrom: new Function(`${js}; return scheduleTokenFrom`)() }
const TOKEN = '45710000-0000-4000-8000-000000000001'

test('SF-1 scheduleTokenFrom keeps a UUID and drops anything else', () => {
  assert.equal(bc.scheduleTokenFrom(TOKEN), TOKEN)
  assert.equal(bc.scheduleTokenFrom(` ${TOKEN.toUpperCase()} `), TOKEN)
  for (const bad of [null, undefined, '', 'abc', `${TOKEN}0`, '<script>', '../x']) assert.equal(bc.scheduleTokenFrom(bad), undefined, String(bad))
})

test('SF-2 bookCall sends for through to growth-tools-book with the rest of the booking', () => {
  assert.match(SRC, /\n      for\?: string\n/, 'a Host call may carry for')
  const body = SRC.slice(SRC.indexOf('export async function bookCall('))
  assert.match(body, /postGrowthTools\('growth-tools-book', \{\n    action: 'book',\n    \.\.\.input,\n  \}\)/, 'the whole input, for included, is the body')
})

test('SF-3 the schedule page reads for for Host calls only, through scheduleTokenFrom', () => {
  const src = fs.readFileSync(path.join(MARKETING, 'app/schedule/ScheduleClient.tsx'), 'utf8')
  assert.match(src, /const scheduleFor = isHost \? scheduleTokenFrom\(params\.get\('for'\)\) : undefined/)
  assert.match(src, /\.\.\.\(scheduleFor \? \{ for: scheduleFor \} : \{\}\)/)
  const hostBranch = src.slice(src.indexOf('...(isHost'), src.indexOf(': {', src.indexOf('...(isHost')))
  assert.ok(hostBranch.includes('for: scheduleFor'), 'sent in the Host branch only')
})
