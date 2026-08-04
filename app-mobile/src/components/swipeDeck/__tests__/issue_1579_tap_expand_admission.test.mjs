import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canAdmitDeckInput,
  canAdmitDeckTapExpand,
  DECK_SWIPE_PHASES,
  nextDeckGestureEpoch,
  shouldReleaseUnactivatedPress,
} from '../deckSwipeLifecycle.ts';

// Enforces I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS.
//
// The symptom ("an expanded modal opens on a real device") has no headless oracle, so this
// guard asserts the CAUSE. Two levers make that real rather than textual:
//
//   1. canAdmitDeckTapExpand / shouldReleaseUnactivatedPress are pure and exported, so the
//      core of the fix is EXECUTED here, and the measured RNGH callback traces are REPLAYED
//      through those same real predicates (T-5).
//   2. Every structural assertion runs on comment- and string-STRIPPED source and locates
//      callback bodies by paren/brace matching (T-6), because two guards on this very deck
//      have already been found satisfiable by a comment or an opening-tag match.
//
// T-7 is a mutant battery: each mutant must be REJECTED. A guard that passes a mutant has no
// discriminating power.

const controllerUrl = new URL('../useDeckSwipeController.ts', import.meta.url);
const workflowUrl = new URL(
  '../../../../../.github/workflows/issue-1579-deck-tap-expand.yml',
  import.meta.url,
);

const [controllerSource, workflowSource] = await Promise.all([
  readFile(controllerUrl, 'utf8'),
  readFile(workflowUrl, 'utf8'),
]);

// ---------------------------------------------------------------------------
// Measured provenance (SPEC #1579 section 6, prototype on iPhone 17 sim
// 2D13440F-75B7-4C23-B48B-382E7E02DFF2, iOS 26.5, RNGH 2.28.0, Reanimated 4.1.5,
// RN 0.81.5). Raw logs, reproduced verbatim, are the source of the event lists below.
//
// Run 1 — isolated TAP (post-fix):
//   RNGH onTouchesDown
//   RNGH onBegin
//   beginGesture ENTER phase=IDLE epoch=1
//   beginGesture ADMITTED newEpoch=2
//   setPhase IDLE -> DRAGGING
//   RNGH onTouchesUp
//   releaseUnactivatedPress RELEASING
//   setPhase DRAGGING -> IDLE
//   TOUCHABLE onPressOut
//   TOUCHABLE onPress
//   requestTapExpand ENTER phase=IDLE panActivated=false hasCard=true
//   requestTapExpand ADMITTED -> onExpandRequested
//
// Run 2 — SWIPE immediately after that tap (post-fix):
//   beginGesture ENTER phase=IDLE epoch=3
//   beginGesture ADMITTED newEpoch=4
//   RNGH onStart (ACTIVATED)
//   RNGH onTouchesUp            <- no RELEASING line: panActivated=true
//   RNGH onEnd
//   RNGH onFinalize success=true dx=-139
//   finalizeGesture ENTER phase=DRAGGING -> EXITING -> COMMITTING -> IDLE
//
// The ordering that makes the !panActivated term LOAD-BEARING (measured, same millisecond):
//   RNGH onTouchesUp   @380146
//   RNGH onEnd         @380146
//   RNGH onFinalize    @380147
// onTouchesUp arrives BEFORE onFinalize, and finalizeGesture early-returns unless the phase
// is still DRAGGING. An unconditional release therefore kills EVERY swipe on the deck.
// ---------------------------------------------------------------------------

const TAP_TRACE = [
  { type: 'onTouchesDown' },
  { type: 'onBegin' },
  { type: 'onTouchesUp' },
  { type: 'onPress' },
];

const SWIPE_TRACE = [
  { type: 'onTouchesDown' },
  { type: 'onBegin' },
  { type: 'onStart' },
  { type: 'onUpdate' },
  { type: 'onTouchesUp' },
  { type: 'onEnd' },
  { type: 'onFinalize', success: true, dx: -139 },
];

// The SAME tap, with the lease release arriving AFTER onPress instead of before it.
// runOnJS(releaseUnactivatedPress) is an async UI-thread -> JS-thread hop while onPress comes
// off the RN touch pipeline, so this interleaving is schedulable. SPEC section 4 requires the
// tap to work "whether or not the release landed first" — order-independent BY CONSTRUCTION,
// rather than a deterministic bug traded for an intermittent queue-ordering race.
// This trace is what gives T-7(a) its discriminating power: with the release landing first,
// even the old IDLE-only gate would pass, so the plain TAP trace alone cannot catch a revert.
const TAP_RELEASE_DEFERRED_TRACE = [
  { type: 'onTouchesDown' },
  { type: 'onBegin' },
  { type: 'onPress' },
  { type: 'onTouchesUp' },
];

