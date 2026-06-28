// ORCH-1243 [OneSignal OS-permission tag] — IMPLEMENTOR happy-path regression.
//
// Root cause: the launch "turn on notifications" In-App Message mis-fires
// because OneSignal v5 registers the push subscription ASYNCHRONOUSLY, so at
// launch the audience sees a device as "not subscribed" even when iOS
// permission is GRANTED. The fix: write a reliable OneSignal TAG reflecting the
// TRUE OS notification permission (`syncPushPermissionTag`), which the dashboard
// audience can target instead of the timing-sensitive subscription state.
//
// This is a TRUE behavioral test (not source-contract): it transpiles the real
// oneSignalService.ts with sucrase (already a dep), injects a mock for the
// `react-native-onesignal` boundary + the RN-coupled logger, and EXECUTES
// syncPushPermissionTag(). app-mobile has no jest; the repo convention is the
// Node built-in test runner (node:test). Run:
//   node --test src/services/__tests__/orch_1243_os_permission_tag.test.cjs
//
// FAILS-ON-REVERT:
//   - delete/neuter `OneSignal.User.addTag('push_os_permission', ...)` → the
//     granted/denied assertions see zero tag calls → FAIL.
//   - flip the value mapping (granted→'denied') → value assertions FAIL.
//   - remove the `if (!_initialized) return` guard → the uninitialized no-op
//     assertion FAILS (a tag would be written before init).
//   fails-on-revert verified at 8d8c258201f36cad79eae1e5209ec6a05aeab340

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { transform } = require('sucrase');

// ── Mock OneSignal boundary (the sole thing the service imports natively) ─────
function makeHarness() {
  global.__DEV__ = false;
  const tagCalls = [];
  let permImpl = () => Promise.resolve(true);

  const OneSignalMock = {
    Debug: { setLogLevel() {} },
    initialize() {},
    login: async () => {},
    logout() {},
    User: {
      addTag: (k, v) => tagCalls.push([k, v]),
      pushSubscription: { optIn: async () => {} },
    },
    Notifications: {
      getPermissionAsync: () => permImpl(),
      requestPermission: async () => true,
      clearAll() {},
      addEventListener() {},
      removeEventListener() {},
    },
  };

  const filename = path.resolve(__dirname, '../oneSignalService.ts');
  const src = fs.readFileSync(filename, 'utf8');
  const { code } = transform(src, { transforms: ['typescript', 'imports'] });
  const m = new Module('oneSignalService', module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const origRequire = m.require.bind(m);
  m.require = (req) => {
    if (req === 'react-native-onesignal') return { OneSignal: OneSignalMock, LogLevel: { Verbose: 0 } };
    if (req.endsWith('utils/logger')) return { logger: { push() {} } };
    return origRequire(req);
  };
  m._compile(code, filename);

  return {
    svc: m.exports,
    tagCalls,
    setPermission: (granted) => { permImpl = () => Promise.resolve(granted); },
  };
}

const TAG_KEY = 'push_os_permission';

test('granted OS permission → addTag(push_os_permission, "granted")', async () => {
  const h = makeHarness();
  h.setPermission(true);
  h.svc.initializeOneSignal(); // sets _initialized + fire-and-forget seed
  await new Promise((r) => setImmediate(r)); // flush the init seed
  h.tagCalls.length = 0;       // isolate the explicit sync call below
  await h.svc.syncPushPermissionTag();
  assert.deepEqual(h.tagCalls, [[TAG_KEY, 'granted']]);
});

test('denied OS permission → addTag(push_os_permission, "denied")', async () => {
  const h = makeHarness();
  h.setPermission(false);
  h.svc.initializeOneSignal();
  await new Promise((r) => setImmediate(r)); // flush the init seed
  h.tagCalls.length = 0;
  await h.svc.syncPushPermissionTag();
  assert.deepEqual(h.tagCalls, [[TAG_KEY, 'denied']]);
});

test('NOT initialized → no tag write (self-guard no-op)', async () => {
  const h = makeHarness();
  h.setPermission(true);
  // Do NOT call initializeOneSignal(): _initialized stays false.
  await h.svc.syncPushPermissionTag();
  assert.equal(h.tagCalls.length, 0, 'syncPushPermissionTag must no-op before init');
});

test('initializeOneSignal seeds the tag (fire-and-forget at startup)', async () => {
  const h = makeHarness();
  h.setPermission(true);
  h.svc.initializeOneSignal();
  // init schedules `void syncPushPermissionTag()`; let the microtask flush.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.tagCalls, [[TAG_KEY, 'granted']], 'init must seed the OS-permission tag');
});
