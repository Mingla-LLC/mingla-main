// @ts-nocheck
//
// ORCH-1063 — production freeze-after-close regression test.
//
// ROOT CAUSE: ExpandedCardModal (a wrapInRNModal RN <Modal>) was rendered INSIDE
// the `switch (effectiveUIState.type)` deck-state machine in SwipeableCards — in
// two different branches (EMPTY/EXHAUSTED and the LOADED main render). When a card
// was expanded and the deck state transiently flipped (token refresh →
// AUTH_REQUIRED, transient PIPELINE_ERROR, background refetch, or reaching the deck
// end → EXHAUSTED / EMPTY↔LOADED), React unmounted the currently-PRESENTED modal
// and mounted a different instance (or none). On a real device + release build iOS
// tore the presented modal window down mid-flight, leaving an invisible full-screen
// modal that captured every touch → TOTAL APP FREEZE.
//
// THE FIX: render ExpandedCardModal / DismissedCardsSheet / CustomPaywallScreen
// EXACTLY ONCE, at a STABLE position OUTSIDE the deck-state switch — as siblings of
// the `deckBody` IIFE — so no deck-state transition can ever unmount/remount/swap
// them; only their `visible` prop changes.
//
// This test is a STRUCTURAL assertion (the project's established style for the giant
// SwipeableCards component — see orch-0945-dead-end-render.test.tsx): it parses the
// source and proves each overlay is rendered exactly once AND positioned AFTER the
// IIFE close (`})();`) that bounds the deck-state switch, i.e. as a sibling of the
// switch, never inside any branch of it.
//
// FAILS-ON-REVERT: moving any overlay back inside the switch (i.e. before `})();`)
// makes that overlay's last occurrence index fall before the IIFE close, and T-2/T-3
// fail. Duplicating an overlay (the old two-instance shape) makes the occurrence
// count > 1, and T-1 fails. Either reversion is caught.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function runOrch1063SingleModalInstanceTest() {
  const source = readSource("src/components/SwipeableCards.tsx");

  // ── Locate the deck-state switch and the IIFE close that bounds it ──────────
  const deckBodyStart = source.indexOf("const deckBody");
  assert.notEqual(
    deckBodyStart,
    -1,
    "T-0 deck-state branches must be wrapped in a `deckBody` value so the overlays can sit outside the switch"
  );

  const switchStart = source.indexOf("switch (effectiveUIState.type)", deckBodyStart);
  assert.notEqual(switchStart, -1, "T-0 deck-state switch must exist");

  // The IIFE that returns ONLY deck content closes with `})();`. Everything after
  // it is the single stable overlay mount.
  const iifeClose = source.indexOf("})();", switchStart);
  assert.notEqual(
    iifeClose,
    -1,
    "T-0 the deckBody IIFE must close with `})();` so overlays can mount as its siblings"
  );

  // The single overlay mount must be the component's final return fragment.
  const finalReturn = source.indexOf("return (", iifeClose);
  assert.notEqual(finalReturn, -1, "T-0 component must have a final return after the deckBody IIFE");
  assert.ok(
    source.indexOf("{deckBody}", finalReturn) !== -1,
    "T-0 final return must render {deckBody} so deck content still appears"
  );

  // ── T-1: each overlay is rendered EXACTLY ONCE ──────────────────────────────
  // (was twice for ExpandedCardModal + DismissedCardsSheet before the fix.)
  for (const tag of ["<ExpandedCardModal", "<DismissedCardsSheet", "<CustomPaywallScreen"]) {
    assert.equal(
      countOccurrences(source, tag),
      1,
      `T-1 ${tag}> must be rendered EXACTLY ONCE (single stable instance, not per-switch-branch)`
    );
  }

  // ── T-2: every overlay instance sits AFTER the deckBody IIFE close ───────────
  // i.e. as a sibling of the switch, NOT inside any of its branches.
  for (const tag of ["<ExpandedCardModal", "<DismissedCardsSheet", "<CustomPaywallScreen"]) {
    const tagIdx = source.indexOf(tag);
    assert.ok(
      tagIdx > iifeClose,
      `T-2 ${tag}> must be rendered AFTER the deckBody IIFE close (\`})();\`) — i.e. outside the deck-state switch, never inside a branch`
    );
  }

  // ── T-3: nothing between `switch` and `})();` renders an overlay ─────────────
  // Hard guard: scan the entire switch body; it must contain zero overlay tags.
  const switchBody = source.slice(switchStart, iifeClose);
  for (const tag of ["<ExpandedCardModal", "<DismissedCardsSheet", "<CustomPaywallScreen"]) {
    assert.ok(
      switchBody.indexOf(tag) === -1,
      `T-3 the deck-state switch body must NOT render ${tag}> — any deck-state transition would unmount the presented modal and freeze the app on device`
    );
  }

  // ── T-4: the single ExpandedCardModal carries BOTH prop sets ─────────────────
  // The unified instance must keep the fuller main-render props (onCardRemoved)
  // AND the review-navigation props from the former EXHAUSTED-case instance, so
  // the modal is reachable identically from the LOADED tap and the EXHAUSTED
  // "review dismissed → tap card" flow.
  const modalStart = source.indexOf("<ExpandedCardModal");
  const modalEnd = source.indexOf("/>", modalStart);
  const modalProps = source.slice(modalStart, modalEnd);
  assert.match(modalProps, /onCardRemoved=/, "T-4 unified modal must keep the main-render onCardRemoved prop");
  assert.match(modalProps, /onNavigateNext=/, "T-4 unified modal must keep the review onNavigateNext prop");
  assert.match(modalProps, /onNavigatePrevious=/, "T-4 unified modal must keep the review onNavigatePrevious prop");
  assert.match(modalProps, /navigationIndex=/, "T-4 unified modal must keep the review navigationIndex prop");
  assert.match(modalProps, /navigationTotal=/, "T-4 unified modal must keep the review navigationTotal prop");
  assert.match(modalProps, /canAccessCurated=/, "T-4 unified modal must keep canAccessCurated");
  assert.match(modalProps, /onPaywallRequired=/, "T-4 unified modal must keep onPaywallRequired");
}

if (require.main === module) {
  try {
    runOrch1063SingleModalInstanceTest();
    console.log(
      "PASS T-0..T-4 ORCH-1063 single stable overlay mount (ExpandedCardModal/DismissedCardsSheet/CustomPaywallScreen rendered exactly once, outside the deck-state switch)"
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch1063SingleModalInstanceTest };