const TAP_THEN_SWIPE_TRACE = [...TAP_TRACE, ...SWIPE_TRACE];

// Synthetic: the exit animation is still in flight (phase EXITING) when a tap arrives.
// This is the trace that catches a tap gate widened to "always admit".
const TAP_DURING_EXITING_TRACE = [
  { type: 'onTouchesDown' },
  { type: 'onBegin' },
  { type: 'onStart' },
  { type: 'onUpdate' },
  { type: 'onTouchesUp' },
  { type: 'onEnd' },
  { type: 'onFinalize', success: true, dx: -139, holdInExiting: true },
  { type: 'onPress' },
];

/**
 * A faithful reduced model of useDeckSwipeController's lifecycle. EVERY admission and
 * release decision is delegated to the REAL imported predicates — the model contributes
 * only the plumbing that RNGH and React would otherwise supply.
 *
 * `overrides` exists so T-7 can inject mutants without editing product source.
 */
function runTrace(trace, overrides = {}) {
  const {
    tapAdmit = canAdmitDeckTapExpand,
    releasePredicate = shouldReleaseUnactivatedPress,
    wireOnStart = true,
    armPanFlagInAdmittedBranch = true,
  } = overrides;

  const state = {
    phase: 'IDLE',
    epoch: 0,
    panActivated: true,
    activeCardId: 'card-a',
    admitted: 0,
    rejected: 0,
    expands: 0,
    releases: 0,
    commits: [],
    admissionEpochs: [],
    finalizePhases: [],
    pendingExitToken: null,
    cardSeq: 0,
  };

  const setPhase = (next) => {
    state.phase = next;
  };

  // beginGesture — mirrors the controller, including the EXITING fast-forward branch.
  const beginGesture = () => {
    if (state.phase === 'EXITING') {
      // No pending fast-forward is modelled in these traces, so this rejects.
      state.rejected += 1;
      return;
    }
    if (!canAdmitDeckInput(state.phase) || !state.activeCardId) {
      state.rejected += 1;
      if (!armPanFlagInAdmittedBranch) state.panActivated = false;
      return;
    }
    state.admitted += 1;
    state.epoch = nextDeckGestureEpoch(state.epoch);
    state.admissionEpochs.push(state.epoch);
    if (armPanFlagInAdmittedBranch) state.panActivated = false;
    setPhase('DRAGGING');
  };

  const activateGesture = () => {
    if (!wireOnStart) return;
    if (state.phase !== 'DRAGGING') return;
    state.panActivated = true;
  };

  const releaseUnactivatedPress = () => {
    if (!releasePredicate(state.phase, state.panActivated)) return;
    state.releases += 1;
    setPhase('IDLE');
  };

  const settleExit = () => {
    const token = state.pendingExitToken;
    if (!token || state.phase !== 'EXITING') return;
    setPhase('COMMITTING');
    state.commits.push(token.epoch);
    state.pendingExitToken = null;
    state.cardSeq += 1;
    state.activeCardId = `card-${state.cardSeq}`;
    setPhase('IDLE');
  };

  const finalizeGesture = (success, dx, holdInExiting) => {
    state.finalizePhases.push(state.phase);
    if (state.phase !== 'DRAGGING') return;
    if (!success || Math.abs(dx) < 80) {
      setPhase('SNAPPING');
      setPhase('IDLE');
      return;
    }
    state.pendingExitToken = { cardId: state.activeCardId, epoch: state.epoch };
    setPhase('EXITING');
    if (holdInExiting) return;
    settleExit();
  };

  const requestTapExpand = () => {
    if (!tapAdmit(state.phase, state.panActivated) || !state.activeCardId) {
      state.rejected += 1;
      return false;
    }
    releaseUnactivatedPress();
    state.expands += 1;
    return true;
  };

  for (const event of trace) {
    switch (event.type) {
      case 'onTouchesDown':
      case 'onUpdate':
      case 'onEnd':
        break;
      case 'onBegin':
        beginGesture();
        break;
      case 'onStart':
        activateGesture();
        break;
      case 'onTouchesUp':
      case 'onTouchesCancelled':
        releaseUnactivatedPress();
        break;
      case 'onFinalize':
        finalizeGesture(event.success, event.dx, event.holdInExiting === true);
        break;
      case 'settleExit':
        settleExit();
        break;
      case 'onPress':
        requestTapExpand();
        break;
      default:
        throw new Error(`unknown trace event: ${event.type}`);
    }
  }

  return state;
}

