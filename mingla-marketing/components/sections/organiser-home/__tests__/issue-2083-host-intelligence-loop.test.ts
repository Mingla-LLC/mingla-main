import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
const source = readFileSync(
  resolve(root, 'components/sections/organiser-home/what-is-mingla.tsx'),
  'utf8',
)

assert.match(source, /What is Mingla\?/)
assert.match(source, /We make real life/)
assert.match(source, /AriInput/)
assert.match(source, /Stepper/)
assert.match(source, /Mingla AI brain/)
assert.match(source, /Drive qualified discovery/)

assert.match(source, /useInView\(sectionRef, \{ once: true/)
assert.match(source, /STEP_DURATION_MS/)
assert.doesNotMatch(source, /useScroll|useMotionValueEvent|scrollYProgress|lg:min-h-\[180vh\]|lg:sticky/)
assert.match(source, /useMinglaReducedMotion/)

assert.doesNotMatch(source, /The places with the most soul are often the hardest to find/)
assert.doesNotMatch(source, /Grow on autopilot/)

console.log('issue #2083 Host intelligence loop contract: PASS')
