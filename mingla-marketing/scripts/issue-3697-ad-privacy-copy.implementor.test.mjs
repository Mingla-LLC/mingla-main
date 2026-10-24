import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'privacyContent.ts'), 'utf8')

for (const provider of [
  'Meta Pixel and Conversions API',
  'Snap Pixel and Conversions API',
  'TikTok Pixel and Events API',
]) assert.match(source, new RegExp(provider), `${provider} disclosure is missing`)

for (const shared of [
  'hashed email and phone numbers',
  'page and purchase events',
  'device and browser data',
]) assert.match(source, new RegExp(shared), `${shared} disclosure is missing`)

assert.match(source, /measure and improve our ads and to show people relevant events/)
assert.match(source, /banner or the “Ad privacy choices” link in the page footer/)
assert.match(source, /Opting out stops the advertising pixels and suppresses server-side conversion sharing/)
assert.doesNotMatch(
  source,
  /We do not share your personal information with third parties for their independent advertising or marketing purposes/,
  'the policy still contradicts the ad-provider sharing disclosure',
)

process.stdout.write('PASS #3697 privacy policy names ad providers, shared data, purpose and opt-out\n')
