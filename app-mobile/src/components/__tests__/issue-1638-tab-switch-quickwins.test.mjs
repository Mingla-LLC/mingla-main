// Issue #1638 [tab switch quick wins] — IMPLEMENTOR happy-path regression suite.
//
// Runs under plain `node --test` (app-mobile has NO jest — see
// the ci-batch:issue-1516-coach-mark-tests suite for the convention). Wired as
// `npm run test:issue-1638` from app-mobile/ and executed by
// ci-batch:issue-1638-tab-switch-quickwins-tests in .github/ci-batch/MANIFEST.json.
//
// #1638 is "switching tabs acknowledges the tap before the screen is ready". This suite
// covers the three quick wins that were in scope FOR PR #1660, which explicitly did not fix
// the lag. The scheduling rework landed afterwards, in the same issue: see
// issue-1638-tab-switch-scheduling.test.mjs for the pending state and the Track-A mount
// reductions, and orch-0995-impl2-optimistic-tab-feedback.test.tsx T-18/T-19 for the
// scheduling contract itself. S1 below was amended when that landed — see its comment.
//
//   C1  ANDROID GETS A TACTILE ACKNOWLEDGEMENT AT ALL.
//       GlassBottomNav.tsx gated `Haptics.impactAsync(Medium)` behind
//       `Platform.OS === 'ios'`, so on Android — the platform where the wait is LONGEST —
//       nothing but the spotlight pill moved. C1 executes the REAL
//       src/utils/navTabHaptics.ts against a recording expo-haptics stub on each platform.
//       It also cross-checks the chosen Android constant against the REAL
//       expo-haptics Kotlin source, because the semantically-perfect constant
//       (`SEGMENT_TICK`) is API-34-only and would THROW on the Samsung SM-A725F
//       (Android 13 / API 33) this issue was filed against.
//
//   C2  A TAB TAP NO LONGER COSTS A GPS FIX AND A DATABASE WRITE.
//       ProfilePage.tsx ran `useEffect(() => { updateLocation(); }, [])` — and because
//       Path B (`I-ONLY-ACTIVE-TAB-MOUNTED`) unmounts the tab on every switch away, `[]`
//       meant EVERY tap. C2 executes the REAL src/utils/profileLocationFreshness.ts over
//       the whole input space, and asserts BOTH halves of the contract: a fresh cached
//       location skips the chain, and a stale/absent/corrupt one still refreshes.
//
//   C3  THE MOUNT PATH NO LONGER FORCE-INVALIDATES — BUT ACTIONS STILL DO.
//       useFriends.ts's `fetchFriends` / `loadFriendRequests` / `fetchBlockedUsers` are
//       `queryClient.invalidateQueries(...)`, not reads. Calling them from a mount effect
//       defeated the 30s `useFriendsList` staleTime on every Profile/Friends switch. C3
//       proves the replacement mechanism against a REAL @tanstack/react-query QueryClient
//       — mounting an observer on fresh data does not fetch, an invalidation does, and a
//       genuinely stale mount still refetches — and then binds that to the real sources,
//       including an OVER-DELETION guard that the action-driven invalidations survived.
//
// Everything except the explicitly-labelled SOURCE BINDING assertions executes real
// product code. The source bindings exist because a behavioural proof of a hook that has
// been DELETED can only be anchored to the file it was deleted from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { transform } = require('sucrase');

// ── Repo-root resolution (runs from app-mobile/ or from the repo root) ───────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_MOBILE_ROOT = path.resolve(HERE, '../../..');

function appFile(rel) {
  const abs = path.join(APP_MOBILE_ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`#1638 harness: missing ${rel} (looked at ${abs})`);
  return abs;
}
const readApp = (rel) => fs.readFileSync(appFile(rel), 'utf8');