function assertTapOutcome(state) {
  assert.equal(state.expands, 1, 'TAP: the expanded view must be admitted exactly once');
  assert.equal(state.rejected, 0, 'TAP: nothing may be rejected on an isolated tap');
  assert.equal(state.phase, 'IDLE', 'TAP: the DRAGGING lease must be released at touch-up');
  assert.equal(state.releases, 1, 'TAP: exactly one lease release');
}

function assertSwipeOutcome(state) {
  assert.equal(state.releases, 0, 'SWIPE: onTouchesUp must NOT release an activated pan');
  assert.deepEqual(
    state.finalizePhases,
    ['DRAGGING'],
    'SWIPE: finalizeGesture must still see phase DRAGGING (the section 2.3 trap)',
  );
  assert.equal(state.commits.length, 1, 'SWIPE: the swipe must commit');
  assert.equal(
    state.commits[0],
    state.admissionEpochs[state.admissionEpochs.length - 1],
    'SWIPE: the commit must run on the epoch its OWN admission allocated',
  );
  assert.equal(state.phase, 'IDLE');
}

function assertDeferredReleaseTapOutcome(state) {
  assert.equal(
    state.expands,
    1,
    'TAP (release deferred): the expand must be admitted against the tap"s OWN lease',
  );
  assert.equal(state.rejected, 0, 'TAP (release deferred): nothing may be rejected');
  assert.equal(state.phase, 'IDLE', 'TAP (release deferred): requestTapExpand closes the lease');
  assert.equal(state.releases, 1, 'exactly one release, and it happens inside requestTapExpand');
}

function assertTapThenSwipeOutcome(state) {
  assert.equal(state.rejected, 0, 'TAP-then-SWIPE: the swipe after a tap must be ADMITTED');
  assert.equal(state.expands, 1);
  assert.equal(state.commits.length, 1);
  assert.equal(state.admissionEpochs.length, 2, 'both the tap and the swipe allocate an epoch');
  assert.equal(
    state.commits[0],
    state.admissionEpochs[1],
    'the swipe commits on its own epoch, not the tap"s',
  );
  assert.ok(
    state.commits[0] > state.admissionEpochs[0],
    'the swipe commit epoch must be strictly greater than the tap epoch (no stale-epoch ride)',
  );
}

function assertExitingTapRejected(state) {
  assert.equal(state.phase, 'EXITING', 'precondition: the exit animation is still in flight');
  assert.equal(state.expands, 0, 'a tap mid-EXITING must NOT open the expanded view');
  assert.ok(state.rejected >= 1, 'a tap mid-EXITING must be rejected');
}

// ---------------------------------------------------------------------------
// Comment- and string-stripping + delimiter matching for the structural checks.
// ---------------------------------------------------------------------------

function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function matchDelimiter(source, openIndex, open, close) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  throw new Error(`unbalanced ${open}${close} from index ${openIndex}`);
}

/**
 * Return the body of the callback introduced by `marker`, where `marker` ends at its own
 * opening paren. The argument region is paren-matched FIRST, so a marker written with no
 * braces at all (the empty-body mutant) cannot run away into the next callback's braces.
 */
function callbackBody(strippedSource, marker) {
  const idx = strippedSource.indexOf(marker);
  assert.ok(idx >= 0, `wiring marker absent from comment-stripped source: ${marker}`);
  const openParen = idx + marker.length - 1;
  assert.equal(strippedSource[openParen], '(', `marker must end at its opening paren: ${marker}`);
  const argRegion = matchDelimiter(strippedSource, openParen, '(', ')');
  const braceAt = argRegion.indexOf('{');
  if (braceAt < 0) return argRegion;
  return matchDelimiter(argRegion, braceAt, '{', '}');
}

