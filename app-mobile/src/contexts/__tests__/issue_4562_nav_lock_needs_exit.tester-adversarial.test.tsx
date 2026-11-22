// @ts-nocheck
// Issue #4562 [first-run tour lock] - TESTER ADVERSARIAL regression test.
//
// Guards invariant I-EXPLORER-NAV-LOCK-NEEDS-EXIT (declared in issue_4562_nav_lock_needs_exit.test.tsx).
// node-runnable, no jest. Same execution model as the implementor's suite: the REAL
// CoachMarkContext provider, the REAL SpotlightOverlay and the REAL CoachMarkNavigationGate
// sliced from app/index.tsx, under a deterministic hook runtime and fake timers. The harness
// is copied (not imported) so this file stands alone if the implementor's suite changes.
//
// Angle: the implementor's suite proves the steady states. This suite attacks the EDGES of
// the presentation report that now drives the lock:
//   AT-1  STALE REPORT: a presentation report for step 1 that lands after the tour has moved
//         to step 2 (whose bubble is NOT drawn) must not lock the tabs or own Android Back.
//   AT-2  OVERLAY UNMOUNT: the overlay disappearing while its bubble is drawn (route change,
//         tree swap) must release the tabs and Android Back through its own clean-up.
//   AT-3  RAPID SKIP: Skip pressed with a late step-1 report racing it leaves the tour at -1,
//         tabs live, no Back listener, and no Held or second Viewed afterwards.
//   AT-4  HELD CLOCK PER ENTRY: a fast step change (step 1 drawn, then step 2 entered while the
//         keyboard hides it) must not fire Held for step 1, must fire exactly one Held for
//         step 2 at about 5 s after ITS entry (reason keyboard), and the tabs stay live
//         throughout the undrawn step.
//   AT-5  BACK REGRESSION: Back from a drawn step 2 returns to step 1, whose registered card
//         redraws the bubble, and the lock follows the redraw.
// Fails on revert: restoring the old gate (`isCoachLoading || isCoachPending || isCoachActive`)
// fails AT-1, AT-2 and AT-4 with 'none' !== 'auto'.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transform } = require('sucrase');

function appMobileRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'src/contexts/CoachMarkContext.tsx'))) return cwd;
  const nested = path.join(cwd, 'app-mobile');
  if (fs.existsSync(path.join(nested, 'src/contexts/CoachMarkContext.tsx'))) return nested;
  throw new Error('cannot locate app-mobile root from ' + cwd);
}
const ROOT = appMobileRoot();
const CONTEXT_PATH = path.join(ROOT, 'src/contexts/CoachMarkContext.tsx');
const OVERLAY_PATH = path.join(ROOT, 'src/components/SpotlightOverlay.tsx');
const INDEX_PATH = path.join(ROOT, 'app/index.tsx');
const STEPS_PATH = path.join(ROOT, 'src/constants/coachMarkSteps.ts');
const SKIP_STATE_PATH = path.join(ROOT, 'src/contexts/coachMarkSkipState.ts');
const USER_ID = '45316d80-cc00-49c9-9d69-882338dc016c';

