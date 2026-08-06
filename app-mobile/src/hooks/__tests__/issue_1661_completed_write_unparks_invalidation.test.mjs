/**
 * Issue #1661 — after a Been-here write completes, the control must settle to
 * "You've been here" WITHOUT a relaunch, even when query-core still believes
 * the device is offline.
 *
 * WHAT THE BUG ACTUALLY IS. The issue was reported as "after any Been-here
 * mutation ERROR, every later successful write stops invalidating". That is not
 * the mechanism, and this suite proves it in both directions:
 *
 *   - T-1 shows an error while ONLINE poisons nothing. The mutation errors, the
 *     next write succeeds, and BOTH keys refetch exactly as they always did.
 *   - T-2 shows the real trigger with no error involved AT ALL: a write that
 *     COMPLETES while `onlineManager.isOnline()` is false. `onSuccess` runs,
 *     `invalidateQueries` runs, query-core records `isInvalidated: true` — and
 *     then parks the refetch at `fetchStatus: 'paused'`, because a query whose
 *     `networkMode` is the default `'online'` does not fetch while that belief
 *     is false. The row lands, the read never happens, the control keeps
 *     rendering "Been here".
 *
 * The error and the parked invalidation are CO-SYMPTOMS of the same stale
 * offline belief, which is why they always appeared together on a device.
 *
 * WHY THE BELIEF GOES STALE AND STAYS STALE. `config/queryClient.ts` drives
 * `onlineManager` from NetInfo. NetInfo's default `useNativeReachability: true`
 * means `isInternetReachable` comes ONLY from native events — in that branch
 * `internetReachability.ts` never schedules `_checkInternetReachability`, so
 * there is no JS polling fallback to correct it. #1642's iOS verification
 * caught this directly: a pre-fix PAUSED mutation was still paused 60 s after
 * connectivity was restored, i.e. `onlineManager` never came back.
 *
 * WHY #1642 EXPOSED IT. Before #1642 both visit mutations used the default
 * `networkMode: 'online'`, so a write could not COMPLETE while the belief was
 * false — it paused (which was #1642's own bug). `networkMode: 'always'` makes
 * the write run regardless, which is right, but it lets a write succeed while
 * every read behind it is still gated on the stale belief.
 *
 * WHAT THIS SUITE IS. Behavioural, not structural. Four issues in one week
 * (#1607, #1627, #1631, #1633) were assertions that did not assert. Nothing
 * here greps for an option name. It:
 *
 *   - loads the REAL `hooks/useVisits.ts` through Node's own TypeScript
 *     stripper, with `useMutation`/`useQueryClient` stubbed so the shipped
 *     `onSuccess` / `onError` / `mutationFn` can be captured as live functions
 *     and handed to the REAL `@tanstack/react-query` machinery;
 *   - uses the REAL `onlineManager` singleton — the same module instance
 *     `config/queryClient.ts` wires to NetInfo — driven offline exactly the way
 *     NetInfo drives it (`isConnected && isInternetReachable !== false`);
 *   - uses the REAL `hooks/queryKeys.ts` factory for `savedCardKeys`;
 *   - runs a REAL `QueryObserver` on `visitKeys.check(...)`, the query
 *     `useHasVisited` runs and `BeenHereControl` reads `visited` from, and
 *     counts ACTUAL queryFn invocations rather than trusting cache flags.
 *
 * `networkMode: 'always'` is forced onto the mutation observer here rather than
 * read out of `useVisits.ts`, deliberately: #1661 is separable from #1642 and
 * must be provable on a branch where #1642 has not merged. The state under
 * test — "a write completed while query-core believes it is offline" — is the
 * state, however the write got there.
 *
 * Requires Node >= 22.13 for `module.stripTypeScriptTypes`. Registered in
 * .github/workflows/issue-1661-completed-write-unparks-invalidation.yml.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

import {
  QueryClient,
  QueryObserver,
  MutationObserver,
  onlineManager,
} from '@tanstack/react-query';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appMobile = path.resolve(__dirname, '../../..');

const USE_VISITS = path.join(appMobile, 'src/hooks/useVisits.ts');
const QUERY_KEYS = path.join(appMobile, 'src/hooks/queryKeys.ts');
const QUERY_CLIENT = path.join(appMobile, 'src/config/queryClient.ts');

const USER = 'demo-user-1661';
const EXPERIENCE = 'exp-1661';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Load the REAL useVisits.ts with its three imports redirected:
//
//   '@tanstack/react-query'   -> a stub exposing the REAL onlineManager plus
//                                capturing useMutation/useQuery stubs
//   '../services/visitService'-> a controllable transport stub
//   './queryKeys'             -> the REAL factory, type-stripped
//
// The hooks are then callable as plain functions outside React, and what comes
// back is the shipped options object — the real `onSuccess`, not a paraphrase.
// ─────────────────────────────────────────────────────────────────────────────
let tmpDir;
let useVisits;
let rqStub;
let serviceStub;
let realQueryKeys;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue1661-'));

  // The REAL onlineManager instance, handed to the stub by identity. Using a
  // global rather than a bare import keeps the generated modules loadable from
  // outside the package root; T-0 asserts the identity actually survived.
  globalThis.__ISSUE_1661_ONLINE_MANAGER__ = onlineManager;

  // — the real key factory, verbatim —
  const keysSrc = fs.readFileSync(QUERY_KEYS, 'utf8');
  const keysPath = path.join(tmpDir, 'queryKeys.mjs');
  fs.writeFileSync(keysPath, stripTypeScriptTypes(keysSrc, { mode: 'strip' }));
  realQueryKeys = await import(pathToFileURL(keysPath).href);

  // — react-query stub —
  const rqPath = path.join(tmpDir, 'reactQueryStub.mjs');
  fs.writeFileSync(
    rqPath,
    `
export const onlineManager = globalThis.__ISSUE_1661_ONLINE_MANAGER__;
if (!onlineManager) throw new Error('VACUITY: the real onlineManager was not handed to the stub');

let client = null;
export function __setClient(c) { client = c; }
export function useQueryClient() {
  if (!client) throw new Error('VACUITY: useQueryClient called before __setClient');
  return client;
}
export const capturedMutations = [];
export function useMutation(options) { capturedMutations.push(options); return options; }
export function useQuery(options) { return options; }
`,
  );

  // — visitService stub. RecordVisitParams is a TYPE, but Node's stripper is not
  //   type-aware, so the import binding survives and must be satisfiable. —
  const svcPath = path.join(tmpDir, 'visitServiceStub.mjs');
  fs.writeFileSync(
    svcPath,
    `
export const control = { mode: 'ok', recordCalls: 0, removeCalls: 0, onRecord: null, onRemove: null };
export const RecordVisitParams = undefined;

function fail() {
  const e = new Error('Failed to send a request to the Edge Function');
  e.name = 'FunctionsFetchError';
  return e;
}

export async function recordVisit(params) {
  control.recordCalls++;
  if (control.mode === 'reject') throw fail();
  control.onRecord?.(params);
  return { visitId: 'v-1661', isNew: true };
}
export async function removeVisit(experienceId) {
  control.removeCalls++;
  if (control.mode === 'reject') throw fail();
  control.onRemove?.(experienceId);
}
export async function fetchMyVisits() { return []; }
export async function fetchPairedUserVisits() { return []; }
export async function hasVisited() { return false; }
export const VISIT_WRITE_TIMEOUT_MS = 15000;
`,
  );

  const raw = fs.readFileSync(USE_VISITS, 'utf8');
  let rewritten = stripTypeScriptTypes(raw, { mode: 'strip' });
  const before3 = rewritten;
  rewritten = rewritten
    .replace("from '@tanstack/react-query'", `from ${JSON.stringify(pathToFileURL(rqPath).href)}`)
    .replace("from '../services/visitService'", `from ${JSON.stringify(pathToFileURL(svcPath).href)}`)
    .replace("from './queryKeys'", `from ${JSON.stringify(pathToFileURL(keysPath).href)}`);

  assert.notEqual(
    rewritten,
    before3,
    'VACUITY: no import specifier in useVisits.ts was rewritten, so the real modules '
      + 'would be loaded (or none would). Refusing to report a result.',
  );
  for (const spec of ['@tanstack/react-query', '../services/visitService', './queryKeys']) {
    assert.ok(
      !rewritten.includes(`from '${spec}'`),
      `VACUITY: the '${spec}' import survived the rewrite; this suite is not loading what it thinks it is.`,
    );
  }

  const modPath = path.join(tmpDir, 'useVisits.mjs');
  fs.writeFileSync(modPath, rewritten);

  useVisits = await import(pathToFileURL(modPath).href);
  rqStub = await import(pathToFileURL(rqPath).href);
  serviceStub = await import(pathToFileURL(svcPath).href);
});

after(() => {
  onlineManager.setOnline(true);
  delete globalThis.__ISSUE_1661_ONLINE_MANAGER__;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// A session: one QueryClient, one live `visits.check` observer (what
// `useHasVisited` runs and `BeenHereControl` renders from), one live
// `savedCards` observer, and the SHIPPED mutation options driving a real
// MutationObserver.
// ─────────────────────────────────────────────────────────────────────────────
function openSession({ hook = 'useRecordVisit', onSuccessOverride } = {}) {
  onlineManager.setOnline(true);

  // Mirrors config/queryClient.ts's defaultOptions.queries. T-0b guards the one
  // property this harness depends on: that queries carry NO networkMode
  // override, so query-core's default 'online' applies to every read.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: (failureCount) => failureCount < 1,
        refetchOnReconnect: 'always',
      },
    },
  });
  // mount() installs the online subscription — the ONLY thing that ever un-parks
  // a paused fetch (`queryCache.onOnline()`), and the reason a stuck belief is
  // permanent rather than merely slow.
  queryClient.mount();
  rqStub.__setClient(queryClient);

  const server = { visited: false };
  serviceStub.control.mode = 'ok';
  serviceStub.control.recordCalls = 0;
  serviceStub.control.removeCalls = 0;
  serviceStub.control.onRecord = () => { server.visited = true; };
  serviceStub.control.onRemove = () => { server.visited = false; };

  let visitFetches = 0;
  let savedFetches = 0;

  const visitKey = ['visits', 'check', USER, EXPERIENCE];
  const visitObserver = new QueryObserver(queryClient, {
    queryKey: visitKey,
    queryFn: async () => { visitFetches++; return server.visited; },
    staleTime: 10 * 60 * 1000,
  });
  const savedObserver = new QueryObserver(queryClient, {
    queryKey: realQueryKeys.savedCardKeys.list(USER),
    queryFn: async () => { savedFetches++; return []; },
  });
  const unVisit = visitObserver.subscribe(() => {});
  const unSaved = savedObserver.subscribe(() => {});

  rqStub.capturedMutations.length = 0;
  const shipped = useVisits[hook]();
  assert.equal(
    rqStub.capturedMutations.length, 1,
    `VACUITY: ${hook}() did not call useMutation exactly once; nothing was captured.`,
  );
  assert.equal(typeof shipped.mutationFn, 'function', `VACUITY: ${hook} has no mutationFn`);
  assert.equal(typeof shipped.onSuccess, 'function', `VACUITY: ${hook} has no onSuccess`);

  // networkMode is forced, not extracted — see the header. Everything else,
  // including onSuccess, is the shipped object.
  const mutationObserver = new MutationObserver(queryClient, {
    ...shipped,
    ...(onSuccessOverride ? { onSuccess: onSuccessOverride(queryClient) } : {}),
    networkMode: 'always',
  });
  const unMutation = mutationObserver.subscribe(() => {});

  return {
    server,
    queryClient,
    mutationObserver,
    counts: () => ({ visitFetches, savedFetches }),
    visitQuery: () => queryClient.getQueryCache().find({ queryKey: visitKey }),
    /** What BeenHereControl renders from: `const isVisited = visited === true`. */
    controlIsSettled: () => visitObserver.getCurrentResult().data === true,
    async tap(vars) {
      await mutationObserver.mutate(vars).catch(() => {});
      // Let the invalidation's refetch (or its absence) resolve.
      await sleep(250);
      return mutationObserver.getCurrentResult();
    },
    /**
     * The device loses signal. Exactly what config/queryClient.ts computes from
     * NetInfo: online = isConnected === true && isInternetReachable !== false.
     */
    loseSignal() { onlineManager.setOnline(false); },
    async close() {
      unVisit(); unSaved(); unMutation();
      // Teardown order matters. Destroying a query whose fetch is still PARKED
      // cancels its retryer, which resolves the pause and lets `Query.fetch()`
      // re-arm the gcTime timer that `destroy()` just cleared — the process then
      // cannot exit for 24 hours. Letting the parked fetch resolve first avoids
      // it. (query-core's MutationCache.clear() never calls Mutation.destroy()
      // at all, so those timers are cleared explicitly.)
      onlineManager.setOnline(true);
      await sleep(80);
      queryClient.unmount();
      queryClient.getMutationCache().getAll().forEach((m) => m.destroy());
      queryClient.clear();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

test('T-0 the harness really loaded the shipped hook and the real onlineManager', () => {
  assert.equal(
    rqStub.onlineManager, onlineManager,
    'T-0: the stub is not holding the REAL onlineManager singleton, so nothing below '
      + 'exercises the object config/queryClient.ts wires to NetInfo.',
  );
  assert.equal(typeof useVisits.useRecordVisit, 'function', 'T-0: useRecordVisit did not load');
  assert.equal(typeof useVisits.useRemoveVisit, 'function', 'T-0: useRemoveVisit did not load');
  assert.deepEqual(
    [...realQueryKeys.savedCardKeys.all], ['savedCards'],
    'T-0: savedCardKeys.all is not the real factory value, so the invalidation target is wrong.',
  );
  // The bug is only expressible because a paused refetch is a real query-core
  // state. Prove the primitive rather than assuming it.
  onlineManager.setOnline(false);
  const qc = new QueryClient();
  const obs = new QueryObserver(qc, { queryKey: ['probe'], queryFn: async () => 1 });
  const un = obs.subscribe(() => {});
  assert.equal(
    obs.getCurrentResult().fetchStatus, 'paused',
    'T-0: query-core did NOT pause a default-networkMode fetch while offline. The mechanism '
      + 'this whole suite is about does not exist in this version — re-derive before trusting it.',
  );
  un(); qc.clear();
  onlineManager.setOnline(true);
});

test('T-0b config/queryClient.ts still leaves reads on the default networkMode', () => {
  // If someone gives defaultOptions.queries a networkMode, reads stop pausing
  // and this suite silently stops testing anything. Fail loudly instead.
  const src = fs.readFileSync(QUERY_CLIENT, 'utf8');
  const at = src.indexOf('defaultOptions:');
  assert.ok(at > 0, 'T-0b: defaultOptions was not found in config/queryClient.ts');
  assert.ok(
    !/networkMode/.test(src.slice(at)),
    'T-0b: config/queryClient.ts now sets a networkMode in defaultOptions. Reads may no longer '
      + 'pause while offline, which changes what #1661 is. Re-derive this suite.',
  );
});

test('T-1 CONTROL — an error while ONLINE poisons nothing (the reported cause is not the cause)', async () => {
  const s = openSession();
  try {
    await sleep(120);
    const base = s.counts().visitFetches;

    serviceStub.control.mode = 'ok';
    await s.tap({ experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'A' } });
    const afterFirst = s.counts().visitFetches;
    assert.ok(afterFirst > base, 'T-1: the baseline success did not invalidate — harness is broken');

    serviceStub.control.mode = 'reject';
    s.server.visited = false;
    const errored = await s.tap({ experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'A' } });
    assert.equal(errored.status, 'error', 'T-1: the write was supposed to fail here');

    serviceStub.control.mode = 'ok';
    const recovered = await s.tap({ experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'A' } });
    assert.equal(recovered.status, 'success', 'T-1: the recovery write did not succeed');

    assert.ok(
      s.counts().visitFetches > afterFirst,
      'T-1: a success AFTER an error did not refetch while ONLINE. If this ever fails, #1661 really '
        + 'IS error-state poisoning and the fix in useVisits.ts is aimed at the wrong layer.',
    );
    assert.equal(
      s.controlIsSettled(), true,
      'T-1: the control did not settle after an online error followed by a success.',
    );
  } finally { await s.close(); }
});