// ── Minimal module loader: transpile the REAL source, inject stubs ───────────────
function loadModule(rel, stubs = {}) {
  const abs = appFile(rel);
  const code = transform(fs.readFileSync(abs, 'utf8'), {
    transforms: ['typescript', 'imports'],
    filePath: abs,
  }).code;
  const mod = { exports: {} };
  const req = (spec) => {
    if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
    throw new Error(`#1638 harness: unstubbed require(${JSON.stringify(spec)}) from ${rel}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    mod.exports, req, mod, abs, path.dirname(abs),
  );
  return mod.exports;
}

// ═══════════════════════════════════════════════════════════════════════════════
// C1 — ANDROID GETS A TACTILE ACKNOWLEDGEMENT AT ALL
// ═══════════════════════════════════════════════════════════════════════════════

// A recording stand-in for expo-haptics with the real enum VALUES (the strings that
// actually cross the bridge into HapticsModule.kt), so an assertion on 'clock-tick' is an
// assertion on what the native module receives, not on a JS symbol name.
function makeHapticsStub({ impactImpl, androidImpl } = {}) {
  const calls = [];
  return {
    calls,
    module: {
      __esModule: true,
      ImpactFeedbackStyle: {
        Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid',
      },
      AndroidHaptics: {
        Confirm: 'confirm', Reject: 'reject', Clock_Tick: 'clock-tick',
        Context_Click: 'context-click', Keyboard_Tap: 'keyboard-tap',
        Long_Press: 'long-press', Virtual_Key: 'virtual-key',
        Segment_Tick: 'segment-tick', Segment_Frequent_Tick: 'segment-frequent-tick',
        No_Haptics: 'no-haptics',
      },
      impactAsync(style) {
        calls.push({ api: 'impactAsync', arg: style });
        return impactImpl ? impactImpl(style) : Promise.resolve();
      },
      selectionAsync() {
        calls.push({ api: 'selectionAsync', arg: undefined });
        return Promise.resolve();
      },
      performAndroidHapticsAsync(type) {
        calls.push({ api: 'performAndroidHapticsAsync', arg: type });
        return androidImpl ? androidImpl(type) : Promise.resolve();
      },
    },
  };
}

function loadHaptics(os, hapticsOverrides) {
  const stub = makeHapticsStub(hapticsOverrides);
  const mod = loadModule('src/utils/navTabHaptics.ts', {
    'react-native': { __esModule: true, Platform: { OS: os } },
    'expo-haptics': stub.module,
  });
  return { trigger: mod.triggerTabSwitchHaptic, calls: stub.calls };
}

test('C1.1 iOS keeps its existing acknowledgement — impactAsync(Medium), unchanged', () => {
  const { trigger, calls } = loadHaptics('ios');
  trigger();
  assert.deepEqual(calls, [{ api: 'impactAsync', arg: 'medium' }]);
});

test('C1.2 #1638 CORE: Android is no longer silent — a haptic fires on a tab switch', () => {
  const { trigger, calls } = loadHaptics('android');
  assert.equal(calls.length, 0, 'precondition: nothing fired before the tap');
  trigger();
  assert.equal(
    calls.length, 1,
    'Android fired NO haptic at all — this is the exact #1638 defect regressing',
  );
});

test('C1.3 Android uses performAndroidHapticsAsync(context-click), NOT the Vibrator path', () => {
  const { trigger, calls } = loadHaptics('android');
  trigger();
  assert.deepEqual(calls, [{ api: 'performAndroidHapticsAsync', arg: 'context-click' }],
    // #1638 follow-up: was 'clock-tick'. Changed ONLY after device verification —
    // clock-tick and keyboard-tap both RESOLVED OK on the SM-A725F and were felt as
    // nothing. context-click was felt. A resolved promise does not mean a rendered
    // haptic; only hardware plus a human can decide that.
    'Android must send the device-verified constant to the native module');
  // impactAsync on Android is `Vibrator.vibrate(...)` — a 43ms motor buzz that needs
  // android.permission.VIBRATE (which app.json does NOT declare) and reads as a
  // notification rather than an acknowledgement. expo's own JSDoc says not to use it.
  assert.equal(
    calls.filter((c) => c.api === 'impactAsync').length, 0,
    'Android must not go through impactAsync/Vibrator',
  );
});

test('C1.4 the Android constant is one expo-haptics guarantees on EVERY API level', () => {
  // WHY: HapticsRecord.kt#toHapticFeedbackType() resolves HapticFeedbackConstants by
  // REFLECTION. On a NoSuchFieldException (i.e. the constant is newer than the device's
  // API level) it falls back to a hard-coded `when (this)` list, and anything NOT in that
  // list throws HapticsNotSupportedException. `SEGMENT_TICK` — the semantically perfect
  // constant for "switching between discrete choices" — is API 34+ and is NOT in the
  // fallback list, so it would THROW on any API 33 device.
  //
  // CORRECTION 2026-08-06: this comment previously claimed the SM-A725F #1638 was filed
  // against is API 33. It is NOT — it runs Android 14 / API 34, confirmed by
  // `getprop ro.build.version.sdk`. Segment_Tick fires fine on it. That unchecked premise
  // is why the first fix shipped a deliberately weak constant and was inaudible.
  // The GUARANTEE this test enforces is still correct and still wanted: we support API 33
  // devices too, so the constant must be in the fallback set regardless of what the
  // operator's own phone happens to be. Verify device facts; do not inherit them.
  // This test reads the REAL vendored Kotlin so the guarantee cannot drift silently
  // under an expo-haptics upgrade.
  const kotlinPath = path.join(
    APP_MOBILE_ROOT,
    'node_modules/expo-haptics/android/src/main/java/expo/modules/haptics/HapticsRecord.kt',
  );
  assert.ok(
    fs.existsSync(kotlinPath),
    `expo-haptics Android source not found at ${kotlinPath}. Run \`npm ci\` in app-mobile. `
    + 'If expo-haptics restructured, RE-VERIFY that the Android constant used by '
    + 'navTabHaptics.ts is still available below API 34 before touching this assertion.',
  );
  const kotlin = fs.readFileSync(kotlinPath, 'utf8');

  // Extract the `when (this)` fallback arms — the constants available on all API levels.
  const fallbackBlock = kotlin.slice(
    kotlin.indexOf('catch (e: NoSuchFieldException)'),
    kotlin.indexOf('catch (e: IllegalAccessException)'),
  );
  assert.ok(fallbackBlock.length > 0, 'could not locate the NoSuchFieldException fallback block');
  const guaranteed = [...fallbackBlock.matchAll(/^\s*([A-Z_]+)\s*->/gm)].map((m) => m[1]);
  assert.ok(guaranteed.length >= 5, `expected the 5-constant fallback set, got ${guaranteed}`);

  // What navTabHaptics.ts actually sends, read out of the real source.
  const src = readApp('src/utils/navTabHaptics.ts');
  const used = /Haptics\.AndroidHaptics\.([A-Za-z_]+)/.exec(src);
  assert.ok(used, 'navTabHaptics.ts must name an explicit AndroidHaptics constant');
  const usedKotlinName = used[1].toUpperCase();
  assert.ok(
    guaranteed.includes(usedKotlinName),
    `AndroidHaptics.${used[1]} maps to HapticFeedbackConstants.${usedKotlinName}, which is NOT `
    + `in expo-haptics' all-API-level fallback set [${guaranteed.join(', ')}] — it would throw `
    + 'HapticsNotSupportedException below API 34, including on the Samsung SM-A725F.',
  );
});

