// ORCH-1243 [OneSignal OS-permission tag] — TESTER adversarial regression.
//
// Different angle from the implementor happy-path (which asserts the
// granted/denied mapping). This suite proves:
//   (A) ERROR-RESILIENCE — if the OS permission read rejects, syncPushPermissionTag
//       MUST swallow it (never throw) and write NO tag (no stale/garbage tag).
//   (B) FRESHNESS WIRING — the MobileFeaturesProvider AppState→'active' branch
//       MUST invoke syncPushPermissionTag, AND it must reuse the EXISTING
//       handler (no second AppState listener), so returning from iOS Settings
//       reconciles the tag.
//
// (A) is behavioral: it transpiles the real oneSignalService.ts (sucrase) and
// EXECUTES the function against a rejecting getPermissionAsync mock.
// (B) is a wiring assertion on the real MobileFeaturesProvider.tsx source with
// comment-stripping (a doc-comment mention cannot satisfy it) — a render test of
// the provider would pull the whole RN/native graph, which is not runnable in
// app-mobile's jest-less harness; the wiring is the load-bearing contract.
//
// Run: node --test src/services/__tests__/orch_1243_os_permission_tag.adversarial.test.cjs
//
// FAILS-ON-REVERT:
//   - remove the try/catch (let getPermissionAsync rejection propagate) →
//     "does not throw" assertion FAILS.
//   - write the tag before/without the await resolving → "no tag on error" FAILS.
//   - delete the `void syncPushPermissionTag()` line from the provider's active
//     branch → the wiring assertion FAILS.
//   - move it into a NEW standalone AppState.addEventListener → the
//     "single AppState listener" assertion FAILS.
//   fails-on-revert verified at 8d8c258201f36cad79eae1e5209ec6a05aeab340

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { transform } = require('sucrase');

const ROOT = path.resolve(__dirname, '../../..'); // app-mobile/
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── (A) behavioral: rejecting permission read is swallowed, writes no tag ─────
function makeHarness(permImpl) {
  global.__DEV__ = false;
  const tagCalls = [];
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a);

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
      getPermissionAsync: permImpl,
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

  return { svc: m.exports, tagCalls, restoreWarn: () => { console.warn = realWarn; } };
}

test('A1 — getPermissionAsync rejecting does NOT throw (swallowed)', async () => {
  const h = makeHarness(() => Promise.reject(new Error('boom')));
  h.svc.initializeOneSignal();
  await new Promise((r) => setImmediate(r)); // flush init seed (also rejects, swallowed)
  await assert.doesNotReject(async () => {
    await h.svc.syncPushPermissionTag();
  });
  h.restoreWarn();
});

test('A2 — a rejected permission read writes NO tag', async () => {
  const h = makeHarness(() => Promise.reject(new Error('boom')));
  h.svc.initializeOneSignal();
  await new Promise((r) => setImmediate(r));
  h.tagCalls.length = 0;
  await h.svc.syncPushPermissionTag();
  assert.equal(h.tagCalls.length, 0, 'no tag may be written when the OS read fails');
  h.restoreWarn();
});

// ── (B) freshness wiring: MobileFeaturesProvider foreground branch ────────────
test('B1 — MobileFeaturesProvider imports syncPushPermissionTag from the service', () => {
  const code = stripComments(read('src/components/MobileFeaturesProvider.tsx'));
  assert.match(
    code,
    /import\s*\{\s*syncPushPermissionTag\s*\}\s*from\s*['"][^'"]*services\/oneSignalService['"]/,
    'must import syncPushPermissionTag from oneSignalService',
  );
});

test('B2 — the AppState active branch invokes syncPushPermissionTag', () => {
  const code = stripComments(read('src/components/MobileFeaturesProvider.tsx'));
  // Slice the handleAppStateChange body and assert the call lives inside the
  // active branch (after the `=== 'active'` guard, before the background arm).
  const activeIdx = code.indexOf("=== 'active'");
  const backgroundIdx = code.indexOf("=== 'background'");
  assert.ok(activeIdx !== -1, "active-branch guard must exist");
  assert.ok(backgroundIdx > activeIdx, "background arm must follow active arm");
  const activeBranch = code.slice(activeIdx, backgroundIdx);
  assert.match(
    activeBranch,
    /syncPushPermissionTag\s*\(\s*\)/,
    'foreground (active) branch must call syncPushPermissionTag()',
  );
});

test('B3 — exactly ONE AppState listener (no second standalone listener)', () => {
  const code = stripComments(read('src/components/MobileFeaturesProvider.tsx'));
  const listeners = (code.match(/AppState\.addEventListener\s*\(/g) || []).length;
  assert.equal(listeners, 1, 'must reuse the existing AppState listener, not add a second');
});
