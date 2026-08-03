// @ts-nocheck
// Issue #1516 [coach mark single process] — TESTER ADVERSARIAL regression test.
//
// Run: `cd app-mobile && npm run test:issue-1516-adv`
// node-runnable, no jest (the app-mobile convention — self-runs via require.main).
//
// ── WHY THIS EXISTS, AND HOW IT DIFFERS FROM THE IMPLEMENTOR'S SUITE ─────────
// The implementor's `issue-1516-coach-mark-single-process.test.tsx` proves the HAPPY
// PATH of the fix: resume-across-remount at every step (R-1), the live end-to-end race
// (R-2), sentinel terminality (R-3), the start-delay anchor (R-4), and read-failure
// retry (R-5). Those are the "does the fix do what it says" cases.
//
// This suite attacks the SIDE the implementor did not: the BLAST RADIUS of deleting the
// only runtime normalization path, and the reachable surface of the NEW local-only
// TOUR_UNAVAILABLE state.
//
//   T-1  VALUE-GRAMMAR BOUNDARY SWEEP. The implementor asserted the three sentinels and
//        the 1..11 band. Nobody asserted the EDGES. Deleting the ORCH-0635 branch also
//        deleted the runtime's ability to REPAIR a value it does not understand: every
//        stored integer is now taken verbatim, forever. This drives the provider at
//        COACH_STEP_COUNT - 1 / COACH_STEP_COUNT / COACH_STEP_COUNT + 1 /
//        COACH_STEP_COUNT + 2 / 99 / -1 / -5 / 0 / NULL and pins the FULL observable
//        tuple for each — including the write log, because the single most dangerous
//        behaviour this issue fixed was a READ that silently WROTE.
//
//   T-2  BOTTOM-NAV LIVENESS ACROSS EVERY REACHABLE STATE (Constitution #1, no dead
//        taps). `CoachMarkNavigationGate` (app/index.tsx) sets pointerEvents='none'
//        whenever isCoachLoading || isCoachPending || isCoachActive. The rework's own
//        rationale for inventing TOUR_UNAVAILABLE was "do not park somewhere that locks
//        the nav" — so the gate is now load-bearing for a state the gate has never seen.
//        This test READS the real gate expression out of app/index.tsx (so it cannot
//        drift out from under the assertion) and applies it to every state the fetch
//        path can actually produce. It also proves the complementary invariant the
//        grammar depends on: NO path ever PERSISTS a local-only band value (-2 / -3).
//
//   T-3  TOUR_UNAVAILABLE PUBLIC-API BLAST RADIUS. R-5c asserted the three derived
//        booleans at -3. It did not touch the four CALLABLE members of the context
//        value. A state that "concludes nothing" must also WRITE nothing when a consumer
//        pokes it, or it concludes something after all.
//
//   T-4  STEP-COUNT DRIFT TRIPWIRE — the recurrence guard. TOUR_COMPLETED is DERIVED
//        (COACH_STEP_COUNT + 1). The tour has already gone 10 -> 7 -> 11, which is
//        exactly how rows at 8 / 10 / 13 were minted. The ORCH-0635 branch was the only
//        runtime path that healed that drift, and it is now gone by design — so the
//        grammar is held up by data + a SQL column comment and nothing else. This
//        DEMONSTRATES the consequence by executing the real provider against a synthetic
//        12-step tour (today's terminal 12 comes back as an ACTIVE step), then pins the
//        live count AND cross-checks the shipped migration's own TOUR_COMPLETED constant
//        against it, so bumping the tour without shipping a migration turns CI red.
//
//   T-5  UNMOUNT DURING THE FETCH RETRY. R-5a/b/c drive the retry to a conclusion.
//        Nothing drives it to a CANCELLATION. The retry timer is new surface: it must
//        not fire after unmount, must not read again, must not write, must not leak a
//        timer, and must not have concluded anything before it was cut off.
//
//   T-6  CONCURRENT / SEQUENTIAL SECOND PROVIDER. `startDelayAnchorByUserId` is MODULE
//        scope — shared by every provider instance in the JS runtime. Two live providers
//        must converge on the same step and neither may cancel the other's tour; and a
//        provider mounting AFTER another already persisted step 1 must RESUME, not
//        restart and not complete.
//
//   T-7  CROSS-USER ANCHOR ISOLATION. The module-scope Map is keyed by user id and
//        deliberately never cleared. A second user signing in to the same JS runtime
//        must still get the full first-run delay — one user's elapsed anchor must never
//        rush another user's tour.
//
// Every assertion below executes the REAL `src/contexts/CoachMarkContext.tsx` (sucrase
// transpile + a deterministic hook runtime + fake clock), and asserts on the state
// machine and the observed READ/WRITE logs. Never on a persisted value alone: `12` is
// unfalsifiable from the database because the genuine-completion path and the silent
// cancel path both write it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transform } = require('sucrase');

