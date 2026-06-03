#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1028 §F.1 — launch-city gate happy-path regression runner.
 *
 * Wraps the Node-built-in-test-runner unit test (this app has no jest) and
 * surfaces a single pass/fail exit code for CI. Asserts the gate decision core
 * (in-city → frictionless, out-of-city → must-pick) and the override write
 * key-set (exactly custom_lat/lng/location + use_gps_location:false, never
 * discover_city_* — I-1028-ONE-LOCATION-OWNER).
 *
 * Usage: npm run test:orch-1028
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '../..')
const testFile = 'src/hooks/__tests__/useLaunchCityGate.test.ts'

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', testFile],
  { cwd: appRoot, stdio: 'inherit' }
)

if (result.status !== 0) {
  console.error('\nFAIL [ORCH-1028]: launch-city gate happy-path test did not pass.')
  process.exit(1)
}
console.log('\nPASS [ORCH-1028]: launch-city gate happy-path test green.')
process.exit(0)
