/**
 * Issue #1642 — "Been here" must reach "Couldn't save" under a REAL network
 * partition, not spin forever.
 *
 * WHAT THIS SUITE IS. It is deliberately NOT a structural gate. Four issues in
 * one week (#1607, #1627, #1631, #1633) were assertions that did not assert,
 * and #1618 shipped `VISIT_WRITE_TIMEOUT_MS = 15000` with no behavioural
 * coverage at all — which is exactly why #1642 reached a physical device. A
 * guard that checks the constant exists would have been GREEN throughout the
 * 3.5-minute hang, because the constant was there the whole time and the code
 * holding it never executed.
 *
 * So this suite EXECUTES the shipped code under a simulated partition:
 *
 *   - the REAL `@tanstack/react-query` mutation machinery, with the REAL
 *     `onlineManager` driven offline exactly the way config/queryClient.ts
 *     drives it from NetInfo (`setOnline(isConnected && isInternetReachable)`);
 *   - the REAL `networkMode` that hooks/useVisits.ts actually configures,
 *     extracted from the source and fed into that machinery — not asserted as a
 *     string, USED as behaviour;
 *   - the REAL, byte-for-byte `services/visitService.ts` as `mutationFn`,
 *     loaded through Node's own TypeScript stripper with only its Supabase
 *     client stubbed. The stub's `functions.invoke` returns a promise that
 *     NEVER SETTLES, which is the partition shape the #1609 Android tester
 *     observed: the request neither resolves nor rejects until connectivity
 *     returns.
 *
 * THE BUG IT LOCKS DOWN. React Query's default `networkMode` is `'online'`.
 * With `onlineManager.isOnline()` false, query-core's retryer takes
 * `pause().then(run)` instead of `run()` — so `mutationFn` is never called,
 * `recordVisit` never runs, the 15s timer inside it is never CREATED, and the
 * mutation sits at `status: 'pending'` / `isPaused: true`. `isPending` is true
 * while paused, and `isPending` is what BeenHereControl's `inFlight` reads.
 * Spinner forever. The write then lands whenever connectivity returns, because
 * `queryClient.mount()` calls `resumePausedMutations()` on both the online and
 * the focus subscription.
 *
 * T-1 is the anti-vacuity NEGATIVE CONTROL: it runs this same harness with the
 * PRE-FIX configuration and proves the harness detects the hang. Without it,
 * every later assertion could be passing for the wrong reason.
 *
 * Runtime ~17s: T-3/T-4 wait out the real 15s bound on a real clock rather than
 * mocking timers, so the suite also fails if anyone RAISES
 * VISIT_WRITE_TIMEOUT_MS — the user-visible guarantee is wall-clock, and a
 * mocked clock cannot prove a wall-clock guarantee.
 *
 * Requires Node >= 22.13 for `module.stripTypeScriptTypes`. Registered in
 * ci-batch:issue-1642-been-here-offline-bound on node 22.
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
  MutationObserver,
  onlineManager,
  dehydrate,
} from '@tanstack/react-query';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appMobile = path.resolve(__dirname, '../../..');

const USE_VISITS = path.join(appMobile, 'src/hooks/useVisits.ts');
const VISIT_SERVICE = path.join(appMobile, 'src/services/visitService.ts');
const SWIPEABLE = path.join(appMobile, 'src/components/SwipeableCards.tsx');
const CARDS_I18N = path.join(appMobile, 'src/i18n/locales/en/cards.json');

// ─────────────────────────────────────────────────────────────────────────────
// String-aware comment stripper. The #1642 fix ships a long explanatory comment
// that NAMES `networkMode: 'always'` several times; without stripping, every
// extraction below would match the prose instead of the code and the suite
// would pass on a file whose actual option had been deleted. Proven on a decoy
// in T-0.
// ─────────────────────────────────────────────────────────────────────────────
function stripComments(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i++; continue; }
      if (c === '/' && n === '*') { state = 'block'; i++; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c; out += c; continue; }
      out += c;
      continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i++; } continue; }
    // inside a string literal
    out += c;
    if (c === '\\') { out += src[i + 1] ?? ''; i++; continue; }
    if (c === state) state = 'code';
  }
  return out;
}

const rawUseVisits = fs.readFileSync(USE_VISITS, 'utf8');
const codeUseVisits = stripComments(rawUseVisits);

/**
 * Pull the `networkMode` that the named hook ACTUALLY configures on its
 * useMutation call. Returns `undefined` when the option is absent — which is
 * precisely the pre-#1642 state, and what makes this test fail on revert.
 */
