// @ts-nocheck
// ORCH-0995 [Android nav jank] — TESTER ADVERSARIAL regression test.
//
// Angle (DIFFERENT from the implementor's happy-path tests, which simulate exactly one
// press → one commit and unconditionally clear pending on every commitCurrentPage):
// this test models the optimistic state machine the way React ACTUALLY runs it, where the
// reconcile `useEffect(() => setPendingPage(null), [currentPage])` fires ONLY when the
// `currentPage` value genuinely CHANGES between renders — not on every render, and not on a
// commit to the same value. It then attacks the desync edge cases that a naive model hides:
//
//   ADV-1  Rapid multi-tap (A→B→C) before ANY currentPage commit. displayPage must track the
//          LAST pressed tab, and once currentPage finally catches up it must NEVER strand on a
//          stale pending — including the realistic path where currentPage lands on an
//          INTERMEDIATE page first (startTransition can coalesce/interleave commits), which
//          fires the reconcile early and must hand authority back to currentPage.
//
//   ADV-2  Programmatic nav (notification) lands on the SAME page a stale optimistic lead
//          points to. Because the real reconcile is keyed on the VALUE of currentPage, a tab
//          tap whose pending happens to equal the eventual currentPage must still leave
//          pending cleared so a later programmatic nav to a different page is not blocked by a
//          stuck non-null pending. Proves the wiring can't deadlock the highlight.
//
//   ADV-3  reduceMotion geometry: while an optimistic lead is active, the instant-set spotlight
//          geometry must be computed from displayPage's tab layout (the LAST tap), NOT
//          currentPage's — otherwise the highlight jumps to the wrong tab under reduce-motion.
//
// These attack real BEHAVIOR (final highlight + geometry), not implementation trivia. The
// model is held faithful to the source by binding source-wiring guards (ADV-W*) that assert
// the component is actually wired the way the model assumes (reconcile keyed on [currentPage],
// displayPage drives geometry + active). Those are the fails-on-revert keys.
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

// designSystem tokens (mirrored from src/constants/designSystem.ts → glass.chrome.nav).
const SPOTLIGHT_INSET = 0; // c.nav.spotlightInset

// ---------------------------------------------------------------------------
// FAITHFUL optimistic-nav model.
//
// Differences from the implementor's createNav (deliberately stricter):
//   - The reconcile effect fires ONLY when currentPage's value CHANGES (mirrors React's
//     [currentPage] dependency comparison). committing the SAME value does NOT re-run it.
//   - `setCurrentPage` and the reconcile are separated so we can interleave rapid taps and
//     out-of-order / coalesced commits the way startTransition can in production.
//   - Geometry (spotlight target) is computed from displayPage against a tab-layout map, so we
//     can assert the highlight lands on the right tab — not just that a string matches.
// ---------------------------------------------------------------------------
function createFaithfulNav(initialPage, tabLayouts) {
  let currentPage = initialPage;
  let prevCommittedCurrentPage = initialPage; // last value the reconcile effect "saw"
  let pendingPage = null;

  const displayPage = () => pendingPage ?? currentPage;

  // Run the reconcile effect the way React would: only if [currentPage] changed since the
  // last time the effect ran.
  const runReconcileIfCurrentPageChanged = () => {
    if (currentPage !== prevCommittedCurrentPage) {
      pendingPage = null; // setPendingPage(null)
      prevCommittedCurrentPage = currentPage;
    }
  };

  return {
    displayPage,
    get currentPage() {
      return currentPage;
    },
    get pendingPage() {
      return pendingPage;
    },
    // onPress optimistic-set: re-tapping the displayed tab is a no-op.
    press(key) {
      if (key === displayPage()) return;
      pendingPage = key;
    },
    // Parent commits setCurrentPage(page); React then re-renders and (if currentPage changed)
    // runs the reconcile effect.
    commitCurrentPage(page) {
      currentPage = page;
      runReconcileIfCurrentPageChanged();
    },
    // Spotlight target geometry for the CURRENT displayPage (UI-thread effect reads displayPage).
    spotlightTarget() {
      const layout = tabLayouts[displayPage()];
      if (!layout) return null;
      return {
        x: layout.x + SPOTLIGHT_INSET,
        width: layout.width - SPOTLIGHT_INSET * 2,
      };
    },
  };
}

// Five real tabs with distinct geometry so a wrong-tab landing is detectable.
const LAYOUTS = {
  home: { x: 0, width: 60 },
  discover: { x: 60, width: 60 },
  connections: { x: 120, width: 70 },
  likes: { x: 190, width: 60 },
  profile: { x: 250, width: 60 },
};

