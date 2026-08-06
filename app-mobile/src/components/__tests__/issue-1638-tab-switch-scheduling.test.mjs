// Issue #1638 [tab-switch scheduling] — "the switch happens and the screen catches up
// later slowly. Too slow." Seth, on his own device, for the third time.
//
// IMPLEMENTOR HAPPY-PATH REGRESSION SUITE.
//
// PR #1660 shipped three quick wins on this issue and explicitly did NOT fix the lag.
// This is the core defect, and it has two halves that must ship together:
//
//   TRACK B — the acknowledgement used to finish BEFORE the work started.
//     ORCH-0995 solved "the highlight lags the tap" by moving the highlight EARLIER
//     (optimistic `pendingPage`) and the mount LATER (`React.startTransition`). It never
//     made the mount cheaper. React keeps the PREVIOUS UI committed until the new render
//     finishes, and there was no `Suspense` boundary and no `isPending` consumer anywhere
//     in the app — so nothing rendered in the gap and the user kept staring at the screen
//     they had just left, with the pill already moved. Now a pending state paints the
//     DESTINATION'S OWN STRUCTURE on the tap frame, cleared by the destination's own
//     commit (never by a timer).
//
//   TRACK A — the destination was expensive to reach.
//     One shared app-wide a11y probe instead of 25 per-component ones; the production
//     `console.log` on the critical path is `__DEV__`-gated; the Likes header spotlight
//     moved to the UI thread; the last `I-TAB-PROPS-STABLE` breach is stabilized; 196
//     lines of dead render-storm-shaped code deleted.
//
// MEASURED ON A PHYSICAL SAMSUNG SM-A725F, cold-launched, 53 switches per block:
//   BEFORE   T4−T3 48ms p50 / 106ms p90   T6−T4 346 / 889   T8−T0 694 / 1576
//            and NOTHING in the content area changed until T8.
//   AFTER    the destination's structure is on screen at TS−T0, one frame region after
//            the tap, instead of at T8.
//
// SCHEDULING DECISION, FOR THE RECORD: `React.startTransition` STAYS. It costs 48ms p50,
// but the JS thread blocks for 256ms p50 during the commit regardless, so the transition
// buys no responsiveness — what it buys is ORDERING, and that ordering is the only reason
// an urgent update (the pending state) can commit and paint before the heavy mount.
// Removing it would put both in the same render pass and make the fix impossible, while
// re-introducing ORCH-0995's proven "highlight is hostage to the mount" defect.
//
// Convention: `node --test` over the real sources. app-mobile has no jest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..', '..'); // app-mobile/

const read = (rel) => fs.readFileSync(path.join(APP_ROOT, rel), 'utf8');

/**
 * Source with comments removed.
 *
 * EVERY absence assertion in this file runs against this, never against raw source.
 * Learned the hard way while writing it: four assertions here went red because the
 * IMPLEMENTATION's own explanatory comments quoted the very strings the gate forbids
 * ("this used to be `style={styles.tab}`", "the old `useNativeDriver: false` spring"). A
 * gate that a comment can turn red is a gate that a comment can also turn GREEN — write
 * `// no more ActivityIndicator here` and a naive presence check passes forever. Absence
 * gates must look at code.
 *
 * Line comments are only stripped when `//` opens the line, so `https://` inside a string
 * survives untouched.
 */
const readCode = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

const INDEX = 'app/index.tsx';
const HOST = 'src/components/navigation/TabSwitchHost.tsx';
const SCAFFOLD = 'src/components/navigation/TabSwitchScaffold.tsx';
const NAV = 'src/components/GlassBottomNav.tsx';
const LIKES = 'src/components/LikesPage.tsx';
const LOGGER = 'src/utils/logger.ts';
const APP_STATE = 'src/components/AppStateManager.tsx';
const A11Y = 'src/hooks/useA11yPreferences.ts';

// ───────────────────────────────────────────────────────────────────────────────
// TRACK B — the pending state
// ───────────────────────────────────────────────────────────────────────────────

