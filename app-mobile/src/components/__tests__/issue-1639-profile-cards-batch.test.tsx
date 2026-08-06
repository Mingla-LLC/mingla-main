// @ts-nocheck
// Issue #1639 [profile cards fix] — IMPLEMENTOR happy-path regression test.
//
// node-runnable, no jest (the app-mobile convention — self-runs via
// require.main === module). Wired as `npm run test:issue-1639` from app-mobile/.
//
// WHAT THIS PROVES
// This is NOT a source-grep test. It sucrase-transpiles and EXECUTES the real
// `src/components/PersonHolidayView.tsx`, the real `src/hooks/usePairedProfileCards.ts`,
// the real `src/hooks/useHolidayCategories.ts`, the real `src/hooks/usePairedCards.ts`,
// the real `src/hooks/queryKeys.ts` and the real `src/constants/holidays.ts` against a
// deterministic React hook runtime and a React-Query stand-in that models the ONE
// semantic under test: a query fetches when it is `enabled` and its key has no cache
// entry. Every request below is recorded AT THE SERVICE BOUNDARY — the recorder is the
// `fetchPairedProfileCards` stub — so the assertions are about the actual request body
// the app would put on the wire, not about the text of any file.
//
// THE BUG
// `usePairedProfileCards` keyed the BATCHED card query on (pairedUserId, mode) only.
// `sections` is a request-body input and was absent from the key. `batchedSectionRequests`
// is built from `customHolidays`, which the PARENT (`ViewFriendProfileScreen`) fetches
// asynchronously and which therefore lands AFTER PersonHolidayView has already mounted
// and fired with `customHolidays = []`. The section list grew; the key did not; React
// Query never refetched; `sections['custom_<id>']` stayed `undefined` for the life of the
// cache entry. The custom-holiday rows were not slow — they were never requested, and the
// row then rendered a horizontal strip containing nothing but a shuffle button, with no
// skeleton, no empty state, no error and no retry, permanently.
//
// WHY THE OBVIOUS FIX IS NOT THE FIX
// Putting `sections` in the key on its own fires the request TWICE on a cold mount (once
// with the empty custom list, once with the real one). Each request fans out server-side
// to ~17 sections, each running a geospatial RPC measured at 1.8 s warm / 3.9 s cold. A
// duplicate doubles the single most expensive operation in the product. So the key change
// is paired with an explicit readiness gate, and the committed section set is GROW-ONLY
// so that removing a section never re-issues the fan-out.
//
//   R-1  ONE REQUEST, LATE INPUTS INCLUDED. Nothing is requested while the async inputs
//        are still settling; when they settle, EXACTLY ONE batched request goes out, and
//        it carries every custom holiday and excludes every archived holiday. This is the
//        assertion the whole branch exists for, and both halves matter.
//   R-2  NO DUPLICATE FROM THE BILATERAL RACE. A stored bilateral override resolves from
//        AsyncStorage after mount and flips `mode`, which is also in the key. Still
//        exactly one request, and it goes out under the stored mode.
//   R-3  GROWTH RE-ISSUES. A custom day added after the first response really does
//        re-issue the request, and the new section is in it. (Without this, R-1 could be
//        satisfied by a gate that never re-evaluates.)
//   R-4  SHRINKING DOES NOT. Archiving a holiday or deleting a custom day must NOT
//        re-issue a 17-section fan-out — we already hold a superset of what is rendered.
//   R-5  THE EMPTY STATE IS HONEST. A section that is genuinely absent from the response
//        renders an explicit state with a retry, never a bare shuffle button; while a
//        batched refetch is in flight it renders the skeleton; a section that came back
//        with cards is untouched.
//   R-6  THE AI CATEGORY CALLS ARE BEHIND THE EXPAND GATE. A collapsed section performs
//        no AsyncStorage read and no `generate-holiday-categories` call; an expanded one
//        performs exactly one of each; and a shuffle tapped while that load is in flight
//        AWAITS it rather than silently shuffling against the defaults.
//   R-7  THE SHUFFLE CACHE WRITE STILL LANDS. The key grew a fifth element, so the
//        shuffle splice must match by prefix or it becomes the dead write ORCH-0986 removed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transform } = require('sucrase');