function configuredNetworkMode(hookName) {
  const at = codeUseVisits.indexOf(`export function ${hookName}(`);
  assert.ok(
    at > 0,
    `VACUITY: ${hookName} was not found in useVisits.ts. The extraction below `
      + 'would silently read nothing, so this suite must fail loudly instead.',
  );
  const call = codeUseVisits.indexOf('useMutation({', at);
  assert.ok(
    call > at,
    `VACUITY: ${hookName} no longer calls useMutation({...}). Re-point this suite `
      + 'at the real mutation before trusting any result from it.',
  );
  // Bound the search at the end of this hook so the NEXT hook's option can
  // never be read as this one's.
  const nextHook = codeUseVisits.indexOf('export function ', call);
  const body = codeUseVisits.slice(call, nextHook > 0 ? nextHook : undefined);
  const m = body.match(/networkMode:\s*['"]([a-zA-Z]+)['"]/);
  return m ? m[1] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load the REAL visitService.ts, verbatim, with only its Supabase client
// stubbed. Node's own stripper does the TypeScript removal (whitespace-
// preserving, no third-party transform, no hand-rolled regex), so what runs
// below is the shipped source and not a paraphrase of it.
// ─────────────────────────────────────────────────────────────────────────────
let tmpDir;
let visitService;
let supabaseStub;

before(async () => {
  const raw = fs.readFileSync(VISIT_SERVICE, 'utf8');

  const relativeImports = [...stripComments(raw).matchAll(/from\s+['"](\.[^'"]*)['"]/g)].map(m => m[1]);
  assert.deepEqual(
    relativeImports,
    ['./supabase'],
    'VACUITY: visitService.ts gained or lost a relative import. This loader stubs '
      + `exactly one ('./supabase'); found ${JSON.stringify(relativeImports)}. Stub the new `
      + 'one before trusting this suite.',
  );

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue1642-'));
  const stubPath = path.join(tmpDir, 'supabaseStub.mjs');
  fs.writeFileSync(
    stubPath,
    `
// Simulated network partition. This is the shape the #1609 Android tester
// observed on a physical Samsung in airplane mode: the request does not reject,
// it simply never settles until connectivity returns.
export const calls = { invoke: 0, getUser: 0 };
const NEVER = () => new Promise(() => {});
export const supabase = {
  functions: { invoke: (...a) => { calls.invoke++; return NEVER(a); } },
  auth: { getUser: () => { calls.getUser++; return NEVER(); } },
  from: () => { throw new Error('unreachable under partition'); },
};
`,
  );

  const stripped = stripTypeScriptTypes(raw, { mode: 'strip' });
  const rewritten = stripped.replace(
    "from './supabase'",
    `from ${JSON.stringify(pathToFileURL(stubPath).href)}`,
  );
  assert.notEqual(
    rewritten,
    stripped,
    'VACUITY: the Supabase import specifier was not rewritten, so the real client '
      + 'would be loaded (or nothing would be). Refusing to report a result.',
  );

  const modPath = path.join(tmpDir, 'visitService.mjs');
  fs.writeFileSync(modPath, rewritten);

  visitService = await import(pathToFileURL(modPath).href);
  supabaseStub = await import(pathToFileURL(stubPath).href);

  for (const name of ['recordVisit', 'removeVisit', 'VISIT_WRITE_TIMEOUT_MS']) {
    assert.ok(
      visitService[name] !== undefined,
      `VACUITY: visitService.ts no longer exports ${name}; the harness is testing nothing.`,
    );
  }
});

after(() => {
  onlineManager.setOnline(true);
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Drive a real react-query mutation to a terminal state under a partition. */
async function runUnderPartition({ networkMode, mutationFn, waitMs }) {
  // EXACTLY what config/queryClient.ts computes from NetInfo in airplane mode:
  //   online = state.isConnected === true && state.isInternetReachable !== false
  onlineManager.setOnline(false);

  const queryClient = new QueryClient();
  // mount() installs the online + focus subscriptions that call
  // resumePausedMutations() — the mechanism that landed the row 3.5 minutes late.
  queryClient.mount();

  let fnCalls = 0;
  const observer = new MutationObserver(queryClient, {
    ...(networkMode === undefined ? {} : { networkMode }),
    mutationFn: (vars) => { fnCalls++; return mutationFn(vars); },
  });

  const seen = [];
  const unsubscribe = observer.subscribe((r) => seen.push({ status: r.status, isPaused: r.isPaused }));

  const startedAt = Date.now();
  observer.mutate(undefined).catch(() => { /* terminal state is read off the observer */ });

  const deadline = startedAt + waitMs;
  while (Date.now() < deadline) {
    const s = observer.getCurrentResult().status;
    if (s === 'error' || s === 'success') break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const settledAfterMs = Date.now() - startedAt;
  const dehydratedWhileOffline = dehydrate(queryClient).mutations.length;
  const result = observer.getCurrentResult();

  return {
    result,
    fnCalls: () => fnCalls,
    settledAfterMs,
    dehydratedWhileOffline,
    everPaused: seen.some((s) => s.isPaused === true),
    async reconnect() {
      onlineManager.setOnline(true);
      // NOT awaited: a resumed write re-enters the never-settling stub, so
      // awaiting it would hang the runner instead of failing the assertion.
      // The point of interest is only whether it fires AT ALL.
      queryClient.resumePausedMutations().catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      return observer.getCurrentResult();
    },
    teardown() {
      unsubscribe();
      queryClient.unmount();
      queryClient.clear();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

test('T-0 the comment stripper actually strips (anti-vacuity)', () => {
  const decoy = `const a = 1; // networkMode: 'always'\n/* networkMode: 'always' */\nconst s = "// not a comment";`;
  const out = stripComments(decoy);
  assert.equal((out.match(/networkMode/g) ?? []).length, 0, 'T-0: comments were not stripped');
  assert.match(out, /"\/\/ not a comment"/, 'T-0: the stripper ate a string literal');
  assert.ok(
    codeUseVisits.length < rawUseVisits.length,
    'T-0: stripComments removed nothing from useVisits.ts, so it is not actually stripping',
  );
});

test('T-1 NEGATIVE CONTROL — the pre-#1642 configuration really does hang', async () => {
  // If this passes, the harness can see the bug. Every assertion after it is
  // therefore meaningful rather than vacuously green.
  const run = await runUnderPartition({
    networkMode: undefined,              // React Query's default: 'online'
    mutationFn: () => new Promise(() => {}),
    waitMs: 1500,
  });

  assert.equal(
    run.fnCalls(), 0,
    'T-1: with the default networkMode the mutationFn must never be called offline. '
      + 'If it was, query-core no longer pauses and this whole suite is testing the wrong mechanism.',
  );
  assert.equal(run.result.status, 'pending', 'T-1: the pre-fix mutation should still be pending');
  assert.equal(run.result.isPaused, true, 'T-1: the pre-fix mutation should be PAUSED — that is the bug');
  assert.ok(
    run.dehydratedWhileOffline > 0,
    'T-1: a paused mutation should be dehydrated (query-core default shouldDehydrateMutation '
      + '= state.isPaused), which is how the ghost write survives into a later app session',
  );

  // ...and it lands the moment connectivity returns. This is the ~3.5-minute
  // late row from the physical-device repro.
  await run.reconnect();
  assert.equal(
    run.fnCalls(), 1,
    'T-1: the paused write must fire on reconnect. That is the behaviour #1642 removes.',
  );
  run.teardown();
});

test('T-2 both visit mutations are configured to run under a partition', () => {
  for (const hook of ['useRecordVisit', 'useRemoveVisit']) {
    const mode = configuredNetworkMode(hook);
    assert.notEqual(
      mode, undefined,
      `T-2: ${hook} declares no networkMode, so React Query defaults to 'online' and PAUSES the `
        + 'mutation offline — mutationFn never runs and VISIT_WRITE_TIMEOUT_MS is never created. #1642.',
    );
    // Behavioural, not lexical: hand the real value to the real library and ask
    // it whether a mutation could start with no connectivity.
    onlineManager.setOnline(false);
    const qc = new QueryClient();
    const obs = new MutationObserver(qc, { networkMode: mode, mutationFn: async () => 'ok' });
    obs.mutate(undefined).catch(() => {});
    assert.equal(
      obs.getCurrentResult().isPaused, false,
      `T-2: with ${hook}'s configured networkMode (${mode}) real query-core still pauses offline.`,
    );
    qc.clear();
    onlineManager.setOnline(true);
  }
});

test('T-3 offline tap on Been here reaches a FAILED state within the bound', async () => {
  const mode = configuredNetworkMode('useRecordVisit');
  const bound = visitService.VISIT_WRITE_TIMEOUT_MS;
  const before = supabaseStub.calls.invoke;

  const run = await runUnderPartition({
    networkMode: mode,
    // The REAL shipped recordVisit, over a Supabase client that never settles.
    mutationFn: () => visitService.recordVisit({
      experienceId: 'exp-1642',
      cardData: { category: 'restaurant', title: 'Partitioned Place' },
    }),
    waitMs: bound + 4000,
  });

  assert.equal(
    run.fnCalls(), 1,
    'T-3: the mutationFn never ran offline — the write is paused above the bound (#1642).',
  );
  assert.ok(
    supabaseStub.calls.invoke > before,
    'VACUITY: recordVisit did not reach supabase.functions.invoke, so nothing was actually bounded.',
  );
  assert.equal(
    run.everPaused, false,
    'T-3: the mutation was PAUSED at some point. A paused mutation reports isPending, which is what '
      + 'BeenHereControl renders as an in-flight spinner — forever.',
  );
  assert.equal(
    run.result.status, 'error',
    `T-3: after ${run.settledAfterMs}ms with no connectivity the write is still "${run.result.status}". `
      + 'The user is looking at a spinner that never becomes "Couldn\'t save".',
  );
  assert.equal(
    run.result.error?.name, 'VisitWriteTimeoutError',
    `T-3: expected the operation bound to be what failed the write, got ${run.result.error?.name}.`,
  );
  assert.ok(
    run.settledAfterMs <= bound + 3000,
    `T-3: the write took ${run.settledAfterMs}ms to fail against a ${bound}ms bound.`,
  );
  assert.equal(
    run.dehydratedWhileOffline, 0,
    'T-3: a Been-here write was persisted to storage while offline. Nothing may be queued — '
      + 'PersistQueryClientProvider would resume it in a later session and record the visit at the '
      + 'wrong time (record-visit stamps visited_at at execution).',
  );

  // THE DELIBERATE DECISION (#1642): connectivity returning must NOT replay the
  // write behind the "Couldn't save" the user was just shown.
  const after = await run.reconnect();
  assert.equal(
    run.fnCalls(), 1,
    'T-3: the write was re-fired when connectivity returned. #1642 decided the failed write is '
      + 'ABANDONED, not replayed — the user retries with a tap.',
  );
  assert.equal(after.status, 'error', 'T-3: the failed state must survive reconnection');
  run.teardown();
});

test('T-4 offline un-press (removeVisit) is bounded the same way', async () => {
  const mode = configuredNetworkMode('useRemoveVisit');
  const bound = visitService.VISIT_WRITE_TIMEOUT_MS;
  const before = supabaseStub.calls.getUser;

  const run = await runUnderPartition({
    networkMode: mode,
    mutationFn: () => visitService.removeVisit('exp-1642'),
    waitMs: bound + 4000,
  });

  assert.ok(
    supabaseStub.calls.getUser > before,
    'VACUITY: removeVisit never reached its auth preamble, so nothing was bounded.',
  );
  assert.equal(
    run.everPaused, false,
    'T-4: the remove mutation paused offline — the same forever-spinner as #1642.',
  );
  assert.equal(
    run.result.status, 'error',
    `T-4: removeVisit is still "${run.result.status}" after ${run.settledAfterMs}ms offline. `
      + 'A bounded record with an unbounded remove still hangs on the un-press.',
  );
  assert.equal(run.result.error?.name, 'VisitWriteTimeoutError', 'T-4: the bound is not what failed it');
  assert.ok(
    run.settledAfterMs <= bound + 3000,
    `T-4: removeVisit took ${run.settledAfterMs}ms against a ${bound}ms bound.`,
  );
  run.teardown();
});

test('T-5 the failed mutation is what renders "Couldn\'t save"', () => {
  // The behavioural tests above end at `status: 'error'`. This closes the last
  // link to the pixel the user sees: a bounded rejection must reach a visible
  // failure, and that state must carry the real copy.
  //
  // #1687 MOVED THE RECORD WRITE OUT OF THIS CONTROL, so this assertion follows
  // it rather than pretending it is still here. The tap now opens the rating
  // prompt and writes nothing; the visit is recorded on confirm by
  // PostExperienceModal, which stays open on its rating step and renders the
  // error itself. The REMOVE write is still owned here, and it is still the one
  // whose failure this control has to show. Both halves are asserted below — the
  // protection is intact, it now spans two files because the write does.
  const code = stripComments(fs.readFileSync(SWIPEABLE, 'utf8'));

  const at = code.indexOf('function BeenHereControl(');
  assert.ok(at > 0, 'VACUITY: BeenHereControl was not found in SwipeableCards.tsx');
  const body = code.slice(at, at + 4000);

  assert.match(
    body,
    /const\s+failed\s*=\s*removeVisit\.isError/,
    'T-5: `failed` no longer derives from the remove mutation\'s isError, so a bounded '
      + 'rejection on the un-press would not reach the failed state (#1642).',
  );

  // The record write's failure must be surfaced by whoever now owns it. Without
  // this the write simply left the file and took its Constitution-rule-3 handling
  // with it — green here, silent on device.
  const modal = stripComments(
    fs.readFileSync(path.join(appMobile, 'src/components/PostExperienceModal.tsx'), 'utf8'),
  );
  const volAt = modal.indexOf('handleSubmitVoluntary');
  assert.ok(volAt > 0, 'T-5: the voluntary submit that now owns the record write is gone (#1687)');
  const volBody = modal.slice(volAt, volAt + 2500);
  assert.match(
    volBody,
    /catch[\s\S]{0,600}setSubmitError\(/,
    'T-5: the voluntary submit swallows its failure. The record write moved here (#1687), so '
      + 'this is now the only place a bounded rejection of it can reach the user.',
  );
  assert.match(
    volBody,
    /setIsSubmitting\(false\)/,
    'T-5: the voluntary submit leaves its spinner running after a failure — the #1618 shape, '
      + 'one file further along.',
  );
  assert.match(
    body,
    /failed[\s\S]{0,40}\?\s*['"]failed['"]/,
    'T-5: the failed mutation no longer selects the `failed` visual state',
  );
  assert.match(
    body,
    /been_here_failed/,
    'T-5: the failed state no longer renders the been_here_failed label',
  );

  const copy = JSON.parse(fs.readFileSync(CARDS_I18N, 'utf8'));
  assert.equal(
    copy['swipeable.been_here_failed'],
    "Couldn't save",
    'T-5: the failed-state copy changed. #1642\'s acceptance bar is literally "Couldn\'t save".',
  );
});