test('T-2 THE BUG — a write that completes while query-core believes it is offline must still refresh the control', async () => {
  const s = openSession();
  try {
    await sleep(120);

    // Baseline: the user has not been here, and everything is healthy.
    assert.equal(s.controlIsSettled(), false, 'T-2: baseline should be "not visited"');

    // The device loses signal. NetInfo reports it; onlineManager goes false.
    s.loseSignal();

    // The tap fails fast (#1642 made this reachable instead of an infinite spinner).
    serviceStub.control.mode = 'reject';
    const failed = await s.tap({ experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'Yonder Coffee' } });
    assert.equal(failed.status, 'error', 'T-2: the offline tap should reach a failed state (#1642)');
    assert.equal(
      onlineManager.isOnline(), false,
      'T-2: a FAILED write must NOT be treated as proof of connectivity. If onError asserts online, '
        + 'every other paused mutation in the app resumes on the strength of a request that never arrived.',
    );

    // Signal actually returns — but NetInfo does not re-emit, so the belief is
    // stale. This is the observed condition: NetInfo's native-reachability
    // branch has no polling fallback, and #1642's iOS run caught a paused write
    // still paused 60s after reconnection.
    assert.equal(onlineManager.isOnline(), false, 'T-2: precondition — the belief is still offline');

    const beforeRetry = s.counts();
    serviceStub.control.mode = 'ok';
    const ok = await s.tap({ experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'Yonder Coffee' } });

    assert.equal(ok.status, 'success', 'T-2: the retry write should succeed — the network is back');
    assert.equal(s.server.visited, true, 'T-2: the row must have landed server-side');

    const q = s.visitQuery();
    assert.notEqual(
      q.state.fetchStatus, 'paused',
      "T-2: the visit read is PARKED at fetchStatus:'paused'. The row landed and the UI will never "
        + 'learn about it — this is #1661. invalidateQueries recorded isInvalidated:'
        + `${q.state.isInvalidated} and then went nowhere.`,
    );
    assert.ok(
      s.counts().visitFetches > beforeRetry.visitFetches,
      `T-2: ['visits'] never refetched after a SUCCESSFUL write (queryFn ran `
        + `${s.counts().visitFetches}x, unchanged from ${beforeRetry.visitFetches}). `
        + 'The control keeps rendering "Been here" off stale data until relaunch.',
    );
    assert.ok(
      s.counts().savedFetches > beforeRetry.savedFetches,
      'T-2: savedCardKeys.all never refetched after a successful write, so the Likes/saved '
        + 'surfaces stay stale too.',
    );
    assert.equal(
      s.controlIsSettled(), true,
      'T-2: the control did not settle to "You\'ve been here" without a relaunch. That is #1661\'s '
        + 'entire acceptance bar.',
    );
    assert.equal(
      onlineManager.isOnline(), true,
      'T-2: a completed server round-trip left query-core still believing it is offline, so every '
        + 'OTHER query in the app stays parked behind the same stale belief.',
    );
  } finally { await s.close(); }
});