function runBehavioralAdversarial() {
  // ===== ADV-1: rapid triple-tap before any commit, then out-of-order/coalesced commit =====
  {
    const nav = createFaithfulNav('home', LAYOUTS);
    // User stabs three tabs fast before the deferred mount commits anything.
    nav.press('discover');
    nav.press('connections');
    nav.press('likes');
    assert.equal(
      nav.displayPage(),
      'likes',
      'ADV-1 displayPage must track the LAST pressed tab during a rapid burst (not the first, not a middle one)'
    );
    assert.equal(nav.currentPage, 'home', 'ADV-1 currentPage has not committed yet');

    // startTransition may coalesce/skip intermediates and land currentPage on 'likes' directly.
    nav.commitCurrentPage('likes');
    assert.equal(nav.pendingPage, null, 'ADV-1 reconcile clears pending once currentPage catches up to the last tap');
    assert.equal(
      nav.displayPage(),
      'likes',
      'ADV-1 displayPage must remain the last-tapped tab after reconcile (now sourced from currentPage), never strand'
    );

    // Realistic interleave variant: currentPage lands on an INTERMEDIATE page first.
    const nav2 = createFaithfulNav('home', LAYOUTS);
    nav2.press('discover');
    nav2.press('connections');
    nav2.press('likes'); // displayPage === 'likes'
    nav2.commitCurrentPage('connections'); // an earlier transition wins first
    // The reconcile fired (currentPage changed home→connections) and CLEARED pending.
    assert.equal(nav2.pendingPage, null, 'ADV-1 intermediate commit fires reconcile and clears the optimistic lead');
    assert.equal(
      nav2.displayPage(),
      'connections',
      'ADV-1 once reconciled, displayPage follows the AUTHORITATIVE currentPage — it must NOT strand on the stale last-tap (likes)'
    );
    // And when the final transition commits, the highlight follows it too — no resurrection.
    nav2.commitCurrentPage('likes');
    assert.equal(
      nav2.displayPage(),
      'likes',
      'ADV-1 final commit moves displayPage to likes via currentPage; no stale-pending resurrection'
    );
  }

  // ===== ADV-2: programmatic nav to the SAME page a stale lead points to → no stuck pending ==
  {
    const nav = createFaithfulNav('home', LAYOUTS);
    nav.press('connections'); // optimistic lead === connections
    assert.equal(nav.pendingPage, 'connections', 'ADV-2 precondition: pending is set');

    // A push notification routes to 'connections' too (same page the user optimistically chose).
    nav.commitCurrentPage('connections');
    // currentPage changed home→connections → reconcile fired → pending cleared.
    assert.equal(
      nav.pendingPage,
      null,
      'ADV-2 reconcile must clear pending even when programmatic nav matches the optimistic page (no stuck non-null pending)'
    );
    assert.equal(nav.displayPage(), 'connections', 'ADV-2 displayPage correct after match');

    // PROOF the highlight is not deadlocked: a later programmatic nav to a DIFFERENT page works.
    nav.commitCurrentPage('profile');
    assert.equal(
      nav.displayPage(),
      'profile',
      'ADV-2 a subsequent programmatic nav must move the highlight — proves pending did not stick and block reconcile'
    );
  }

  // ===== ADV-3: reduceMotion geometry lands at displayPage's tab during an optimistic lead =====
  {
    const nav = createFaithfulNav('home', LAYOUTS);
    nav.press('profile'); // optimistic lead; currentPage still 'home'
    const target = nav.spotlightTarget();
    // Under reduceMotion the component instant-sets spotlightX/Width to exactly this target.
    assert.deepEqual(
      target,
      { x: LAYOUTS.profile.x + SPOTLIGHT_INSET, width: LAYOUTS.profile.width - SPOTLIGHT_INSET * 2 },
      'ADV-3 spotlight geometry (reduce-motion instant-set) must be computed from displayPage=profile, NOT currentPage=home'
    );
    assert.notDeepEqual(
      target,
      { x: LAYOUTS.home.x + SPOTLIGHT_INSET, width: LAYOUTS.home.width - SPOTLIGHT_INSET * 2 },
      'ADV-3 geometry must NOT land on the old currentPage tab while an optimistic lead is active'
    );
  }
}

// ===========================================================================
// SOURCE-WIRING GUARDS — bind the faithful model to the real component so the model can't
// drift from production semantics. These are the fails-on-revert keys for the tester test.
// ===========================================================================
function runWiringGuards() {
  const nav = readSource('src/components/GlassBottomNav.tsx');

  // ADV-W1: reconcile is keyed on [currentPage] (NOT [displayPage] / [] / [pendingPage]).
  // The whole "fires only when currentPage changes" model rests on this exact dep array.
  assert.match(
    nav,
    /useEffect\(\s*\(\)\s*=>\s*\{\s*setPendingPage\(null\)\s*;?\s*\},\s*\[currentPage\]\s*\)/,
    'ADV-W1 reconcile effect must be `useEffect(() => { setPendingPage(null); }, [currentPage])` — keyed ONLY on currentPage'
  );

  // ADV-W2: the spotlight geometry effect reads displayPage's layout (so an optimistic lead
  // moves the pill to the tapped tab, the basis of ADV-1/ADV-3).
  assert.match(
    nav,
    /const\s+layout\s*=\s*tabLayoutsRef\.current\[displayPage\]\s*;/,
    'ADV-W2 spotlight geometry must be read from tabLayoutsRef.current[displayPage]'
  );

  // ADV-W3: re-tap guard compares against displayPage (optimistic-aware), so a rapid burst
  // mid-flight isn't blocked by the stale currentPage closure (basis of ADV-1 burst).
  assert.match(
    nav,
    /if\s*\(\s*key\s*===\s*displayPage\s*\)\s*return\s*;/,
    'ADV-W3 onPress re-tap guard must compare key === displayPage (optimistic), not currentPage'
  );

  // ADV-W4: active flag derives from displayPage → icon color + label + a11y.selected all
  // follow the optimistic lead (ADV-1 expects the LAST tap to read as active).
  assert.match(
    nav,
    /const\s+active\s*=\s*key\s*===\s*displayPage\s*;/,
    'ADV-W4 active flag must be `key === displayPage`'
  );
}

function runAll() {
  runBehavioralAdversarial();
  runWiringGuards();
}

if (require.main === module) {
  try {
    runAll();
    console.log(
      'PASS ADV-1..ADV-3 + ADV-W1..ADV-W4 ORCH-0995 tester adversarial — optimistic-nav desync edge cases (rapid multi-tap, programmatic-same-page reconcile, reduce-motion geometry) hold against a faithful effect-timing model wired to the real component'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runBehavioralAdversarial, runWiringGuards, runAll, createFaithfulNav };
