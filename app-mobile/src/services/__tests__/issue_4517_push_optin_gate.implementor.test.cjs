// #4517 — Explorer false "notifications turned off" alert after Allow.
//
// INVARIANT: push optIn never runs on an unanswered or denied permission.
//
// The SDK rule modelled by the mock (OneSignal iOS 5.8): pushSubscription.optIn()
// raises the OS prompt when the user was never asked, and raises the Settings
// alert when they were asked and are not granted. Our code must never call it in
// those states, however many times the sign-in effect fires (device proof: four
// loginToOneSignal calls per cold start).
//
// Transpiles the REAL oneSignalService.ts (sucrase) against a mocked SDK.
// Run: node --test src/services/__tests__/issue_4517_push_optin_gate.implementor.test.cjs
//
// FAILS-ON-REVERT: restoring the unconditional optIn() in runLogin fails (i), (ii);
// deleting the _loginFlight guard fails (iii); not clearing it in logout fails (iv).

const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { transform } = require('sucrase');

function harness({ prompted, granted }) {
  global.__DEV__ = false;
  const dev = { prompted, granted, optIns: 0, prompts: 0, alerts: 0 };
  const optIn = () => {
    dev.optIns++;
    if (!dev.prompted) { dev.prompts++; dev.prompted = true; }
    else if (!dev.granted) dev.alerts++;
  };
  const sdk = {
    Debug: { setLogLevel() {} },
    initialize() {},
    InAppMessages: { setPaused() {} },
    login: async () => { await new Promise((r) => setImmediate(r)); },
    logout() {},
    User: { addTag() {}, pushSubscription: { optIn } },
    Notifications: {
      canRequestPermission: async () => !dev.prompted,
      getPermissionAsync: async () => dev.granted,
      requestPermission: async () => {
        if (dev.prompted) return dev.granted;
        dev.prompted = true; dev.prompts++;
        dev.granted = dev.userAllows !== false;
        return dev.granted;
      },
      clearAll() {}, addEventListener() {}, removeEventListener() {},
    },
  };
  const filename = path.resolve(__dirname, '../oneSignalService.ts');
  const { code } = transform(fs.readFileSync(filename, 'utf8'), { transforms: ['typescript', 'imports'] });
  const m = new Module('oneSignalService', module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const origRequire = m.require.bind(m);
  m.require = (req) => {
    if (req === 'react-native-onesignal') return { OneSignal: sdk, LogLevel: { Verbose: 0 } };
    if (req.endsWith('utils/logger')) return { logger: { push() {} } };
    return origRequire(req);
  };
  m._compile(code, filename);
  m.exports.initializeOneSignal();
  return { svc: m.exports, dev };
}

test('(i) never-asked device: login = 0 optIn / prompt / alert; a grant = exactly 1 optIn', async () => {
  const h = harness({ prompted: false, granted: false });
  await h.svc.loginToOneSignal('u1');
  assert.deepEqual([h.dev.optIns, h.dev.prompts, h.dev.alerts], [0, 0, 0]);
  assert.equal(await h.svc.requestPushPermission(), true);
  assert.equal(h.dev.optIns, 1);
  assert.equal(h.dev.alerts, 0);
  assert.equal(h.dev.prompts, 1, 'the single OS prompt comes from requestPermission');
});

test('(ii) declined device: four sequential + concurrent logins = 0 optIn, 0 alerts', async () => {
  const h = harness({ prompted: true, granted: false });
  await Promise.all([h.svc.loginToOneSignal('u1'), h.svc.loginToOneSignal('u1')]);
  await h.svc.loginToOneSignal('u1');
  await h.svc.loginToOneSignal('u1');
  assert.equal(h.dev.optIns, 0);
  assert.equal(h.dev.alerts, 0);
});

test('(iii) granted device: four logins = exactly 1 optIn, same promise reused', async () => {
  const h = harness({ prompted: true, granted: true });
  const p1 = h.svc.loginToOneSignal('u1');
  const p2 = h.svc.loginToOneSignal('u1');
  assert.equal(p1, p2, 'concurrent same-user call returns the same promise');
  await Promise.all([p1, p2]);
  await h.svc.loginToOneSignal('u1');
  await h.svc.loginToOneSignal('u1');
  assert.equal(h.dev.optIns, 1);
  assert.equal(h.dev.alerts, 0);
});

test('(iv) logout clears the guard: login runs again (same and different user)', async () => {
  const h = harness({ prompted: true, granted: true });
  await h.svc.loginToOneSignal('u1');
  h.svc.logoutOneSignal();
  await h.svc.loginToOneSignal('u1');
  assert.equal(h.dev.optIns, 2, 'a new session for the same user opts in again');
  h.svc.logoutOneSignal();
  await h.svc.loginToOneSignal('u2');
  assert.equal(h.dev.optIns, 3);
  assert.equal(h.dev.alerts, 0);
});

test('(v) a grant before login finishes still opts in exactly once', async () => {
  const h = harness({ prompted: false, granted: false });
  await h.svc.requestPushPermission(); // no user yet: no optIn here
  assert.equal(h.dev.optIns, 0);
  await h.svc.loginToOneSignal('u1'); // sees answered + granted
  assert.equal(h.dev.optIns, 1);
});