// ── Repo-root resolution (run from app-mobile/ or repo root) ──────────────────
function appMobileRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'src/components/PersonHolidayView.tsx'))) return cwd;
  const nested = path.join(cwd, 'app-mobile');
  if (fs.existsSync(path.join(nested, 'src/components/PersonHolidayView.tsx'))) return nested;
  throw new Error('cannot locate app-mobile root from ' + cwd);
}
const ROOT = appMobileRoot();
const P = {
  view: path.join(ROOT, 'src/components/PersonHolidayView.tsx'),
  profileCards: path.join(ROOT, 'src/hooks/usePairedProfileCards.ts'),
  pairedCards: path.join(ROOT, 'src/hooks/usePairedCards.ts'),
  categories: path.join(ROOT, 'src/hooks/useHolidayCategories.ts'),
  queryKeys: path.join(ROOT, 'src/hooks/queryKeys.ts'),
  holidays: path.join(ROOT, 'src/constants/holidays.ts'),
};

const PAIRED_USER_ID = '9d3ac0f1-6c1e-4a55-9e1b-3f6f2b1c77aa';
const VIEWER_ID = '45316d80-cc00-49c9-9d69-882338dc016c';
const PAIRING_ID = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';

// ── Minimal module loader: transpile the REAL source, inject stubs ────────────
function loadModule(absPath, stubs) {
  const code = transform(fs.readFileSync(absPath, 'utf8'), {
    transforms: ['typescript', 'jsx', 'imports'],
    filePath: absPath,
  }).code;
  const mod = { exports: {} };
  const req = (spec) => {
    if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
    throw new Error(`issue-1639 harness: unstubbed require(${JSON.stringify(spec)}) from ${absPath}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    mod.exports, req, mod, absPath, path.dirname(absPath),
  );
  return mod.exports;
}

// ── Deterministic React hook runtime ─────────────────────────────────────────
// Enough of React to execute ONE function component per instance with real hook
// semantics. Unlike an inline-calling harness, `createElement` NEVER invokes a child
// component — it returns a descriptor. That keeps each component's hook slots its own,
// which matters here because PersonHolidayView's auto-expand effect changes the child
// TREE SHAPE after the first commit. Children are mounted explicitly via `mountChild`,
// each as its own instance, which is also the only honest way to assert on CardRow.
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
    createElement(type, props, ...children) {
      const p = Object.assign({}, props);
      if (children.length) p.children = children.length === 1 ? children[0] : children;
      return { type, props: p };
    },
    Fragment: 'Fragment',
    useState(initial) {
      const inst = cur;
      const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      const setter = (next) => {
        const prev = s.value;
        const val = typeof next === 'function' ? next(prev) : next;
        if (Object.is(val, prev)) return;
        s.value = val;
        inst.dirty = true;
        if (inst.onDirty) inst.onDirty();
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
      if (guard > 60) throw new Error('issue-1639 harness: render loop did not settle');
      guard += 1;
      inst.dirty = false;
      renderOnce(inst);
    }
  }

  function mount(Component, props) {
    const inst = {
      Component, props, hooks: [], queue: [], dirty: false, mounted: true, renders: 0, element: null,
    };
    flush(inst);
    return inst;
  }

  // Re-render with NEW props — this is how the parent handing down freshly-resolved
  // customHolidays / archivedHolidayIds / holidayInputsReady is modelled.
  function setProps(inst, patch) {
    inst.props = Object.assign({}, inst.props, patch);
    flush(inst);
  }

  function unmount(inst) {
    inst.mounted = false;
    for (const s of inst.hooks) {
      if (s && s.effect && typeof s.cleanup === 'function') { s.cleanup(); s.cleanup = null; }
    }
  }

  return { React, mount, setProps, unmount, flush };
}

// ── Element-tree walker ──────────────────────────────────────────────────────
function walk(node, visit) {
  if (node === null || node === undefined || node === false || node === true) return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (typeof node !== 'object') return;
  visit(node);
  if (node.props && node.props.children !== undefined) walk(node.props.children, visit);
}
function findAll(tree, pred) {
  const hits = [];
  walk(tree, (n) => { if (pred(n)) hits.push(n); });
  return hits;
}
function findOne(tree, pred, label) {
  const hits = findAll(tree, pred);
  assert.equal(hits.length >= 1, true, `expected to find ${label} in the rendered tree`);
  return hits[0];
}
function textOf(node) {
  const c = node.props ? node.props.children : undefined;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => typeof x === 'string').join('') : '';
}

// ── Async settling ───────────────────────────────────────────────────────────
async function settle(insts) {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
  for (const inst of [].concat(insts)) if (inst && inst.mounted) makeReactFlush(inst);
}
let makeReactFlush = () => {};

// ── React Query stand-in ─────────────────────────────────────────────────────
// Models exactly one semantic: a query fetches when it is `enabled` and its key hash
// has neither a cache entry nor an in-flight fetch. That is the semantic the fix turns
// on, and it is the semantic a duplicate request would violate. `placeholderData` is
// honoured because the fix relies on it to avoid blanking already-painted rows.
function makeQueryRuntime(React) {
  const cache = new Map();
  const inflight = new Map();
  const observedKeys = [];

  function useQuery(opts) {
    const hash = JSON.stringify(opts.queryKey);
    const [, bump] = React.useState(0);
    const prevRef = React.useRef(undefined);
    const enabled = opts.enabled !== false;

    if (enabled) observedKeys.push(hash);

    if (enabled && !cache.has(hash) && !inflight.has(hash)) {
      const p = Promise.resolve()
        .then(() => opts.queryFn())
        .then((data) => { cache.set(hash, { data, error: null }); })
        .catch((error) => { cache.set(hash, { data: undefined, error }); })
        .then(() => { inflight.delete(hash); bump((n) => n + 1); });
      inflight.set(hash, p);
    }

    const entry = cache.get(hash);
    const data = entry ? entry.data : undefined;
    let effective = data;
    if (data === undefined && typeof opts.placeholderData === 'function') {
      effective = opts.placeholderData(prevRef.current);
    }
    if (data !== undefined) prevRef.current = data;
    const isPlaceholder = data === undefined && effective !== undefined;

    return {
      data: effective,
      isLoading: enabled && data === undefined && !isPlaceholder,
      isFetching: inflight.has(hash),
      isError: !!(entry && entry.error),
      error: entry ? entry.error : null,
      refetch: () => { cache.delete(hash); bump((n) => n + 1); },
    };
  }

  // setQueriesData with PREFIX matching (React Query v5 `exact` defaults to false).
  const queryClient = {
    setQueriesData(filters, updater) {
      const prefix = JSON.stringify(filters.queryKey).slice(0, -1);
      let hits = 0;
      for (const [hash, entry] of cache.entries()) {
        if (hash === JSON.stringify(filters.queryKey) || hash.startsWith(prefix + ',')) {
          cache.set(hash, { data: updater(entry.data), error: entry.error });
          hits += 1;
        }
      }
      return hits;
    },
    setQueryData(key, updater) {
      const hash = JSON.stringify(key);
      const entry = cache.get(hash);
      if (!entry) return 0;
      cache.set(hash, { data: updater(entry.data), error: entry.error });
      return 1;
    },
  };

  return { useQuery, queryClient, cache, observedKeys };
}

// ── AsyncStorage stand-in with a real (async) resolution boundary ─────────────
function makeAsyncStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  const reads = [];
  const writes = [];
  return {
    api: {
      __esModule: true,
      default: {
        getItem: async (k) => { reads.push(k); return store.has(k) ? store.get(k) : null; },
        setItem: async (k, v) => { writes.push(k); store.set(k, v); },
        removeItem: async (k) => { store.delete(k); },
      },
    },
    reads,
    writes,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const CUSTOM_1 = { id: 'aaaa1111-1111-4111-8111-111111111111', name: 'The day we met', month: 6, day: 14, year: 2021 };
const CUSTOM_2 = { id: 'bbbb2222-2222-4222-8222-222222222222', name: 'Lagos trip', month: 11, day: 2, year: 2023 };
const CUSTOM_3 = { id: 'cccc3333-3333-4333-8333-333333333333', name: 'First gig', month: 3, day: 9, year: 2024 };

function cardsFor(key) {
  return [{
    id: `${key}-card-1`, title: `${key} pick`, category: 'upscale_fine_dining',
    imageUrl: 'https://example.test/a.jpg', rating: 4.6, priceRange: '$$',
    cardType: 'single', experienceType: null, stops: 0,
  }];
}

// ── Harness: mount the REAL PersonHolidayView ────────────────────────────────
function makeHarness(options) {
  const opts = options || {};
  const rt = makeReact();
  makeReactFlush = rt.flush;
  const qr = makeQueryRuntime(rt.React);
  const storage = makeAsyncStorage(opts.storage);

  // Every batched request is recorded HERE — at the service boundary — so the
  // assertions are about the request body that would go on the wire.
  const requests = [];
  const personHeroCardsService = {
    __esModule: true,
    fetchPairedProfileCards: async (body) => {
      requests.push({
        pairedUserId: body.pairedUserId,
        mode: body.mode,
        holidayKeys: body.sections.map((s) => s.holidayKey),
      });
      const sections = {};
      for (const s of body.sections) {
        if (opts.omitSectionKeys && opts.omitSectionKeys.includes(s.holidayKey)) continue;
        sections[s.holidayKey] = { cards: cardsFor(s.holidayKey), summary: undefined };
      }
      return { locationStatus: 'ok', sections };
    },
    fetchPersonHeroCards: async (body) => {
      shuffleRequests.push({
        holidayKey: body.holidayKey,
        categorySlugs: body.categorySlugs,
        mode: body.mode,
      });
      return { cards: cardsFor('shuffled') };
    },
  };
  const shuffleRequests = [];

  const categoryCalls = [];
  const holidayCategoryService = {
    __esModule: true,
    fetchHolidayCategories: async (name) => {
      categoryCalls.push(name);
      if (opts.categoriesFail) throw new Error('generate-holiday-categories unavailable');
      return [
        { label: 'Romantic', type: 'romantic' },
        // A slug that appears in NO preset, so "the shuffle used the AI categories"
        // is distinguishable from "the shuffle fell back to DEFAULT_PERSON_SECTIONS".
        { label: 'Nature', type: 'category', categorySlug: 'ai_only_marker_slug' },
        { label: 'Play', type: 'category', categorySlug: 'play' },
        { label: 'Drinks', type: 'category', categorySlug: 'drinks_and_music' },
        { label: 'Dining', type: 'category', categorySlug: 'upscale_fine_dining' },
        { label: 'Watch', type: 'category', categorySlug: 'movies' },
      ];
    },
    slotsToSections: (slots) => slots,
  };

  const holidayTypesStub = { __esModule: true };
  const queryKeysModule = loadModule(P.queryKeys, {});
  const holidaysModule = loadModule(P.holidays, { '../types/holidayTypes': holidayTypesStub });

  const reactQueryStub = {
    __esModule: true,
    useQuery: qr.useQuery,
    useQueryClient: () => qr.queryClient,
  };

  const pairedCardsModule = loadModule(P.pairedCards, {
    '@tanstack/react-query': reactQueryStub,
    react: rt.React,
    '../services/personHeroCardsService': personHeroCardsService,
    '../services/holidayCardsService': {},
    '../types/holidayTypes': holidayTypesStub,
    './queryKeys': queryKeysModule,
  });

  const profileCardsModule = loadModule(P.profileCards, {
    '@tanstack/react-query': reactQueryStub,
    '../services/personHeroCardsService': personHeroCardsService,
    './queryKeys': queryKeysModule,
    './usePairedCards': pairedCardsModule,
  });

  const categoriesModule = loadModule(P.categories, {
    react: rt.React,
    '@react-native-async-storage/async-storage': storage.api,
    '../services/holidayCategoryService': holidayCategoryService,
    '../constants/holidays': holidaysModule,
    '../types/holidayTypes': holidayTypesStub,
  });

  const marker = (name) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: name }); return f; };
  const ShuffleButtonStub = marker('ShuffleButtonStub');
  const CalendarButtonStub = marker('CalendarButtonStub');
  const IconStub = marker('IconStub');

  const RN = {
    __esModule: true,
    View: 'View', Text: 'Text', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity',
    Modal: 'Modal', Pressable: 'Pressable',
    Animated: { View: 'Animated.View', Value: function () { return { setValue() {} }; }, timing: () => ({ start() {} }) },
    Easing: { out: () => 0, ease: 0 },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove() {} }),
    },
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: (o) => o,
      absoluteFillObject: {},
      hairlineWidth: 1,
    },
  };

  const viewModule = loadModule(P.view, {
    react: rt.React,
    'react-native': RN,
    'expo-image': { __esModule: true, Image: 'ExpoImage' },
    'expo-linear-gradient': { __esModule: true, LinearGradient: 'LinearGradient' },
    'expo-haptics': { __esModule: true, impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 1, Medium: 2 } },
    '@react-native-async-storage/async-storage': storage.api,
    './ui/BaseBottomSheet': { __esModule: true, BaseBottomSheet: 'BaseBottomSheet' },
    './ui/Icon': { __esModule: true, Icon: IconStub },
    './ui/GlassBadge': { __esModule: true, GlassBadge: 'GlassBadge' },
    '../types/expandedCardTypes': {},
    './utils/holidayCardToExpandedCardData': { __esModule: true, holidayCardToExpandedCardData: (c) => ({ id: c.id }) },
    '../types/holidayTypes': holidayTypesStub,
    '../services/holidayCardsService': {},
    '../constants/holidays': holidaysModule,
    '../hooks/usePairedCards': pairedCardsModule,
    '../hooks/usePairedProfileCards': profileCardsModule,
    '../hooks/useHolidayCategories': categoriesModule,
    '../hooks/usePairedSaves': { __esModule: true, usePairedSaves: () => ({ data: { saves: [] }, isLoading: false, isError: false, isFetching: false, refetch: () => {} }) },
    '../hooks/useVisits': { __esModule: true, usePairedUserVisits: () => ({ data: [], isLoading: false }) },
    '../utils/categoryUtils': { __esModule: true, getCategoryIcon: () => 'ellipse-outline', getCategoryColor: () => '#000', getReadableCategoryName: (c) => c },
    '../utils/ordinalSuffix': { __esModule: true, ordinal: (n) => `${n}th` },
    '../utils/responsive': { __esModule: true, s: (n) => n, vs: (n) => n, ms: (n) => n, SCREEN_WIDTH: 390 },
    '../constants/designSystem': { __esModule: true, colors: { gray: { 50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563' } } },
    '../constants/priceTiers': {},
    './CalendarButton': { __esModule: true, default: CalendarButtonStub },
    './ShuffleButton': { __esModule: true, default: ShuffleButtonStub },
    './PersonTabBar': { __esModule: true, default: marker('PersonTabBarStub') },
    './BilateralToggle': { __esModule: true, default: marker('BilateralToggleStub') },
    './VisitBadge': { __esModule: true, default: marker('VisitBadgeStub') },
    './profile/PairedProfileSection': { __esModule: true, default: marker('PairedProfileSectionStub') },
    './PairedSavesListScreen': { __esModule: true, default: marker('PairedSavesListScreenStub') },
    './pairedSaves/PairedSavesListPresentation': {
      __esModule: true,
      PairedSavesListHeader: marker('PairedSavesListHeader'),
      PairedSavesSkeletonGrid: marker('PairedSavesSkeletonGrid'),
      PairedSavesEmptyState: marker('PairedSavesEmptyState'),
      PairedSavesErrorState: marker('PairedSavesErrorState'),
      pairedSavesGridStyles: { columnWrapper: {}, gridContent: {} },
      renderPairedSaveItem: () => null,
      PAIRED_SAVES_NUM_COLUMNS: 2,
    },
    'react-i18next': { __esModule: true, useTranslation: () => ({ t: (k) => k }) },
    '../i18n': { __esModule: true, default: { t: (k) => k } },
  });

  return {
    rt,
    qr,
    storage,
    requests,
    categoryCalls,
    shuffleRequests,
    queryKeysModule,
    holidaysModule,
    pairedCardsModule,
    PersonHolidayView: viewModule.default,
    ShuffleButtonStub,
    IconStub,
  };
}

function baseProps(overrides) {
  return Object.assign({
    pairedUserId: PAIRED_USER_ID,
    pairingId: PAIRING_ID,
    displayName: 'Amara Obi',
    birthday: '1994-09-21',
    gender: 'female',
    userId: VIEWER_ID,
    customHolidays: [],
    holidayInputsReady: false,
    archivedHolidayIds: [],
  }, overrides || {});
}

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? ' — ' + detail : ''}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ═════════════════════════════════════════════════════════════════════════════
async function run() {
  // ── R-1 ────────────────────────────────────────────────────────────────────
  // The exact live sequence: PersonHolidayView mounts while the parent's custom-day
  // fetch and archived-day AsyncStorage read are still in flight, then both land.
  {
    const h = makeHarness();
    const inst = h.rt.mount(h.PersonHolidayView, baseProps());
    await settle(inst);

    ok(
      'R-1a nothing is requested while the async inputs are still settling',
      h.requests.length === 0,
      `fired ${h.requests.length} request(s) before the inputs settled: ${JSON.stringify(h.requests)}`,
    );

    // The custom days come back from Supabase — but the archived list has not settled,
    // so the gate is still shut. This is the render that USED to fire the request.
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1, CUSTOM_2] });
    await settle(inst);
    ok(
      'R-1b a custom-day arrival alone does not open the gate',
      h.requests.length === 0,
      `fired ${h.requests.length} request(s) with the archive list still unresolved`,
    );

    // Both settled. The parent flips holidayInputsReady.
    h.rt.setProps(inst, { holidayInputsReady: true, archivedHolidayIds: ['valentines_day'] });
    await settle(inst);

    ok(
      'R-1c EXACTLY ONE batched request fires on a cold mount',
      h.requests.length === 1,
      `fired ${h.requests.length}: ${JSON.stringify(h.requests.map((r) => r.holidayKeys.length))}`,
    );

    const sent = h.requests[0].holidayKeys;
    ok(
      'R-1d the one request carries BOTH custom holidays (the bug: it never asked for them)',
      sent.includes(`custom_${CUSTOM_1.id}`) && sent.includes(`custom_${CUSTOM_2.id}`),
      `sent ${JSON.stringify(sent)}`,
    );
    ok(
      'R-1e the one request carries the birthday section',
      sent.includes('birthday'),
      `sent ${JSON.stringify(sent)}`,
    );
    ok(
      'R-1f the one request does NOT pay for a holiday the user archived',
      !sent.includes('valentines_day'),
      `sent ${JSON.stringify(sent)}`,
    );
    ok(
      'R-1g every requested key is unique (no section is fanned out twice server-side)',
      new Set(sent).size === sent.length,
      `sent ${JSON.stringify(sent)}`,
    );

    // And the rows actually receive their cards.
    const customRow = findAll(inst.element, (n) => n.props && n.props.holidayKey === undefined
      && n.props.holiday && n.props.holiday.id === CUSTOM_1.id);
    ok(
      'R-1h the custom-holiday section is handed real card data (not undefined)',
      customRow.length === 1 && customRow[0].props.sectionData
        && Array.isArray(customRow[0].props.sectionData.cards)
        && customRow[0].props.sectionData.cards.length > 0,
      customRow.length ? JSON.stringify(customRow[0].props.sectionData) : 'custom section not rendered',
    );
  }

  // ── R-2 ────────────────────────────────────────────────────────────────────
  {
    const h = makeHarness({ storage: { [`bilateral_mode_${PAIRED_USER_ID}`]: 'bilateral' } });
    const inst = h.rt.mount(h.PersonHolidayView, baseProps());
    await settle(inst);
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1], holidayInputsReady: true });
    await settle(inst);

    ok(
      'R-2a a stored bilateral override still yields exactly ONE request',
      h.requests.length === 1,
      `fired ${h.requests.length} — the AsyncStorage mode read raced the query`,
    );
    ok(
      'R-2b that request goes out under the STORED mode, not the default',
      h.requests[0].mode === 'bilateral',
      `mode was ${h.requests[0].mode}`,
    );
  }

  // ── R-3 / R-4 ──────────────────────────────────────────────────────────────
  {
    const h = makeHarness();
    const inst = h.rt.mount(h.PersonHolidayView, baseProps());
    await settle(inst);
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1, CUSTOM_2], holidayInputsReady: true });
    await settle(inst);
    assert.equal(h.requests.length, 1, 'precondition: one request after settle');
    const firstCount = h.requests[0].holidayKeys.length;

    // R-3: the viewer adds a custom day. That section's cards genuinely do not exist.
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1, CUSTOM_2, CUSTOM_3] });
    await settle(inst);
    ok(
      'R-3a adding a custom day RE-ISSUES the batched request',
      h.requests.length === 2,
      `fired ${h.requests.length} total`,
    );
    ok(
      'R-3b the re-issued request contains the newly-added day',
      h.requests[1].holidayKeys.includes(`custom_${CUSTOM_3.id}`),
      JSON.stringify(h.requests[1].holidayKeys),
    );

    // R-4: archiving a holiday removes a row. We already hold its superset — re-issuing
    // a 17-section fan-out here would be a 1.8-3.9s x 17 tax for zero new data.
    h.rt.setProps(inst, { archivedHolidayIds: ['valentines_day', 'new_years_eve'] });
    await settle(inst);
    ok(
      'R-4a archiving a holiday does NOT re-issue the fan-out',
      h.requests.length === 2,
      `fired ${h.requests.length} total — an archive tap triggered a refetch`,
    );

    // R-4b: deleting a custom day is the same shape.
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1, CUSTOM_3] });
    await settle(inst);
    ok(
      'R-4b deleting a custom day does NOT re-issue the fan-out',
      h.requests.length === 2,
      `fired ${h.requests.length} total`,
    );
    ok(
      'R-4c the first request was a real fan-out, not a degenerate one-section call',
      firstCount >= 3,
      `first request carried ${firstCount} sections`,
    );
  }

  // ── R-5 ────────────────────────────────────────────────────────────────────
  // The response deliberately omits one requested section — the exact shape F-3
  // produced in the field (requested-but-absent), and the shape a server-side
  // per-section failure produces today.
  {
    const missingKey = `custom_${CUSTOM_1.id}`;
    const h = makeHarness({ omitSectionKeys: [missingKey] });
    const inst = h.rt.mount(h.PersonHolidayView, baseProps());
    await settle(inst);
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1], holidayInputsReady: true });
    await settle(inst);

    const customNode = findOne(
      inst.element,
      (n) => n.props && n.props.holiday && n.props.holiday.id === CUSTOM_1.id,
      'the custom-holiday section',
    );
    ok(
      'R-5a a section omitted by the server really does arrive as undefined',
      customNode.props.sectionData === undefined,
      'fixture did not reproduce the missing-section shape',
    );

    // Mount the section EXPANDED — exactly the state a chevron tap produces.
    const section = h.rt.mount(customNode.type, Object.assign({}, customNode.props, { isExpanded: true }));
    // Select by a prop ONLY CardRow carries. `holidayKey` alone also matches
    // CalendarButton, and mounting that stub renders null — which would make every
    // "no shuffle button" assertion below pass vacuously.
    const cardRow = findOne(
      section.element,
      (n) => n.props && n.props.holidayKey === missingKey && typeof n.props.refetchProfile === 'function',
      'the CardRow',
    );
    assert.equal(typeof cardRow.type, 'function', 'CardRow must be a component, not a host element');
    const row = h.rt.mount(cardRow.type, cardRow.props);
    assert.ok(row.element && row.element.props, 'CardRow rendered nothing — the selector picked the wrong node');

    const shuffles = findAll(row.element, (n) => n.type === h.ShuffleButtonStub);
    ok(
      'R-5b a genuinely-missing section NO LONGER renders a lone shuffle button',
      shuffles.length === 0,
      'the bare-shuffle-button strip is still reachable',
    );
    const titles = findAll(row.element, (n) => n.type === 'Text').map(textOf);
    ok(
      'R-5c it renders an honest, named state instead',
      titles.includes('social:holiday.couldnt_load'),
      `rendered text was ${JSON.stringify(titles)}`,
    );
    ok(
      'R-5d it offers a retry the viewer can actually press',
      findAll(row.element, (n) => n.props && n.props.accessibilityLabel === 'social:holiday.retry'
        && typeof n.props.onPress === 'function').length === 1,
      'no pressable retry in the honest-empty state',
    );

    // While a batched refetch is in flight, the same absent section is WAITING,
    // not empty — it must show the skeleton, not an error with a retry.
    const fetching = h.rt.mount(cardRow.type, Object.assign({}, cardRow.props, { isProfileFetching: true }));
    ok(
      'R-5e a missing section under an in-flight refetch shows the skeleton, not the error',
      findAll(fetching.element, (n) => n.type === 'Text').map(textOf).indexOf('social:holiday.couldnt_load') === -1
        && findAll(fetching.element, (n) => n.type === h.ShuffleButtonStub).length === 0,
      'in-flight state is not distinguished from a permanent miss',
    );

    // And a section that DID come back is untouched — the guard must not over-correct.
    const populated = h.rt.mount(cardRow.type, Object.assign({}, cardRow.props, {
      sectionData: { cards: cardsFor('birthday'), summary: undefined },
    }));
    ok(
      'R-5f a populated section still renders its cards AND its shuffle button',
      findAll(populated.element, (n) => n.type === h.ShuffleButtonStub).length === 1,
      'the fix removed the shuffle button from healthy rows',
    );

    // A server-reported empty section keeps its original copy.
    const reportedEmpty = h.rt.mount(cardRow.type, Object.assign({}, cardRow.props, {
      sectionData: { cards: [], summary: { emptyReason: 'no_candidates' } },
    }));
    ok(
      'R-5g a server-REPORTED empty section keeps the "No strong picks yet" copy',
      findAll(reportedEmpty.element, (n) => n.type === 'Text').map(textOf).includes('No strong picks yet'),
      'the reported-empty branch was lost',
    );
  }

  // ── R-6 ────────────────────────────────────────────────────────────────────
  {
    const h = makeHarness();
    const inst = h.rt.mount(h.PersonHolidayView, baseProps());
    await settle(inst);
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1], holidayInputsReady: true });
    await settle(inst);

    const catKeyRe = /^mingla_holiday_categories_v1_/;
    const sectionNode = findOne(
      inst.element,
      (n) => n.props && n.props.holiday && n.props.holiday.id === CUSTOM_1.id,
      'the custom-holiday section',
    );

    const beforeReads = h.storage.reads.filter((k) => catKeyRe.test(k)).length;
    const beforeCalls = h.categoryCalls.length;

    const collapsed = h.rt.mount(sectionNode.type, Object.assign({}, sectionNode.props, { isExpanded: false }));
    await settle(collapsed);
    ok(
      'R-6a a COLLAPSED section performs no AsyncStorage read and no OpenAI-backed call',
      h.storage.reads.filter((k) => catKeyRe.test(k)).length === beforeReads
        && h.categoryCalls.length === beforeCalls,
      `reads +${h.storage.reads.filter((k) => catKeyRe.test(k)).length - beforeReads}, calls +${h.categoryCalls.length - beforeCalls}`,
    );

    const expanded = h.rt.mount(sectionNode.type, Object.assign({}, sectionNode.props, { isExpanded: true }));
    await settle(expanded);
    ok(
      'R-6b an EXPANDED section does exactly one cache read and one category fetch',
      h.storage.reads.filter((k) => catKeyRe.test(k)).length === beforeReads + 1
        && h.categoryCalls.length === beforeCalls + 1,
      `reads +${h.storage.reads.filter((k) => catKeyRe.test(k)).length - beforeReads}, calls +${h.categoryCalls.length - beforeCalls}`,
    );

    // A shuffle tapped while that load is still in flight must AWAIT it, not fall back
    // to DEFAULT_PERSON_SECTIONS. The freshly-mounted instance has an in-flight load.
    const pending = h.rt.mount(sectionNode.type, Object.assign({}, sectionNode.props, { isExpanded: true }));
    const pendingRow = findOne(pending.element, (n) => n.props && n.props.resolveSections, 'the CardRow');
    const resolved = await pendingRow.props.resolveSections();
    ok(
      'R-6c a shuffle tapped during the category load resolves the REAL categories',
      Array.isArray(resolved) && resolved.length === 6 && resolved[0].label === 'Romantic',
      `resolveSections returned ${JSON.stringify(resolved)}`,
    );

    // R-6d — THE SHUFFLE BUTTON STILL WORKS. Deferring the category load to expand
    // means the first shuffle can now land while that load is in flight. Press the
    // button's real `onShuffle` on a FRESHLY-mounted expanded section, with no settle
    // in between, and the outgoing shuffle request must still carry the AI categories.
    // A regression here is silent: the request would succeed with DEFAULT_PERSON_SECTIONS
    // and simply return less personal picks.
    const fresh = h.rt.mount(sectionNode.type, Object.assign({}, sectionNode.props, { isExpanded: true }));
    const freshRow = findOne(
      fresh.element,
      (n) => n.props && typeof n.props.refetchProfile === 'function' && n.props.resolveSections,
      'the CardRow',
    );
    const mountedRow = h.rt.mount(freshRow.type, freshRow.props);
    const shuffleBtn = findOne(mountedRow.element, (n) => n.type === h.ShuffleButtonStub, 'the ShuffleButton');
    ok(
      'R-6d the shuffle button is rendered with a real async onShuffle (ShuffleButton spins for its whole duration)',
      typeof shuffleBtn.props.onShuffle === 'function',
      'the row no longer hands ShuffleButton a callback',
    );

    const before = h.shuffleRequests.length;
    await shuffleBtn.props.onShuffle();
    ok(
      'R-6e a shuffle pressed DURING the deferred category load still fires exactly one request',
      h.shuffleRequests.length === before + 1,
      `fired ${h.shuffleRequests.length - before}`,
    );
    ok(
      'R-6f ...and that request carries the AI categories, not the DEFAULT_PERSON_SECTIONS fallback',
      h.shuffleRequests[before].categorySlugs.includes('ai_only_marker_slug'),
      `shuffle sent ${JSON.stringify(h.shuffleRequests[before].categorySlugs)}`,
    );
  }

  // ── R-7 ────────────────────────────────────────────────────────────────────
  // The read key gained a fifth element. An exact-key write to the 4-element prefix
  // would be the dead write ORCH-0986 removed; the splice must match by prefix.
  {
    const h = makeHarness();
    const inst = h.rt.mount(h.PersonHolidayView, baseProps());
    await settle(inst);
    h.rt.setProps(inst, { customHolidays: [CUSTOM_1], holidayInputsReady: true });
    await settle(inst);

    const readKeys = [...h.qr.cache.keys()].map((k) => JSON.parse(k))
      .filter((k) => k[0] === 'personCards' && k[1] === 'pairedProfile');
    ok(
      'R-7a the batched read key carries the section set',
      readKeys.length === 1 && readKeys[0].length === 5 && typeof readKeys[0][4] === 'string'
        && readKeys[0][4].includes(`custom_${CUSTOM_1.id}`),
      JSON.stringify(readKeys),
    );

    const before = h.qr.cache.get(JSON.stringify(readKeys[0])).data.sections.birthday.cards[0].id;
    // `useShufflePairedCards` is a hook (useCallback + useQueryClient), so it has to be
    // obtained from inside a render like the real CardRow does.
    let shuffle = null;
    h.rt.mount(function ShuffleProbe() { shuffle = h.pairedCardsModule.useShufflePairedCards(); return null; }, {});
    await shuffle(PAIRED_USER_ID, 'birthday', [], 'default');
    const after = h.qr.cache.get(JSON.stringify(readKeys[0])).data.sections.birthday.cards[0].id;
    ok(
      'R-7b the shuffle splice still lands on the key the row actually reads',
      before !== after && after === 'shuffled-card-1',
      `birthday card id went ${before} -> ${after}`,
    );
  }

  console.log(`\nissue-1639 profile-cards batched-request regression: PASS (${passed} checks)`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { run };