test('S-1 [FAILS-ON-REVERT] the tab handler raises the pending state BEFORE it schedules the deferred mount', () => {
  const src = read(INDEX);

  const beginIdx = src.indexOf('tabSwitchHostRef.current?.beginSwitch(page)');
  assert.notEqual(
    beginIdx,
    -1,
    'S-1 onNavigate must call tabSwitchHostRef.current?.beginSwitch(page) — without it the ' +
      'transition has nothing to render in the gap, which IS defect #1638',
  );

  const transitionIdx = src.indexOf('React.startTransition(');
  assert.notEqual(transitionIdx, -1, 'S-1 the deferred mount must still be scheduled in a transition');

  assert.ok(
    beginIdx < transitionIdx,
    'S-1 beginSwitch(page) must run BEFORE React.startTransition(...). It is an URGENT ' +
      'update: it has to commit and PAINT while the transition-lane mount is still ' +
      'rendering. Scheduled after, it would be batched into the same work it is covering.',
  );
});

test('S-2 [FAILS-ON-REVERT] the ORCH-0995 deferred mount survives — re-affirmed, not reversed', () => {
  const src = readCode(INDEX);
  assert.match(
    src,
    /closeProfileOverlays\(\)\s*;[\s\S]*?React\.startTransition\(\s*\(\)\s*=>\s*\{[\s\S]*?setCurrentPage\(page\)\s*;[\s\S]*?\}\)/,
    'S-2 onNavigate must keep closeProfileOverlays() urgent and setCurrentPage(page) inside ' +
      'React.startTransition. This mirrors ORCH-0995 T-18 from the #1638 side: the two gates ' +
      'now bind the SAME contract from opposite directions, so neither can be quietly dropped.',
  );
  assert.ok(
    !/closeProfileOverlays\(\)\s*;\s*\n\s*setCurrentPage\(page\)\s*;/.test(src),
    'S-2 the un-deferred setCurrentPage(page) must not come back',
  );
});

test('S-3 [FAILS-ON-REVERT] the pending state is cleared by the destination COMMIT, not by a timer', () => {
  const src = read(HOST);

  // The clear lives inside a layout effect keyed on the committed page.
  assert.match(
    src,
    /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?setPendingPage\(null\)\s*;[\s\S]*?\},\s*\[currentPage[^\]]*\]\)/,
    'S-3 TabSwitchHost must clear the pending state in a useLayoutEffect keyed on ' +
      '[currentPage] — that is what makes it transition-bound and impossible to tune into a lie',
  );

  // Exactly one setTimeout, and it is the named failsafe ceiling — not the mechanism.
  const timeouts = src.match(/setTimeout\(/g) ?? [];
  assert.equal(
    timeouts.length,
    1,
    'S-3 TabSwitchHost may contain exactly ONE setTimeout: the PENDING_FAILSAFE_MS ceiling. ' +
      `Found ${timeouts.length}. A duration-driven dismissal is the masking umbrella #1635 rejects.`,
  );
  assert.match(
    src,
    /PENDING_FAILSAFE_MS/,
    'S-3 the single timer must be the named failsafe ceiling',
  );
});

test('S-4 the pending state renders the destination structure and NEVER a naked spinner', () => {
  const src = readCode(SCAFFOLD);
  assert.ok(
    !/ActivityIndicator/.test(src),
    'S-4 umbrella #1635 bans a naked spinner where real structure could be shown',
  );
  for (const page of ['home', 'discover', 'connections', 'likes', 'profile']) {
    assert.ok(
      new RegExp(`page === '${page}'`).test(src),
      `S-4 every reachable tab needs its own skeleton — '${page}' has none`,
    );
  }
  // The five BottomNavPage values must each map to a background, or the overlay would be
  // transparent and the outgoing screen would show through.
  assert.match(src, /const SCREEN_BG: Record<ScaffoldPage, string>/, 'S-4 opaque per-page background required');
});

