/**
 * Issue #1642 — TESTER ADVERSARIAL SUITE.
 *
 * A DIFFERENT ANGLE from the implementor's `issue_1642_been_here_offline_write_bound`.
 * That suite proves the offline tap REACHES a bounded failure. This one attacks the
 * other half of #1642's decision — that the failed write is ABANDONED — along the two
 * routes by which an abandoned write can still come back from the dead:
 *
 *   1. THE PERSISTED-MUTATION STORE, ACROSS AN APP RESTART. The implementor's T-3
 *      asserts `dehydrate(queryClient).mutations.length === 0` — an IN-MEMORY snapshot
 *      of the SAME client, taken while the app is still running. That does not exercise
 *      the thing that actually bit us: app/_layout.tsx wraps the tree in
 *      PersistQueryClientProvider with `createAsyncStoragePersister`, and its
 *      `dehydrateOptions` overrides ONLY `shouldDehydrateQuery`. `shouldDehydrateMutation`
 *      is therefore query-core's default, `(m) => m.state.isPaused`. So a paused write is
 *      serialised to AsyncStorage, survives process death, and is restored into a LATER
 *      session — a session in which the user has already been told "Couldn't save".
 *      This suite drives the REAL persister and a REAL second QueryClient across that
 *      boundary.
 *
 *      This is not hypothetical. Verifying #1642 on an iOS simulator against a genuinely
 *      partitioned host left TWO such entries in the app's live AsyncStorage — both
 *      written by PRE-FIX taps, `isPaused: true, status: "pending"`, one of them 30
 *      minutes old and already survivor of a cold launch. Zero were written by taps on
 *      the fixed build. This suite is that observation, mechanised.
 *
 *   2. THE RECONNECT RACE. T-3 reconnects only AFTER the write has settled. The
 *      dangerous ordering is the opposite one: connectivity returning WHILE the tap is
 *      still in flight. `queryClient.mount()` subscribes `resumePausedMutations()` to
 *      BOTH the online and the focus manager, so under the pre-fix configuration that
 *      flip is what fires the write — and `record-visit` stamps
 *      `visited_at: new Date().toISOString()` at EXECUTION time, so the row is dated to
 *      the reconnect rather than to the tap. Constitution rule 9: fabricated data.
 *
 * PARTITION SHAPE. The implementor's stub NEVER SETTLES, which models a socket that
 * hangs (captive portal) and makes the 15s operation bound the thing that fires. This
 * suite models the OTHER real shape, and the one both physical devices actually showed:
 * React Native's `fetch` REJECTS immediately when there is no route. Android SM-A725F
 * failed in 86ms; an iOS simulator against a host with no non-loopback interface at all
 * failed in 24ms (`[MUTATION] start 00:59:43.909` -> `ERROR +24ms`). Rejecting is also
 * what makes the reconnect race testable at all: the write has to reach a terminal state
 * before connectivity returns, or there is no "already told the user it failed" to
 * contradict.
 *
 * The stub is driven by the REAL `onlineManager`, so "the network came back" is a single
 * source of truth for both query-core and the transport — exactly as on a device.
 *
 * A-0 and A-1 are the anti-vacuity controls. A zero-count assertion is worthless unless
 * the harness is proven able to produce a NON-zero count, and #1607/#1627/#1631/#1633
 * were all assertions that did not assert. A-0 proves the persister round-trip carries a
 * paused mutation at all; A-1 proves the PRE-FIX configuration really does strand one.
 *
 * Requires Node >= 22.13 for `module.stripTypeScriptTypes`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

import { QueryClient, MutationObserver, onlineManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  persistQueryClientSave,
  persistQueryClientRestore,
} from '@tanstack/query-persist-client-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appMobile = path.resolve(__dirname, '../../..');

const USE_VISITS = path.join(appMobile, 'src/hooks/useVisits.ts');
const VISIT_SERVICE = path.join(appMobile, 'src/services/visitService.ts');
const ROOT_LAYOUT = path.join(appMobile, 'app/_layout.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// Comment stripper. Independent of the implementor's. #1642 ships a long comment
// that names `networkMode: 'always'` repeatedly, so an extractor that reads raw
// source would find the PROSE and pass on a file whose real option was deleted.
// Proven against a decoy in A-0.
// ─────────────────────────────────────────────────────────────────────────────
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const codeUseVisits = stripComments(fs.readFileSync(USE_VISITS, 'utf8'));

/**
 * The networkMode the named hook ACTUALLY configures, read by brace-matching the
 * useMutation({...}) argument so a neighbouring hook's option can never leak in.
 * `undefined` is the pre-#1642 state and is what makes A-2/A-3/A-4 fail on revert.
 */
