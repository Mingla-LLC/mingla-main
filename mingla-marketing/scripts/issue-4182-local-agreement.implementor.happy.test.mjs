import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
const content = await import(pathToFileURL(new URL('lib/localAgreementContent.ts', root).pathname))
const page = readFileSync(new URL('app/local-agreement/page.tsx', root), 'utf8')
const source = readFileSync(new URL('lib/localAgreementContent.ts', root), 'utf8')

assert.equal(content.LOCAL_AGREEMENT_STATUS, 'Effective 29 October 2026')
assert.equal(content.LOCAL_AGREEMENT_VERSION, 'local-ng-1.0')
assert.equal(content.LOCAL_AGREEMENT_SECTIONS.length, 18)
assert.match(page, /Agreement fingerprint/)
assert.match(page, /robots:\s*\{\s*index:\s*true/)
assert.doesNotMatch(page, /review copy|must not invite a Local/i)

const required = [
  'Only you can accept this agreement',
  'place does not choose, approve, pay for or veto your review',
  'place card in your Mingla swipeable deck',
  'invite Mingla’s designated official account as a collaborator',
  'place’s expanded card',
  'paid or organic marketing',
  'monthly fee',
  'withholding tax',
  'independent contractor',
  'Nigeria Data Protection Act 2023',
  'Arbitration and Mediation Act 2023',
  'typed legal name, the agreement version, its fingerprint',
]
for (const phrase of required) assert.ok(source.includes(phrase), `missing required agreement term: ${phrase}`)
assert.doesNotMatch(source, /Disclose the paid visit/i)

const digest = createHash('sha256').update(content.localAgreementCanonicalText()).digest('hex')
assert.equal(content.LOCAL_AGREEMENT_SHA256, digest, 'published fingerprint must match the exact canonical agreement')

process.stdout.write(`PASS #4182 complete published Local agreement ${content.LOCAL_AGREEMENT_VERSION} · ${digest}\n`)