test('S-15 [FAILS-ON-REVERT] the pending overlay sits between the page and the nav, by document order', () => {
  // Settled on the SM-A725F, twice, in opposite directions:
  //   - `elevation: 24` from inside the tab subtree beat the outgoing page AND the bottom
  //     nav — the nav vanished for the whole pending window.
  //   - `zIndex: 40` fixed the nav but lost to the page headers, which carry `zIndex: 50`
  //     of their own; the outgoing "Friends" title sat on top of the incoming skeleton.
  // On Android neither elevation nor a nested zIndex stays inside its own subtree, so the
  // only value that satisfies both is one that TIES and lets document order decide.
  const scaffold = readCode(SCAFFOLD);
  assert.match(scaffold, /zIndex: 50,/, 'S-15 the overlay must tie with the page header and the nav at zIndex 50');
  assert.match(
    scaffold,
    /elevation: 0,/,
    'S-15 elevation must stay pinned at 0 — any elevation escapes the subtree on Android and buries the bottom nav',
  );

  // Placement: the host must wrap mainContent, NOT sit inside the tab subtree, or the
  // document-order tiebreak above resolves against the page instead of for it.
  const idx = readCode(INDEX);
  const hostIdx = idx.indexOf('<TabSwitchHost');
  const mainIdx = idx.indexOf('styles.mainContent');
  const navIdx = idx.indexOf('<CoachMarkNavigationGate');
  assert.ok(hostIdx !== -1 && mainIdx !== -1 && navIdx !== -1, 'S-15 shell landmarks missing');
  assert.ok(
    hostIdx < mainIdx,
    'S-15 TabSwitchHost must OPEN before mainContent so the overlay is mainContent\'s sibling, not its descendant',
  );
  assert.ok(
    idx.indexOf('</TabSwitchHost>') < navIdx,
    'S-15 TabSwitchHost must CLOSE before the bottom nav so the nav stays painted above the overlay',
  );
});

test('S-5 [FAILS-ON-REVERT] the shell wraps the active-tab subtree in TabSwitchHost', () => {
  const src = read(INDEX);
  assert.match(
    src,
    /<TabSwitchHost[\s\S]{0,200}?ref=\{tabSwitchHostRef\}[\s\S]{0,200}?currentPage=\{currentPage\}/,
    'S-5 the switch(currentPage) IIFE must render inside <TabSwitchHost ref currentPage> — ' +
      'the wrapper owns both the pending state and the T4/T6/T8 measurement clock',
  );
  assert.match(src, /<\/TabSwitchHost>/, 'S-5 the host must actually wrap the tab subtree');
});

