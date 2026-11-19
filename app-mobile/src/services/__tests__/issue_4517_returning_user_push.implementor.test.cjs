// #4517 (amendment) — an already-onboarded, signed-in user who was never asked for
// notifications gets the gated request once per app session on reaching home.
//
// INVARIANT: push optIn never runs on an unanswered or denied permission, and the
// OS prompt is raised at most once per session by the shared single-flight gate
// (post-onboarding call and returning-user call cannot double-prompt).
//
// Run: node --test src/services/__tests__/issue_4517_returning_user_push.implementor.test.cjs
//
// FAILS-ON-REVERT: calling requestPushPermission() directly (no canRequest gate)
// fails the "answered user" case; dropping the shared _pushRequestInFlight fails the
// "no double prompt" case; dropping the index.tsx guard strings fails the source case.

const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { transform } = require('sucrase');

function load({ canRequest, os = 'android', att }) {
  const calls = { can: 0, request: 0, order: [] };
  const filename = path.resolve(__dirname, '../permissionOrchestrator.ts');
  const { code } = transform(fs.readFileSync(filename, 'utf8'), { transforms: ['typescript', 'imports'] });
  const m = new Module('permissionOrchestrator', module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const origRequire = m.require.bind(m);
  m.require = (req) => {
    if (req === 'react-native') {
      return { Platform: { OS: os }, AppState: { currentState: 'active', addEventListener() { return { remove() {} }; } } };
    }
    if (req === './oneSignalService') {
      return {
        canRequestPushPermission: async () => { calls.can++; await new Promise((r) => setImmediate(r)); return canRequest; },
        requestPushPermission: async () => { calls.request++; calls.order.push('push'); return true; },
      };
    }
    if (req === '../utils/attRequestTiming') return { shouldRequestAttNow: (st) => st === 'active' };
    if (req === './appsFlyerService') return { startAppsFlyer() {} };
    if (req === 'expo-tracking-transparency') {
      return { requestTrackingPermissionsAsync: async () => { await att; calls.order.push('att'); } };
    }
    return origRequire(req);
  };
  m._compile(code, filename);
  return { svc: m.exports, calls };
}

test('never-asked returning user: exactly one request; repeated calls collapse', async () => {
  const h = load({ canRequest: true });
  await Promise.all([h.svc.requestReturningUserPushPermission(), h.svc.requestReturningUserPushPermission()]);
  await h.svc.requestReturningUserPushPermission();
  assert.equal(h.calls.request, 1);
});

test('already-answered user: never asked again', async () => {
  const h = load({ canRequest: false });
  await h.svc.requestReturningUserPushPermission();
  assert.equal(h.calls.request, 0);
});

test('no double prompt with the post-onboarding call', async () => {
  const h = load({ canRequest: true });
  await Promise.all([h.svc.requestPostTourPermissions(), h.svc.requestReturningUserPushPermission()]);
  assert.equal(h.calls.request, 1);
});

test('iOS: the push request runs after ATT resolves', async () => {
  let release;
  const att = new Promise((r) => { release = r; });
  const h = load({ canRequest: true, os: 'ios', att });
  const p = h.svc.requestReturningUserPushPermission();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.calls.request, 0, 'push must wait for ATT');
  release();
  await p;
  assert.deepEqual(h.calls.order, ['att', 'push']);
});

test('index.tsx calls it only for a signed-in, onboarded, hydrated user', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../app/index.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const i = src.indexOf('requestReturningUserPushPermission()');
  assert.ok(i > 0, 'home effect must call requestReturningUserPushPermission()');
  const guard = src.slice(src.lastIndexOf('useEffect(', i), i);
  for (const needle of ['_hasHydrated', 'isLoadingAuth', 'isAuthenticated', 'user?.id', 'showOnboardingFlow', 'has_completed_onboarding !== true']) {
    assert.ok(guard.includes(needle), `guard must include ${needle}`);
  }
});