test('T-3 the parked invalidation is what breaks it — same session, correction removed', async () => {
  // NEGATIVE CONTROL. Identical to T-2 except the shipped onSuccess is replaced
  // by an invalidate-only handler. It must reproduce the defect, which is what
  // makes T-2's pass meaningful rather than vacuous. This test stays GREEN when
  // the fix is reverted — that is its job.
  const s = openSession({
    onSuccessOverride: (queryClient) => () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: realQueryKeys.savedCardKeys.all });
    },
  });
  try {
    await sleep(120);
    s.loseSignal();

    const before = s.counts();
    serviceStub.control.mode = 'ok';
    const ok = await s.tap({ experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'Yonder Coffee' } });

    assert.equal(ok.status, 'success', 'T-3: the write should still succeed — networkMode is always');
    assert.equal(s.server.visited, true, 'T-3: the row landed');
    assert.equal(
      s.counts().visitFetches, before.visitFetches,
      'T-3: an invalidate-only onSuccess DID refetch while offline. The pause mechanism is not '
        + 'present, so T-2 proves nothing.',
    );
    assert.equal(
      s.visitQuery().state.fetchStatus, 'paused',
      "T-3: expected the refetch to be parked at 'paused'",
    );
    assert.equal(s.visitQuery().state.isInvalidated, true, 'T-3: expected isInvalidated to be recorded');
    assert.equal(
      s.controlIsSettled(), false,
      'T-3: without the correction the control must still read stale — that is the bug.',
    );
  } finally { await s.close(); }
});