test('C1.5 web (and anything without a haptics engine) stays silent and does not throw', () => {
  const { trigger, calls } = loadHaptics('web');
  assert.doesNotThrow(() => trigger());
  assert.deepEqual(calls, []);
});

test('C1.6 never throws — a rejecting native promise is swallowed on both platforms', async () => {
  const rejecting = () => Promise.reject(new Error('no haptics motor'));
  const ios = loadHaptics('ios', { impactImpl: rejecting });
  const android = loadHaptics('android', { androidImpl: rejecting });
  assert.doesNotThrow(() => ios.trigger());
  assert.doesNotThrow(() => android.trigger());
  // Give any unhandled rejection a turn to surface before the test ends.
  await new Promise((r) => setImmediate(r));
});

test('C1.7 never throws — a SYNCHRONOUSLY throwing native module is swallowed', () => {
  const boom = () => { throw new TypeError('performHapticsAsync is not a function'); };
  assert.doesNotThrow(() => loadHaptics('android', { androidImpl: boom }).trigger());
  assert.doesNotThrow(() => loadHaptics('ios', { impactImpl: boom }).trigger());
});

test('C1.8 SOURCE BINDING: GlassBottomNav fires the shared helper, not an iOS-only branch', () => {
  const src = readApp('src/components/GlassBottomNav.tsx');
  assert.match(
    src, /import \{ triggerTabSwitchHaptic \} from '\.\.\/utils\/navTabHaptics'/,
    'GlassBottomNav must import the shared tab-switch haptic helper',
  );
  assert.match(
    src, /if \(key === displayPage\) return;[\s\S]{0,900}?triggerTabSwitchHaptic\(\);/,
    'onPress must fire triggerTabSwitchHaptic() right after the re-tap guard',
  );
  // The exact defect: haptics gated on iOS. It must be gone from this file entirely.
  assert.doesNotMatch(
    src, /Platform\.OS === 'ios'[\s\S]{0,200}?Haptics\.impactAsync/,
    'the iOS-only haptic gate is back — Android is silent again (#1638)',
  );
  assert.doesNotMatch(
    src, /\bHaptics\.(impactAsync|selectionAsync|notificationAsync)\b/,
    'GlassBottomNav must not call expo-haptics directly — route through navTabHaptics.ts',
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// C2 — PROFILE NO LONGER FIRES A GPS FIX + DB WRITE ON EVERY TAB TAP
// ═══════════════════════════════════════════════════════════════════════════════

const freshness = loadModule('src/utils/profileLocationFreshness.ts');
const {
  isProfileLocationFresh,
  parseProfileLocationTimestamp,
  PROFILE_LOCATION_MAX_AGE_MS,
  PROFILE_LOCATION_PLACE_KEY,
  PROFILE_LOCATION_TS_KEY,
} = freshness;

const NOW = 1_800_000_000_000; // fixed clock — no wall-time flake

test('C2.1 the freshness window is 30 minutes, and the keys are the expected ones', () => {
  assert.equal(PROFILE_LOCATION_MAX_AGE_MS, 30 * 60 * 1000);
  // The place key keeps its pre-#1638 name/shape so installs that predate this change
  // keep rendering their cached city instead of blanking.
  assert.equal(PROFILE_LOCATION_PLACE_KEY, 'mingla_user_location');
  assert.equal(PROFILE_LOCATION_TS_KEY, 'mingla_user_location_ts');
});

test('C2.2 SKIP: a recent cached location suppresses the GPS + geocode + DB chain', () => {
  assert.equal(isProfileLocationFresh('London, England, United Kingdom', NOW - 1000, NOW), true);
  assert.equal(isProfileLocationFresh('Lagos, Lagos, Nigeria', NOW, NOW), true);
  // Right on the boundary is still fresh; one millisecond past it is not.
  assert.equal(isProfileLocationFresh('Lagos', NOW - PROFILE_LOCATION_MAX_AGE_MS, NOW), true);
  assert.equal(isProfileLocationFresh('Lagos', NOW - PROFILE_LOCATION_MAX_AGE_MS - 1, NOW), false);
});

test('C2.3 STILL REFRESHES: a genuinely STALE location is not treated as fresh', () => {
  assert.equal(isProfileLocationFresh('London', NOW - PROFILE_LOCATION_MAX_AGE_MS - 1, NOW), false);
  assert.equal(isProfileLocationFresh('London', NOW - 60 * 60 * 1000, NOW), false);
  assert.equal(isProfileLocationFresh('London', NOW - 30 * 24 * 60 * 60 * 1000, NOW), false);
});

test('C2.4 STILL REFRESHES: an ABSENT location is never fresh', () => {
  for (const place of [null, undefined, '', '   ', '\n\t ']) {
    assert.equal(
      isProfileLocationFresh(place, NOW, NOW), false,
      `place=${JSON.stringify(place)} must force a refresh`,
    );
  }
  // `AsyncStorage.setItem(key, placeString || "")` could historically persist a literal
  // empty string. Treating "" as a value would pin a blank city forever (sentinel poisoning).
});

test('C2.5 STILL REFRESHES: a missing or corrupt timestamp is never fresh', () => {
  for (const ts of [null, undefined, 0, -1, NaN, Infinity, -Infinity, '123', {}]) {
    assert.equal(
      isProfileLocationFresh('London', ts, NOW), false,
      `cachedAtMs=${String(ts)} must force a refresh`,
    );
  }
  // A pre-#1638 install has a place string but NO timestamp key — it must refresh once,
  // then be stamped. This is the upgrade path.
});

test('C2.6 STILL REFRESHES: a FUTURE timestamp fails toward refresh, never toward stale', () => {
  assert.equal(isProfileLocationFresh('London', NOW + 1, NOW), false);
  assert.equal(isProfileLocationFresh('London', NOW + 365 * 24 * 60 * 60 * 1000, NOW), false);
  // Clock changes / DST rolls / corrupt writes must not pin a stale city indefinitely.
});

test('C2.7 an unusable clock fails toward refresh', () => {
  assert.equal(isProfileLocationFresh('London', NOW, NaN), false);
  assert.equal(isProfileLocationFresh('London', NOW, Infinity), false);
});

test('C2.8 parseProfileLocationTimestamp: only a positive finite number survives', () => {
  assert.equal(parseProfileLocationTimestamp(String(NOW)), NOW);
  for (const raw of [null, undefined, '', '   ', 'abc', '0', '-5', 'NaN', 'Infinity']) {
    assert.equal(
      parseProfileLocationTimestamp(raw), 0,
      `raw=${JSON.stringify(raw)} must parse to the absent sentinel 0`,
    );
  }
  assert.equal(isProfileLocationFresh('London', parseProfileLocationTimestamp(null), NOW), false);
});

test('C2.9 SOURCE BINDING: ProfilePage gates updateLocation on the freshness check', () => {
  const src = readApp('src/components/ProfilePage.tsx');
  assert.match(
    src, /from ["']\.\.\/utils\/profileLocationFreshness["']/,
    'ProfilePage must import the freshness module',
  );
  // The exact #1638 defect: an unconditional updateLocation() in a [] mount effect.
  assert.doesNotMatch(
    src, /useEffect\(\(\) => \{\s*updateLocation\(\);\s*\}, \[\]\);/,
    'the unconditional mount-time updateLocation() is back (#1638)',
  );
  // The gate must SHORT-CIRCUIT before updateLocation, not merely mention the helper.
  assert.match(
    src,
    /if \(isProfileLocationFresh\([\s\S]{0,120}?\)\) return;[\s\S]{0,120}?await updateLocation\(\);/,
    'the mount path must return early when the cached location is fresh, and only then '
    + 'fall through to updateLocation()',
  );
  // The display must still be populated from cache — "the profile must still show a location".
  assert.match(
    src, /if \(cachedPlace\) setCurrentLocation\(cachedPlace\);/,
    'the cached place must hydrate the UI even when the refresh is skipped',
  );
  // Stamp AFTER the place string, so a torn write fails toward refresh.
  const placeWrite = src.indexOf(`AsyncStorage.setItem(PROFILE_LOCATION_PLACE_KEY`);
  const tsWrite = src.indexOf(`AsyncStorage.setItem(PROFILE_LOCATION_TS_KEY`);
  assert.ok(placeWrite > 0 && tsWrite > 0, 'both cache writes must exist');
  assert.ok(
    placeWrite < tsWrite,
    'the timestamp must be written AFTER the place string — otherwise a process kill '
    + 'between the two writes pins a stale city behind a fresh stamp',
  );
  // The manual override must survive: tap-to-refresh still runs the chain unconditionally.
  assert.match(
    src, /onLocationRefresh=\{updateLocation\}/,
    'the hero tap-to-refresh must still call updateLocation directly (no gate)',
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// C3 — MOUNT NO LONGER FORCE-INVALIDATES; ACTIONS STILL DO
// ═══════════════════════════════════════════════════════════════════════════════

const { QueryClient, QueryObserver } = require('@tanstack/react-query');

// `useFriendsList` config, mirrored from src/hooks/useFriendsQuery.ts.
const FRIENDS_STALE_TIME = 30_000;
const FRIENDS_KEY = ['friends', 'list', 'user-1638'];

function makeFriendsHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let fetches = 0;
  const options = {
    queryKey: FRIENDS_KEY,
    queryFn: async () => { fetches += 1; return [{ id: 'friend-a' }]; },
    staleTime: FRIENDS_STALE_TIME,
  };
  // `mountObserver` is what a tab mount does: it adds an observer to a query that the
  // never-unmounted shell (app/index.tsx) already subscribes to.
  const mountObserver = () => {
    const obs = new QueryObserver(client, options);
    return obs.subscribe(() => {});
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { client, options, mountObserver, settle, fetchCount: () => fetches };
}

test('C3.1 the staleTime the mount path now relies on is real and configured at 30s', () => {
  const src = readApp('src/hooks/useFriendsQuery.ts');
  assert.match(src, /const FRIENDS_STALE_TIME = 30_000;/);
  assert.match(src, /staleTime: FRIENDS_STALE_TIME/);
  // refetchOnMount must NOT be globally disabled, or removing the invalidation would
  // remove freshness rather than relocate it.
  const qc = readApp('src/config/queryClient.ts');
  assert.doesNotMatch(
    qc, /refetchOnMount\s*:\s*false/,
    'refetchOnMount must stay at its default (true) — the mount path depends on it',
  );
});

test('C3.2 BEHAVIOUR: mounting a tab on FRESH friends data performs NO network fetch', async () => {
  const h = makeFriendsHarness();
  const unsubShell = h.mountObserver();      // the shell's permanent observer
  await h.settle();
  assert.equal(h.fetchCount(), 1, 'precondition: the first observer populates the cache');

  const unsubTab = h.mountObserver();        // a tab switch mounts a second observer
  await h.settle();
  assert.equal(
    h.fetchCount(), 1,
    'a tab mount on fresh data must be served from cache — this is the #1638 saving',
  );
  unsubTab(); unsubShell();
});

test('C3.3 BEHAVIOUR: the OLD mount-time invalidateQueries DID force a fetch (the defect)', async () => {
  const h = makeFriendsHarness();
  const unsubShell = h.mountObserver();
  await h.settle();
  assert.equal(h.fetchCount(), 1);

  const unsubTab = h.mountObserver();
  await h.settle();
  assert.equal(h.fetchCount(), 1, 'still cached');

  // This is exactly what fetchFriends()/loadFriendRequests() do, and exactly what the two
  // deleted mount effects called. It fetches regardless of staleTime — the defect.
  await h.client.invalidateQueries({ queryKey: FRIENDS_KEY });
  await h.settle();
  assert.equal(
    h.fetchCount(), 2,
    'invalidateQueries must still force a fetch — this is why action call sites keep it',
  );
  unsubTab(); unsubShell();
});

test('C3.4 BEHAVIOUR: a genuinely STALE mount still refetches — freshness is not lost', async () => {
  const h = makeFriendsHarness();
  const unsubShell = h.mountObserver();
  await h.settle();
  assert.equal(h.fetchCount(), 1);

  // Age the cached data past staleTime without touching wall-clock time.
  const entry = h.client.getQueryCache().find({ queryKey: FRIENDS_KEY });
  entry.state.dataUpdatedAt = Date.now() - (FRIENDS_STALE_TIME + 1_000);

  const unsubTab = h.mountObserver();
  await h.settle();
  assert.equal(
    h.fetchCount(), 2,
    'refetchOnMount + staleTime must still refresh stale friends data on a tab mount',
  );
  unsubTab(); unsubShell();
});

test('C3.5 SOURCE BINDING: ProfilePage no longer force-invalidates friends on mount', () => {
  const src = readApp('src/components/ProfilePage.tsx');
  assert.doesNotMatch(
    src, /useEffect\(\(\) => \{\s*fetchFriends\(\);\s*\}, \[fetchFriends\]\);/,
    'the mount-time fetchFriends() invalidation is back (#1638)',
  );
  // Not destructured at all — there is no way to call it from this file any more.
  assert.doesNotMatch(
    src, /^\s*const \{[^}]*\bfetchFriends\b[^}]*\} = useFriends\(\)/m,
    'ProfilePage must not destructure fetchFriends',
  );
  assert.doesNotMatch(src, /\bfetchFriends\s*\(/, 'ProfilePage must not call fetchFriends');
  // It must still READ the friends data — the count on the profile cannot go dark.
  assert.match(src, /const \{ friends: realFriends, friendCount \} = useFriends\(\);/);
  assert.match(src, /const actualConnectionsCount = friendCount;/);
});

test('C3.6 SOURCE BINDING: ConnectionsPage no longer force-invalidates on mount', () => {
  const src = readApp('src/components/ConnectionsPage.tsx');
  assert.doesNotMatch(
    src,
    /useEffect\(\(\) => \{[\s\S]{0,200}?fetchFriends\(\)[\s\S]{0,200}?loadFriendRequests\(\)[\s\S]{0,200}?\}, \[user\?\.id, fetchFriends, loadFriendRequests\]\);/,
    'the mount-time friends/requests invalidation effect is back (#1638)',
  );
  assert.doesNotMatch(
    src, /fetchFriends\(\)\.catch\(/,
    'the mount-effect form of fetchFriends() is back (#1638)',
  );
  assert.doesNotMatch(
    src, /loadFriendRequests\(\)\.catch\(/,
    'the mount-effect form of loadFriendRequests() is back (#1638)',
  );
});

test('C3.7 OVER-DELETION GUARD: every action-driven invalidation still fires', () => {
  const conn = readApp('src/components/ConnectionsPage.tsx');
  // Pull-to-refresh — the user explicitly asked for fresh data.
  assert.match(
    conn, /const handleRefresh = useCallback\(async \(\) => \{[\s\S]{0,200}?await fetchFriends\(\);/,
    'pull-to-refresh must still force a refetch',
  );
  // The error-state "Try again" button.
  assert.match(
    conn, /setConversationsLoading\(true\);[\s\S]{0,240}?fetchFriends\(\);[\s\S]{0,80}?loadFriendRequests\(\);/,
    'the error-state retry must still force a refetch',
  );
  // A request sent from the add-friend surface must show up immediately.
  assert.match(conn, /onRequestSent=\{\(\) => loadFriendRequests\(\)\}/);

  // The modal the user opens specifically to review requests keeps its explicit refresh.
  const modal = readApp('src/components/FriendRequestsModal.tsx');
  assert.match(
    modal, /if \(isOpen\) \{[\s\S]{0,300}?await loadFriendRequests\(\);/,
    'opening the friend-requests modal must still force a refetch',
  );

  // The mutations — stale data here would be VISIBLY wrong, which is the whole reason
  // this change had to be surgical rather than a blanket removal.
  const hook = readApp('src/hooks/useFriends.ts');
  for (const fn of [
    'acceptFriendRequest', 'declineFriendRequest', 'removeFriend',
    'blockFriend', 'unblockFriend', 'cancelFriendRequest', 'addFriend',
  ]) {
    const start = hook.indexOf(`const ${fn} = useCallback(`);
    assert.ok(start > 0, `${fn} must still exist in useFriends.ts`);
    const end = hook.indexOf('const ', start + 10) > start
      ? hook.indexOf('\n  const ', start + 10)
      : hook.length;
    const body = hook.slice(start, end === -1 ? hook.length : end);
    assert.match(
      body, /queryClient\.invalidateQueries\(/,
      `${fn} must still invalidate — dropping this would leave friend lists stale after an action`,
    );
  }

  // The three invalidators themselves are untouched — only their MOUNT callers were removed.
  assert.match(hook, /const fetchFriends = useCallback\(async \(\) => \{\s*await queryClient\.invalidateQueries\(/);
  assert.match(hook, /const loadFriendRequests = useCallback\(async \(\) => \{\s*await queryClient\.invalidateQueries\(/);
  assert.match(hook, /const fetchBlockedUsers = useCallback\(async \(\) => \{\s*await queryClient\.invalidateQueries\(/);
});

test('C3.8 the 60s friend-request poll in the shell is untouched', () => {
  // app/index.tsx's poll is the app-wide freshness floor for requests. Removing the tab
  // mount invalidation is only safe because this still runs.
  const src = fs.readFileSync(path.join(APP_MOBILE_ROOT, 'app/index.tsx'), 'utf8');
  assert.match(src, /setInterval\(checkFriendRequests, 60000\)/);
  assert.match(src, /await loadFriendRequests\(\);/);
});

// ═══════════════════════════════════════════════════════════════════════════════
// OUT-OF-SCOPE TRIPWIRE
// ═══════════════════════════════════════════════════════════════════════════════

test('S1 the ORCH-0995 startTransition scheduling still holds, and is now paired with a pending state', () => {
  // AMENDED when the #1638 scheduling leg landed.
  //
  // This started life as an OUT-OF-SCOPE tripwire: PR #1660 shipped three quick wins and
  // deliberately did not touch the scheduling, so S1 asserted "unchanged". The scheduling
  // leg then landed in the same issue and RE-AFFIRMED the transition with measurements on
  // a physical Samsung SM-A725F (48ms p50 scheduling gap vs a 256ms p50 JS-thread block
  // during the commit — the transition buys ordering, not responsiveness, and that
  // ordering is what lets the pending state paint first).
  //
  // So the first assertion is unchanged and still fails on revert. The second is ADDED,
  // not substituted: what #1660 could not assert is that the deferral is paired with
  // something to render in the gap, which is the actual defect. Weakening was not an
  // option and was not taken — this tripwire is strictly stronger than it was.
  const src = fs.readFileSync(path.join(APP_MOBILE_ROOT, 'app/index.tsx'), 'utf8');
  assert.match(
    src, /React\.startTransition\(\(\) => \{[\s\S]{0,200}?setCurrentPage\(page\)/,
    'app/index.tsx must still wrap setCurrentPage in React.startTransition',
  );
  const beginIdx = src.indexOf('tabSwitchHostRef.current?.beginSwitch(page)');
  assert.notEqual(
    beginIdx, -1,
    'the deferred mount must be paired with an urgent pending state (beginSwitch) — a transition with nothing rendered in the interim IS the #1638 defect',
  );
  assert.ok(
    beginIdx < src.indexOf('React.startTransition('),
    'beginSwitch(page) must run before the transition is scheduled',
  );
});
