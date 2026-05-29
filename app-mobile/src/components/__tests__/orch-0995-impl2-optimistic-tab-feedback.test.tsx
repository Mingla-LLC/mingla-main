// @ts-nocheck
// ORCH-0995 IMPLEMENT-2 [instant tab-tap feedback — optimistic nav selection + deferred mount]
//
// Follow-on to the ORCH-0995 spotlight UI-thread fix (commit b91770195). After that fix the
// spotlight animated on the UI thread, but the highlight was still HOSTAGE to the destination
// screen's mount: tap → onNavigate → parent setCurrentPage → AppContent re-renders, the
// switch(currentPage) IIFE unmounts the old screen + mounts the new heavy screen SYNCHRONOUSLY
// on the JS thread → only THEN does GlassBottomNav receive the new currentPage prop and move
// the spotlight. So the tap feedback was blocked by the screen mount → "noticeable lag between
// tapping a tab and seeing the effect."
//
// THE FIX (two parts):
//   PART A — GlassBottomNav keeps a local optimistic `pendingPage`; `displayPage =
//            pendingPage ?? currentPage` drives the spotlight effect + active icon + active
//            label + accessibilityState.selected. onPress sets `setPendingPage(key)` BEFORE
//            `onNavigate(key)`. A `useEffect(..., [currentPage])` clears pendingPage whenever
//            the real currentPage commits (tapped page OR programmatic page) — guaranteeing
//            the optimistic state can never desync from the source of truth.
//   PART B — app/index.tsx onNavigate keeps closeProfileOverlays() URGENT and wraps
//            setCurrentPage(page) in React.startTransition(...) so the urgent optimistic nav
//            update + spotlight animation commit first and the heavy mount is de-prioritized.
//
// This file proves BOTH:
//   1. The optimistic state-machine SEMANTICS (behavioral simulation that mirrors the exact
//      code: press sets displayPage before currentPage changes; reconcile clears it; a
//      programmatic currentPage change to a DIFFERENT page is reflected — no desync).
//   2. The SOURCE actually wires it that way (static assertions that bind this test to the
//      real GlassBottomNav.tsx + app/index.tsx → these are the FAILS-ON-REVERT keys).
//
// Convention: standalone node:assert script (the repo's component-test convention — there is
// no jest/RTL in app-mobile). Mirrors orch-0995-bottom-nav-spotlight-ui-thread.test.tsx.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoFile(relPath) {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Behavioral model — a faithful, minimal re-implementation of the GlassBottomNav
// optimistic state machine. It mirrors the EXACT semantics of the component:
//   - displayPage = pendingPage ?? currentPage
//   - press(key): if key === displayPage → no-op; else setPendingPage(key)
//   - commitCurrentPage(page): set currentPage = page, then run the reconcile
//     effect (setPendingPage(null)) because the [currentPage] dep changed.
// This lets us assert the ordering guarantees the UI thread depends on, in pure JS.
// ---------------------------------------------------------------------------
function createNav(initialPage) {
  let currentPage = initialPage;
  let pendingPage = null;
  return {
    get displayPage() {
      return pendingPage ?? currentPage;
    },
    get currentPage() {
      return currentPage;
    },
    get pendingPage() {
      return pendingPage;
    },
    // Mirrors the Pressable onPress optimistic-set.
    press(key) {
      if (key === (pendingPage ?? currentPage)) return; // guard: re-tap is a no-op
      pendingPage = key; // setPendingPage(key) — instant, before onNavigate
    },
    // Mirrors the parent committing setCurrentPage(page) → currentPage prop change →
    // the reconcile useEffect(() => setPendingPage(null), [currentPage]) firing.
    commitCurrentPage(page) {
      currentPage = page;
      pendingPage = null; // reconcile effect clears the optimistic lead
    },
  };
}

function runOptimisticSemanticsTests() {
  // ---- T-08: pressing an inactive tab sets optimistic displayPage IMMEDIATELY, ----
  //            BEFORE the currentPage prop changes (the core of "instant feedback").
  {
    const nav = createNav('home');
    nav.press('discover');
    assert.equal(
      nav.displayPage,
      'discover',
      'T-08 pressing an inactive tab must set displayPage to the pressed key on the tap frame'
    );
    assert.equal(
      nav.currentPage,
      'home',
      'T-08 currentPage must NOT have changed yet (still the old page — mount is deferred)'
    );
    assert.equal(nav.pendingPage, 'discover', 'T-08 pendingPage holds the optimistic lead');
  }

  // ---- T-09: when currentPage later commits to the tapped page, the optimistic ----
  //            state CLEARS (displayPage stays correct, no double-source). ----
  {
    const nav = createNav('home');
    nav.press('discover'); // optimistic lead
    nav.commitCurrentPage('discover'); // parent's deferred setCurrentPage finally commits
    assert.equal(
      nav.pendingPage,
      null,
      'T-09 reconcile effect must clear pendingPage once currentPage catches up'
    );
    assert.equal(
      nav.displayPage,
      'discover',
      'T-09 displayPage must remain the tapped page after reconcile (now sourced from currentPage)'
    );
  }

  // ---- T-10: a programmatic currentPage change to a DIFFERENT page (deep link / ----
  //            push notification, NO tab tapped) is reflected by displayPage — no desync. ----
  {
    const nav = createNav('home');
    // No press(). A notification routes the app to 'connections' directly.
    nav.commitCurrentPage('connections');
    assert.equal(
      nav.pendingPage,
      null,
      'T-10 no optimistic lead when nothing was tapped'
    );
    assert.equal(
      nav.displayPage,
      'connections',
      'T-10 programmatic nav must be reflected by displayPage (highlight follows deep-link/notification)'
    );
  }

  // ---- T-11: optimistic lead can NEVER desync — if currentPage commits to a page ----
  //            DIFFERENT from the optimistic one (e.g. a notification fires mid-tap), ----
  //            the reconcile clears pending and displayPage follows the real source. ----
  {
    const nav = createNav('home');
    nav.press('discover'); // user optimistically heading to discover
    // ...but a push notification wins and routes to 'connections' instead.
    nav.commitCurrentPage('connections');
    assert.equal(nav.pendingPage, null, 'T-11 reconcile clears the stale optimistic lead');
    assert.equal(
      nav.displayPage,
      'connections',
      'T-11 displayPage must follow the authoritative currentPage, never strand on the stale optimistic page'
    );
  }

  // ---- T-12: re-tapping the already-displayed tab is a no-op (no spurious pending). ----
  {
    const nav = createNav('home');
    nav.press('home');
    assert.equal(nav.pendingPage, null, 'T-12 re-tapping the active tab must not set pendingPage');
    assert.equal(nav.displayPage, 'home', 'T-12 displayPage unchanged on re-tap');
  }
}

