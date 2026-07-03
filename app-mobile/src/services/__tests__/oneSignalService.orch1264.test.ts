// @ts-nocheck
//
// ORCH-1264 [consumer false "notifications turned off / Open Settings" dialog] —
// implementor-owned HAPPY-PATH regression (consumer app-mobile). The tester writes
// a second, adversarial one.
//
// app-mobile has NO jest/RTL runner and oneSignalService.ts uses extensionless
// relative imports the Node test runner cannot resolve, so the repo convention is
// node:assert SOURCE-assertions (see orch_1187_posthog_native_consumer.test.ts).
// Comment-stripping guarantees a doc-comment mention of a symbol cannot satisfy an
// assertion — every assertion FAILS on a TRUE LINE-DELETION of the fix, not merely
// on a comment-out (real fails-on-revert).
//
// PROTECTED CONTRACT (ORCH-1264, proven on-device):
//   Inside loginToOneSignal(), OneSignal.Notifications.getPermissionAsync() — a pure
//   OS-permission READ (no prompt) that reconciles OneSignal's CACHED permission to
//   the true OS value — MUST run BEFORE OneSignal.User.pushSubscription.optIn().
//   optIn() fired on a stale/denied cache pops iOS's native fallbackToSettings
//   "notifications turned off" dialog even when notifications are ON. Refreshing the
//   cache first suppresses that false dialog. optIn() must STILL run (subscription
//   must register + the legit iOS prompt still appears for not-determined users), and
//   the ORCH-1243 syncPushPermissionTag() must STILL run AFTER optIn().
//
// FAILS-ON-REVERT: delete the pre-optIn `await OneSignal.Notifications.getPermissionAsync()`
// and loginToOneSignal's body contains NO getPermissionAsync before optIn (the tag-sync
// read lives in a SEPARATE function AFTER optIn) → the "must call getPermissionAsync"
// + "before optIn" assertions fail. Restore → passes.
//
// Run:
//   node app-mobile/src/services/__tests__/oneSignalService.orch1264.test.ts

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

function resolveRepoFile(relPath: string): string {
  // Runnable from repo root (`node app-mobile/...`) or from app-mobile/ (`--prefix app-mobile`).
  const direct = path.resolve(process.cwd(), relPath)
  if (fs.existsSync(direct)) return direct
  return path.resolve(process.cwd(), 'app-mobile', relPath)
}

// Strip block + line comments so a doc-comment mention of a symbol cannot satisfy an
// assertion (true fails-on-revert vs LINE-DELETION). Preserves `https://` (colon before //).
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const source = fs.readFileSync(resolveRepoFile('src/services/oneSignalService.ts'), 'utf8')
const code = stripComments(source)

// Isolate loginToOneSignal's body: from its declaration to the NEXT top-level function
// (requestPushPermission). Bounding to THIS function ensures syncPushPermissionTag's own
// getPermissionAsync read (a different function) cannot mask a revert of the fix.
const loginStart = code.indexOf('export async function loginToOneSignal')
assert.ok(loginStart !== -1, 'loginToOneSignal must exist')
const bodyEnd = code.indexOf('export async function requestPushPermission', loginStart)
assert.ok(bodyEnd !== -1, 'requestPushPermission must follow loginToOneSignal (body boundary)')
const body = code.slice(loginStart, bodyEnd)

const idxLogin = body.indexOf('OneSignal.login(')
const idxGetPerm = body.indexOf('OneSignal.Notifications.getPermissionAsync(')
const idxOptIn = body.indexOf('OneSignal.User.pushSubscription.optIn(')
const idxSyncTag = body.indexOf('syncPushPermissionTag(')

// Presence — the -1 guards are the PRIMARY fails-on-revert catchers (a deleted fix line
// makes idxGetPerm === -1 here, before the ordering check that -1 would otherwise pass).
assert.ok(idxLogin !== -1, 'loginToOneSignal must call OneSignal.login()')
assert.ok(
  idxOptIn !== -1,
  'loginToOneSignal must STILL call pushSubscription.optIn() — the subscription must register and the legit iOS prompt must still appear (fix must not gate/skip optIn)',
)
assert.ok(
  idxGetPerm !== -1,
  'ORCH-1264: loginToOneSignal must call OneSignal.Notifications.getPermissionAsync() to refresh the cached permission before optIn (deleting it re-opens the false "notifications off" dialog)',
)
assert.ok(idxSyncTag !== -1, 'ORCH-1243: loginToOneSignal must still call syncPushPermissionTag()')

// Ordering — the core contract.
assert.ok(
  idxGetPerm < idxOptIn,
  'ORCH-1264: getPermissionAsync() must run BEFORE pushSubscription.optIn() so optIn cannot pop the false "notifications turned off" dialog on a stale/denied cache',
)
assert.ok(
  idxLogin < idxGetPerm,
  'OneSignal.login() must run before the pre-optIn permission read (identity before subscription)',
)
assert.ok(
  idxSyncTag > idxOptIn,
  'ORCH-1243: syncPushPermissionTag() must remain AFTER optIn (tag attaches to the logged-in, subscribed user)',
)

console.log(
  'ORCH-1264 regression PASS: loginToOneSignal order is login -> getPermissionAsync -> optIn -> syncPushPermissionTag.',
)
