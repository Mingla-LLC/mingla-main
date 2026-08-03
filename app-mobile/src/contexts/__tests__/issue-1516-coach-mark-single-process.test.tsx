// @ts-nocheck
// Issue #1516 [coach mark single process] — IMPLEMENTOR happy-path regression test.
//
// node-runnable, no jest (the app-mobile convention — self-runs via
// require.main === module). Wired as `npm run test:issue-1516` from app-mobile/.
//
// WHAT THIS PROVES
// This is NOT a source-grep test. It sucrase-transpiles and EXECUTES the real
// `src/contexts/CoachMarkContext.tsx` against a deterministic React hook runtime
// (useState/useRef/useEffect/useCallback/useMemo + fake timers + a fake clock), with
// react-native / safe-area / appStore / supabase / mixpanel stubbed. Every assertion is
// therefore about the ACTUAL provider state machine, not about the text of the file.
//
// The bug: `CoachMarkContext.tsx` carried an ORCH-0635 "legacy tour" normalization
// branch that fired on EVERY provider mount for any stored `coach_mark_step` in
// 1..COACH_STEP_COUNT and rewrote it to TOUR_COMPLETED (12), rendering nothing. But
// 1..11 is exactly the range the LIVE 11-step tour occupies while in progress, so the
// post-onboarding provider remount (ATT prompt + refreshAllSessions showLoading unmounts
// the authed subtree) destroyed real in-progress tours. Brand-new users were stamped
// `coach_mark_step = 12` having never seen a single card.
//
//   R-1  RESUME AT EVERY IN-PROGRESS STEP. For each step 1..COACH_STEP_COUNT: mount,
//        unmount, remount. Both mounts must resolve currentStep to EXACTLY that step,
//        report isCoachActive, and re-show the overlay. No mount may write 12 — and no
//        mount may write anything at all on a pure resume.
//   R-2  THE #1516 END-TO-END RACE. Fresh user at 0 → the start delay elapses → the
//        provider persists step 1 and shows the overlay → the post-onboarding remount
//        fires → the remount must RESUME at step 1 with the overlay up, and must never
//        write TOUR_COMPLETED. This is the exact live sequence from
//        `ashfordbysadiq` (45316d80-cc00-49c9-9d69-882338dc016c).
//   R-3  ONLY 0 / -1 / 12 ARE SENTINELS. The three terminal values stay terminal and
//        inert across a remount (no overlay, no write, no reinterpretation).
//   R-4  START-RACE HARDENING. A remount that happens BEFORE the start delay elapses
//        must not restart the countdown — the per-user module-scope anchor carries the
//        elapsed time across the remount so the tour still starts on schedule.
//
// Verification note (#1516): `coach_mark_step = 12` is unfalsifiable from the database —
// the genuine-completion path and the silent-cancel path both write it — and coach-mark
// analytics go to Mixpanel only. So every assertion below is on the state machine
// (currentStep / isCoachActive / overlayVisible) and on the observed write log, never on
// a persisted value alone.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transform } = require('sucrase');

// ── Repo-root resolution (run from app-mobile/ or repo root) ──────────────────
function appMobileRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'src/contexts/CoachMarkContext.tsx'))) return cwd;
  const nested = path.join(cwd, 'app-mobile');
  if (fs.existsSync(path.join(nested, 'src/contexts/CoachMarkContext.tsx'))) return nested;
  throw new Error('cannot locate app-mobile root from ' + cwd);
}
const ROOT = appMobileRoot();
const CONTEXT_PATH = path.join(ROOT, 'src/contexts/CoachMarkContext.tsx');
const STEPS_PATH = path.join(ROOT, 'src/constants/coachMarkSteps.ts');

const USER_ID = '45316d80-cc00-49c9-9d69-882338dc016c';