// ── Repo paths ───────────────────────────────────────────────────────────────
function appMobileRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'src/contexts/CoachMarkContext.tsx'))) return cwd;
  const nested = path.join(cwd, 'app-mobile');
  if (fs.existsSync(path.join(nested, 'src/contexts/CoachMarkContext.tsx'))) return nested;
  throw new Error('issue-1516-adv: cannot locate app-mobile root from ' + cwd);
}
const ROOT = appMobileRoot();
const CONTEXT_PATH = path.join(ROOT, 'src/contexts/CoachMarkContext.tsx');
const STEPS_PATH = path.join(ROOT, 'src/constants/coachMarkSteps.ts');
const APP_INDEX_PATH = path.join(ROOT, 'app/index.tsx');
const MIGRATION_PATH = path.join(
  ROOT, '..', 'supabase/migrations/20270210001516_issue_1516_normalize_coach_mark_step_grammar.sql',
);

const USER_A = 'a1516aaa-0000-4000-8000-00000000000a';
const USER_B = 'b1516bbb-0000-4000-8000-00000000000b';

// Local-only band — these must NEVER appear in the write log, from any path.
const LOADING_SENTINEL = -2;
const TOUR_UNAVAILABLE = -3;

// ── Module loader: transpile the REAL source, inject stubs ───────────────────
function loadModule(absPath, stubs, sourceOverride) {
  const src = sourceOverride === undefined ? fs.readFileSync(absPath, 'utf8') : sourceOverride;
  const code = transform(src, { transforms: ['typescript', 'jsx', 'imports'], filePath: absPath }).code;
  const mod = { exports: {} };
  const req = (spec) => {
    if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
    throw new Error(`issue-1516-adv: unstubbed require(${JSON.stringify(spec)}) from ${absPath}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    mod.exports, req, mod, absPath, path.dirname(absPath),
  );
  return mod.exports;
}

// ── Deterministic React hook runtime ─────────────────────────────────────────
function makeReact() {
  let cur = null;
  let idx = 0;
  const depsEqual = (a, b) => {
    if (a === undefined || b === undefined) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
    return true;
  };
  const slot = (init) => {
    const inst = cur;
    if (idx >= inst.hooks.length) inst.hooks.push(init());
    const s = inst.hooks[idx];
    idx += 1;
    return s;
  };
  const React = {
    __esModule: true,
    createContext(d) {
      const c = { _default: d };
      c.Provider = (p) => ({ __provider: true, value: p.value, children: p.children });
      return c;
    },
    createElement(type, props, ...children) {
      const p = Object.assign({}, props);
      if (children.length) p.children = children.length === 1 ? children[0] : children;
      if (typeof type === 'function') return type(p);
      return { type, props: p };
    },
    useState(initial) {
      const inst = cur;
      const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [s.value, (next) => {
        const prev = s.value;
        const val = typeof next === 'function' ? next(prev) : next;
        if (Object.is(val, prev)) return;
        s.value = val;
        inst.dirty = true;
      }];
    },
    useRef(initial) { return slot(() => ({ current: initial })); },
    useCallback(fn, deps) {
      const s = slot(() => ({ fn, deps }));
      if (!depsEqual(s.deps, deps)) { s.fn = fn; s.deps = deps; }
      return s.fn;
    },
    useMemo(fn, deps) {
      const s = slot(() => ({ value: undefined, deps: undefined, primed: false }));
      if (!s.primed || !depsEqual(s.deps, deps)) { s.value = fn(); s.deps = deps; s.primed = true; }
      return s.value;
    },
    useEffect(fn, deps) {
      const inst = cur;
      const s = slot(() => ({ deps: undefined, cleanup: null, primed: false, effect: true }));
      if (!s.primed || !depsEqual(s.deps, deps)) { s.primed = true; s.deps = deps; s.fn = fn; inst.queue.push(s); }
    },
    useContext(ctx) { return ctx._default; },
  };
  React.default = React;

  function renderOnce(inst) {
    cur = inst; idx = 0; inst.queue = [];
    inst.element = inst.Component(inst.props);
    cur = null; inst.renders += 1;
    for (const s of inst.queue) {
      if (typeof s.cleanup === 'function') { s.cleanup(); s.cleanup = null; }
      const c = s.fn();
      s.cleanup = typeof c === 'function' ? c : null;
    }
  }
  function flush(inst) {
    if (!inst.mounted) return;
    renderOnce(inst);
    let guard = 0;
    while (inst.dirty) {
      if (guard > 60) throw new Error('issue-1516-adv: render loop did not settle');
      guard += 1; inst.dirty = false; renderOnce(inst);
    }
  }
  function mount(Component, props) {
    const inst = { Component, props, hooks: [], queue: [], dirty: false, mounted: true, renders: 0, element: null };
    flush(inst);
    return inst;
  }
  function unmount(inst) {
    inst.mounted = false;
    for (const s of inst.hooks) if (s && s.effect && typeof s.cleanup === 'function') { s.cleanup(); s.cleanup = null; }
  }
  return { React, mount, unmount, flush };
}

// ── Fake clock + timers (also counts LEAKED timers) ──────────────────────────
function makeClock() {
  let now = 1_770_000_000_000;
  let seq = 0;
  let timers = [];
  const rST = global.setTimeout;
  const rCT = global.clearTimeout;
  const rDN = Date.now;
  const install = () => {
    global.setTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn }); return id; };
    global.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
    Date.now = () => now;
  };
  const restore = () => { global.setTimeout = rST; global.clearTimeout = rCT; Date.now = rDN; };
  const settle = async (inst, flush) => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    if (inst) flush(inst);
  };
  const advance = async (ms, inst, flush) => {
    const target = now + ms;
    await settle(inst, flush);
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
      await settle(inst, flush);
    }
    now = target;
    await settle(inst, flush);
  };
  return { install, restore, advance, settle, pending: () => timers.length };
}

// ── Supabase stub: multi-row, full read + write logs, programmable failures ──
function makeSupabase(rows, fetchPlan) {
  const db = Object.assign({}, rows);
  const writes = [];
  const reads = [];
  const plan = (fetchPlan || []).slice();
  const client = {
    from() {
      return {
        select() {
          return {
            eq(_col, id) {
              return {
                single: async () => {
                  reads.push(id);
                  const mode = plan.shift();
                  if (mode === 'error') return { data: null, error: { message: 'adv: simulated transient read failure' } };
                  if (mode === 'throw') throw new Error('adv: simulated transient read throw');
                  return { data: { coach_mark_step: db[id] }, error: null };
                },
              };
            },
          };
        },
        update(patch) {
          return {
            eq(_col, id) {
              writes.push({ step: patch.coach_mark_step, id });
              db[id] = patch.coach_mark_step;
              return { then: (cb) => Promise.resolve().then(() => cb({ error: null })) };
            },
          };
        },
      };
    },
  };
  return { supabase: client, db, writes, reads };
}

// ── Harness: mount the REAL CoachMarkProvider ────────────────────────────────
function makeHarness(opts) {
  const { rows, fetchPlan, userId = USER_A, stepsModule } = opts;
  const rt = makeReact();
  const sb = makeSupabase(rows, fetchPlan);
  const navigations = [];
  const userBox = { id: userId };
  const ctxModule = loadModule(CONTEXT_PATH, {
    react: rt.React,
    'react-native': {
      __esModule: true,
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      Platform: { OS: 'ios' },
    },
    'react-native-safe-area-context': {
      __esModule: true,
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    },
    '../store/appStore': { __esModule: true, useAppStore: () => ({ user: userBox.id ? { id: userBox.id } : null }) },
    '../services/supabase': { __esModule: true, supabase: sb.supabase },
    '../constants/coachMarkSteps': stepsModule,
    '../services/mixpanelService': {
      __esModule: true,
      mixpanelService: {
        track() {}, timeEvent() {},
        trackCoachMarkViewed() {}, trackCoachMarkCompleted() {},
        trackCoachTourCompleted() {}, trackCoachMarkSkipped() {},
      },
    },
  });
  const props = { children: null, navigateToTab: (tab) => navigations.push(tab) };
  return {
    sb, navigations, userBox,
    mount: () => rt.mount(ctxModule.CoachMarkProvider, props),
    read: (i) => i.element.value,
    unmount: rt.unmount,
    flush: rt.flush,
  };
}

// TAB_NAVIGATE_DELAY_MS (400) + the full 25 x 60ms offset-poll budget + slack, so the
// scroll steps (8..11) reach their centered fallback, which is where they surface.
const SETTLE_MS = 4000;

/** The blast-radius question this suite exists to answer, for one stored value. */
async function observe(clock, stored, stepsModule, fetchPlan) {
  const h = makeHarness({ rows: { [USER_A]: stored }, stepsModule, fetchPlan });
  const inst = h.mount();
  await clock.advance(SETTLE_MS, inst, h.flush);
  const v = h.read(inst);
  const snap = {
    currentStep: v.currentStep,
    isCoachActive: v.isCoachActive,
    isCoachPending: v.isCoachPending,
    isCoachLoading: v.isCoachLoading,
    overlayVisible: v.overlayVisible,
    configId: v.currentStepConfig ? v.currentStepConfig.id : null,
    writes: h.sb.writes.map((w) => w.step),
    dbAfter: h.sb.db[USER_A],
    reads: h.sb.reads.length,
  };
  h.unmount(inst);
  return { snap, h, inst, value: v };
}

async function run() {
  const realSteps = loadModule(STEPS_PATH, {});
  const N = realSteps.COACH_STEP_COUNT;
  const TOUR_COMPLETED = N + 1;

  const clock = makeClock();
  const warnings = [];
  const realWarn = console.warn;
  clock.install();
  console.warn = (...a) => warnings.push(a.join(' '));

  // Every write observed anywhere in this suite — feeds the local-only-band invariant.
  const allWrites = [];

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // T-1 — VALUE-GRAMMAR BOUNDARY SWEEP.
    //
    // The runtime no longer repairs anything. Pin the FULL observable tuple at every
    // edge, and above all pin the WRITE LOG: the defect this issue fixed was a READ
    // that silently WROTE. `N` (the last in-progress step) and `N + 2` / 99 (provably
    // out of grammar) are the two edges the implementor's 1..N loop and 3-sentinel
    // case never reach.
    // ═══════════════════════════════════════════════════════════════════════════
    {
      // stored -> expected [currentStep, active, pending, loading, overlay, configId, writes]
      const cases = [
        // ── in-progress band, upper edge ──────────────────────────────────────
        [N - 1, [N - 1, true, false, false, true, N - 1, []]],
        [N, [N, true, false, false, true, N, []]],
        // ── the terminal sentinel, exactly at the boundary ────────────────────
        [TOUR_COMPLETED, [TOUR_COMPLETED, false, false, false, false, null, []]],
        // ── ABOVE the boundary: out of grammar. Taken verbatim, NEVER rewritten. ─
        [TOUR_COMPLETED + 1, [TOUR_COMPLETED + 1, false, false, false, false, null, []]],
        [99, [99, false, false, false, false, null, []]],
        // ── the other two persisted sentinels ─────────────────────────────────
        [-1, [-1, false, false, false, false, null, []]],
        [0, [1, true, false, false, true, 1, [1]]],
        // ── below the grammar: out of grammar, negative ───────────────────────
        [-5, [-5, false, false, false, false, null, []]],
        // ── NULL column: coalesces to TOUR_NOT_STARTED and the tour runs ──────
        [null, [1, true, false, false, true, 1, [1]]],
      ];

      for (const [stored, expected] of cases) {
        const { snap, h } = await observe(clock, stored, realSteps);
        allWrites.push(...h.sb.writes.map((w) => w.step));
        const actual = [
          snap.currentStep, snap.isCoachActive, snap.isCoachPending,
          snap.isCoachLoading, snap.overlayVisible, snap.configId, snap.writes,
        ];
        assert.deepEqual(
          actual, expected,
          `T-1 stored=${stored}: expected [step,active,pending,loading,overlay,cfg,writes]=` +
          `${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
        );
      }

      // The two assertions that bind this test to the deleted normalization branch,
      // stated separately so the failure message names the defect, not a tuple diff.
      {
        const { snap } = await observe(clock, N, realSteps);
        assert.equal(
          snap.currentStep, N,
          `T-1: the LAST in-progress step (${N}) must RESUME at ${N}, got ${snap.currentStep}. ` +
          `${TOUR_COMPLETED} means the ORCH-0635 normalization branch is back and is eating the ` +
          `top of the live tour.`,
        );
        assert.equal(
          snap.isCoachActive, true,
          `T-1: step ${N} is the last card of the live tour and MUST be active on resume.`,
        );
        assert.deepEqual(
          snap.writes, [],
          `T-1: resuming step ${N} must write NOTHING — a READ that WRITES is the exact ` +
          `defect of #1516. Saw ${JSON.stringify(snap.writes)}.`,
        );
      }
      {
        const outOfGrammar = TOUR_COMPLETED + 1;
        const { snap } = await observe(clock, outOfGrammar, realSteps);
        assert.deepEqual(
          snap.writes, [],
          `T-1: an out-of-grammar stored value (${outOfGrammar}) must NOT be silently ` +
          `rewritten by the read path — the grammar is reconciled ONCE in the migration, ` +
          `never at mount. Saw writes ${JSON.stringify(snap.writes)}.`,
        );
        assert.equal(
          snap.isCoachActive, false,
          `T-1: ${outOfGrammar} is above COACH_STEP_COUNT and must never present as an active step.`,
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T-2 — BOTTOM-NAV LIVENESS (Constitution #1) + the local-only-band invariant.
    //
    // Read the REAL gate out of app/index.tsx so this assertion cannot drift out from
    // under the fix, then apply it to every state the fetch path can produce.
    // ═══════════════════════════════════════════════════════════════════════════
    {
      const appIndex = fs.readFileSync(APP_INDEX_PATH, 'utf8');
      assert.ok(
        appIndex.includes('const locked = isCoachLoading || isCoachPending || isCoachActive;'),
        'T-2: CoachMarkNavigationGate no longer computes `locked` from exactly ' +
        '(isCoachLoading || isCoachPending || isCoachActive) — this suite\'s nav-liveness ' +
        'model is stale. Re-derive it from app/index.tsx before trusting any verdict.',
      );
      assert.ok(
        /pointerEvents=\{locked \? 'none' : 'auto'\}/.test(appIndex),
        'T-2: CoachMarkNavigationGate no longer disables the tab bar via ' +
        "pointerEvents={locked ? 'none' : 'auto'} — the nav-liveness model is stale.",
      );
      const locked = (s) => s.isCoachLoading || s.isCoachPending || s.isCoachActive;

      // The nav MUST stay live in every state that renders nothing. A state that paints
      // no overlay while holding the tab bar dead is a dead nav with no way out.
      const mustBeLive = [
        [TOUR_COMPLETED, 'a completed tour'],
        [-1, 'a skipped tour'],
        [TOUR_COMPLETED + 1, 'an out-of-grammar row above the grammar'],
        [99, 'a far-out-of-grammar row'],
        [-5, 'an out-of-grammar row below the grammar'],
      ];
      for (const [stored, label] of mustBeLive) {
        const { snap, h } = await observe(clock, stored, realSteps);
        allWrites.push(...h.sb.writes.map((w) => w.step));
        assert.equal(
          snap.overlayVisible, false,
          `T-2 ${label} (stored=${stored}) must render no overlay.`,
        );
        assert.equal(
          locked(snap), false,
          `T-2 DEAD NAV: ${label} (stored=${stored}) renders nothing yet leaves the bottom ` +
          `tab bar pointerEvents='none'. The user has no overlay to dismiss and no nav to ` +
          `tap (Constitution #1).`,
        );
      }

      // TOUR_UNAVAILABLE is the state the rework INVENTED. It is the one the gate has
      // never seen, and the entire justification for not parking at LOADING_SENTINEL.
      {
        const { snap, h } = await observe(clock, 5, realSteps, ['error', 'error', 'error']);
        allWrites.push(...h.sb.writes.map((w) => w.step));
        assert.equal(
          snap.currentStep, TOUR_UNAVAILABLE,
          `T-2: a read that fails every attempt must hold TOUR_UNAVAILABLE (${TOUR_UNAVAILABLE}), ` +
          `got ${snap.currentStep}${snap.currentStep === TOUR_COMPLETED ? ' — that is #1516 all over again' : ''}.`,
        );
        assert.equal(
          locked(snap), false,
          'T-2 DEAD NAV: TOUR_UNAVAILABLE locks the bottom tab bar. This is the exact ' +
          'regression the rework said it was avoiding by not parking at LOADING_SENTINEL.',
        );
        assert.equal(snap.overlayVisible, false, 'T-2: TOUR_UNAVAILABLE must render nothing.');
      }

      // The grammar's other half: the local-only band must never reach the column. If
      // -2 or -3 were ever persisted, the next launch would read it back — and -2 is
      // isCoachLoading, i.e. a PERMANENTLY dead tab bar.
      const banned = allWrites.filter((s) => s === LOADING_SENTINEL || s === TOUR_UNAVAILABLE);
      assert.deepEqual(
        banned, [],
        `T-2: a LOCAL-ONLY band value (${LOADING_SENTINEL} / ${TOUR_UNAVAILABLE}) was PERSISTED ` +
        `(${JSON.stringify(banned)}). Reading ${LOADING_SENTINEL} back locks the bottom nav forever.`,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T-3 — TOUR_UNAVAILABLE PUBLIC-API BLAST RADIUS.
    // A state that "concludes nothing" must also write nothing when poked.
    // ═══════════════════════════════════════════════════════════════════════════
    {
      const STORED = 7; // a real in-progress tour the failed read could not see
      const h = makeHarness({ rows: { [USER_A]: STORED }, stepsModule: realSteps, fetchPlan: ['error', 'throw', 'error'] });
      const inst = h.mount();
      await clock.advance(SETTLE_MS, inst, h.flush);

      assert.equal(
        h.read(inst).currentStep, TOUR_UNAVAILABLE,
        'T-3 precondition: the provider must be parked at TOUR_UNAVAILABLE.',
      );
      assert.ok(
        h.sb.reads.length >= 3,
        `T-3 precondition: the read must be retried to exhaustion, saw ${h.sb.reads.length}.`,
      );

      // nextStep / prevStep are the two members SpotlightOverlay's buttons call.
      h.read(inst).nextStep();
      await clock.advance(SETTLE_MS, inst, h.flush);
      assert.equal(
        h.read(inst).currentStep, TOUR_UNAVAILABLE,
        'T-3: nextStep() from TOUR_UNAVAILABLE must be inert.',
      );
      assert.deepEqual(
        h.sb.writes, [],
        `T-3: nextStep() from TOUR_UNAVAILABLE must not write — the stored value is UNKNOWN, ` +
        `and writing over it is the "guess what this number means" defect #1516 deleted. ` +
        `Saw ${JSON.stringify(h.sb.writes)}.`,
      );

      h.read(inst).prevStep();
      await clock.advance(SETTLE_MS, inst, h.flush);
      assert.equal(
        h.read(inst).currentStep, TOUR_UNAVAILABLE,
        'T-3: prevStep() from TOUR_UNAVAILABLE must be inert.',
      );
      assert.deepEqual(
        h.sb.writes, [],
        `T-3: prevStep() from TOUR_UNAVAILABLE must not write. Saw ${JSON.stringify(h.sb.writes)}.`,
      );

      assert.equal(
        h.read(inst).currentStepConfig, null,
        'T-3: TOUR_UNAVAILABLE must expose no step config — SpotlightOverlay keys its ' +
        'entire render off currentStepConfig.',
      );
      assert.equal(h.read(inst).overlayVisible, false, 'T-3: TOUR_UNAVAILABLE must render nothing.');
      assert.equal(
        h.sb.db[USER_A], STORED,
        `T-3: the user's real stored step (${STORED}) must survive the whole failed-read ` +
        `episode untouched, so the next launch can resume it. Row now reads ${h.sb.db[USER_A]}.`,
      );
      allWrites.push(...h.sb.writes.map((w) => w.step));
      h.unmount(inst);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T-4 — STEP-COUNT DRIFT TRIPWIRE (the recurrence guard).
    // ═══════════════════════════════════════════════════════════════════════════
    {
      // (a) DEMONSTRATE the consequence of having no runtime normalization left.
      //     Load the REAL provider against a synthetic 12-step tour and watch today's
      //     TERMINAL value come back as an ACTIVE step. This is not a hypothetical:
      //     the tour already went 10 -> 7 -> 11, which is where the stale 8 / 10 / 13
      //     rows in production came from.
      const driftedSrc = fs.readFileSync(STEPS_PATH, 'utf8').replace(
        'export const COACH_STEP_COUNT',
        'COACH_STEPS.push({ id: 12, tab: "profile", title: "Synthetic 12th step", ' +
        'description: "drift probe", buttonLabel: "Next" });\nexport const COACH_STEP_COUNT',
      );
      const drifted = loadModule(STEPS_PATH, {}, driftedSrc);
      assert.equal(drifted.COACH_STEP_COUNT, N + 1, 'T-4 setup: the synthetic tour must be one step longer.');

      const { snap: driftSnap } = await observe(clock, TOUR_COMPLETED, drifted);
      assert.equal(
        driftSnap.isCoachActive, true,
        `T-4: setup check — under a ${N + 1}-step tour, today's terminal value ` +
        `${TOUR_COMPLETED} is expected to present as an ACTIVE in-progress step, because the ` +
        `runtime no longer normalizes anything. If this is now false, a runtime guard was ` +
        `added and the tripwire below should be re-derived.`,
      );
      assert.deepEqual(
        driftSnap.writes, [],
        'T-4: the drifted runtime must still not self-heal by writing — confirming the ' +
        'migration is the ONLY reconciliation path.',
      );

      // (b) THE TRIPWIRE. Because (a) holds, bumping the tour without shipping a
      //     matching migration silently re-opens the tour for every completed user.
      assert.equal(
        N, 11,
        'T-4 TRIPWIRE: COACH_STEP_COUNT changed. TOUR_COMPLETED is DERIVED ' +
        '(COACH_STEP_COUNT + 1), the ORCH-0635 runtime normalization branch was deleted by ' +
        'issue #1516, and nothing at runtime repairs a stored value any more. Every row ' +
        'holding the OLD TOUR_COMPLETED will be read back as an IN-PROGRESS step and those ' +
        'users will be dragged back into the tour. Ship a data migration in the SAME PR that ' +
        'moves this count (see supabase/migrations/20270210001516_*.sql for the pattern), ' +
        'then update this pin and the column comment together.',
      );

      // (c) The shipped migration must agree with the live constant, or the reconciliation
      //     that (b) demands was written against a different tour than the one that ships.
      const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
      const m = migration.match(/v_tour_completed\s+CONSTANT\s+integer\s*:=\s*(-?\d+)\s*;/);
      assert.ok(m, 'T-4: cannot find v_tour_completed in the #1516 migration — has it been renamed?');
      assert.equal(
        Number(m[1]), TOUR_COMPLETED,
        `T-4: the #1516 migration normalizes to ${m[1]} but the live runtime's TOUR_COMPLETED ` +
        `is ${TOUR_COMPLETED} (COACH_STEP_COUNT ${N} + 1). The data reconciliation and the ` +
        `runtime disagree about what "completed" means.`,
      );
      assert.ok(
        /coach_mark_step\s*>\s*v_tour_completed/.test(migration) &&
        /coach_mark_step\s*<\s*v_tour_skipped/.test(migration),
        'T-4: the migration no longer catches BOTH out-of-grammar directions ' +
        '(> completed and < skipped) by VALUE. Rows like 13 are then reachable only by the ' +
        'timestamp predicate, which does not cover them.',
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T-5 — UNMOUNT DURING THE FETCH RETRY.
    // The retry timer is brand-new surface. It must cancel cleanly and, crucially,
    // must not have CONCLUDED anything before it was cut off.
    // ═══════════════════════════════════════════════════════════════════════════
    {
      const h = makeHarness({ rows: { [USER_A]: 4 }, stepsModule: realSteps, fetchPlan: ['error', 'error', 'error'] });
      const inst = h.mount();
      // 100ms: attempt 1 has failed, the 700ms retry timer is armed, nothing concluded.
      await clock.advance(100, inst, h.flush);

      assert.equal(h.sb.reads.length, 1, `T-5: exactly one read attempt at t=100ms, saw ${h.sb.reads.length}.`);
      assert.equal(
        h.read(inst).currentStep, LOADING_SENTINEL,
        `T-5: mid-retry the provider must still be LOADING (${LOADING_SENTINEL}) and must have ` +
        `concluded NOTHING, got ${h.read(inst).currentStep}. ` +
        `${TOUR_COMPLETED} means a single failed read is being read as a completed tour again.`,
      );

      const readsAtUnmount = h.sb.reads.length;
      h.unmount(inst);
      await clock.advance(30_000, null, h.flush);

      assert.equal(
        h.sb.reads.length, readsAtUnmount,
        `T-5: the retry fired AFTER unmount — ${h.sb.reads.length - readsAtUnmount} extra read(s). ` +
        'A cancelled effect must not keep hitting the network.',
      );
      assert.deepEqual(h.sb.writes, [], 'T-5: an unmounted provider must never write.');
      assert.equal(h.sb.db[USER_A], 4, 'T-5: the row must be untouched by a cancelled retry.');
      assert.equal(
        clock.pending(), 0,
        `T-5: ${clock.pending()} timer(s) still armed after unmount + 30s — the retry timer leaked.`,
      );
      allWrites.push(...h.sb.writes.map((w) => w.step));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T-6 — CONCURRENT + SEQUENTIAL SECOND PROVIDER (module-scope anchor is shared).
    // ═══════════════════════════════════════════════════════════════════════════
    {
      // Two live providers on the same runtime, same user, both at TOUR_NOT_STARTED.
      const h = makeHarness({ rows: { [USER_A]: 0 }, stepsModule: realSteps });
      const a = h.mount();
      const b = h.mount();
      await clock.advance(SETTLE_MS, a, h.flush);
      await clock.advance(10, b, h.flush);

      assert.equal(h.read(a).currentStep, 1, `T-6: provider A must start the tour at 1, got ${h.read(a).currentStep}.`);
      assert.equal(h.read(b).currentStep, 1, `T-6: provider B must converge on 1, got ${h.read(b).currentStep}.`);
      assert.deepEqual(
        h.sb.writes.filter((w) => w.step === TOUR_COMPLETED), [],
        'T-6: a second concurrent provider must never cancel the first one\'s tour.',
      );
      assert.ok(
        h.sb.writes.every((w) => w.step === 1),
        `T-6: a double-mount must only ever write step 1, saw ${JSON.stringify(h.sb.writes.map((w) => w.step))}.`,
      );
      allWrites.push(...h.sb.writes.map((w) => w.step));
      h.unmount(a);
      h.unmount(b);

      // Sequential: a provider mounting AFTER step 1 was already persisted must RESUME.
      const writesBefore = h.sb.writes.length;
      const c = h.mount();
      await clock.advance(SETTLE_MS, c, h.flush);
      assert.equal(
        h.read(c).currentStep, 1,
        `T-6: a later provider must RESUME the persisted step 1, got ${h.read(c).currentStep}.`,
      );
      assert.equal(h.read(c).isCoachActive, true, 'T-6: the resumed tour must be active.');
      assert.equal(
        h.sb.writes.length, writesBefore,
        `T-6: a pure resume must add no writes, saw ${JSON.stringify(h.sb.writes.slice(writesBefore))}.`,
      );
      h.unmount(c);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T-7 — CROSS-USER START-DELAY ANCHOR ISOLATION.
    // startDelayAnchorByUserId is module scope and deliberately never cleared.
    // ═══════════════════════════════════════════════════════════════════════════
    {
      // User A burns its anchor and starts.
      const hA = makeHarness({ rows: { [USER_A]: 0 }, stepsModule: realSteps, userId: USER_A });
      const a = hA.mount();
      await clock.advance(3000, a, hA.flush);
      assert.equal(hA.read(a).currentStep, 1, 'T-7 setup: user A must have started the tour.');
      hA.unmount(a);
      await clock.advance(120_000, null, hA.flush); // a long while later

      // User B signs in to the SAME JS runtime. A's elapsed anchor must not rush B.
      const hB = makeHarness({ rows: { [USER_B]: 0 }, stepsModule: realSteps, userId: USER_B });
      const b = hB.mount();
      await clock.advance(200, b, hB.flush);
      assert.equal(
        hB.read(b).currentStep, 0,
        `T-7: user B must still be waiting out its OWN first-run delay 200ms in, got ` +
        `${hB.read(b).currentStep}. A cross-user anchor would have started B immediately.`,
      );
      assert.deepEqual(hB.sb.writes, [], 'T-7: user B must not have persisted anything yet.');

      await clock.advance(2000, b, hB.flush);
      assert.equal(hB.read(b).currentStep, 1, 'T-7: user B must start its tour once its own delay elapses.');
      assert.deepEqual(
        hB.sb.writes.map((w) => w.id), [USER_B],
        `T-7: every write must be addressed to user B's row, saw ${JSON.stringify(hB.sb.writes)}.`,
      );
      allWrites.push(...hB.sb.writes.map((w) => w.step));
      hB.unmount(b);
    }

    // Final restatement of the local-only-band invariant over EVERY write this suite saw.
    {
      const banned = allWrites.filter((s) => s === LOADING_SENTINEL || s === TOUR_UNAVAILABLE);
      assert.deepEqual(
        banned, [],
        `FINAL: a local-only band value reached the database (${JSON.stringify(banned)}). ` +
        `-2 and -3 must never be persisted.`,
      );
    }
  } finally {
    console.warn = realWarn;
    clock.restore();
  }

  return `issue-1516 TESTER ADVERSARIAL: PASS (T-1 grammar boundary sweep, T-2 nav liveness + local-only band, T-3 TOUR_UNAVAILABLE API blast radius, T-4 step-count drift tripwire, T-5 unmount-during-retry, T-6 double-mount, T-7 cross-user anchor)`;
}

if (require.main === module) {
  run()
    .then((msg) => { console.log(msg); process.exit(0); })
    .catch((err) => {
      console.log('issue-1516 TESTER ADVERSARIAL: FAIL');
      console.log(err && err.message ? err.message : String(err));
      if (err && err.expected !== undefined) console.log(`${JSON.stringify(err.actual)} !== ${JSON.stringify(err.expected)}`);
      process.exit(1);
    });
}

module.exports = { run };
