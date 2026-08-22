/**
 * Issue #1661 — TESTER ADVERSARIAL SUITE.
 *
 * The implementor's suite (issue_1661_completed_write_unparks_invalidation.test.mjs)
 * proves the mechanism on ONE read (`visits.check`) plus `savedCards.list`, with
 * the device already offline BEFORE the tap and with `networkMode: 'always'`
 * FORCED onto the mutation observer by the harness.
 *
 * This suite attacks five different things, and removes the forced option.
 *
 * ─── 1. THE BELIEF GOES STALE MID-FLIGHT, AND NO OPTION IS FORCED ───────────
 *
 * The implementor forces `networkMode: 'always'` onto its MutationObserver so
 * that #1661 stays provable on a branch where #1642 has not merged. That is a
 * legitimate choice, but it means the one option the two PRs argue about is
 * hand-placed by the test rather than read from the product.
 *
 * This suite forces NOTHING. It hands query-core the shipped options object
 * verbatim — whatever `networkMode` `useVisits.ts` declares (none on the #1661
 * branch alone, `'always'` once #1642 lands) is what runs. It reaches the same
 * state by a different and more realistic route:
 *
 *     the tap starts while the device is ONLINE, the request is already on the
 *     wire, the radio blips, NetInfo emits `isInternetReachable: false`, and
 *     THEN the response arrives.
 *
 * query-core never re-pauses a mutation that is already running, so `onSuccess`
 * runs with `onlineManager.isOnline() === false` — #1661's exact state — under
 * the DEFAULT `networkMode: 'online'`, with no #1642 dependency and no forced
 * option. X-0b proves the construction actually lands in that state rather than
 * assuming it. That also makes this suite an integration proof of the combined
 * release: it exercises whatever the two PRs together actually ship.
 *
 * ─── 2. THE WHOLE `['visits']` PREFIX, NOT ONE KEY ──────────────────────────
 *
 * `onSuccess` invalidates the bare prefix `['visits']`, which covers THREE
 * separate reads — `visitKeys.my`, `visitKeys.paired` and `visitKeys.check` —
 * plus `savedCardKeys.all`, which covers `list` and `paired`. The implementor
 * watched two of those five. A fix that un-parked only the query the control
 * reads would pass that suite and still leave the user's own visit history and
 * their PARTNER's visit list stale for the rest of the session. X-2 subscribes
 * to all five and requires all five.
 *
 * ─── 3. THE PHANTOM-RETRY LOOP ──────────────────────────────────────────────
 *
 * A stale control does not sit still — the user taps it again. `record-visit`
 * upserts with `visited_at: new Date().toISOString()` unconditionally, and both
 * visit lists order by `visited_at desc`, so every phantom retry silently
 * reorders the user's and their partner's history. X-3 drives the actual user
 * loop (tap, wait, tap again if still stale) and requires the control to settle
 * on the FIRST write — one `recordVisit` call, not four.
 *
 * ─── 4. THE APP IS BACKGROUNDED BETWEEN THE WRITE AND THE REFETCH ───────────
 *
 * `config/queryClient.ts` wires `focusManager` to `AppState`. A user who taps
 * "Been here" and immediately switches apps is the common case, not an edge
 * case. X-4 puts `focusManager` in the background before the write resolves and
 * still requires the refetch — the correction must not depend on the app being
 * foregrounded, or the control settles only for users who stayed on the screen.
 *
 * ─── 5. THE BELIEF FLIPS BACK TO FALSE MID-REFETCH ──────────────────────────
 *
 * `confirmOnlineFromCompletedWrite()` sets the belief true, and the invalidation
 * starts a refetch. NetInfo is free to emit a stale `false` again one tick
 * later — that is exactly the flapping signal that produced the wrong belief in
 * the first place. X-5 does that while the refetch's `queryFn` promise is still
 * pending and requires the control to settle anyway.
 *
 * ─── 6. THE COLLATERAL CLAIM, AND THE ONE PLACE IT MUST NOT APPLY ───────────
 *
 * PR #1665 claims the correction "un-parks every other query stranded behind
 * the same stale value". X-6 parks an unrelated query (`['notifications']`)
 * before the write completes and requires it to resume. X-7 is the other side
 * of the same coin and is a CONTROL: a FAILED write proves nothing, so it must
 * NOT flip the belief and must NOT resume that unrelated query — for BOTH
 * hooks. X-7 stays green when the fix is reverted; that is its job.
 *
 * ─── FAILS-ON-REVERT ────────────────────────────────────────────────────────
 *
 * True line deletion of the two `confirmOnlineFromCompletedWrite();` call sites
 * fires X-2, X-3, X-4, X-5 and X-6. X-0, X-0b, X-1 and X-7 stay green.
 *
 * Requires Node >= 22.13 for `module.stripTypeScriptTypes`. Registered in
 * ci-batch:issue-1661-completed-write-unparks-invalidation in .github/ci-batch/MANIFEST.json.
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
  focusManager,
} from '@tanstack/react-query';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appMobile = path.resolve(__dirname, '../../..');

const USE_VISITS = path.join(appMobile, 'src/hooks/useVisits.ts');
const QUERY_KEYS = path.join(appMobile, 'src/hooks/queryKeys.ts');

const USER = 'demo-user-1661-adv';
const PARTNER = 'paired-user-1661-adv';
const EXPERIENCE = 'exp-1661-adv';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(5);
  }
  throw new Error(`VACUITY: timed out after ${timeoutMs}ms waiting for ${what}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Load the REAL useVisits.ts with its three imports redirected. Same loading
// technique as the implementor's suite — that part is not the angle, and there
// is no other way to hold the SHIPPED onSuccess as a live function. Everything
// downstream of the load is different.
// ─────────────────────────────────────────────────────────────────────────────
let tmpDir;
let useVisits;
let rqStub;
let serviceStub;
let realQueryKeys;
let rewrittenSource;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue1661adv-'));
  globalThis.__ISSUE_1661_ADV_ONLINE_MANAGER__ = onlineManager;

  const keysSrc = fs.readFileSync(QUERY_KEYS, 'utf8');
  const keysPath = path.join(tmpDir, 'queryKeys.mjs');
  fs.writeFileSync(keysPath, stripTypeScriptTypes(keysSrc, { mode: 'strip' }));
  realQueryKeys = await import(pathToFileURL(keysPath).href);

  const rqPath = path.join(tmpDir, 'reactQueryStub.mjs');
  fs.writeFileSync(
    rqPath,
    `
export const onlineManager = globalThis.__ISSUE_1661_ADV_ONLINE_MANAGER__;
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

  // The transport. `recordVisit`/`removeVisit` HOLD until the harness releases
  // them, which is what lets the belief go stale mid-flight — the whole point.
  const svcPath = path.join(tmpDir, 'visitServiceStub.mjs');
  fs.writeFileSync(
    svcPath,
    `
export const RecordVisitParams = undefined;
export const control = {
  mode: 'ok',
  recordCalls: 0,
  removeCalls: 0,
  inFlight: 0,
  gate: null,
  release: null,
  onRecord: null,
  onRemove: null,
};

export function hold() {
  control.gate = new Promise((resolve) => { control.release = resolve; });
}

function fail() {
  const e = new Error('Failed to send a request to the Edge Function');
  e.name = 'FunctionsFetchError';
  return e;
}

async function gate() {
  control.inFlight++;
  try {
    if (control.gate) await control.gate;
  } finally {
    control.inFlight--;
  }
}

export async function recordVisit(params) {
  control.recordCalls++;
  await gate();
  if (control.mode === 'reject') throw fail();
  control.onRecord?.(params);
  return { visitId: 'v-1661-adv', isNew: true };
}
export async function removeVisit(experienceId) {
  control.removeCalls++;
  await gate();
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
  const stripped = stripTypeScriptTypes(raw, { mode: 'strip' });
  rewrittenSource = stripped
    .replace("from '@tanstack/react-query'", `from ${JSON.stringify(pathToFileURL(rqPath).href)}`)
    .replace("from '../services/visitService'", `from ${JSON.stringify(pathToFileURL(svcPath).href)}`)
    .replace("from './queryKeys'", `from ${JSON.stringify(pathToFileURL(keysPath).href)}`);

  assert.notEqual(
    rewrittenSource,
    stripped,
    'VACUITY: no import specifier in useVisits.ts was rewritten, so this suite is not loading '
      + 'what it thinks it is. Refusing to report a result.',
  );
  for (const spec of ['@tanstack/react-query', '../services/visitService', './queryKeys']) {
    assert.ok(
      !rewrittenSource.includes(`from '${spec}'`),
      `VACUITY: the '${spec}' import survived the rewrite.`,
    );
  }

  const modPath = path.join(tmpDir, 'useVisits.mjs');
  fs.writeFileSync(modPath, rewrittenSource);

  useVisits = await import(pathToFileURL(modPath).href);
  rqStub = await import(pathToFileURL(rqPath).href);
  serviceStub = await import(pathToFileURL(svcPath).href);
});

after(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  delete globalThis.__ISSUE_1661_ADV_ONLINE_MANAGER__;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// A session. FIVE live reads across everything `onSuccess` invalidates, plus one
// unrelated read used by X-6/X-7, plus the SHIPPED mutation options handed to a
// real MutationObserver with NOTHING overridden.
// ─────────────────────────────────────────────────────────────────────────────
function openSession({ hook = 'useRecordVisit', onSuccessOverride } = {}) {
  onlineManager.setOnline(true);
  focusManager.setFocused(true);

  // Mirrors config/queryClient.ts defaultOptions.queries. No networkMode — that
  // is the product's state and the reason the pause exists.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: () => false,
        refetchOnReconnect: 'always',
      },
    },
  });
  queryClient.mount();
  rqStub.__setClient(queryClient);

  const server = { visited: false, myVisits: [], partnerVisits: [] };
  Object.assign(serviceStub.control, {
    mode: 'ok', recordCalls: 0, removeCalls: 0, gate: null, release: null,
  });
  serviceStub.control.onRecord = () => {
    server.visited = true;
    server.myVisits = [EXPERIENCE];
    server.partnerVisits = [EXPERIENCE];
  };
  serviceStub.control.onRemove = () => {
    server.visited = false;
    server.myVisits = [];
    server.partnerVisits = [];
  };

  const counts = { check: 0, my: 0, paired: 0, savedList: 0, savedPaired: 0, unrelated: 0 };

  // The three reads under the bare ['visits'] prefix that onSuccess invalidates.
  const kCheck = useVisits.visitKeys.check(USER, EXPERIENCE);
  const kMy = useVisits.visitKeys.my(USER);
  const kPaired = useVisits.visitKeys.paired(USER, PARTNER);
  // The two reads under savedCardKeys.all.
  const kSavedList = realQueryKeys.savedCardKeys.list(USER);
  const kSavedPaired = realQueryKeys.savedCardKeys.paired(PARTNER);
  // Nothing to do with visits — X-6/X-7.
  const kUnrelated = ['notifications', 'list', USER];

  const obsCheck = new QueryObserver(queryClient, {
    queryKey: kCheck, queryFn: async () => { counts.check++; return server.visited; },
    staleTime: 10 * 60 * 1000,
  });
  const obsMy = new QueryObserver(queryClient, {
    queryKey: kMy, queryFn: async () => { counts.my++; return [...server.myVisits]; },
    staleTime: 5 * 60 * 1000,
  });
  const obsPaired = new QueryObserver(queryClient, {
    queryKey: kPaired, queryFn: async () => { counts.paired++; return [...server.partnerVisits]; },
    staleTime: 5 * 60 * 1000,
  });
  const obsSavedList = new QueryObserver(queryClient, {
    queryKey: kSavedList, queryFn: async () => { counts.savedList++; return []; },
  });
  const obsSavedPaired = new QueryObserver(queryClient, {
    queryKey: kSavedPaired, queryFn: async () => { counts.savedPaired++; return []; },
  });
  const obsUnrelated = new QueryObserver(queryClient, {
    queryKey: kUnrelated, queryFn: async () => { counts.unrelated++; return []; },
    staleTime: 0,
  });

  const unsubs = [obsCheck, obsMy, obsPaired, obsSavedList, obsSavedPaired, obsUnrelated]
    .map((o) => o.subscribe(() => {}));

  rqStub.capturedMutations.length = 0;
  const shipped = useVisits[hook]();
  assert.equal(
    rqStub.capturedMutations.length, 1,
    `VACUITY: ${hook}() did not call useMutation exactly once; nothing was captured.`,
  );
  assert.equal(typeof shipped.mutationFn, 'function', `VACUITY: ${hook} has no mutationFn`);
  assert.equal(typeof shipped.onSuccess, 'function', `VACUITY: ${hook} has no onSuccess`);

  // The belief as query-core saw it at the instant onSuccess was entered, read
  // by a TRANSPARENT wrapper: it records one boolean and then calls the SHIPPED
  // function. Nothing about the shipped behaviour is replaced. X-0b uses this to
  // prove the mid-flight construction really lands in #1661's state.
  let onlineAtSuccessEntry = null;
  const shippedOnSuccess = shipped.onSuccess;
  const observedOptions = {
    ...shipped,
    onSuccess: onSuccessOverride
      ? onSuccessOverride(queryClient)
      : (...args) => {
        onlineAtSuccessEntry = onlineManager.isOnline();
        return shippedOnSuccess(...args);
      },
  };

  const mutationObserver = new MutationObserver(queryClient, observedOptions);
  const unMutation = mutationObserver.subscribe(() => {});

  return {
    server,
    counts,
    queryClient,
    shipped,
    observedOptions,
    keys: { kCheck, kMy, kPaired, kSavedList, kSavedPaired, kUnrelated },
    onlineAtSuccessEntry: () => onlineAtSuccessEntry,
    snapshot: () => ({ ...counts }),
    q: (key) => queryClient.getQueryCache().find({ queryKey: key }),
    /** What BeenHereControl renders from: `const isVisited = visited === true`. */
    controlIsSettled: () => obsCheck.getCurrentResult().data === true,
    myVisits: () => obsMy.getCurrentResult().data ?? [],
    partnerVisits: () => obsPaired.getCurrentResult().data ?? [],

    /**
     * THE CONSTRUCTION. The tap starts while ONLINE, so query-core runs it
     * whatever its networkMode is; the belief goes stale while the request is on
     * the wire; the response then arrives. onSuccess therefore runs with
     * isOnline() === false, with nothing forced onto the observer.
     */
    async tapWithSignalLostMidFlight(vars, { background = false, beforeRelease } = {}) {
      serviceStub.hold();
      const p = mutationObserver.mutate(vars).catch(() => {});
      await waitUntil(() => serviceStub.control.inFlight > 0, 2000, 'the write to reach the wire');
      onlineManager.setOnline(false);
      if (background) focusManager.setFocused(false);
      await beforeRelease?.();
      serviceStub.control.release();
      serviceStub.control.gate = null;
      await p;
      await sleep(300);
      return mutationObserver.getCurrentResult();
    },

    /**
     * A plain tap with no signal games — the X-3 retry loop.
     *
     * BOUNDED DELIBERATELY. If the belief is still stale and the mutation is on
     * query-core's default networkMode (i.e. #1642 has not landed), query-core
     * PAUSES this tap and the promise never settles at all. An unbounded await
     * would turn a product defect into a hung test run. `timedOut: true` is a
     * real observation — the user's retry did not even reach the wire.
     */
    async tap(vars, { timeoutMs = 1500 } = {}) {
      serviceStub.control.gate = null;
      let timedOut = false;
      await Promise.race([
        mutationObserver.mutate(vars).catch(() => {}),
        sleep(timeoutMs).then(() => { timedOut = true; }),
      ]);
      if (!timedOut) await sleep(250);
      return { timedOut, result: mutationObserver.getCurrentResult() };
    },

    async close() {
      unsubs.forEach((u) => u());
      unMutation();
      // Teardown order matters: a query destroyed while its fetch is PARKED
      // re-arms the 24h gc timer and the process never exits. Let the pause
      // resolve first, then destroy the mutations query-core's clear() leaves
      // holding their own 5-minute timers.
      onlineManager.setOnline(true);
      focusManager.setFocused(true);
      await sleep(100);
      queryClient.unmount();
      queryClient.getMutationCache().getAll().forEach((m) => m.destroy());
      queryClient.clear();
    },
  };
}