// ── Minimal module loader: transpile the REAL source, inject stubs ────────────
function loadModule(absPath, stubs) {
  const code = transform(fs.readFileSync(absPath, 'utf8'), {
    transforms: ['typescript', 'jsx', 'imports'],
    filePath: absPath,
  }).code;
  const mod = { exports: {} };
  const req = (spec) => {
    if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
    throw new Error(`issue-1516 harness: unstubbed require(${JSON.stringify(spec)}) from ${absPath}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    mod.exports, req, mod, absPath, path.dirname(absPath),
  );
  return mod.exports;
}

// ── Deterministic React hook runtime ─────────────────────────────────────────
// Enough of React to execute a single function component with real hook semantics:
// state updates mark the instance dirty and re-render; effects run after commit with
// dep comparison and cleanup-before-rerun / cleanup-on-unmount.
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
    createContext(defaultValue) {
      const ctx = { _default: defaultValue };
      ctx.Provider = (props) => ({ __provider: true, value: props.value, children: props.children });
      return ctx;
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
      const setter = (next) => {
        const prev = s.value;
        const val = typeof next === 'function' ? next(prev) : next;
        if (Object.is(val, prev)) return;
        s.value = val;
        inst.dirty = true;
      };
      return [s.value, setter];
    },
    useRef(initial) {
      return slot(() => ({ current: initial }));
    },
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
      if (!s.primed || !depsEqual(s.deps, deps)) {
        s.primed = true;
        s.deps = deps;
        s.fn = fn;
        inst.queue.push(s);
      }
    },
    useContext(ctx) { return ctx._default; },
  };
  React.default = React;

  function renderOnce(inst) {
    cur = inst;
    idx = 0;
    inst.queue = [];
    inst.element = inst.Component(inst.props);
    cur = null;
    inst.renders += 1;
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
      if (guard > 60) throw new Error('issue-1516 harness: render loop did not settle');
      guard += 1;
      inst.dirty = false;
      renderOnce(inst);
    }
  }

  function mount(Component, props) {
    const inst = { Component, props, hooks: [], queue: [], dirty: false, mounted: true, renders: 0, element: null };
    flush(inst);
    return inst;
  }

  function unmount(inst) {
    inst.mounted = false;
    for (const s of inst.hooks) {
      if (s && s.effect && typeof s.cleanup === 'function') { s.cleanup(); s.cleanup = null; }
    }
  }

  return { React, mount, unmount, flush };
}

// ── Fake clock + timers ──────────────────────────────────────────────────────
function makeClock() {
  let now = 1_760_000_000_000;
  let seq = 0;
  let timers = [];
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const realDateNow = Date.now;

  const install = () => {
    global.setTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn }); return id; };
    global.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
    Date.now = () => now;
  };
  const restore = () => {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    Date.now = realDateNow;
  };

  // Drain the microtask queue so awaited supabase stubs settle, then re-render.
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

  return { install, restore, advance, settle, nowRef: () => now };
}

// ── Supabase stub: one row, full write log ───────────────────────────────────
function makeSupabase(initialStep) {
  const db = { coach_mark_step: initialStep };
  const writes = [];
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { single: async () => ({ data: { coach_mark_step: db.coach_mark_step }, error: null }) };
            },
          };
        },
        update(patch) {
          return {
            eq(_col, id) {
              writes.push({ step: patch.coach_mark_step, id });
              db.coach_mark_step = patch.coach_mark_step;
              return { then: (cb) => Promise.resolve().then(() => cb({ error: null })) };
            },
          };
        },
      };
    },
  };
  return { supabase: client, db, writes };
}

// ── Harness: mount the REAL CoachMarkProvider ────────────────────────────────
function makeHarness(initialStep, sharedRealSteps) {
  const rt = makeReact();
  const sb = makeSupabase(initialStep);
  const navigations = [];
  const stepsModule = sharedRealSteps || loadModule(STEPS_PATH, {});

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
    '../store/appStore': { __esModule: true, useAppStore: () => ({ user: { id: USER_ID } }) },
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
  const mount = () => rt.mount(ctxModule.CoachMarkProvider, props);
  const read = (inst) => inst.element.value;

  return { rt, sb, mount, read, navigations, stepsModule, unmount: rt.unmount, flush: rt.flush };
}

// Enough time for the scroll-step path (TAB_NAVIGATE_DELAY_MS + the full offset poll
// budget) to reach its centered fallback, which is where scroll steps surface the overlay.
const SETTLE_MS = 3000;

async function run() {
  const realSteps = loadModule(STEPS_PATH, {});
  const STEP_COUNT = realSteps.COACH_STEP_COUNT;
  const TOUR_COMPLETED = STEP_COUNT + 1;

  assert.equal(STEP_COUNT, 11, 'guard: the live tour is 11 steps (COACH_STEP_COUNT)');
  assert.equal(TOUR_COMPLETED, 12, 'guard: TOUR_COMPLETED is 12');

  const clock = makeClock();
  const warnings = [];
  const realWarn = console.warn;
  clock.install();
  console.warn = (...a) => warnings.push(a.join(' '));

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // R-1 — resume at EVERY in-progress step, across a remount.
    // ─────────────────────────────────────────────────────────────────────────
    for (let step = 1; step <= STEP_COUNT; step += 1) {
      const h = makeHarness(step, realSteps);

      // First mount — the app launches with an in-progress tour on the row.
      const a = h.mount();
      await clock.advance(SETTLE_MS, a, h.flush);
      let v = h.read(a);
      assert.equal(v.currentStep, step, `R-1 mount: step ${step} must resume at ${step}, got ${v.currentStep}`);
      assert.equal(v.isCoachActive, true, `R-1 mount: step ${step} must report isCoachActive`);
      assert.equal(v.overlayVisible, true, `R-1 mount: step ${step} must show its overlay`);
      assert.equal(h.sb.db.coach_mark_step, step, `R-1 mount: step ${step} must not be rewritten in the DB`);

      // The post-onboarding remount: unmount the whole authed subtree, mount it again.
      h.unmount(a);
      const b = h.mount();
      await clock.advance(SETTLE_MS, b, h.flush);
      v = h.read(b);
      assert.equal(v.currentStep, step, `R-1 remount: step ${step} must RESUME at ${step}, got ${v.currentStep}`);
      assert.equal(v.isCoachActive, true, `R-1 remount: step ${step} must still report isCoachActive`);
      assert.equal(v.overlayVisible, true, `R-1 remount: step ${step} must RE-SHOW its overlay`);
      assert.equal(v.currentStepConfig && v.currentStepConfig.id, step, `R-1 remount: step ${step} must expose its own config`);

      // The killer assertion: nothing may silently cancel the tour.
      const completedWrites = h.sb.writes.filter((w) => w.step === TOUR_COMPLETED);
      assert.deepEqual(completedWrites, [], `R-1: step ${step} must NEVER be normalized to TOUR_COMPLETED (${TOUR_COMPLETED})`);
      assert.deepEqual(h.sb.writes, [], `R-1: a pure resume at step ${step} must write NOTHING, saw ${JSON.stringify(h.sb.writes)}`);
      assert.equal(h.sb.db.coach_mark_step, step, `R-1: step ${step} must still be ${step} after the remount`);
      h.unmount(b);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // R-2 — the live #1516 sequence, end to end.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const h = makeHarness(0, realSteps);

      const a = h.mount();
      await clock.advance(100, a, h.flush);
      assert.equal(h.read(a).currentStep, 0, 'R-2: a fresh user starts at TOUR_NOT_STARTED');
      assert.equal(h.read(a).isCoachPending, true, 'R-2: a fresh user is pending, not active');

      // START_DELAY_MS elapses inside the post-onboarding settling window.
      await clock.advance(2000, a, h.flush);
      let v = h.read(a);
      assert.equal(v.currentStep, 1, 'R-2: the tour must start at step 1 after the start delay');
      assert.equal(v.overlayVisible, true, 'R-2: step 1 must show its overlay');
      assert.deepEqual(h.sb.writes.map((w) => w.step), [1], 'R-2: exactly one write — step 1');
      assert.equal(h.sb.writes[0].id, USER_ID, 'R-2: the write must be addressed to the signed-in row');

      // ATT prompt + refreshAllSessions({showLoading:true}) → the authed subtree remounts.
      h.unmount(a);
      const b = h.mount();
      await clock.advance(SETTLE_MS, b, h.flush);
      v = h.read(b);
      assert.equal(v.currentStep, 1, `R-2: the remount must RESUME at step 1, got ${v.currentStep} (12 = the #1516 silent cancel)`);
      assert.equal(v.isCoachActive, true, 'R-2: the tour must still be active after the remount');
      assert.equal(v.overlayVisible, true, 'R-2: the remount must RE-SHOW step 1');
      assert.deepEqual(
        h.sb.writes.filter((w) => w.step === TOUR_COMPLETED), [],
        'R-2: the remount must NEVER write TOUR_COMPLETED — that is the bug that stamped brand-new users as "tour completed"',
      );
      assert.equal(h.sb.db.coach_mark_step, 1, 'R-2: the row must still read 1 after the remount');

      // And the user can actually walk the tour from the resumed step.
      h.read(b).nextStep();
      await clock.advance(SETTLE_MS, b, h.flush);
      assert.equal(h.read(b).currentStep, 2, 'R-2: nextStep from the resumed step must advance to 2');
      assert.deepEqual(h.sb.writes.map((w) => w.step), [1, 2], 'R-2: advancing persists step 2');
      h.unmount(b);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // R-3 — 0 / -1 / 12 are the ONLY sentinels, and they are inert.
    // ─────────────────────────────────────────────────────────────────────────
    for (const sentinel of [-1, TOUR_COMPLETED]) {
      const h = makeHarness(sentinel, realSteps);
      const a = h.mount();
      await clock.advance(SETTLE_MS, a, h.flush);
      const v = h.read(a);
      assert.equal(v.currentStep, sentinel, `R-3: sentinel ${sentinel} must be preserved verbatim`);
      assert.equal(v.isCoachActive, false, `R-3: sentinel ${sentinel} must not activate the tour`);
      assert.equal(v.overlayVisible, false, `R-3: sentinel ${sentinel} must not show an overlay`);
      assert.deepEqual(h.sb.writes, [], `R-3: sentinel ${sentinel} must be inert — no writes`);
      h.unmount(a);

      const b = h.mount();
      await clock.advance(SETTLE_MS, b, h.flush);
      assert.equal(h.read(b).currentStep, sentinel, `R-3: sentinel ${sentinel} must survive a remount`);
      assert.deepEqual(h.sb.writes, [], `R-3: sentinel ${sentinel} must stay inert across a remount`);
      h.unmount(b);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // R-4 — the start delay survives the remount (start-race hardening).
    // ─────────────────────────────────────────────────────────────────────────
    {
      const h = makeHarness(0, realSteps);
      const a = h.mount();
      // 800ms into the 1500ms start delay the post-onboarding remount lands.
      await clock.advance(800, a, h.flush);
      assert.deepEqual(h.sb.writes, [], 'R-4: nothing persisted before the delay elapses');
      h.unmount(a);

      const b = h.mount();
      // Only the REMAINING ~700ms may be required. A countdown that restarted from
      // scratch would still be waiting here.
      await clock.advance(900, b, h.flush);
      const v = h.read(b);
      assert.equal(v.currentStep, 1, 'R-4: the remount must not restart the start-delay countdown');
      assert.equal(v.overlayVisible, true, 'R-4: the tour must be visible once the anchored delay elapses');
      assert.deepEqual(h.sb.writes.map((w) => w.step), [1], 'R-4: step 1 persisted exactly once across the remount');
      h.unmount(b);
    }
  } finally {
    console.warn = realWarn;
    clock.restore();
  }

  return { passed: true };
}

if (require.main === module) {
  run().then(() => {
    console.log('issue-1516 coach-mark single-process regression: PASS (R-1 x11 steps, R-2, R-3, R-4)');
  }).catch((e) => {
    console.error('issue-1516 coach-mark single-process regression: FAIL');
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { run };
