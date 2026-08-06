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

  // ===== ISSUE #1638 AMENDMENT — T-19 =====
  //
  // WHY THIS GATE WAS AMENDED, AND WHY T-18 ABOVE IS UNCHANGED.
  //
  // Issue #1638 is Seth's third report of the same thing: "the switch happens and the
  // screen catches up later slowly. Too slow." The Phase-A investigation proved the cause
  // is not a regression — it is ORCH-0995's intended behaviour. This file's own T-18 was
  // named in that investigation as the gate any remedy would have to amend, and it was
  // explicitly forbidden to delete, weaken, or route around it.
  //
  // The implementation RE-AFFIRMED the T-18 contract instead of reversing it, with
  // numbers. Physical Samsung SM-A725F, cold-launched, 53 switches:
  //   - the transition's own scheduling gap (setCurrentPage -> destination render begins)
  //     is 48ms p50 / 106ms p90 — 7% of the 694ms p50 tap-to-first-frame total;
  //   - the JS thread blocks for 256ms p50 / 703ms p90 during the commit ANYWAY, so the
  //     transition buys no responsiveness — commits are not interruptible and these trees
  //     are large;
  //   - what the transition DOES buy is ORDERING, and that ordering is load-bearing: it is
  //     the only reason an urgent update can commit and PAINT before the heavy mount.
  //     Remove it and the pending state below lands in the same render pass as the mount,
  //     so it could never paint first — and ORCH-0995's original defect (the highlight
  //     hostage to the mount) returns.
  //   - transition restarts were ruled out as a counter-argument: pre-commit render passes
  //     measured p50 1 / p90 1 / max 2.
  //
  // So T-18 stands, unmodified. What was MISSING is added here at equal strictness: a
  // deferred mount with NOTHING rendered in the interim is exactly defect #1638. React
  // keeps the previous UI committed for the whole transition render, and this app has no
  // Suspense boundary and no isPending consumer anywhere. T-19 makes the pending state a
  // precondition of the deferral, so the two can never again be separated — deleting the
  // pending state now fails this suite just as loudly as deleting the transition does.

  // ---- T-19 [FAILS-ON-REVERT]: the deferral is paired with an URGENT pending state ----
  const beginIdx = idx.indexOf('tabSwitchHostRef.current?.beginSwitch(page)');
  const transitionIdx = idx.indexOf('React.startTransition(');
  assert.notEqual(
    beginIdx,
    -1,
    'T-19 onNavigate must raise the tab-switch pending state (tabSwitchHostRef.current?.beginSwitch(page)). A deferred mount with nothing rendered in the gap IS issue #1638 — the pill moves, the haptic fires, and the user keeps looking at the screen they just left.'
  );
  assert.ok(
    beginIdx < transitionIdx,
    'T-19 beginSwitch(page) must run BEFORE React.startTransition(...) — it is an urgent update and has to commit and paint while the transition-lane mount is still rendering'
  );

  // ---- T-19b [FAILS-ON-REVERT]: the pending state is transition-bound, not timer-bound ----
  const host = readSource('src/components/navigation/TabSwitchHost.tsx');
  assert.match(
    host,
    /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?setPendingPage\(null\)\s*;[\s\S]*?\},\s*\[currentPage[^\]]*\]\)/,
    'T-19b TabSwitchHost must clear the pending state from a useLayoutEffect keyed on [currentPage], i.e. from the destination COMMIT. A duration-driven dismissal would be the masking umbrella #1635 rejects, and it could outlive or undercut the data.'
  );
  const hostTimeouts = host.match(/setTimeout\(/g) || [];
  assert.equal(
    hostTimeouts.length,
    1,
    `T-19b TabSwitchHost may contain exactly ONE setTimeout — the named PENDING_FAILSAFE_MS ceiling that guards against a page commit that never arrives. Found ${hostTimeouts.length}.`
  );

  // ---- T-19c [FAILS-ON-REVERT]: the pending state shows STRUCTURE, never a spinner ----
  const scaffold = readSource('src/components/navigation/TabSwitchScaffold.tsx');
  assert.ok(
    !/ActivityIndicator/.test(scaffold),
    'T-19c the pending state must never be a naked spinner — umbrella #1635 bans one where real structure could be shown'
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
      'PASS T-08..T-19c ORCH-0995 IMPLEMENT-2 optimistic tab-tap feedback (instant displayPage on press, reconcile clears on currentPage commit, programmatic nav reflected, no desync) + source wired for optimistic nav + startTransition-deferred mount + #1638 amendment: the deferral is paired with an urgent, commit-bound, structure-showing pending state'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOptimisticSemanticsTests, runSourceWiringTests, runAll, createNav };
