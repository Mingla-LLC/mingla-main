// #4640 — a short paid-Host form hands off to Mingla's scheduler without PII
// in the URL, and every scheduler profile uses the same future-safe routes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('#4640 the form redirect carries only a profile key and opaque handoff token', () => {
  const renderer = read('components/forms/form-renderer.tsx')
  assert.match(renderer, /next\.searchParams\.set\('profile', outcome\.schedulerKey\)/)
  assert.match(renderer, /next\.searchParams\.set\('handoff', outcome\.handoffToken\)/)
  for (const pii of ['name', 'email', 'phone', 'venue', 'answers']) {
    assert.doesNotMatch(renderer, new RegExp(`next\\.searchParams\\.set\\('${pii}'`))
  }
  assert.match(renderer, /form\.audience === 'creator'[\s\S]*form\.audience === 'local'/)
});

test('#4640 the scheduler hydrates server-saved answers and requires phone for every audience', () => {
  const client = read('app/schedule/ScheduleClient.tsx')
  const transport = read('lib/booking-call.ts')
  assert.match(client, /fetchBookingHandoff\(handoffToken, schedulerKey\)/)
  for (const setter of ['setName', 'setEmail', 'setPhone', 'setIcp', 'setSocialPlatform', 'setSocialHandle']) {
    assert.match(client, new RegExp(`${setter}\\(p\\.`))
  }
  assert.match(client, /Your phone[\s\S]*data-field="phone"[\s\S]*required/)
  assert.match(client, /phone: phone\.trim\(\)/)
  assert.match(transport, /export interface BookCallExtras \{\s+phone: string/)
});

test('#4640 route aliases select stable profiles while future keys remain data', () => {
  // #4636: /schedule renders the registry block `scheduler`, which carries the key.
  assert.match(read('app/schedule/page.tsx'), /<SchedulerBlock\b/)
  assert.match(read('components/site-blocks/sections/scheduler-block.tsx'), /schedulerKey="host-demo"/)
  const programs = read('app/schedule/ProgramCallPage.tsx')
  assert.match(programs, /audience === 'creator' \? 'creator-call' : 'local-call'/)
  assert.match(read('app/schedule/ScheduleClient.tsx'), /scheduler_key: schedulerKey/)
});
