// @ts-nocheck
// MINGLA-INVARIANT: I-EXPLORER-NAV-LOCK-NEEDS-EXIT | issue #4562 | The Explorer bottom tabs are non-interactive only while the coach overlay has drawn a bubble with a way out for the current step; every other state, including an unknown cause, leaves them live.
//
// Issue #4562 [first-run tour lock] - IMPLEMENTOR regression test.
//
// node-runnable, no jest (the app-mobile convention for the coach-mark suites; self-runs via
// require.main === module). It sucrase-transpiles and EXECUTES the REAL
// `CoachMarkContext.tsx` provider, the REAL `SpotlightOverlay.tsx`, and the REAL
// `CoachMarkNavigationGate` function sliced out of `app/index.tsx`, against a deterministic
// React hook runtime with fake timers. react-native, svg, safe-area, i18n, supabase and
// Mixpanel are stubbed. Nothing here greps for text: every assertion is on what the three
// real pieces do together.
//
// THE BUG. The bottom tabs locked whenever the tour was due (`isCoachLoading ||
// isCoachPending || isCoachActive`), but the only exit (Skip) lives inside a bubble that is
// drawn on a separate condition. Whenever the two disagreed the person had dead tabs, no
// bubble, and no way out. Two triggers were proven:
//   trigger 1  no card on Home: step 1 draws nothing until the deck has a card.
//   trigger 2  a card on screen whose measured rect was rejected as "the whole screen" (an
//              Android 14 phone with a tall cutout; the whole-screen rejection is deleted).
//
//   T-1  TRIGGER 1 (fails on revert): step 1, no deck target, 10 s -> the tab bar is live,
//        exactly one `Coach Mark Held` (reason no_target), no `Coach Mark Viewed`, no write.
//   T-2  TRIGGER 2 (the clamp ships): the former whole-screen rect {0,2,360,676} on a
//        360x712 window, and the recorded Android 14 deck card {0,2,360,699} on a 728 dp
//        window, now get the bubble and the lock. A rect with no size is still refused: tabs
//        live, `Coach Mark Held` reason rect_rejected with every size field.
//   T-3  UNKNOWN TRIGGER: with no overlay mounted, stored -2, 0 and 1..12 always leave the
//        tab bar live (the lock reads only what the overlay reports; unknown fails open).
//   T-4  ADVERSARIAL: a plausible rect arriving at 3 s -> bubble, tabs locked, ONE Viewed
//        (waited_ms about 3000), no Held; the keyboard hiding and re-showing the bubble does
//        not repeat Viewed; Back while nothing is drawn is not intercepted, Back with step
//        1 drawn is consumed with no write; Skip frees the tabs; Got it walks to step 2.

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
    throw new Error(`issue-4562 harness: unstubbed require(${JSON.stringify(spec)}) from ${absPath}`);
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
      if (guard > 60) throw new Error('issue-4562 harness: render loop did not settle');
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
    // #3969: the step is read through the own-profile read; same stub chain.
    '../services/profileAccessService': { __esModule: true, readMyProfile: () => sb.supabase.from('profiles') },
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
    throw new Error('issue-4562 harness: world did not settle');
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
    unmount: () => { rt.unmount(providerInst); if (overlayInst) rt.unmount(overlayInst); },
  };
  return world;
}

let clock;