const CARD = { experienceId: EXPERIENCE, cardData: { category: 'restaurant', title: 'Frankie\'s of Raleigh' } };

// ─────────────────────────────────────────────────────────────────────────────

test('X-0 the harness holds the real singletons and forces NOTHING onto the shipped options', () => {
  assert.equal(
    rqStub.onlineManager, onlineManager,
    'X-0: the stub is not holding the REAL onlineManager, so nothing below exercises the object '
      + 'config/queryClient.ts wires to NetInfo.',
  );

  const s = openSession();
  try {
    // The one option the two PRs argue about must come from the PRODUCT, not
    // from this file. The implementor's suite forces it; this one must not.
    assert.equal(
      Object.prototype.hasOwnProperty.call(s.observedOptions, 'networkMode'),
      Object.prototype.hasOwnProperty.call(s.shipped, 'networkMode'),
      'X-0: this harness injected or dropped a networkMode. The whole point of this suite is that '
        + 'the shipped options run verbatim, so the result reflects the release rather than the test.',
    );
    assert.equal(
      s.observedOptions.networkMode, s.shipped.networkMode,
      'X-0: networkMode handed to query-core differs from what useVisits.ts declares.',
    );
    assert.equal(
      s.observedOptions.mutationFn, s.shipped.mutationFn,
      'X-0: the shipped mutationFn was replaced.',
    );

    // Every read this suite watches must actually be a target of what onSuccess
    // invalidates, or the fan-out assertions below are decorative.
    for (const [name, key] of [['check', s.keys.kCheck], ['my', s.keys.kMy], ['paired', s.keys.kPaired]]) {
      assert.equal(
        key[0], 'visits',
        `X-0: visitKeys.${name} no longer starts with 'visits', so onSuccess's `
          + "invalidateQueries({ queryKey: ['visits'] }) does not reach it.",
      );
    }
    for (const [name, key] of [['list', s.keys.kSavedList], ['paired', s.keys.kSavedPaired]]) {
      assert.equal(
        key[0], realQueryKeys.savedCardKeys.all[0],
        `X-0: savedCardKeys.${name} is not under savedCardKeys.all.`,
      );
    }
  } finally { /* session closed by the async wrapper below */ }
  return s.close();
});