function assertControllerWiring(rawSource) {
  const src = stripCommentsAndStrings(rawSource);

  assert.match(
    callbackBody(src, '.onStart('),
    /runOnJS\(activateGesture\)/,
    '.onStart must record that the pan activated',
  );
  assert.match(
    callbackBody(src, '.onTouchesUp('),
    /runOnJS\(releaseUnactivatedPress\)/,
    '.onTouchesUp must release a non-activated lease',
  );
  assert.match(
    callbackBody(src, '.onTouchesCancelled('),
    /runOnJS\(releaseUnactivatedPress\)/,
    '.onTouchesCancelled must release a non-activated lease',
  );

  const tapBody = callbackBody(src, 'const requestTapExpand = useCallback(');
  assert.match(tapBody, /canAdmitDeckTapExpand/, 'tap expand must use the tap-aware gate');
  assert.doesNotMatch(
    tapBody,
    /canAdmitDeckInput/,
    'tap expand must NOT be gated on the IDLE-only swipe gate',
  );
  assert.match(tapBody, /releaseUnactivatedPress\(\)/, 'tap expand must close the lease itself');

  assert.match(
    callbackBody(src, 'const beginGesture = useCallback('),
    /panActivatedRef\.current = false/,
    'an admitted press must be armed as tap-eligible',
  );
  assert.match(
    callbackBody(src, 'const requestSwipe = useCallback('),
    /panActivatedRef\.current = true/,
    'a programmatic swipe is never a tap-eligible press',
  );

  // The IDLE-only gate must still be the gate for swipe and accessibility admission.
  assert.match(
    callbackBody(src, 'const requestSwipe = useCallback('),
    /canAdmitDeckInput\(phaseRef\.current\)/,
  );
}

// ---------------------------------------------------------------------------
// T-1 .. T-8
// ---------------------------------------------------------------------------

test('T-1 both new lifecycle predicates exist and are executable', () => {
  assert.equal(typeof canAdmitDeckTapExpand, 'function');
  assert.equal(typeof shouldReleaseUnactivatedPress, 'function');
  // Vacuity guard: every derived truth table below is only meaningful if the phase list is real.
  assert.ok(DECK_SWIPE_PHASES.length >= 5, 'phase enumeration must be non-degenerate');
  assert.ok(DECK_SWIPE_PHASES.includes('IDLE'));
  assert.ok(DECK_SWIPE_PHASES.includes('DRAGGING'));
});

test('T-2 canAdmitDeckTapExpand admits IDLE and exactly one DRAGGING case', () => {
  let trueCells = 0;
  let falseCells = 0;
  for (const phase of DECK_SWIPE_PHASES) {
    for (const panActivated of [false, true]) {
      const actual = canAdmitDeckTapExpand(phase, panActivated);
      const expected = phase === 'IDLE' || (phase === 'DRAGGING' && !panActivated);
      assert.equal(actual, expected, `canAdmitDeckTapExpand(${phase}, ${panActivated})`);
      if (actual) trueCells += 1;
      else falseCells += 1;
    }
  }
  // The repair itself, pinned as its own cell.
  assert.equal(canAdmitDeckTapExpand('DRAGGING', false), true, 'a tap holds its own lease');
  assert.equal(canAdmitDeckTapExpand('DRAGGING', true), false, 'a real drag is not a tap');
  // Not a widening of admission: mid-transition phases stay closed.
  for (const phase of DECK_SWIPE_PHASES.filter((p) => p !== 'IDLE' && p !== 'DRAGGING')) {
    assert.equal(canAdmitDeckTapExpand(phase, false), false, `${phase} must stay rejected`);
    assert.equal(canAdmitDeckTapExpand(phase, true), false, `${phase} must stay rejected`);
  }
  assert.ok(trueCells > 0 && falseCells > 0, 'truth table must discriminate');
});

test('T-3 canAdmitDeckInput is UNCHANGED — still IDLE-only', () => {
  for (const phase of DECK_SWIPE_PHASES) {
    assert.equal(
      canAdmitDeckInput(phase),
      phase === 'IDLE',
      `the shared swipe/a11y gate must not be widened: ${phase}`,
    );
  }
});

test('T-4 shouldReleaseUnactivatedPress is true ONLY for a non-activated DRAGGING lease', () => {
  for (const phase of DECK_SWIPE_PHASES) {
    for (const panActivated of [false, true]) {
      assert.equal(
        shouldReleaseUnactivatedPress(phase, panActivated),
        phase === 'DRAGGING' && !panActivated,
        `shouldReleaseUnactivatedPress(${phase}, ${panActivated})`,
      );
    }
  }
  // This single cell is what stops the release from killing every swipe (SPEC section 2.3).
  assert.equal(
    shouldReleaseUnactivatedPress('DRAGGING', true),
    false,
    'releasing an ACTIVATED pan would make finalizeGesture early-return and kill every swipe',
  );
});