function runSourceWiringTests() {
  const nav = readSource('src/components/GlassBottomNav.tsx');
  const idx = readSource('app/index.tsx');

  // ===== FAILS-ON-REVERT KEYS (PART A — GlassBottomNav.tsx) =====

  // ---- T-13 [FAILS-ON-REVERT]: optimistic pendingPage state exists ----
  assert.match(
    nav,
    /const\s+\[pendingPage,\s*setPendingPage\]\s*=\s*useState<BottomNavPage\s*\|\s*null>\(null\)/,
    'T-13 GlassBottomNav must declare optimistic `pendingPage` state (useState<BottomNavPage | null>(null))'
  );

  // ---- T-14 [FAILS-ON-REVERT]: displayPage = pendingPage ?? currentPage ----
  assert.match(
    nav,
    /const\s+displayPage\s*=\s*pendingPage\s*\?\?\s*currentPage\s*;/,
    'T-14 GlassBottomNav must derive `displayPage = pendingPage ?? currentPage`'
  );

  // ---- T-15 [FAILS-ON-REVERT]: reconcile effect clears pendingPage on currentPage change ----
  assert.match(
    nav,
    /setPendingPage\(null\)\s*;[\s\S]*?\},\s*\[currentPage\]\)/,
    'T-15 GlassBottomNav must clear pendingPage in a useEffect keyed on [currentPage] (reconcile / anti-desync)'
  );

  // ---- T-16 [FAILS-ON-REVERT]: onPress sets pending BEFORE onNavigate ----
  const pendIdx = nav.indexOf('setPendingPage(key)');
  const navIdx = nav.indexOf('onNavigate(key)');
  assert.notEqual(pendIdx, -1, 'T-16 onPress must call setPendingPage(key)');
  assert.notEqual(navIdx, -1, 'T-16 onPress must call onNavigate(key)');
  assert.ok(
    pendIdx < navIdx,
    'T-16 setPendingPage(key) must run BEFORE onNavigate(key) so the highlight moves on the tap frame'
  );

  // ---- T-17 [FAILS-ON-REVERT]: spotlight + active styling are driven by displayPage ----
  assert.match(
    nav,
    /const\s+layout\s*=\s*tabLayoutsRef\.current\[displayPage\]\s*;/,
    'T-17 spotlight effect must look up layout via displayPage (optimistic), not currentPage'
  );
  assert.match(
    nav,
    /const\s+active\s*=\s*key\s*===\s*displayPage\s*;/,
    'T-17 active flag (icon color + label style + accessibilityState.selected) must derive from displayPage'
  );
  // The old currentPage-driven wiring must be gone from the active flag + effect lookup.
  assert.ok(
    !/const\s+active\s*=\s*key\s*===\s*currentPage\s*;/.test(nav),
    'T-17 the old `active = key === currentPage` must be replaced by displayPage'
  );

  // ===== FAILS-ON-REVERT KEYS (PART B — app/index.tsx) =====

  // ---- T-18 [FAILS-ON-REVERT]: the tab onNavigate defers setCurrentPage via startTransition ----
  // closeProfileOverlays() stays urgent (outside the transition); setCurrentPage(page) is wrapped.
  assert.match(
    idx,
    /closeProfileOverlays\(\)\s*;[\s\S]*?React\.startTransition\(\s*\(\)\s*=>\s*\{[\s\S]*?setCurrentPage\(page\)\s*;[\s\S]*?\}\)/,
    'T-18 onNavigate must keep closeProfileOverlays() urgent then wrap setCurrentPage(page) in React.startTransition (deferred mount)'
  );
  // The old un-deferred `closeProfileOverlays(); setCurrentPage(page);` bare pair must be gone.
  assert.ok(
    !/closeProfileOverlays\(\)\s*;\s*\n\s*setCurrentPage\(page\)\s*;/.test(idx),
    'T-18 the old un-deferred setCurrentPage(page) immediately after closeProfileOverlays() must be wrapped in startTransition'
  );
}

function runAll() {
  runOptimisticSemanticsTests();
  runSourceWiringTests();
}

if (require.main === module) {
  try {
    runAll();
    console.log(
      'PASS T-08..T-18 ORCH-0995 IMPLEMENT-2 optimistic tab-tap feedback (instant displayPage on press, reconcile clears on currentPage commit, programmatic nav reflected, no desync) + source wired for optimistic nav + startTransition-deferred mount'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOptimisticSemanticsTests, runSourceWiringTests, runAll, createNav };