test('T-4 the un-press (useRemoveVisit) carries the same correction', async () => {
  const s = openSession({ hook: 'useRemoveVisit' });
  try {
    await sleep(120);
    s.server.visited = true;
    await s.queryClient.refetchQueries({ queryKey: ['visits'] });
    await sleep(150);
    assert.equal(s.controlIsSettled(), true, 'T-4: precondition — the control starts settled');

    s.loseSignal();
    const before = s.counts();
    serviceStub.control.mode = 'ok';
    const ok = await s.tap(EXPERIENCE);

    assert.equal(ok.status, 'success', 'T-4: the remove should succeed');
    assert.equal(s.server.visited, false, 'T-4: the row was removed server-side');
    assert.ok(
      s.counts().visitFetches > before.visitFetches,
      'T-4: removeVisit completed while query-core believed it was offline and its invalidation was '
        + 'parked — the control stays on "You\'ve been here" after a successful un-press.',
    );
    assert.equal(
      s.controlIsSettled(), false,
      'T-4: the control did not return to "Been here" after a successful un-press.',
    );
  } finally { await s.close(); }
});

test('T-5 nothing changes when the belief was already correct', async () => {
  // Guards against "fixing" #1661 by making writes unconditionally flip the
  // belief or by short-circuiting the read. Online is the overwhelmingly common
  // path and it must behave exactly as it did before.
  const s = openSession();
  try {
    await sleep(120);
    const before = s.counts();
    serviceStub.control.mode = 'ok';
    const ok = await s.tap({ experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'A' } });

    assert.equal(ok.status, 'success', 'T-5: the online write should succeed');
    assert.equal(
      s.counts().visitFetches, before.visitFetches + 1,
      'T-5: the online path must refetch the visit read exactly once per successful write.',
    );
    assert.equal(
      s.counts().savedFetches, before.savedFetches + 1,
      'T-5: the online path must refetch savedCards exactly once per successful write.',
    );
    assert.equal(onlineManager.isOnline(), true, 'T-5: the belief must remain online');
    assert.equal(s.controlIsSettled(), true, 'T-5: the control must settle on the online path');
  } finally { await s.close(); }
});
