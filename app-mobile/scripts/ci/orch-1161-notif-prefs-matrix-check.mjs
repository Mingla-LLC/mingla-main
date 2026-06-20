#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1161 Sub-A — notification-prefs matrix happy-path regression runner.
 *
 * Wraps the Node-built-in-test-runner unit test (this app has no jest) and
 * surfaces a single pass/fail exit code for CI. Asserts the decision core:
 *  - a toggle writes the correct notification_channel_prefs upsert (true/false);
 *  - the SMS chip renders ONLY for sms-eligible categories
 *    (I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES);
 *  - effective state = coalesce(pref.enabled, default); locked chips write nothing.
 *
 * Usage: npm run test:orch-1161
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '../..')
const testFile =
  'src/components/profile/__tests__/notificationPrefsMatrix.orch1161.test.ts'

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', testFile],
  { cwd: appRoot, stdio: 'inherit' }
)

if (result.status !== 0) {
  console.error('\nFAIL [ORCH-1161]: notification-prefs matrix happy-path test did not pass.')
  process.exit(1)
}
console.log('\nPASS [ORCH-1161]: notification-prefs matrix happy-path test green.')
process.exit(0)