function configuredNetworkMode(hookName) {
  const at = codeUseVisits.indexOf(`export function ${hookName}(`);
  assert.ok(at > 0, `VACUITY: ${hookName} not found in useVisits.ts — this suite would test nothing.`);
  const call = codeUseVisits.indexOf('useMutation({', at);
  assert.ok(call > at, `VACUITY: ${hookName} no longer calls useMutation({ ... }).`);
  let depth = 0;
  let end = -1;
  for (let i = call + 'useMutation('.length; i < codeUseVisits.length; i++) {
    const ch = codeUseVisits[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > 0, `VACUITY: could not brace-match ${hookName}'s useMutation argument.`);
  const m = codeUseVisits.slice(call, end).match(/networkMode:\s*['"]([a-zA-Z]+)['"]/);
  return m ? m[1] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// The real visitService.ts, byte-for-byte, with only its Supabase client stubbed.
// The stub rejects while onlineManager says offline and resolves when it says
// online — one source of truth for query-core and the transport, as on a device.
// ─────────────────────────────────────────────────────────────────────────────
let tmpDir;
let visitService;
let stub;

before(async () => {
  const raw = fs.readFileSync(VISIT_SERVICE, 'utf8');

  const relativeImports = [...stripComments(raw).matchAll(/from\s+['"](\.[^'"]*)['"]/g)].map((m) => m[1]);
  assert.deepEqual(
    relativeImports,
    ['./supabase'],
    'VACUITY: visitService.ts gained or lost a relative import; this loader stubs exactly '
      + `one ('./supabase') and found ${JSON.stringify(relativeImports)}. Stub the new one first.`,
  );

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue1642-adv-'));
  const stubPath = path.join(tmpDir, 'supabaseStub.mjs');

  // The stub lives outside the package, so bare-specifier resolution does not
  // reach app-mobile/node_modules. Resolve to the SAME module instance this file
  // holds — a second copy of react-query would carry a second onlineManager and
  // the transport would stop agreeing with query-core about connectivity.
  const reactQueryUrl = import.meta.resolve('@tanstack/react-query');
  assert.ok(reactQueryUrl?.startsWith('file:'), 'VACUITY: could not resolve @tanstack/react-query to a file URL.');

  fs.writeFileSync(
    stubPath,
    `
import { onlineManager } from ${JSON.stringify(reactQueryUrl)};

// Every invocation is timestamped so a LATE write (one that fired after the user
// was already shown "Couldn't save") is distinguishable from the original tap.
export const invocations = [];

function transport(name) {
  invocations.push({ name, at: Date.now(), online: onlineManager.isOnline() });
  if (!onlineManager.isOnline()) {
    // React Native's fetch with no route. Measured on the real thing: Android
    // SM-A725F 86ms, iOS simulator 24ms. supabase-js wraps it as this error.
    return Promise.reject(Object.assign(new Error('Failed to send a request to the Edge Function'), {
      name: 'FunctionsFetchError',
    }));
  }
  return Promise.resolve({ data: { visitId: 'srv-visit-id', isNew: true }, error: null });
}

export const supabase = {
  functions: { invoke: (...a) => transport('functions.invoke', a) },
  auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  from: () => { throw new Error('visit WRITES must not touch .from() — they go through the edge function'); },
};
`,
  );

  const stripped = stripTypeScriptTypes(raw, { mode: 'strip' });
  const rewritten = stripped.replace("from './supabase'", `from ${JSON.stringify(pathToFileURL(stubPath).href)}`);
  assert.notEqual(
    rewritten,
    stripped,
    'VACUITY: the Supabase import was not rewritten, so this suite is not running the shipped service.',
  );

  const modPath = path.join(tmpDir, 'visitService.mjs');
  fs.writeFileSync(modPath, rewritten);
  visitService = await import(pathToFileURL(modPath).href);
  stub = await import(pathToFileURL(stubPath).href);

  for (const name of ['recordVisit', 'removeVisit', 'VISIT_WRITE_TIMEOUT_MS']) {
    assert.ok(visitService[name] !== undefined, `VACUITY: visitService.ts no longer exports ${name}.`);
  }
});

after(() => {
  onlineManager.setOnline(true);
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// A fake AsyncStorage with the exact three-method surface
// @react-native-async-storage/async-storage exposes to the persister, plus the
// app's own persister construction.
// ─────────────────────────────────────────────────────────────────────────────
function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
  };
}

/** Persisted paused-mutation entries, read back out of storage the way a relaunch would. */
function persistedMutations(storage) {
  for (const [, v] of storage.map) {
    try {
      const parsed = JSON.parse(v);
      if (parsed?.clientState?.mutations) return parsed.clientState.mutations;
    } catch { /* not the cache key */ }
  }
  return [];
}

/**
 * Session 1: cold client, go offline, tap "Been here", let it settle, then persist
 * exactly as PersistQueryClientProvider does on its way to AsyncStorage.
 */
async function offlineTapThenPersist({ networkMode, storage }) {
  onlineManager.setOnline(false);

  const queryClient = new QueryClient();
  queryClient.mount(); // installs the online/focus resumePausedMutations() subscriptions

  let fnCalls = 0;
  const observer = new MutationObserver(queryClient, {
    ...(networkMode === undefined ? {} : { networkMode }),
    mutationFn: (params) => { fnCalls++; return visitService.recordVisit(params); },
  });

  const params = {
    experienceId: 'exp-yonder-coffee',
    cardData: { category: 'Icebreakers', title: 'Yonder Coffee' },
  };
  observer.mutate(params).catch(() => { /* terminal state is read off the observer */ });

  // Long enough for a rejecting transport to settle; far short of the 15s bound,
  // so a PAUSED mutation is still visibly pending here rather than timed out.
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const s = observer.getCurrentResult().status;
    if (s === 'error' || s === 'success') break;
    await new Promise((r) => setTimeout(r, 25));
  }

  const persister = createAsyncStoragePersister({ storage, throttleTime: 0 });
  await persistQueryClientSave({ queryClient, persister });

  return {
    queryClient,
    observer,
    persister,
    fnCalls: () => fnCalls,
    result: observer.getCurrentResult(),
    teardown() { queryClient.unmount(); queryClient.clear(); },
  };
}

/** Session 2: a brand-new client restored from storage, then connectivity returns. */
async function relaunchAndReconnect({ storage }) {
  const queryClient = new QueryClient();
  const persister = createAsyncStoragePersister({ storage, throttleTime: 0 });
  await persistQueryClientRestore({ queryClient, persister, maxAge: 24 * 60 * 60 * 1000 });
  queryClient.mount();

  const restored = queryClient.getMutationCache().getAll();

  onlineManager.setOnline(true);
  await queryClient.resumePausedMutations().catch(() => {});
  await new Promise((r) => setTimeout(r, 300));

  return {
    restoredCount: restored.length,
    restoredPaused: restored.filter((m) => m.state.isPaused).length,
    teardown() { queryClient.unmount(); queryClient.clear(); },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

test('A-0 the harness can carry a paused mutation through the REAL persister (anti-vacuity)', async () => {
  const decoy = `const a = 1; // networkMode: 'always'\n/* networkMode: 'always' */\nconst s = "// not a comment";`;
  const strippedDecoy = stripComments(decoy);
  assert.equal(
    (strippedDecoy.match(/networkMode/g) ?? []).length,
    0,
    'A-0: the stripper left a commented networkMode behind, so every extraction below could read prose.',
  );
  assert.match(strippedDecoy, /"\/\/ not a comment"/, 'A-0: the stripper ate a string literal.');

  // A hand-built paused mutation must survive save -> restore. Without this, the
  // zero-count assertions in A-2 could pass simply because nothing ever persists.
  const storage = makeStorage();
  const persister = createAsyncStoragePersister({ storage, throttleTime: 0 });
  const c1 = new QueryClient();
  c1.getMutationCache().build(c1, { mutationKey: ['probe'] }, undefined);
  const probe = c1.getMutationCache().getAll()[0];
  probe.state = { ...probe.state, isPaused: true, status: 'pending', variables: { probe: true } };
  await persistQueryClientSave({ queryClient: c1, persister });

  assert.equal(
    persistedMutations(storage).length,
    1,
    'A-0: the real persister did not carry a paused mutation into storage, so this suite '
      + 'cannot tell "abandoned" from "never wired up". Fix the harness before trusting A-2.',
  );

  const c2 = new QueryClient();
  await persistQueryClientRestore({ queryClient: c2, persister, maxAge: 24 * 60 * 60 * 1000 });
  assert.equal(
    c2.getMutationCache().getAll().length,
    1,
    'A-0: restore did not rebuild the persisted mutation into a fresh client.',
  );
});

test('A-0b the app still lets query-core decide which MUTATIONS persist', () => {
  const layout = stripComments(fs.readFileSync(ROOT_LAYOUT, 'utf8'));
  assert.ok(
    layout.includes('PersistQueryClientProvider'),
    'A-0b: the root layout no longer mounts PersistQueryClientProvider — re-point this suite.',
  );
  assert.ok(
    layout.includes('shouldDehydrateQuery'),
    'A-0b: dehydrateOptions no longer filters queries; the harness assumptions have moved.',
  );
  assert.ok(
    !layout.includes('shouldDehydrateMutation'),
    'A-0b: app/_layout.tsx now overrides shouldDehydrateMutation. query-core\'s default is '
      + '`(m) => m.state.isPaused`, and THAT default is why a pre-#1642 paused write reached '
      + 'AsyncStorage and could fire in a later session. If the app now filters mutations '
      + 'itself, #1642\'s "nothing is ever queued" guarantee no longer rests on networkMode '
      + 'alone and this suite must be rewritten to prove the new filter.',
  );
});

test('A-1 NEGATIVE CONTROL — the pre-#1642 configuration strands a write in AsyncStorage', async () => {
  const storage = makeStorage();
  const s1 = await offlineTapThenPersist({ networkMode: undefined, storage });

  assert.equal(
    s1.fnCalls(),
    0,
    'A-1: with the default networkMode the mutationFn must never run offline — that is the bug.',
  );
  assert.equal(s1.result.isPaused, true, 'A-1: the pre-fix write should be PAUSED.');
  assert.equal(s1.result.status, 'pending', 'A-1: the pre-fix write should still be pending.');

  const stranded = persistedMutations(storage);
  assert.equal(
    stranded.length,
    1,
    'A-1: the pre-fix paused write was NOT persisted, so this harness cannot detect the '
      + 'defect and A-2\'s zero-count would be meaningless.',
  );
  assert.equal(stranded[0].state.isPaused, true, 'A-1: the stranded entry should be marked paused.');
  s1.teardown();

  const s2 = await relaunchAndReconnect({ storage });
  assert.equal(
    s2.restoredCount,
    1,
    'A-1: a brand-new client did not restore the stranded write. The cross-session route '
      + 'this suite exists to close would not be exercised.',
  );
  s2.teardown();
});

test('A-2 the shipped config leaves NOTHING behind for a later session to replay', async () => {
  const storage = makeStorage();
  const mode = configuredNetworkMode('useRecordVisit');
  const s1 = await offlineTapThenPersist({ networkMode: mode, storage });

  assert.ok(
    s1.fnCalls() >= 1,
    `A-2: useRecordVisit's configured networkMode (${String(mode)}) still paused the write offline, `
      + 'so recordVisit never ran. #1642 — the operation bound below it is unreachable.',
  );
  assert.equal(
    s1.result.status,
    'error',
    `A-2: the offline write settled as "${s1.result.status}" rather than reaching a failure the `
      + 'user can see. "Couldn\'t save" is #1642\'s acceptance bar.',
  );
  assert.equal(s1.result.isPaused, false, 'A-2: a write that reached the user as failed must not also be paused.');

  assert.equal(
    persistedMutations(storage).length,
    0,
    'A-2: an abandoned Been-here write was serialised into AsyncStorage. #1642 decided the '
      + 'write is abandoned, not queued: a later silent success contradicts the "Couldn\'t save" '
      + 'the user was already shown, and record-visit stamps visited_at at EXECUTION time, so a '
      + 'replay dates the visit to the replay (Constitution rule 9).',
  );
  s1.teardown();

  const s2 = await relaunchAndReconnect({ storage });
  assert.equal(
    s2.restoredCount,
    0,
    'A-2: a later app session restored a Been-here write from storage. Nothing may survive '
      + 'the process boundary.',
  );
  s2.teardown();
});

test('A-3 RECONNECT RACE — connectivity returning mid-tap must not fire a second write', async () => {
  onlineManager.setOnline(false);
  const before = stub.invocations.length;

  const queryClient = new QueryClient();
  queryClient.mount();

  let fnCalls = 0;
  const observer = new MutationObserver(queryClient, {
    ...(configuredNetworkMode('useRecordVisit') === undefined
      ? {}
      : { networkMode: configuredNetworkMode('useRecordVisit') }),
    mutationFn: (params) => { fnCalls++; return visitService.recordVisit(params); },
  });

  observer.mutate({ experienceId: 'exp-race', cardData: { category: 'Icebreakers', title: 'Yonder Coffee' } })
    .catch(() => {});

  // Reconnect while the tap is still the most recent thing that happened — the
  // ordering T-3 never exercises, and the one queryClient.mount()'s online
  // subscription turns into resumePausedMutations().
  await new Promise((r) => setTimeout(r, 120));
  const statusAtReconnect = observer.getCurrentResult().status;
  onlineManager.setOnline(true);
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(
    statusAtReconnect,
    'error',
    `A-3: at the moment connectivity returned the write was "${statusAtReconnect}", not a settled `
      + 'failure. Under the pre-#1642 configuration it is still paused here, and the reconnect is '
      + 'what executes it — the row that landed 3.5 minutes after the tap.',
  );

  const after = stub.invocations.slice(before);
  const onlineInvocations = after.filter((i) => i.online === true);
  assert.equal(
    onlineInvocations.length,
    0,
    'A-3: a Been-here write reached the transport AFTER connectivity returned. record-visit '
      + `stamps visited_at at execution time, so this row would be dated to the reconnect. Saw: `
      + `${JSON.stringify(onlineInvocations)}`,
  );
  assert.equal(fnCalls, 1, `A-3: recordVisit ran ${fnCalls} times for ONE tap.`);
  assert.equal(
    observer.getCurrentResult().status,
    'error',
    'A-3: the failure the user was shown was silently replaced after reconnection.',
  );

  queryClient.unmount();
  queryClient.clear();
});

test('A-4 the un-press is abandoned on exactly the same terms', async () => {
  const storage = makeStorage();
  onlineManager.setOnline(false);

  const queryClient = new QueryClient();
  queryClient.mount();

  let fnCalls = 0;
  const mode = configuredNetworkMode('useRemoveVisit');
  const observer = new MutationObserver(queryClient, {
    ...(mode === undefined ? {} : { networkMode: mode }),
    mutationFn: (id) => { fnCalls++; return visitService.removeVisit(id); },
  });
  observer.mutate('exp-yonder-coffee').catch(() => {});

  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (observer.getCurrentResult().status === 'error') break;
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.ok(
    fnCalls >= 1,
    `A-4: useRemoveVisit's configured networkMode (${String(mode)}) paused the un-press offline. A `
      + 'bounded record with a paused remove still hangs forever on the same control.',
  );
  assert.equal(observer.getCurrentResult().status, 'error', 'A-4: the offline un-press did not reach a failure.');

  const persister = createAsyncStoragePersister({ storage, throttleTime: 0 });
  await persistQueryClientSave({ queryClient, persister });
  assert.equal(
    persistedMutations(storage).length,
    0,
    'A-4: an abandoned un-press was serialised to AsyncStorage and can be replayed in a later '
      + 'session — deleting a visit the user may since have deliberately re-recorded.',
  );

  queryClient.unmount();
  queryClient.clear();
});