test('X-0b the mid-flight construction really lands in #1661\'s state, with no option forced', async () => {
  // Anti-vacuity for the ENTIRE suite. If the belief were still true at
  // onSuccess, every test below would be testing the healthy online path and
  // would pass no matter what the product does.
  const s = openSession();
  try {
    await sleep(140);
    const res = await s.tapWithSignalLostMidFlight(CARD);
    assert.equal(res.status, 'success', 'X-0b: the write must COMPLETE — that is the premise');
    assert.equal(
      s.onlineAtSuccessEntry(), false,
      'X-0b: onSuccess was entered while query-core still believed it was ONLINE. The construction '
        + 'did not reproduce #1661 and nothing below means anything.',
    );
    assert.equal(
      s.server.visited, true,
      'X-0b: the row must have landed server-side — #1661 is about a write that SUCCEEDS.',
    );
  } finally { await s.close(); }
});

test('X-1 CONTROL — an invalidate-only onSuccess parks all five reads (the defect, reproduced)', async () => {
  // Proves the pause mechanism is present in this query-core for every key the
  // real handler invalidates, which is what makes X-2's pass meaningful. Stays
  // GREEN when the fix is reverted — that is its job.
  const s = openSession({
    onSuccessOverride: (queryClient) => () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: realQueryKeys.savedCardKeys.all });
    },
  });
  try {
    await sleep(140);
    const before = s.snapshot();
    const res = await s.tapWithSignalLostMidFlight(CARD);

    assert.equal(res.status, 'success', 'X-1: the write should still succeed');
    assert.equal(s.server.visited, true, 'X-1: the row landed');
    for (const k of ['check', 'my', 'paired', 'savedList', 'savedPaired']) {
      assert.equal(
        s.counts[k], before[k],
        `X-1: '${k}' refetched without the correction. The pause mechanism is not present for this `
          + 'key, so this suite cannot prove anything about it.',
      );
    }
    assert.equal(s.q(s.keys.kCheck).state.fetchStatus, 'paused', "X-1: expected visits.check parked");
    assert.equal(s.q(s.keys.kPaired).state.fetchStatus, 'paused', "X-1: expected visits.paired parked");
    assert.equal(s.controlIsSettled(), false, 'X-1: without the correction the control must read stale');
  } finally { await s.close(); }
});