test('S-6 [FAILS-ON-REVERT] the nav tab gives press-IN feedback', () => {
  const src = readCode(NAV);
  assert.match(
    src,
    /style=\{\(\{\s*pressed\s*\}\)\s*=>/,
    'S-6 the tab Pressable must use the function-form style with a `pressed` branch. It was ' +
      '`style={styles.tab}` — a static object — so the FIRST feedback of any kind was at ' +
      'press-OUT, which is why an optimistic highlight had to be invented to fake an answer.',
  );
  assert.ok(
    !/style=\{styles\.tab\}/.test(src),
    'S-6 the static press-state-less style must be gone',
  );
  assert.match(src, /tabPressed:\s*\{/, 'S-6 a pressed style must exist');
});

// ───────────────────────────────────────────────────────────────────────────────
// TRACK A — make the destination cheaper to reach
// ───────────────────────────────────────────────────────────────────────────────

test('S-7 [FAILS-ON-REVERT] one shared a11y probe replaces the per-component ones on the switch path', () => {
  const shared = read(A11Y);
  assert.match(shared, /useSyncExternalStore/, 'S-7 the shared probe must be a real external store');
  assert.match(
    shared,
    /let\s+probeStarted\s*=\s*false/,
    'S-7 the native probe must run ONCE per app session',
  );

  const converted = [
    NAV,
    LIKES,
    'src/components/ConnectionsPage.tsx',
    'src/components/ProfilePage.tsx',
    'src/components/GlassTopBar.tsx',
    'src/components/ui/GlassCard.tsx',
    'src/components/ui/GlassIconButton.tsx',
    'src/components/ui/GlassBadge.tsx',
  ];
  for (const rel of converted) {
    const src = readCode(rel);
    assert.ok(
      !/AccessibilityInfo\.isReduce/.test(src),
      `S-7 ${rel} must not run its own AccessibilityInfo probe — GlassCard/GlassIconButton/` +
        'GlassBadge are PER-INSTANCE, so ProfilePage alone paid six of them on every single tap',
    );
    assert.match(
      src,
      /useA11yPreferences\(\)/,
      `S-7 ${rel} must read the shared probe`,
    );
  }
});

test('S-8 [FAILS-ON-REVERT] the production console.log is off the critical path', () => {
  const src = read(LOGGER);
  assert.match(
    src,
    /const logAndCrumb = \([\s\S]*?\) => \{\s*\n\s*if \(__DEV__\) \{[\s\S]*?console\.log\(/,
    'S-8 logAndCrumb must gate its console.log behind __DEV__. Two of these fired per tab ' +
      'switch in production (logger.action in the press handler, logger.nav post-commit), and ' +
      'babel.config.js carries no transform-remove-console.',
  );
  // Breadcrumbs must still be recorded — the gate is on the console call, not the crumb.
  assert.match(
    src,
    /\}\s*\n\s*breadcrumbs\.add\(category, message, data\);/,
    'S-8 breadcrumbs.add must stay OUTSIDE the __DEV__ guard — only the native round trip is removed',
  );
  // Errors keep logging.
  assert.match(src, /console\.error\(`\[ERROR\]/, 'S-8 logger.error must remain ungated');
});

test('S-9 [FAILS-ON-REVERT] handleUserIdentityUpdate is stable — the last I-TAB-PROPS-STABLE breach', () => {
  const src = read(APP_STATE);
  assert.match(
    src,
    /const handleUserIdentityUpdate = useCallback\(async \(updatedIdentity: any\) => \{/,
    'S-9 handleUserIdentityUpdate must be useCallback-wrapped. app/index.tsx passes it straight ' +
      'to <ProfilePage onUserIdentityUpdate>, so a bare arrow busted React.memo(ProfilePage) on ' +
      'every shell render.',
  );
});

test('S-10 [FAILS-ON-REVERT] the dead renderCurrentPage copy is gone', () => {
  const src = readCode(INDEX);
  assert.ok(
    !/const renderCurrentPage = \(\) =>/.test(src),
    'S-10 the 196-line unreferenced second copy of the tab switch must stay deleted — it still ' +
      'contained the exact inline-prop pattern ORCH-0679 Wave 2A/2.7 eliminated',
  );
});

test('S-11 [FAILS-ON-REVERT] the Likes header spotlight animates on the UI thread', () => {
  const src = readCode(LIKES);
  assert.ok(
    !/useNativeDriver:\s*false/.test(src),
    'S-11 no JS-thread layout spring in LikesPage. The header spotlight used ' +
      'Animated.spring on left/width with useNativeDriver:false, and its layoutTick dep made it ' +
      'fire ONE FRAME INTO THE NEW PAGE — exactly when the JS thread is busiest. Same migration ' +
      'ORCH-0995 already did for GlassBottomNav.',
  );
  assert.match(src, /useSharedValue\(0\)/, 'S-11 spotlight geometry must be Reanimated shared values');
  assert.match(src, /withSpring\(targetX, springConfig\)/, 'S-11 spring must run through Reanimated');
});

test('S-12 [FAILS-ON-REVERT] Reanimated worklet entry points are never import-aliased', () => {
  // Caught as a HARD CRASH on the Samsung during this very issue:
  //   "[Worklets] Tried to synchronously call a non-worklet function on the UI thread".
  // `react-native-worklets/plugin` decides what to auto-workletize by matching the CALLEE
  // NAME. `import { useAnimatedStyle as useReAnimatedStyle }` type-checks, bundles, and
  // then kills the app on the UI thread the first time the screen renders. No type system
  // and no lint rule in this repo catches it — this gate does.
  const WORKLET_ENTRIES = [
    'useAnimatedStyle',
    'useAnimatedProps',
    'useDerivedValue',
    'useAnimatedScrollHandler',
    'useAnimatedGestureHandler',
    'useAnimatedReaction',
    'runOnUI',
  ];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs
        .readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
      if (!/from ['"]react-native-reanimated['"]/.test(src)) continue;
      for (const name of WORKLET_ENTRIES) {
        if (new RegExp(`\\b${name}\\s+as\\s+\\w+`).test(src)) {
          offenders.push(`${path.relative(APP_ROOT, full)} aliases ${name}`);
        }
      }
    }
  };
  walk(path.join(APP_ROOT, 'src'));
  walk(path.join(APP_ROOT, 'app'));
  assert.deepEqual(
    offenders,
    [],
    'S-12 aliasing a Reanimated worklet entry point silently disables auto-workletization and ' +
      'hard-crashes the app on the UI thread:\n  ' + offenders.join('\n  '),
  );
});

test('S-14 [FAILS-ON-REVERT] I-ONLY-ACTIVE-TAB-MOUNTED is untouched by this work', () => {
  const src = readCode(INDEX);
  assert.match(
    src,
    /switch \(currentPage\) \{/,
    'S-14 Path B must still select exactly one mounted tab via switch(currentPage)',
  );
  assert.ok(
    !/styles\.(tabVisible|tabHidden)/.test(src),
    'S-14 #1638 must NOT have re-introduced the all-tabs-mounted keep-alive pattern. Selective ' +
      'keep-alive was on the table and was deliberately NOT taken: it re-exposes the ORCH-0679 ' +
      'render-storm surface and reactivates the dormant isTabVisible contract that DiscoverScreen ' +
      'and LikesPage still ignore.',
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// S-13 — behavioural model of the pending-state machine
//
// A faithful, minimal re-implementation of TabSwitchHost's semantics:
//   beginSwitch(page): no-op when page === currentPage; else pending = page
//   commit(page):      currentPage = page, then the [currentPage] layout effect clears
//                      pending UNCONDITIONALLY (the ORCH-0995 T-15 anti-desync contract)
// ───────────────────────────────────────────────────────────────────────────────

function createHost(initialPage) {
  let currentPage = initialPage;
  let pending = null;
  return {
    get pending() {
      return pending;
    },
    get currentPage() {
      return currentPage;
    },
    beginSwitch(page) {
      if (page === currentPage) return;
      pending = page;
    },
    commit(page) {
      currentPage = page;
      pending = null; // the layout effect, running inside the destination's own commit
    },
  };
}

test('S-13a the pending state is raised on the tap frame, before the page commits', () => {
  const host = createHost('home');
  host.beginSwitch('profile');
  assert.equal(host.pending, 'profile', 'S-13a the destination scaffold must be up immediately');
  assert.equal(host.currentPage, 'home', 'S-13a the page commit is still deferred — that is the point');
});

test('S-13b the destination commit clears the pending state in the same commit', () => {
  const host = createHost('home');
  host.beginSwitch('profile');
  host.commit('profile');
  assert.equal(host.pending, null, 'S-13b the scaffold must be gone the moment the real page lands');
  assert.equal(host.currentPage, 'profile');
});

test('S-13c a deep link that wins the race never leaves a scaffold describing the wrong page', () => {
  const host = createHost('home');
  host.beginSwitch('profile'); // user taps Profile
  host.commit('connections'); // ...but a push notification routes elsewhere
  assert.equal(
    host.pending,
    null,
    'S-13c clearing on ANY currentPage commit is what makes a wrong-page overlay impossible',
  );
});

test('S-13d re-asking for the page you are already on does nothing', () => {
  const host = createHost('likes');
  host.beginSwitch('likes');
  assert.equal(host.pending, null, 'S-13d no scaffold over a page that is already committed');
});

test('S-13e rapid double tap ends on the page tapped last, with no scaffold left behind', () => {
  const host = createHost('home');
  host.beginSwitch('connections');
  host.beginSwitch('likes'); // second tap before the first transition commits
  assert.equal(host.pending, 'likes', 'S-13e the scaffold follows the newest intent');
  host.commit('likes');
  assert.equal(host.pending, null);
  assert.equal(host.currentPage, 'likes');
});
