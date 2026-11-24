// issue #4508 1.17 / 1.18 — the RSVP guest link without the app.
// Run: node --experimental-strip-types "app/c/[code]/__tests__/issue-4508-rsvp-guest-landing.implementor.happy.test.mjs"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, '..', 'ClaimLinkClient.tsx'), 'utf8')
const landing = readFileSync(join(here, '..', 'RsvpGuestLanding.tsx'), 'utf8')
const transportPath = join(here, '..', '..', '..', '..', 'lib', 'rsvp-guest-client.ts')
const transport = readFileSync(transportPath, 'utf8')
const { parseRsvpGuestLanding } = await import(pathToFileURL(transportPath).href)

// The /c/ page asks claim-link both questions and shows the guest landing first.
assert.match(client, /resolveRsvpGuest\(code, controller\.signal\)/)
assert.match(client, /<RsvpGuestLanding code=\{code\} guest=\{rsvpGuest\} platform=\{platform\} \/>/)
assert.match(transport, /\{ op: 'rsvp_guest_resolve', code \}/)
assert.match(transport, /\{ op: 'rsvp_guest_release', code \}/)
assert.match(transport, /cache: 'no-store'/)

// Exact spec copy (1.17) and the three buttons.
assert.match(landing, /saved you a spot/)
assert.match(landing, /Your pass is in the Mingla app\./)
assert.match(landing, /Get the app and your pass/)
assert.match(landing, /I already have Mingla/)
assert.match(landing, /This isn't me/)
// "This isn't me" asks before releasing (no accidental release).
assert.match(landing, /notMeConfirm/)

// Parsing: open guest, not a guest (ticket links fall through), errors.
const open = parseRsvpGuestLanding({
  ok: true,
  status: 'open',
  inviterName: 'Ada O.',
  inviterFirstName: 'Ada',
  phoneLast4: '4567',
  event: { title: 'Rooftop Sessions', startsAt: '2028-11-22T20:00:00Z', timezone: 'Africa/Lagos' },
  appLink: { oneLink: 'https://go.usemingla.com/w36m/rsvp?x=1', appScheme: 'com.mingla.app.v2://c/AB12CD34EF' },
})
assert.equal(open.kind, 'guest')
assert.equal(open.guest.inviterName, 'Ada O.')
assert.equal(open.guest.appLink.appScheme, 'com.mingla.app.v2://c/AB12CD34EF')
assert.deepEqual(parseRsvpGuestLanding({ ok: true, status: 'not_found' }), { kind: 'not_guest' })
assert.deepEqual(parseRsvpGuestLanding({ ok: false, error: 'unavailable' }), { kind: 'error' })
assert.deepEqual(parseRsvpGuestLanding({ ok: true, status: 'weird' }), { kind: 'error' })
const released = parseRsvpGuestLanding({ ok: true, status: 'released' })
assert.equal(released.kind, 'guest')
assert.equal(released.guest.appLink, null)

// C5: the public cover is shown; anything that is not an https URL is dropped.
const withCover = parseRsvpGuestLanding({
  ok: true, status: 'open', inviterName: 'Ada O.',
  event: { title: 'Rooftop Sessions', coverImageUrl: 'https://cdn.example.test/cover.jpg' },
})
assert.equal(withCover.guest.event.coverImageUrl, 'https://cdn.example.test/cover.jpg')
const badCover = parseRsvpGuestLanding({
  ok: true, status: 'open', inviterName: 'Ada O.',
  event: { title: 'X', coverImageUrl: 'javascript:alert(1)' },
})
assert.equal(badCover.guest.event.coverImageUrl, null)
assert.equal(open.guest.event.coverImageUrl, null)
assert.match(landing, /guest\.event\.coverImageUrl \? \(/)

console.log('issue-4508 RSVP guest landing: PASS')