test('X-2 the whole ["visits"] prefix and savedCardKeys must refresh — not just the key the control reads', async () => {
  const s = openSession();
  try {
    await sleep(140);
    assert.equal(s.controlIsSettled(), false, 'X-2: baseline should be "not visited"');
    const before = s.snapshot();

    const res = await s.tapWithSignalLostMidFlight(CARD);
    assert.equal(res.status, 'success', 'X-2: the write completed');
    assert.equal(s.onlineAtSuccessEntry(), false, 'X-2: premise — the belief was stale at onSuccess');

    const parked = ['check', 'my', 'paired', 'savedList', 'savedPaired'].filter((k) => s.counts[k] === before[k]);
    assert.deepEqual(
      parked, [],
      `X-2: ${parked.length} of the 5 reads that onSuccess invalidates never refetched after a `
        + `SUCCESSFUL write: [${parked.join(', ')}]. visits.check=${s.q(s.keys.kCheck).state.fetchStatus} `
        + `visits.my=${s.q(s.keys.kMy).state.fetchStatus} visits.paired=${s.q(s.keys.kPaired).state.fetchStatus}. `
        + 'The row landed and those surfaces will render stale until relaunch — this is #1661.',
    );
    assert.equal(
      s.controlIsSettled(), true,
      'X-2: the control did not settle to "You\'ve been to…" without a relaunch.',
    );
    assert.deepEqual(
      s.myVisits(), [EXPERIENCE],
      "X-2: the user's OWN visit list (visitKeys.my) did not pick up the visit they just recorded.",
    );
    assert.deepEqual(
      s.partnerVisits(), [EXPERIENCE],
      'X-2: the PAIRED-PARTNER visit list (visitKeys.paired) stayed stale. A fix that only un-parks '
        + 'the control\'s own read leaves the couple surface wrong for the rest of the session.',
    );
    assert.equal(
      onlineManager.isOnline(), true,
      'X-2: a completed server round-trip left query-core still believing it is offline.',
    );
  } finally { await s.close(); }
});

