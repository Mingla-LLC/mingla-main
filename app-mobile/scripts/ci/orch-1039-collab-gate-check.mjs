#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1039 §8 — onboarding collaboration-step hide-gate happy-path runner.
 *
 * Wraps the Node-built-in-test-runner unit test (this app has no jest) and
 * surfaces a single pass/fail exit code for CI. Asserts the sequencing decision
 * core (onboardingSequenceLogic.ts): Step 6 (collaborations) is omitted when
 * hasCollabContext is false and present when true, and goNext/goBack/resume all
 * skip the hidden step correctly while progress never goes NaN.
 *
 * Usage: npm run test:orch-1039
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '../..')
// Happy-path (implementor) + adversarial (tester, T-12 resume-empty regression).
// The adversarial test guards the rework fix: a resume at a now-hidden Step 6
// must advance to Step 7, never strand on the hollow placeholder.
const testFiles = [
  'src/hooks/__tests__/onboardingCollabGate.test.ts',
  'src/hooks/__tests__/onboardingCollabGate.adversarial.test.ts',
]

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', ...testFiles],
  { cwd: appRoot, stdio: 'inherit' }
)

if (result.status !== 0) {
  console.error('\nFAIL [ORCH-1039]: collab-step hide-gate test(s) did not pass.')
  process.exit(1)
}
console.log('\nPASS [ORCH-1039]: collab-step hide-gate happy-path + adversarial tests green.')
process.exit(0)