// ── Module loader: transpile REAL source, inject stubs ────────────────────────
function compile(source, filePath) {
  return transform(source, { transforms: ['typescript', 'jsx', 'imports'], filePath }).code;
}
function loadModule(absPath, stubs) {
  const code = compile(fs.readFileSync(absPath, 'utf8'), absPath);
  const mod = { exports: {} };
  const req = (spec) => {
    if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
    throw new Error(`issue-4562 tester harness: unstubbed require(${JSON.stringify(spec)}) from ${absPath}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', '__DEV__', code)(
    mod.exports, req, mod, absPath, path.dirname(absPath), false,
  );
  return mod.exports;
}

// ── Deterministic React hook runtime (same semantics as the issue-1516 harness) ──
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
    Fragment: 'Fragment',
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
        const val = typeof next === 'function' ? next(s.value) : next;
        if (Object.is(val, s.value)) return;
        s.value = val;
        inst.dirty = true;
      };
      return [s.value, setter];
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
      if (!s.primed || !depsEqual(s.deps, deps)) {
        s.primed = true; s.deps = deps; s.fn = fn;
        inst.queue.push(s);
      }
    },
    useContext(ctx) { return ctx._default; },
  };
  React.default = React;

  function renderOnce(inst) {
    cur = inst; idx = 0; inst.queue = [];
    inst.element = inst.Component(inst.props);
    cur = null;
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
      if (guard > 60) throw new Error('issue-4562 tester harness: render loop did not settle');
      guard += 1; inst.dirty = false; renderOnce(inst);
    }
  }
  function mount(Component, props) {
    const inst = { Component, props, hooks: [], queue: [], dirty: false, mounted: true, element: null };
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
  const real = { st: global.setTimeout, ct: global.clearTimeout, dn: Date.now };
  const install = () => {
    global.setTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn }); return id; };
    global.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
    Date.now = () => now;
  };
  const restore = () => { global.setTimeout = real.st; global.clearTimeout = real.ct; Date.now = real.dn; };
  const settle = async (flushAll) => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    flushAll();
  };
  const advance = async (ms, flushAll) => {
    const target = now + ms;
    await settle(flushAll);
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
      await settle(flushAll);
    }
    now = target;
    await settle(flushAll);
  };
  return { install, restore, advance, settle };
}

// ── Supabase stub: one row, write log ────────────────────────────────────────
function makeSupabase(initialStep) {
  const db = { coach_mark_step: initialStep };
  const writes = [];
  const client = {
    from() {
      return {
        select() {
          return { eq() { return { single: async () => ({ data: { coach_mark_step: db.coach_mark_step }, error: null }) }; } };
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

// ── Tree helpers over the overlay's returned element ─────────────────────────
function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = findNode(child, predicate); if (hit) return hit; }
    return null;
  }
  if (node.props && predicate(node)) return node;
  return node.props ? findNode(node.props.children, predicate) : null;
}

// ── World: REAL provider + REAL overlay + REAL gate, one fake device ─────────
const NOOP_ANIM = { start(cb) { if (cb) cb({ finished: true }); } };

function makeWorld({ storedStep, withOverlay, windowSize, platform }) {
  const rt = makeReact();
  const sb = makeSupabase(storedStep);
  const navigations = [];
  const stepsModule = loadModule(STEPS_PATH, {});
  const skipStateModule = loadModule(SKIP_STATE_PATH, {});
  const win = windowSize || { width: 360, height: 712 };
  const screen = { width: 360, height: 800 };
  const insets = { top: 24, bottom: 16, left: 0, right: 0 };
  const mixpanel = { viewed: [], held: [], completed: [], skipped: [], timed: [] };
  const keyboard = { listeners: {} };
  let backHandler = null;
  let providerInst = null;
  const liveContext = () => providerInst.element.value;

  const ReactNativeStub = {
    __esModule: true,
    Platform: { OS: platform || 'android' },
    Dimensions: { get: (which) => (which === 'screen' ? screen : win) },
    BackHandler: {
      addEventListener(event, handler) {
        assert.equal(event, 'hardwareBackPress');
        backHandler = handler;
        return { remove() { if (backHandler === handler) backHandler = null; } };
      },
    },
    View: 'View',
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    StyleSheet: { create: (x) => x, absoluteFill: {} },
    Animated: {
      Value: class { constructor(v) { this.v = v; } setValue(v) { this.v = v; } },
      View: 'Animated.View',
      timing: () => NOOP_ANIM,
      parallel: () => NOOP_ANIM,
      sequence: () => NOOP_ANIM,
    },
    Easing: { out: () => 0, in: () => 0, ease: 0 },
    Keyboard: {
      addListener(name, cb) {
        keyboard.listeners[name] = cb;
        return { remove() { delete keyboard.listeners[name]; } };
      },
    },
    useWindowDimensions: () => win,
    AccessibilityInfo: { isReduceMotionEnabled: () => new Promise(() => {}) },
  };

  const ctxModule = loadModule(CONTEXT_PATH, {
    react: rt.React,
    'react-native': ReactNativeStub,
    'react-native-safe-area-context': { __esModule: true, useSafeAreaInsets: () => insets },
    '../store/appStore': { __esModule: true, useAppStore: () => ({ user: { id: USER_ID } }) },
    '../services/supabase': { __esModule: true, supabase: sb.supabase },
    '../constants/coachMarkSteps': stepsModule,
    './coachMarkSkipState': skipStateModule,
    '../services/mixpanelService': {
      __esModule: true,
      mixpanelService: {
        track() {},
        timeEvent(name) { mixpanel.timed.push(name); },
        trackCoachMarkViewed(p) { mixpanel.viewed.push(p); },
        trackCoachMarkHeld(p) { mixpanel.held.push(p); },
        trackCoachMarkCompleted(p) { mixpanel.completed.push(p); },
        trackCoachTourCompleted() {},
        trackCoachMarkSkipped(p) { mixpanel.skipped.push(p); },
      },
    },
  });

  const overlayModule = withOverlay ? loadModule(OVERLAY_PATH, {
    react: rt.React,
    'react-native': ReactNativeStub,
    'react-native-svg': { __esModule: true, default: 'Svg', Defs: 'Defs', Rect: 'Rect', Mask: 'Mask' },
    'react-native-safe-area-context': {
      __esModule: true,
      useSafeAreaFrame: () => ({ x: 0, y: 0, width: screen.width, height: screen.height }),
      useSafeAreaInsets: () => insets,
    },
    '../contexts/CoachMarkContext': { __esModule: true, useCoachMarkContext: liveContext },
    '../hooks/useAppLayout': { __esModule: true, useAppLayout: () => ({ insets, bottomNavTotalHeight: 80 }) },
    '../constants/coachMarkSteps': stepsModule,
    './CoachLikesPreview': { __esModule: true, default: 'CoachLikesPreview' },
    'react-i18next': { __esModule: true, useTranslation: () => ({ t: (key) => key }) },
    '../services/mixpanelService': {
      __esModule: true,
      mixpanelService: { trackCoachMarkHeld(p) { mixpanel.held.push(p); } },
    },
  }) : null;

  // The REAL gate, sliced out of app/index.tsx. `useCoachMarkContext` is the live provider.
  const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
  const gateMatch = indexSource.match(/function CoachMarkNavigationGate[\s\S]*?\n}\n/);
  assert.ok(gateMatch, 'harness: CoachMarkNavigationGate must exist in app/index.tsx');
  const gateCode = compile(gateMatch[0] + '\nreturn CoachMarkNavigationGate;', INDEX_PATH);
  // eslint-disable-next-line no-new-func
  const Gate = new Function('React', 'View', 'styles', 'Platform', 'useCoachMarkContext', gateCode)(
    rt.React, 'View', new Proxy({}, { get: () => ({}) }), { OS: 'android' }, liveContext,
  );

  const providerProps = { children: null, navigateToTab: (tab) => navigations.push(tab) };
  providerInst = rt.mount(ctxModule.CoachMarkProvider, providerProps);
  const overlayInst = overlayModule ? rt.mount(overlayModule.default, {}) : null;

  const flushAll = () => {
    for (let i = 0; i < 60; i += 1) {
      rt.flush(providerInst);
      if (overlayInst) rt.flush(overlayInst);
      if (!providerInst.dirty && !(overlayInst && overlayInst.dirty)) return;
    }
    throw new Error('issue-4562 tester harness: world did not settle');
  };

  const world = {
    sb, mixpanel, navigations,
    ctx: liveContext,
    advance: (ms) => clock.advance(ms, flushAll),
    settle: () => clock.settle(flushAll),
    tabsLocked: () => Gate({ layout: { insets }, children: null }).props.pointerEvents === 'none',
    pointerEvents: () => Gate({ layout: { insets }, children: null }).props.pointerEvents,
    bubbleDrawn: () => !!(overlayInst && overlayInst.element),
    hasBackListener: () => typeof backHandler === 'function',
    pressBack: () => backHandler(),
    pressByLabel: (label) => {
      const node = findNode(overlayInst.element, (n) => n.props.accessibilityLabel === label);
      assert.ok(node, `no control labelled ${label} is drawn`);
      node.props.onPress();
    },
    hasControl: (label) => !!findNode(overlayInst && overlayInst.element, (n) => n.props.accessibilityLabel === label),
    keyboard: (name) => keyboard.listeners[name] && keyboard.listeners[name](),
    unmount: () => { rt.unmount(providerInst); if (overlayInst && overlayInst.mounted) rt.unmount(overlayInst); },
    unmountOverlay: () => { if (overlayInst) rt.unmount(overlayInst); },
    overlayMounted: () => !!(overlayInst && overlayInst.mounted),
  };
  return world;
}

let clock;
const RECT = { x: 0, y: 2, width: 360, height: 699, radius: 36 };

async function run() {
  clock = makeClock();
  const realWarn = console.warn;
  clock.install();
  console.warn = () => {};
  try {
    // AT-1 STALE REPORT
    {
      const w = makeWorld({ storedStep: 1, withOverlay: true });
      await w.advance(1000);
      w.ctx().registerTarget(1, RECT);
      await w.settle();
      assert.equal(w.pointerEvents(), 'none', 'AT-1 setup: step 1 drawn, tabs locked');
      w.keyboard('keyboardDidShow');
      await w.settle();
      w.ctx().nextStep();
      await w.settle();
      assert.equal(w.ctx().currentStep, 2, 'AT-1 setup: tour moved to step 2');
      assert.equal(w.bubbleDrawn(), false, 'AT-1 setup: keyboard hides step 2');
      w.ctx().reportPresentation(1); // stale: arrives for the step we just left
      await w.settle();
      assert.equal(w.ctx().isTourExitOnScreen, false, 'AT-1: a stale step-1 report must not count as an exit on screen at step 2');
      assert.equal(w.pointerEvents(), 'auto', 'AT-1 DEAD TABS: a stale report must not lock the tab bar');
      assert.equal(w.hasBackListener(), false, 'AT-1: a stale report must not hand Android Back to the tour');
      w.unmount();
    }

    // AT-2 OVERLAY UNMOUNT
    {
      const w = makeWorld({ storedStep: 1, withOverlay: true });
      await w.advance(500);
      w.ctx().registerTarget(1, RECT);
      await w.settle();
      assert.equal(w.pointerEvents(), 'none', 'AT-2 setup: drawn and locked');
      assert.equal(w.hasBackListener(), true, 'AT-2 setup: Back owned');
      w.unmountOverlay();
      await w.advance(6000);
      assert.equal(w.ctx().currentStep, 1, 'AT-2: the tour itself stays at step 1');
      assert.equal(w.pointerEvents(), 'auto', 'AT-2 DEAD TABS: an unmounted overlay must release the tab bar');
      assert.equal(w.hasBackListener(), false, 'AT-2: an unmounted overlay must release Android Back');
      w.unmount();
    }

    // AT-3 RAPID SKIP
    {
      const w = makeWorld({ storedStep: 1, withOverlay: true });
      await w.advance(500);
      w.ctx().registerTarget(1, RECT);
      await w.settle();
      assert.equal(w.mixpanel.viewed.length, 1, 'AT-3 setup: one Viewed');
      w.pressByLabel('modals:spotlight.skip_tour_label');
      w.ctx().reportPresentation(1); // late report racing the skip, before any re-render
      await w.advance(10000);
      assert.equal(w.ctx().currentStep, -1, 'AT-3: Skip wins');
      assert.equal(w.pointerEvents(), 'auto', 'AT-3: tabs live after Skip despite a late report');
      assert.equal(w.hasBackListener(), false, 'AT-3: Back released after Skip');
      assert.equal(w.mixpanel.held.length, 0, 'AT-3: no Held after Skip');
      assert.equal(w.mixpanel.viewed.length, 1, 'AT-3: no second Viewed after Skip');
      assert.deepEqual(w.sb.writes.map((x) => x.step), [-1], 'AT-3: exactly one write, the skip');
      w.unmount();
    }

    // AT-4 HELD CLOCK PER ENTRY
    {
      const w = makeWorld({ storedStep: 1, withOverlay: true });
      await w.advance(1000);
      w.ctx().registerTarget(1, RECT);
      await w.settle();
      await w.advance(1000);
      w.keyboard('keyboardDidShow');
      await w.settle();
      w.ctx().nextStep(); // step 2 entered at t=2 s, hidden by the keyboard
      await w.advance(4500);
      assert.equal(w.ctx().currentStep, 2);
      assert.equal(w.mixpanel.held.length, 0, 'AT-4: no Held 4.5 s into step 2 (and never for presented step 1)');
      assert.equal(w.pointerEvents(), 'auto', 'AT-4 DEAD TABS: undrawn step 2 leaves the tab bar live');
      await w.advance(1000);
      assert.equal(w.mixpanel.held.length, 1, 'AT-4: one Held about 5 s after step 2 entry');
      assert.equal(w.mixpanel.held[0].step_id, '2');
      assert.equal(w.mixpanel.held[0].reason, 'keyboard');
      assert.ok(w.mixpanel.held[0].held_ms >= 5000 && w.mixpanel.held[0].held_ms < 5600, `AT-4: held_ms measured from step 2 entry, got ${w.mixpanel.held[0].held_ms}`);
      await w.advance(20000);
      assert.equal(w.mixpanel.held.length, 1, 'AT-4: Held fires once per entry');
      w.keyboard('keyboardDidHide');
      await w.advance(2000);
      assert.equal(w.bubbleDrawn(), true, 'AT-4: step 2 draws once the keyboard closes');
      assert.equal(w.pointerEvents(), 'none', 'AT-4: and the lock follows it');
      assert.deepEqual(w.mixpanel.viewed.map((v) => v.step_id), ['1', '2'], 'AT-4: Viewed only for drawn steps, once each');
      w.unmount();
    }

    // AT-5 BACK REGRESSION
    {
      const w = makeWorld({ storedStep: 1, withOverlay: true });
      await w.advance(500);
      w.ctx().registerTarget(1, RECT);
      await w.settle();
      w.pressByLabel('modals:spotlight.next_step_label');
      await w.advance(2000);
      assert.equal(w.ctx().currentStep, 2);
      assert.equal(w.pointerEvents(), 'none', 'AT-5 setup: step 2 drawn');
      assert.equal(w.pressBack(), true, 'AT-5: Back consumed at step 2');
      await w.advance(2000);
      assert.equal(w.ctx().currentStep, 1, 'AT-5: Back returns to step 1');
      assert.equal(w.bubbleDrawn(), true, 'AT-5: step 1 redraws on its registered card');
      assert.equal(w.ctx().isTourExitOnScreen, true, 'AT-5: presentation tracks the redrawn step');
      assert.equal(w.pointerEvents(), 'none', 'AT-5: lock follows the redraw');
      w.unmount();
    }
  } finally {
    console.warn = realWarn;
    clock.restore();
  }
}

if (require.main === module) {
  run().then(() => {
    console.log('issue-4562 tester adversarial: PASS (AT-1 stale report, AT-2 overlay unmount, AT-3 rapid skip, AT-4 held clock per entry, AT-5 back regression)');
  }).catch((e) => {
    console.error('issue-4562 tester adversarial: FAIL');
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