test('X-3 the control must settle on the FIRST write — no phantom-retry loop re-stamping visited_at', async () => {
  // The real user loop. record-visit upserts with visited_at = now() on EVERY
  // call and both visit lists order by visited_at desc, so each phantom retry
  // silently reorders the user's and their partner's history (Constitution #9).
  const s = openSession();
  try {
    await sleep(140);

    let taps = 0;
    const res = await s.tapWithSignalLostMidFlight(CARD);
    taps++;
    assert.equal(res.status, 'success', 'X-3: the first write completed');

    // The user keeps tapping while the control still looks untouched.
    let stalledTaps = 0;
    while (!s.controlIsSettled() && taps < 4) {
      const retry = await s.tap(CARD);
      taps++;
      if (retry.timedOut) stalledTaps++;
    }

    assert.equal(
      s.controlIsSettled(), true,
      `X-3: the control never settled — the user tapped ${taps} times, ${stalledTaps} of which never `
        + `even reached the wire (query-core paused them behind the same stale belief), and `
        + `record-visit re-stamped visited_at on all ${serviceStub.control.recordCalls} that did.`,
    );
    assert.equal(
      taps, 1,
      `X-3: the control needed ${taps} taps to settle. Every tap after the first is a phantom retry `
        + `that rewrites the recorded time of the user's own visit (recordVisit called `
        + `${serviceStub.control.recordCalls}x).`,
    );
    assert.equal(
      serviceStub.control.recordCalls, 1,
      `X-3: recordVisit ran ${serviceStub.control.recordCalls}x for one visit.`,
    );
  } finally { await s.close(); }
});