async function run() {
  clock = makeClock();
  const warnings = [];
  const realWarn = console.warn;
  clock.install();
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    // ── T-1 TRIGGER 1: no card on Home ──────────────────────────────────────
    {
      const w = makeWorld({ storedStep: 1, withOverlay: true });
      await w.advance(10000);
      assert.equal(w.ctx().currentStep, 1, 'T-1: the stored step stays 1');
      assert.equal(w.bubbleDrawn(), false, 'T-1: with no deck target nothing is drawn');
      assert.equal(w.pointerEvents(), 'auto', 'T-1 DEAD TABS: step 1 with no bubble drawn must leave the tab bar live');
      assert.equal(w.mixpanel.held.length, 1, 'T-1: exactly one Coach Mark Held for the entry');
      assert.equal(w.mixpanel.held[0].reason, 'no_target', 'T-1: reason no_target separates trigger 1');
      assert.equal(w.mixpanel.held[0].step_id, '1');
      assert.ok(w.mixpanel.held[0].held_ms >= 5000 && w.mixpanel.held[0].held_ms < 5600, `T-1: held_ms about 5000, got ${w.mixpanel.held[0].held_ms}`);
      assert.equal(w.mixpanel.viewed.length, 0, 'T-1: no Coach Mark Viewed for a bubble that never rendered');
      assert.deepEqual(w.sb.writes, [], 'T-1: a held tour writes nothing');
      assert.equal(w.hasBackListener(), false, 'T-1: nothing drawn, so the tour does not own Android Back');
      // A card shows up later: the bubble appears, then the tabs lock.
      w.ctx().registerTarget(1, { x: 0, y: 2, width: 360, height: 600, radius: 36 });
      await w.settle();
      assert.equal(w.bubbleDrawn(), true, 'T-1: a card arriving later brings the bubble');
      assert.equal(w.pointerEvents(), 'none', 'T-1: tabs lock from the moment the bubble is drawn');
      assert.equal(w.mixpanel.viewed.length, 1, 'T-1: Viewed fires when the bubble draws');
      w.unmount();
    }

    // ── T-2 TRIGGER 2: a rect the old rule rejected now gets the bubble and the lock ──
    for (const [label, rect, win] of [
      ['former whole-screen rect', { x: 0, y: 2, width: 360, height: 676, radius: 36 }, { width: 360, height: 712 }],
      ['recorded Android 14 deck card', { x: 0, y: 2, width: 360, height: 699, radius: 36 }, { width: 360, height: 728 }],
    ]) {
      const w = makeWorld({ storedStep: 1, withOverlay: true, windowSize: win });
      await w.advance(1000);
      w.ctx().registerTarget(1, rect);
      await w.advance(10000);
      assert.equal(w.bubbleDrawn(), true, `T-2 (${label}): the real card gets the bubble`);
      assert.equal(w.pointerEvents(), 'none', `T-2 (${label}): the bubble is drawn, so the tabs lock`);
      assert.equal(w.mixpanel.held.length, 0, `T-2 (${label}): no Held for a drawn bubble`);
      assert.equal(w.mixpanel.viewed.length, 1, `T-2 (${label}): one Viewed`);
      assert.ok(w.hasControl('modals:spotlight.skip_tour_label'), `T-2 (${label}): Skip is on screen, the way out`);
      w.unmount();
    }
    {
      // A rect with no size is still refused: tabs live, Held rect_rejected with every field.
      const w = makeWorld({ storedStep: 1, withOverlay: true, windowSize: { width: 360, height: 712 } });
      await w.advance(500);
      w.ctx().registerTarget(1, { x: 0, y: 2, width: 0, height: 0, radius: 36 });
      await w.advance(10000);
      assert.equal(w.bubbleDrawn(), false, 'T-2: a sizeless rect is refused');
      assert.equal(w.pointerEvents(), 'auto', 'T-2 DEAD TABS: a refused rect must leave the tab bar live');
      assert.equal(w.mixpanel.held.length, 1, 'T-2: one Held');
      const held = w.mixpanel.held[0];
      assert.equal(held.reason, 'rect_rejected');
      assert.deepEqual(
        [held.rect_x, held.rect_y, held.rect_w, held.rect_h], [0, 2, 0, 0], 'T-2: rect fields are reported');
      assert.deepEqual(
        [held.window_w, held.window_h, held.screen_w, held.screen_h, held.root_w, held.root_h, held.inset_top, held.inset_bottom],
        [360, 712, 360, 800, 360, 800, 24, 16], 'T-2: window, screen, root and inset fields are reported');
      w.unmount();
    }

    // ── T-3 UNKNOWN TRIGGER: no overlay mounted, every stored value ─────────
    {
      const w = makeWorld({ storedStep: 5, withOverlay: false });
      assert.equal(w.ctx().currentStep, -2, 'T-3: first render is the LOADING sentinel');
      assert.equal(w.pointerEvents(), 'auto', 'T-3 DEAD TABS: a step read in flight must not lock the tab bar');
      w.unmount();
    }
    for (const stored of [0, ...Array.from({ length: 12 }, (_, i) => i + 1)]) {
      const w = makeWorld({ storedStep: stored, withOverlay: false });
      await w.advance(4000);
      assert.equal(
        w.pointerEvents(), 'auto',
        `T-3 DEAD TABS: stored=${stored} (now step ${w.ctx().currentStep}) with nothing drawn must leave the tab bar live`,
      );
      w.unmount();
    }

    // ── T-4 ADVERSARIAL ─────────────────────────────────────────────────────
    {
      const w = makeWorld({ storedStep: 1, withOverlay: true });
      await w.advance(3000);
      assert.equal(w.pointerEvents(), 'auto', 'T-4: still nothing drawn at 3 s');
      w.ctx().registerTarget(1, { x: 0, y: 2, width: 360, height: 600, radius: 36 });
      await w.settle();
      assert.equal(w.bubbleDrawn(), true, 'T-4: the plausible rect at 3 s draws the bubble');
      assert.equal(w.pointerEvents(), 'none', 'T-4: gate is none once the bubble is drawn');
      assert.equal(w.mixpanel.viewed.length, 1, 'T-4: one Viewed');
      assert.equal(w.mixpanel.viewed[0].step_id, '1');
      const waited = w.mixpanel.viewed[0].waited_ms;
      assert.ok(waited >= 2900 && waited <= 3200, `T-4: waited_ms about 3000, got ${waited}`);
      assert.deepEqual(w.mixpanel.timed, ['Coach Tour Completed'], 'T-4: the tour timer starts with the first drawn bubble');
      await w.advance(12000);
      assert.equal(w.mixpanel.held.length, 0, 'T-4: a presented step never reports Held');
      assert.equal(w.mixpanel.viewed.length, 1, 'T-4: Viewed fires once per step entry');

      // Android Back: drawn at step 1 -> consumed, no write, step unchanged.
      assert.equal(w.hasBackListener(), true, 'T-4: a drawn bubble owns Android Back');
      assert.equal(w.pressBack(), true, 'T-4: Back at step 1 is consumed');
      await w.settle();
      assert.equal(w.ctx().currentStep, 1, 'T-4: Back at step 1 does not move the tour');
      assert.deepEqual(w.sb.writes, [], 'T-4: Back at step 1 writes nothing');

      // Keyboard hides the bubble: tabs live, Back released; it returns without a second Viewed.
      w.keyboard('keyboardDidShow');
      await w.settle();
      assert.equal(w.bubbleDrawn(), false, 'T-4: the keyboard hides the bubble');
      assert.equal(w.pointerEvents(), 'auto', 'T-4: keyboard up, nothing drawn, tabs live');
      assert.equal(w.hasBackListener(), false, 'T-4: Back is not intercepted while nothing is drawn');
      w.keyboard('keyboardDidHide');
      await w.advance(10000);
      assert.equal(w.bubbleDrawn(), true, 'T-4: the bubble returns');
      assert.equal(w.pointerEvents(), 'none');
      assert.equal(w.mixpanel.viewed.length, 1, 'T-4: the bubble returning does not repeat Viewed');
      assert.equal(w.mixpanel.held.length, 0, 'T-4: a step that was presented never reports Held later');

      // Got it walks to step 2 and the lock follows its bubble.
      w.pressByLabel('modals:spotlight.next_step_label');
      await w.advance(2000);
      assert.equal(w.ctx().currentStep, 2, 'T-4: Got it advances to step 2');
      assert.equal(w.bubbleDrawn(), true, 'T-4: step 2 draws its bubble (centred when its target is missing)');
      assert.equal(w.pointerEvents(), 'none', 'T-4: the step-2 bubble locks the tabs');
      assert.equal(w.mixpanel.viewed.length, 2, 'T-4: step 2 fires its own Viewed');
      assert.equal(w.mixpanel.viewed[1].step_id, '2');

      // Skip returns the tabs.
      w.pressByLabel('modals:spotlight.skip_tour_label');
      await w.advance(1000);
      assert.equal(w.ctx().currentStep, -1, 'T-4: Skip ends the tour');
      assert.equal(w.pointerEvents(), 'auto', 'T-4: Skip frees the tabs');
      w.unmount();
    }
  } finally {
    console.warn = realWarn;
    clock.restore();
  }
  return { warnings };
}

if (require.main === module) {
  run().then(() => {
    console.log('issue-4562 nav lock needs exit: PASS (T-1 trigger 1, T-2 trigger 2 + clamp deleted, T-3 unknown trigger, T-4 adversarial)');
  }).catch((e) => {
    console.error('issue-4562 nav lock needs exit: FAIL');
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