test('T-5 measured RNGH traces replayed through the real predicates', () => {
  assertTapOutcome(runTrace(TAP_TRACE));
  assertDeferredReleaseTapOutcome(runTrace(TAP_RELEASE_DEFERRED_TRACE));
  assertSwipeOutcome(runTrace(SWIPE_TRACE));
  assertTapThenSwipeOutcome(runTrace(TAP_THEN_SWIPE_TRACE));
  assertExitingTapRejected(runTrace(TAP_DURING_EXITING_TRACE));
});

test('T-6 the controller wiring is present in EXECUTABLE source, not in a comment', () => {
  assertControllerWiring(controllerSource);
});

test('T-7 mutant battery — every mutant is rejected', () => {
  // (a) requestTapExpand reverted to the IDLE-only gate -> the tap dies whenever onPress
  // wins the race against the release hop. Asserted on the deferred-release trace on
  // purpose: on the release-first trace even the reverted gate passes, which is exactly
  // why SPEC section 4 refuses to lean on that ordering.
  assert.throws(
    () => assertDeferredReleaseTapOutcome(runTrace(TAP_RELEASE_DEFERRED_TRACE, {
      tapAdmit: (phase) => canAdmitDeckInput(phase),
    })),
    /TAP \(release deferred\): the expand must be admitted/,
  );

  // (b) THE TRAP: a release that ignores panActivated -> every swipe stops committing.
  assert.throws(
    () => assertSwipeOutcome(runTrace(SWIPE_TRACE, {
      releasePredicate: (phase) => phase === 'DRAGGING',
    })),
    /SWIPE: onTouchesUp must NOT release an activated pan/,
  );

  // (c) .onStart not wired -> the pan never records activation -> every swipe stops committing.
  assert.throws(
    () => assertSwipeOutcome(runTrace(SWIPE_TRACE, { wireOnStart: false })),
    /SWIPE/,
  );

  // (d) a tap gate widened to "always admit" -> a tap mid-EXITING is wrongly admitted.
  assert.throws(
    () => assertExitingTapRejected(runTrace(TAP_DURING_EXITING_TRACE, {
      tapAdmit: () => true,
    })),
    /a tap mid-EXITING must NOT open the expanded view/,
  );

  // (e) the wiring present ONLY inside a comment -> the structural check must not be fooled.
  const commentOnly = controllerSource.replace(
    /\.onTouchesUp\(\(\) => \{\s*runOnJS\(releaseUnactivatedPress\)\(\);\s*\}\)/,
    '// .onTouchesUp(() => { runOnJS(releaseUnactivatedPress)(); })',
  );
  assert.notEqual(commentOnly, controllerSource, 'mutant (e) must actually mutate the source');
  assert.throws(() => assertControllerWiring(commentOnly), /\.onTouchesUp\(/);

  // (f) THE OPENING-TAG-MATCH DEFENSE: .onTouchesUp( present with an EMPTY body.
  const emptyBody = controllerSource.replace(
    /\.onTouchesUp\(\(\) => \{\s*runOnJS\(releaseUnactivatedPress\)\(\);\s*\}\)/,
    '.onTouchesUp(() => {})',
  );
  assert.notEqual(emptyBody, controllerSource, 'mutant (f) must actually mutate the source');
  assert.throws(
    () => assertControllerWiring(emptyBody),
    /onTouchesUp must release a non-activated lease/,
  );

  // (g) the arming moved into the REJECTED branch of beginGesture -> the tap dies again.
  assert.throws(
    () => assertTapOutcome(runTrace(TAP_TRACE, { armPanFlagInAdmittedBranch: false })),
    /TAP/,
  );
});

test('T-8 the #1579 workflow requires and executes both #1579 guards, and only those', () => {
  assert.match(workflowSource, /node-version: ['"]22['"]/);
  assert.match(workflowSource, /timeout-minutes: 5/);
  assert.match(workflowSource, /test -f/);
  assert.match(workflowSource, /node --test/);
  assert.match(workflowSource, /issue_1579_tap_expand_admission\.test\.mjs/);
  assert.match(workflowSource, /issue_1579_tap_expand_admission\.adversarial\.test\.mjs/);
  assert.match(workflowSource, /app-mobile\/src\/components\/swipeDeck\/\*\*/);
  // #1481's job asserts its own step names EXACTLY eight guards; #1579 must never add to it.
  assert.doesNotMatch(workflowSource, /issue_1481_/);
  assert.doesNotMatch(workflowSource, /issue_1576_/);
});
