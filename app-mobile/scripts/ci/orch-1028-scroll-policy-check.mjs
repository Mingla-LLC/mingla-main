#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1028 REWORK §F-1/F-2 — responsive onboarding scroll-policy regression runner.
 *
 * Wraps the Node-built-in-test-runner unit test (this app has no jest) and surfaces a
 * single pass/fail exit code for CI. Guards the QA fix: `gender_identity` + `intents`
 * become scroll-enabled on short viewports (iPhone SE 3) so their last option/subtitle
 * clears the fixed bottom CTA bar, while staying non-scrollable on tall screens
 * (no large-screen regression).
 *
 * Usage: npm run test:orch-1028-scroll
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '../..')
const testFile = 'src/components/onboarding/__tests__/onboardingScrollPolicy.test.ts'

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', testFile],
  { cwd: appRoot, stdio: 'inherit' }
)

if (result.status !== 0) {
  console.error('\nFAIL [ORCH-1028]: onboarding scroll-policy regression test did not pass.')
  process.exit(1)
}
console.log('\nPASS [ORCH-1028]: onboarding scroll-policy regression test green.')
process.exit(0)
