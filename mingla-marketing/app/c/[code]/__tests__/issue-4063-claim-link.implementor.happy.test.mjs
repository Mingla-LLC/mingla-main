import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const route = readFileSync(join(here, '..', 'page.tsx'), 'utf8')
const client = readFileSync(join(here, '..', 'ClaimLinkClient.tsx'), 'utf8')
const copy = readFileSync(join(here, '..', 'copy.ts'), 'utf8')
const registry = readFileSync(join(here, '..', '..', '..', '..', 'lib', 'search', 'route-registry.ts'), 'utf8')
const transport = readFileSync(join(here, '..', '..', '..', '..', 'lib', 'claim-link-client.ts'), 'utf8')

assert.match(route, /dynamic = 'force-dynamic'/)
assert.match(route, /publicNoindexMetadata\('\/c'/)
assert.match(route, /<ClaimLinkClient code=\{code\} platform=\{platform\} \/>/)
assert.doesNotMatch(route, /startsAt|emailMasked|phoneLast4|orderLabel/)

assert.match(client, /resolveClaimLink\(code, controller\.signal\)/)
assert.match(client, /window\.location\.replace\(result\.url\)/)
assert.match(client, /router\.replace\(`\/c\/\$\{result\.claim\.redirectCode\}`\)/)
assert.match(client, /mintClaimLinkHandoff\(code\)/)
assert.match(client, /value=\{state\.handoffUrl\}/)
assert.doesNotMatch(client, /qrPayload|ticketQr|TicketQr/)

assert.match(copy, /Your ticket is in the Mingla app/)
assert.match(copy, /This is not your ticket\. It works once, for 10 minutes\./)
assert.match(copy, /Sign in with the email or mobile number you used\./)
assert.match(copy, /Get my tickets/)

assert.match(transport, /\{ op: 'resolve', code \}/)
assert.match(transport, /\{ op: 'handoff', code \}/)
assert.match(transport, /cache: 'no-store'/)
assert.match(registry, /\['\/c', 'claim-link-family'\]/)

console.log('issue-4063 claim-link landing contract: PASS')