test('X-4 the refetch must happen even if the app is BACKGROUNDED between the write and it', async () => {
  // focusManager is wired to AppState in config/queryClient.ts. Tapping and
  // immediately switching apps is the common case. If the correction only lands
  // for a foregrounded app, the control settles only for users who stayed put.
  const s = openSession();
  try {
    await sleep(140);
    const before = s.snapshot();

    const res = await s.tapWithSignalLostMidFlight(CARD, { background: true });
    assert.equal(res.status, 'success', 'X-4: the write completed');
    assert.equal(focusManager.isFocused(), false, 'X-4: premise — the app is backgrounded');
    assert.equal(s.onlineAtSuccessEntry(), false, 'X-4: premise — the belief was stale at onSuccess');

    assert.ok(
      s.counts.check > before.check,
      `X-4: the visit read never refetched while the app was backgrounded `
        + `(fetchStatus=${s.q(s.keys.kCheck).state.fetchStatus}). The user returns to a control that `
        + 'still says "Been here" for a visit that is already in the database.',
    );
    assert.equal(s.controlIsSettled(), true, 'X-4: the control did not settle while backgrounded');

    // Returning to the app must not be required, and must not double-fetch the
    // work that already happened.
    const afterBackground = s.snapshot();
    focusManager.setFocused(true);
    await sleep(250);
    assert.equal(
      s.counts.check, afterBackground.check,
      'X-4: foregrounding re-fetched a read that was already fresh — the correction is duplicating work.',
    );
  } finally { await s.close(); }
});

test('X-5 a stale offline signal arriving MID-REFETCH must not strand the control again', async () => {
  // NetInfo flapping is what produced the wrong belief in the first place. The
  // correction sets the belief true and starts the refetch; a `false` one tick
  // later must not undo it.
  const s = openSession();
  try {
    await sleep(140);
    const before = s.snapshot();

    const p = s.tapWithSignalLostMidFlight(CARD);
    // Land the spurious re-emit inside the refetch window opened by onSuccess.
    await sleep(30);
    onlineManager.setOnline(false);
    const res = await p;

    assert.equal(res.status, 'success', 'X-5: the write completed');
    assert.ok(
      s.counts.check > before.check,
      `X-5: the visit read never refetched (fetchStatus=${s.q(s.keys.kCheck).state.fetchStatus}, `
        + `isInvalidated=${s.q(s.keys.kCheck).state.isInvalidated}).`,
    );
    assert.equal(
      s.controlIsSettled(), true,
      'X-5: a stale offline re-emit arriving mid-refetch left the control on "Been here" for a visit '
        + 'that is already recorded.',
    );
  } finally { await s.close(); }
});

test('X-6 the correction un-parks an UNRELATED query stranded behind the same stale belief', async () => {
  // PR #1665 claims this explicitly: "saying so also un-parks every other query
  // stranded behind the same stale value". Test the claim, not the sentence.
  const s = openSession();
  try {
    await sleep(140);
    let unrelatedBefore = 0;

    const res = await s.tapWithSignalLostMidFlight(CARD, {
      beforeRelease: async () => {
        // Something else in the app asks for fresh data while the belief is
        // false — it parks. Nothing to do with visits.
        unrelatedBefore = s.counts.unrelated;
        s.queryClient.invalidateQueries({ queryKey: ['notifications'] }).catch(() => {});
        await sleep(60);
        assert.equal(
          s.q(s.keys.kUnrelated).state.fetchStatus, 'paused',
          'X-6: premise — the unrelated read did not park, so there is nothing to un-park.',
        );
      },
    });

    assert.equal(res.status, 'success', 'X-6: the write completed');
    assert.ok(
      s.counts.unrelated > unrelatedBefore,
      `X-6: the unrelated read is still parked at ${s.q(s.keys.kUnrelated).state.fetchStatus} after a `
        + 'completed server round-trip. Every query stranded behind the stale belief stays stranded.',
    );
  } finally { await s.close(); }
});

test('X-7 CONTROL — a FAILED write must NOT assert connectivity, for either hook', async () => {
  // The deliberate asymmetry. A failure proves nothing; asserting connectivity
  // in onError would resume every paused mutation in the app on the strength of
  // a request that never arrived. Stays green when the fix is reverted.
  for (const hook of ['useRecordVisit', 'useRemoveVisit']) {
    const s = openSession({ hook });
    try {
      await sleep(140);
      serviceStub.control.mode = 'reject';

      const res = await s.tapWithSignalLostMidFlight(
        hook === 'useRecordVisit' ? CARD : EXPERIENCE,
        {
          beforeRelease: async () => {
            s.queryClient.invalidateQueries({ queryKey: ['notifications'] }).catch(() => {});
            await sleep(60);
          },
        },
      );

      assert.equal(res.status, 'error', `X-7 (${hook}): the write was supposed to fail here`);
      assert.equal(
        onlineManager.isOnline(), false,
        `X-7 (${hook}): a FAILED write flipped onlineManager to true. That resumes every paused `
          + 'mutation in the app on the strength of a request that never arrived.',
      );
      assert.equal(
        s.q(s.keys.kUnrelated).state.fetchStatus, 'paused',
        `X-7 (${hook}): a failed write un-parked an unrelated read, so the app now believes it is `
          + 'online on no evidence.',
      );
    } finally { await s.close(); }
  }
});
