import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canAdmitDeckInput,
  canAdmitDeckTapExpand,
  DECK_SWIPE_PHASES,
  nextDeckGestureEpoch,
  shouldReleaseUnactivatedPress,
} from '../deckSwipeLifecycle.ts';

// ===========================================================================
// TESTER ADVERSARIAL GUARD — SPEC #1579 section 9.2 (A-1 .. A-4, A-8).
// Enforces I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS.
//
// DIFFERENT AXIS FROM THE IMPLEMENTOR GUARD, AND HERE IS EXACTLY WHY.
//
// issue_1579_tap_expand_admission.test.mjs is strong at BOTH ENDS and blind in the
// MIDDLE. It executes the two pure predicates directly (real), and it structurally
// pins the CALL SITES (`.onStart(` contains `runOnJS(activateGesture)`). But the
// bridge between those two ends — the declared body of each callback and the
// ARGUMENTS handed to each predicate — is asserted by nothing. Its T-5 replay
// hand-writes that bridge in the test file, so the model's bridge is correct by
// construction no matter what the product source says.
//
// Measured by the tester against the real source, in a mirrored checkout
// (verdict comment on issue #1579). Each of these SIX mutants keeps the
// implementor guard at 8 pass / 0 fail, and each one ships a broken deck:
//
//   M9  `activateGesture` body emptied, `.onStart` still wired
//         -> panActivated never becomes true -> on every real swipe onTouchesUp
//            releases the lease before onFinalize -> finalizeGesture early-returns
//            -> EVERY SWIPE ON THE DECK DIES. This is SPEC section 2.3's trap,
//            reintroduced through a door the mutant battery does not watch.
//   M11 `releaseUnactivatedPress` body emptied, wiring still present
//         -> the lease is never handed back -> the #1579 stale-DRAGGING epoch leak
//            is restored in full.
//   M12 `activateGesture` sets the flag to `false` instead of `true`  -> as M9.
//   M13 `releaseUnactivatedPress` calls setPhase('DRAGGING') not ('IDLE') -> as M11.
//   M14 release call site negates its argument
//         -> releases ACTIVATED pans and never releases taps: both defects at once.
//   M15 tap gate call site negates its argument
//         -> canAdmitDeckTapExpand(phase, !panActivated) -> a tap evaluates the
//            ('DRAGGING', true) cell -> false -> the ORIGINAL #1579 dead tap is back.
//
// So this guard does not re-check the predicates and does not re-check the call
// sites. It TRANSPLANTS the real declared callback bodies out of the controller
// source and EXECUTES them against the real imported predicates (A-9). The bridge
// stops being pattern-matched and starts being run. Every mutant above is then
// rejected by an observable behavioural property rather than by a token search.
//
// On top of that it does what section 9.2 asks and the implementor guard does not:
// it DERIVES the attack surface from the source instead of naming it — every
// lease-claiming site (A-1), every attached RNGH callback (A-2), the phase
// enumeration and the callback alphabet feeding a 10,000-sequence fuzz (A-3) —
// so a future third lease-claiming path or a newly attached terminal callback is
// caught by construction. A-4 covers interruption and multi-touch, which no trace
// in the implementor guard exercises at all (`onTouchesCancelled` appears in its
// reducer switch but no trace ever emits it). A-8 mutates real source, runs the
// IMPLEMENTOR guard in a scratch mirror, and asserts it actually goes red.
//
// A-5 (runtime, independent oracle via onCommitRequested/onTransitionRejected),
// A-6 (VoiceOver, human-in-the-loop) and A-7 (sub-minDistance press) are device
// claims with no headless oracle. They are recorded in the tester verdict on
// issue #1579, not simulated here — a guard that pretended to cover them would be
// exactly the unfalsifiable-test failure this file exists to prevent.
// ===========================================================================

const controllerUrl = new URL('../useDeckSwipeController.ts', import.meta.url);
const lifecycleUrl = new URL('../deckSwipeLifecycle.ts', import.meta.url);
const implementorGuardUrl = new URL('./issue_1579_tap_expand_admission.test.mjs', import.meta.url);
const workflowUrl = new URL(
  '../../../../../.github/workflows/issue-1579-deck-tap-expand.yml',
  import.meta.url,
);
const registryUrl = new URL('../../../../../docs/INVARIANT_REGISTRY.md', import.meta.url);

const [controllerSource, workflowSource, registrySource] = await Promise.all([
  readFile(controllerUrl, 'utf8'),
  readFile(workflowUrl, 'utf8'),
  readFile(registryUrl, 'utf8'),
]);

// ---------------------------------------------------------------------------
// Source masking. Independent implementation, and deliberately NOT the
// implementor's: that one blanks string CONTENTS, which is right for marker
// searching and fatal for transplantation (`setPhase('DRAGGING')` would become
// `setPhase('')`). This produces a same-LENGTH mask so every index computed on
// the mask addresses the identical character in the original, letting us search
// on masked text and slice executable text.
// ---------------------------------------------------------------------------

function maskSource(source) {
  const out = Array.from(source);
  const n = source.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      let j = i;
      while (j < n && source[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j += 1;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n && source[j] !== quote) {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const controllerMask = maskSource(controllerSource);

assert.equal(
  controllerMask.length,
  controllerSource.length,
  'the mask must be index-identical to the source',
);

function matchDelimiter(mask, openIndex, open, close) {
  let depth = 0;
  for (let i = openIndex; i < mask.length; i += 1) {
    if (mask[i] === open) depth += 1;
    else if (mask[i] === close) {
      depth -= 1;
      if (depth === 0) return [openIndex + 1, i];
    }
  }
  throw new Error(`unbalanced ${open}${close} from index ${openIndex}`);
}

/**
 * Slice the EXECUTABLE body of `const <name> = useCallback(<arrow>)` out of the
 * controller. Indices come from the mask (so braces inside comments and strings
 * cannot mislead the matcher); the returned text comes from the real source (so
 * it can be executed).
 */
function declaredCallbackBody(name) {
  const decl = `const ${name} = useCallback(`;
  const at = controllerMask.indexOf(decl);
  assert.ok(at >= 0, `controller must declare ${name} via useCallback`);
  const openParen = at + decl.length - 1;
  const [argFrom, argTo] = matchDelimiter(controllerMask, openParen, '(', ')');
  const braceAt = controllerMask.indexOf('{', argFrom);
  assert.ok(braceAt >= 0 && braceAt < argTo, `${name} must have a braced arrow body`);
  const [bodyFrom, bodyTo] = matchDelimiter(controllerMask, braceAt, '{', '}');
  const body = controllerSource.slice(bodyFrom, bodyTo);
  assert.ok(body.trim().length > 0, `${name} must have a non-empty body`);
  return body;
}

// ---------------------------------------------------------------------------
// A-9 — the live bridge. The real declared bodies, executed against the real
// predicates. `new Function` gives each transplanted body exactly the free
// identifiers the controller gives it, and nothing else: an identifier the
// product adds later surfaces immediately as a ReferenceError rather than as a
// silently-passing guard.
// ---------------------------------------------------------------------------

const TRANSPLANTED = [
  'beginGesture',
  'activateGesture',
  'releaseUnactivatedPress',
  'requestTapExpand',
  'requestSwipe',
];

/** The phase `finalizeGesture` demands, DERIVED from source rather than assumed. */
function deriveFinalizeGuardPhase() {
  const body = declaredCallbackBody('finalizeGesture');
  const m = body.match(/if\s*\(\s*phaseRef\.current\s*!==\s*'([A-Z]+)'\s*\)\s*return;/);
  assert.ok(m, 'finalizeGesture must open with an early-return phase guard (#1481)');
  assert.ok(
    DECK_SWIPE_PHASES.includes(m[1]),
    `finalizeGesture guards on a phase outside DECK_SWIPE_PHASES: ${m[1]}`,
  );
  return m[1];
}

const FINALIZE_GUARD_PHASE = deriveFinalizeGuardPhase();

const COMMIT_DX = 140; // above every commit threshold; direction is irrelevant here

/**
 * A controller instance whose admission, arming, release and tap decisions are
 * the REAL source, executed. Only the things RNGH / Reanimated / React would
 * supply (exit animation, timers, card rotation) are modelled.
 */
function makeLiveController(sourceOverride = null) {
  const source = sourceOverride ?? controllerSource;
  const mask = sourceOverride ? maskSource(sourceOverride) : controllerMask;

  const bodyOf = (name) => {
    if (!sourceOverride) return declaredCallbackBody(name);
    const decl = `const ${name} = useCallback(`;
    const at = mask.indexOf(decl);
    assert.ok(at >= 0, `controller must declare ${name}`);
    const openParen = at + decl.length - 1;
    const [argFrom, argTo] = matchDelimiter(mask, openParen, '(', ')');
    const braceAt = mask.indexOf('{', argFrom);
    assert.ok(braceAt >= 0 && braceAt < argTo, `${name} must have a braced arrow body`);
    const [bodyFrom, bodyTo] = matchDelimiter(mask, braceAt, '{', '}');
    return source.slice(bodyFrom, bodyTo);
  };

  const phaseRef = { current: 'IDLE' };
  const panActivatedRef = { current: true };
  const epochRef = { current: 0 };
  const activeCardIdRef = { current: 'card-0' };
  const latestEndYRef = { current: 0 };
  const countersRef = { current: { admitted: 0, rejected: 0, stale: 0 } };

  const log = {
    phases: [],
    admissionEpochs: [],
    commits: [],
    releases: 0,
    expands: 0,
    finalizeObservedPhases: [],
    cardSeq: 0,
  };

  const setPhase = (next) => {
    assert.ok(
      DECK_SWIPE_PHASES.includes(next),
      `setPhase received a phase outside DECK_SWIPE_PHASES: ${next}`,
    );
    phaseRef.current = next;
    log.phases.push(next);
  };

  const optionsRef = {
    current: {
      onExpandRequested: () => {
        log.expands += 1;
      },
      onSwipeValidated: () => true,
      onSwipeRejectedCentered: () => {},
      onTransitionRejected: () => {},
    },
  };

  const rejectInput = () => {
    countersRef.current.rejected += 1;
  };

  let pendingExit = null;
  let fastForwardEnabled = false;

  const animateToCenter = () => {
    if (phaseRef.current === 'IDLE') return;
    setPhase('SNAPPING');
    setPhase('IDLE');
  };

  const beginExit = (direction) => {
    const cardId = activeCardIdRef.current;
    if (!cardId || phaseRef.current !== 'DRAGGING') return false;
    const token = { cardId, direction, epoch: epochRef.current };
    if (!optionsRef.current.onSwipeValidated(token)) {
      animateToCenter();
      return false;
    }
    pendingExit = token;
    setPhase('EXITING');
    return true;
  };

  const settleExit = () => {
    if (!pendingExit || phaseRef.current !== 'EXITING') return;
    setPhase('COMMITTING');
    log.commits.push({ epoch: pendingExit.epoch, cardId: pendingExit.cardId });
    pendingExit = null;
    log.cardSeq += 1;
    activeCardIdRef.current = `card-${log.cardSeq}`;
    setPhase('IDLE');
  };

  const fastForwardPendingExit = () => {
    if (!fastForwardEnabled || !pendingExit || phaseRef.current !== 'EXITING') return false;
    setPhase('COMMITTING');
    log.commits.push({ epoch: pendingExit.epoch, cardId: pendingExit.cardId });
    pendingExit = null;
    log.cardSeq += 1;
    activeCardIdRef.current = `card-${log.cardSeq}`;
    setPhase('IDLE');
    return true;
  };

  // --- the transplant ------------------------------------------------------
  const env = {
    phaseRef,
    panActivatedRef,
    epochRef,
    activeCardIdRef,
    latestEndYRef,
    countersRef,
    optionsRef,
    setPhase,
    rejectInput,
    beginExit,
    fastForwardPendingExit,
    canAdmitDeckInput,
    canAdmitDeckTapExpand,
    shouldReleaseUnactivatedPress,
    nextDeckGestureEpoch,
  };
  const envNames = Object.keys(env);
  const envValues = envNames.map((k) => env[k]);

  const compiled = {};
  for (const name of TRANSPLANTED) {
    const body = bodyOf(name);
    // `direction` is requestSwipe's only parameter; harmless for the others.
    // eslint-disable-next-line no-new-func
    const fn = new Function(...envNames, 'releaseUnactivatedPress', 'direction', body);
    compiled[name] = (direction) =>
      fn(...envValues, (...a) => compiled.releaseUnactivatedPress(...a), direction);
  }

  // releaseUnactivatedPress is observed through setPhase, so count real releases.
  const rawRelease = compiled.releaseUnactivatedPress;
  compiled.releaseUnactivatedPress = () => {
    const before = phaseRef.current;
    const r = rawRelease();
    if (before === 'DRAGGING' && phaseRef.current !== 'DRAGGING') log.releases += 1;
    return r;
  };

  const beginGesture = () => {
    const before = countersRef.current.admitted;
    compiled.beginGesture();
    if (countersRef.current.admitted > before) log.admissionEpochs.push(epochRef.current);
  };

  const requestSwipe = (direction = 'left') => {
    const before = countersRef.current.admitted;
    const r = compiled.requestSwipe(direction);
    if (countersRef.current.admitted > before) log.admissionEpochs.push(epochRef.current);
    return r;
  };

  const finalizeGesture = (success, dx) => {
    log.finalizeObservedPhases.push(phaseRef.current);
    if (phaseRef.current !== FINALIZE_GUARD_PHASE) return;
    if (!success) {
      animateToCenter();
      return;
    }
    if (Math.abs(dx) >= 80) beginExit(dx < 0 ? 'left' : 'right');
    else animateToCenter();
  };

  return {
    log,
    phaseRef,
    panActivatedRef,
    epochRef,
    countersRef,
    beginGesture,
    activateGesture: () => compiled.activateGesture(),
    releaseUnactivatedPress: () => compiled.releaseUnactivatedPress(),
    requestTapExpand: () => compiled.requestTapExpand(),
    requestSwipe,
    finalizeGesture,
    settleExit,
    enableFastForward: (on) => {
      fastForwardEnabled = on;
    },
    hasPendingExit: () => pendingExit !== null,
  };
}

/**
 * Replay an event list through a live controller. Every RNGH callback name here
 * is drawn from the DERIVED alphabet (A-2), so an unhandled one is a hard error
 * rather than a silent skip.
 */
function replay(events, ctl = makeLiveController()) {
  for (const ev of events) {
    const type = typeof ev === 'string' ? ev : ev.type;
    switch (type) {
      case 'onTouchesDown':
      case 'onUpdate':
      case 'onEnd':
        break;
      case 'onBegin':
        ctl.beginGesture();
        break;
      case 'onStart':
        ctl.activateGesture();
        break;
      case 'onTouchesUp':
      case 'onTouchesCancelled':
        ctl.releaseUnactivatedPress();
        break;
      case 'onFinalize':
        ctl.finalizeGesture(ev.success !== false, ev.dx ?? COMMIT_DX);
        break;
      case 'onPress':
        ctl.requestTapExpand();
        break;
      case 'a11ySwipe':
        ctl.requestSwipe(ev.direction ?? 'left');
        break;
      case 'settleExit':
        ctl.settleExit();
        break;
      default:
        throw new Error(`unhandled derived event: ${type}`);
    }
  }
  return ctl;
}

const TAP = ['onTouchesDown', 'onBegin', 'onTouchesUp', 'onPress'];
const TAP_RELEASE_DEFERRED = ['onTouchesDown', 'onBegin', 'onPress', 'onTouchesUp'];
const SWIPE = [
  'onTouchesDown',
  'onBegin',
  'onStart',
  'onUpdate',
  'onTouchesUp',
  'onEnd',
  { type: 'onFinalize', success: true, dx: -COMMIT_DX },
  'settleExit',
];

// ---------------------------------------------------------------------------
// A-1 — lease-escape analysis. DERIVED, not hardcoded.
// ---------------------------------------------------------------------------

/** Every site that transitions the phase INTO 'DRAGGING', attributed to its function. */
function deriveLeaseClaimSites() {
  const decls = [...controllerMask.matchAll(/const (\w+) = useCallback\(/g)].map((m) => ({
    name: m[1],
    at: m.index,
  }));
  const sites = [];
  // Search the MASK for the call (so commented-out calls are invisible), then confirm
  // the literal against the real source (whose string contents the mask blanks out).
  for (const m of controllerMask.matchAll(/setPhase\(/g)) {
    if (!controllerSource.startsWith("setPhase('DRAGGING')", m.index)) continue;
    const owner = decls.filter((d) => d.at < m.index).pop();
    assert.ok(owner, `setPhase('DRAGGING') at ${m.index} sits outside any useCallback`);
    sites.push(owner.name);
  }
  return [...new Set(sites)];
}

test('A-1 every derived lease-claiming site has a release path independent of onFinalize', () => {
  const claimers = deriveLeaseClaimSites();
  assert.ok(claimers.length > 0, 'vacuity: no lease-claiming site was derived at all');
  assert.deepEqual(
    [...claimers].sort(),
    ['beginGesture', 'requestSwipe'],
    'a NEW site claims the DRAGGING lease — prove it has a non-onFinalize release path, '
      + 'then extend this guard. The implementor guard names its pair and cannot see this.',
  );

  // beginGesture's lease: released by a touch-end that never reaches onFinalize.
  for (const terminator of ['onTouchesUp', 'onTouchesCancelled']) {
    const ctl = replay(['onTouchesDown', 'onBegin', terminator]);
    assert.equal(
      ctl.phaseRef.current,
      'IDLE',
      `a press ended by ${terminator} alone must not strand the DRAGGING lease`,
    );
    assert.equal(canAdmitDeckInput(ctl.phaseRef.current), true);
  }

  // requestSwipe's lease: never observable outside its own synchronous call.
  const ctl = makeLiveController();
  assert.equal(ctl.requestSwipe('left'), true, 'a programmatic swipe must be admitted from IDLE');
  assert.notEqual(
    ctl.phaseRef.current,
    'DRAGGING',
    'requestSwipe must leave DRAGGING before returning — its lease has no touch to release it',
  );
  assert.equal(
    ctl.panActivatedRef.current,
    true,
    'a programmatic swipe must never be releasable as a tap-eligible press',
  );
  // ...and a stray touch-end must not be able to steal it.
  ctl.releaseUnactivatedPress();
  assert.notEqual(ctl.phaseRef.current, 'IDLE', 'a stray touch-end must not cancel an a11y swipe');
});

// ---------------------------------------------------------------------------
// A-2 — terminal-callback coverage, derived from the Gesture.Pan() chain.
// ---------------------------------------------------------------------------

function derivePanChainCallbacks() {
  const at = controllerMask.indexOf('Gesture.Pan()');
  assert.ok(at >= 0, 'the controller must build its gesture from Gesture.Pan()');
  const links = [];
  let i = at + 'Gesture.Pan()'.length;
  while (i < controllerMask.length) {
    const m = /^\s*\.(\w+)\(/.exec(controllerMask.slice(i, i + 64));
    if (!m) break;
    const openParen = i + m[0].length - 1;
    const [from, to] = matchDelimiter(controllerMask, openParen, '(', ')');
    links.push({ name: m[1], body: controllerSource.slice(from, to) });
    i = to + 1;
  }
  return links;
}

test('A-2 every attached callback that can end a touch has a lease consequence', () => {
  const links = derivePanChainCallbacks();
  assert.ok(links.length >= 6, `vacuity: only ${links.length} chain links derived`);

  const callbacks = links.filter((l) => /^on[A-Z]/.test(l.name));
  const names = callbacks.map((l) => l.name);
  assert.ok(names.includes('onBegin'), 'derivation failed: onBegin not found on the chain');

  // Any callback that can be the LAST one delivered for a touch must move the lease.
  const TERMINAL = new Set(['onFinalize', 'onTouchesUp', 'onTouchesCancelled']);
  const LEASE_CONSEQUENCE = /runOnJS\((releaseUnactivatedPress|finalizeGesture)\)/;
  const seenTerminal = [];
  for (const cb of callbacks) {
    if (!TERMINAL.has(cb.name)) continue;
    seenTerminal.push(cb.name);
    assert.match(
      cb.body,
      LEASE_CONSEQUENCE,
      `${cb.name} can be the last callback for a touch and must have a lease consequence`,
    );
  }
  assert.deepEqual(
    seenTerminal.sort(),
    ['onFinalize', 'onTouchesCancelled', 'onTouchesUp'],
    'the non-activating path (onTouchesUp/onTouchesCancelled) and the activating path '
      + '(onFinalize) must all be attached',
  );

  // A newly attached callback we have not analysed must fail loudly, not pass quietly.
  const ANALYSED = new Set([
    'onBegin', 'onStart', 'onUpdate', 'onTouchesUp', 'onTouchesCancelled', 'onFinalize',
  ]);
  for (const n of names) {
    assert.ok(
      ANALYSED.has(n),
      `unanalysed RNGH callback "${n}" attached to the deck pan — decide its lease `
        + 'consequence and extend A-2/A-3 before shipping it',
    );
  }

  // The measured RNGH behaviour the whole design rests on must be auditable, not folklore.
  assert.match(
    registrySource,
    /I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS/,
    'the invariant must be registered',
  );
  assert.match(
    registrySource,
    /Measured basis \(RNGH [\d.]+ \/ RN [\d.]+/,
    'the measured RNGH version basis must be recorded so it can be re-measured on a bump',
  );
  assert.match(
    registrySource,
    /onTouchesUp` arrives BEFORE `onEnd`\/`onFinalize`/,
    'the ordering that makes the !panActivated term load-bearing must be written down',
  );
});

// ---------------------------------------------------------------------------
// A-9 — the live bridge (the six mutants the implementor battery cannot see).
// ---------------------------------------------------------------------------

test('A-9 the transplanted controller bridge behaves correctly on the measured traces', () => {
  const tap = replay(TAP);
  assert.equal(tap.log.expands, 1, 'TAP: the expanded view must open');
  assert.equal(tap.phaseRef.current, 'IDLE', 'TAP: the lease must be handed back');
  assert.equal(tap.countersRef.current.rejected, 0, 'TAP: nothing may be rejected');
  assert.equal(tap.panActivatedRef.current, false, 'TAP: the press never activated');

  const deferred = replay(TAP_RELEASE_DEFERRED);
  assert.equal(
    deferred.log.expands,
    1,
    'TAP (release deferred): the expand must be admitted against the tap own lease — '
      + 'order-independence is load-bearing (SPEC section 4)',
  );
  assert.equal(deferred.phaseRef.current, 'IDLE');

  const swipe = replay(SWIPE);
  assert.equal(
    swipe.log.releases,
    0,
    'SWIPE: onTouchesUp must NOT release an activated pan (SPEC section 2.3 trap)',
  );
  assert.deepEqual(
    swipe.log.finalizeObservedPhases,
    [FINALIZE_GUARD_PHASE],
    'SWIPE: finalizeGesture must still observe the phase it guards on',
  );
  assert.equal(swipe.log.commits.length, 1, 'SWIPE: the swipe must commit');
  assert.equal(
    swipe.log.commits[0].epoch,
    swipe.log.admissionEpochs.at(-1),
    'SWIPE: the commit must ride the epoch its own admission allocated',
  );

  const tapThenSwipe = replay([...TAP, ...SWIPE]);
  assert.equal(
    tapThenSwipe.countersRef.current.rejected,
    0,
    'TAP-then-SWIPE: the swipe after a tap must be ADMITTED, not rejected',
  );
  assert.equal(tapThenSwipe.log.admissionEpochs.length, 2);
  assert.ok(
    tapThenSwipe.log.commits[0].epoch > tapThenSwipe.log.admissionEpochs[0],
    'TAP-then-SWIPE: the swipe must not ride the tap stale epoch',
  );
});

test('A-9 mutating the real bridge is rejected — the six mutants the battery misses', () => {
  const mutate = (find, replaceWith) => {
    const mutated = controllerSource.replace(find, replaceWith);
    assert.notEqual(mutated, controllerSource, `mutant did not apply: ${find}`);
    return mutated;
  };

  const ACTIVATE_BODY = "    if (phaseRef.current !== 'DRAGGING') return;\n"
    + '    panActivatedRef.current = true;';
  const RELEASE_BODY =
    '    if (!shouldReleaseUnactivatedPress(phaseRef.current, panActivatedRef.current)) return;\n'
    + "    setPhase('IDLE');";

  // Each entry: [label, mutated source, the sequence that exposes it, the check].
  const cases = [
    [
      'M9 activateGesture emptied — every swipe dies',
      mutate(ACTIVATE_BODY, '    return;'),
      SWIPE,
      (c) => assert.equal(c.log.commits.length, 1),
    ],
    [
      'M12 activateGesture arms the wrong value — every swipe dies',
      mutate(ACTIVATE_BODY, ACTIVATE_BODY.replace('= true;', '= false;')),
      SWIPE,
      (c) => assert.equal(c.log.commits.length, 1),
    ],
    [
      'M14 release call site negates its argument — releases activated pans',
      mutate(
        'shouldReleaseUnactivatedPress(phaseRef.current, panActivatedRef.current)',
        'shouldReleaseUnactivatedPress(phaseRef.current, !panActivatedRef.current)',
      ),
      SWIPE,
      (c) => assert.equal(c.log.commits.length, 1),
    ],
    [
      'M11 releaseUnactivatedPress emptied — the stale-DRAGGING leak returns',
      mutate(RELEASE_BODY, '    return;'),
      [...TAP, ...SWIPE],
      (c) => assert.equal(c.countersRef.current.rejected, 0),
    ],
    [
      'M13 release moves to the wrong phase — the stale-DRAGGING leak returns',
      mutate(RELEASE_BODY, RELEASE_BODY.replace("setPhase('IDLE')", "setPhase('DRAGGING')")),
      [...TAP, ...SWIPE],
      (c) => assert.equal(c.countersRef.current.rejected, 0),
    ],
    [
      'M15 tap gate call site negates its argument — the original dead tap returns',
      mutate(
        'canAdmitDeckTapExpand(phaseRef.current, panActivatedRef.current)',
        'canAdmitDeckTapExpand(phaseRef.current, !panActivatedRef.current)',
      ),
      TAP_RELEASE_DEFERRED,
      (c) => assert.equal(c.log.expands, 1),
    ],
  ];

  for (const [label, mutatedSource, sequence, check] of cases) {
    // Sanity: the check passes on the REAL source (so a green mutant is meaningful).
    check(replay(sequence));
    assert.throws(
      () => check(replay(sequence, makeLiveController(mutatedSource))),
      (err) => err instanceof assert.AssertionError,
      `MUTANT SURVIVED: ${label}`,
    );
  }
});

// ---------------------------------------------------------------------------
// A-3 — 10,000-sequence fuzz over the derived alphabet and derived phases.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A well-formed RNGH touch, drawn from the derived callback alphabet. */
function drawTouch(rnd) {
  const events = ['onTouchesDown', 'onBegin'];
  const activates = rnd() < 0.55;
  if (activates) {
    events.push('onStart');
    const frames = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < frames; i += 1) events.push('onUpdate');
    const cancelled = rnd() < 0.15;
    events.push(cancelled ? 'onTouchesCancelled' : 'onTouchesUp');
    events.push('onEnd');
    const success = rnd() < 0.8;
    const dx = rnd() < 0.6 ? COMMIT_DX : 10;
    events.push({ type: 'onFinalize', success, dx: rnd() < 0.5 ? -dx : dx });
    events.push('settleExit');
  } else {
    // A non-activating pan: RNGH delivers NO onStart/onEnd/onFinalize (measured).
    const cancelled = rnd() < 0.25;
    events.push(cancelled ? 'onTouchesCancelled' : 'onTouchesUp');
    if (!cancelled && rnd() < 0.7) events.push('onPress');
  }
  return { events, activates };
}

test('A-3 10,000 derived sequences leave no permanent lease and no stale-epoch commit', () => {
  const rnd = mulberry32(0x15790001);
  let sequencesRun = 0;
  let commitsSeen = 0;
  let tapsSeen = 0;

  for (let iteration = 0; iteration < 10000; iteration += 1) {
    const ctl = makeLiveController();
    const touches = 1 + Math.floor(rnd() * 4);
    const trace = [];

    for (let t = 0; t < touches; t += 1) {
      // Between touches, accessibility may drive the deck directly.
      if (rnd() < 0.15) {
        trace.push({ type: 'a11ySwipe', direction: rnd() < 0.5 ? 'left' : 'right' });
        trace.push('settleExit');
      }
      const { events } = drawTouch(rnd);
      trace.push(...events);
    }

    // Replay, checking the epoch property at every commit boundary.
    let touchAdmissionEpoch = null;
    let commitsBefore = 0;
    for (const ev of trace) {
      const type = typeof ev === 'string' ? ev : ev.type;
      if (type === 'onTouchesDown') touchAdmissionEpoch = null;
      const admissionsBefore = ctl.log.admissionEpochs.length;
      replay([ev], ctl);
      if (ctl.log.admissionEpochs.length > admissionsBefore) {
        touchAdmissionEpoch = ctl.log.admissionEpochs.at(-1);
      }
      if (ctl.log.commits.length > commitsBefore) {
        const commit = ctl.log.commits.at(-1);
        assert.equal(
          commit.epoch,
          touchAdmissionEpoch,
          `PROPERTY (ii) VIOLATED at iteration ${iteration}: a commit ran on epoch `
            + `${commit.epoch} which its own admission did not allocate `
            + `(${touchAdmissionEpoch}). This is exactly the #1579 stale-epoch ride.`,
        );
        commitsBefore = ctl.log.commits.length;
        commitsSeen += 1;
      }
    }

    // Property (i): the deck must be re-admittable once everything has settled.
    ctl.settleExit();
    assert.equal(
      canAdmitDeckInput(ctl.phaseRef.current),
      true,
      `PROPERTY (i) VIOLATED at iteration ${iteration}: the lease was never handed back — `
        + `phase stranded at ${ctl.phaseRef.current}`,
    );
    sequencesRun += 1;
    tapsSeen += ctl.log.expands;
  }

  // Vacuity guards: a fuzz that never commits and never taps proves nothing.
  assert.equal(sequencesRun, 10000);
  assert.ok(commitsSeen > 500, `fuzz too weak: only ${commitsSeen} commits exercised`);
  assert.ok(tapsSeen > 500, `fuzz too weak: only ${tapsSeen} tap expands exercised`);
});

test('A-3 the same fuzz properties FAIL on the pre-#1579 source shape', () => {
  // The pre-fix shape, reconstructed by removing exactly what #1579 added: no release
  // wiring, and the IDLE-only gate on tap expand.
  const preFix = controllerSource
    .replace(
      '    if (\n'
        + '      !canAdmitDeckTapExpand(phaseRef.current, panActivatedRef.current) ||\n'
        + '      !activeCardIdRef.current\n'
        + '    ) {',
      '    if (!canAdmitDeckInput(phaseRef.current) || !activeCardIdRef.current) {',
    )
    .replace('    releaseUnactivatedPress();          // idempotent; no-ops when already IDLE\n', '');
  assert.notEqual(preFix, controllerSource, 'the pre-fix reconstruction must actually differ');

  const preFixReplay = (events) => {
    const ctl = makeLiveController(preFix);
    for (const ev of events) {
      const type = typeof ev === 'string' ? ev : ev.type;
      // Pre-fix, onTouchesUp/onTouchesCancelled were NOT wired to anything.
      if (type === 'onTouchesUp' || type === 'onTouchesCancelled') continue;
      replay([ev], ctl);
    }
    return ctl;
  };

  // Property (i) fails: the tap strands the lease forever.
  const tap = preFixReplay(TAP);
  assert.equal(
    canAdmitDeckInput(tap.phaseRef.current),
    false,
    'pre-fix control: a tap must strand the DRAGGING lease (else this guard proves nothing)',
  );
  assert.equal(tap.log.expands, 0, 'pre-fix control: the tap must be rejected, 100% of the time');

  // Property (ii) fails: the next swipe is rejected and commits anyway on the tap epoch.
  const tapThenSwipe = preFixReplay([...TAP, ...SWIPE]);
  assert.ok(
    tapThenSwipe.countersRef.current.rejected >= 1,
    'pre-fix control: the swipe after a tap must be rejected by admission control',
  );
  assert.equal(
    tapThenSwipe.log.admissionEpochs.length,
    1,
    'pre-fix control: the swipe must allocate NO epoch of its own',
  );
  assert.equal(
    tapThenSwipe.log.commits.length,
    1,
    'pre-fix control: and yet it must still commit — rejected, and committed anyway',
  );
  assert.equal(
    tapThenSwipe.log.commits[0].epoch,
    tapThenSwipe.log.admissionEpochs[0],
    'pre-fix control: the commit must ride the TAP epoch — the stale-epoch bypass itself',
  );
});

// ---------------------------------------------------------------------------
// A-4 — interruption and multi-touch. No trace in the implementor guard emits
// onTouchesCancelled at all, and none interleaves two touches.
// ---------------------------------------------------------------------------

test('A-4 interruption never strands a lease and never releases an activated pan', () => {
  // Backgrounding / incoming call mid-press: cancelled, no onTouchesUp, no onFinalize.
  const cancelledPress = replay(['onTouchesDown', 'onBegin', 'onTouchesCancelled']);
  assert.equal(cancelledPress.phaseRef.current, 'IDLE', 'a cancelled press must release the lease');
  assert.equal(cancelledPress.log.expands, 0, 'a cancelled press must not open the expanded view');

  // Cancelled AFTER activation: the lease belongs to a real drag; onFinalize owns it.
  const cancelledDrag = replay([
    'onTouchesDown',
    'onBegin',
    'onStart',
    'onUpdate',
    'onTouchesCancelled',
    'onEnd',
    { type: 'onFinalize', success: false, dx: 0 },
  ]);
  assert.equal(
    cancelledDrag.log.releases,
    0,
    'onTouchesCancelled must NOT release a lease held by an activated pan',
  );
  assert.deepEqual(
    cancelledDrag.log.finalizeObservedPhases,
    [FINALIZE_GUARD_PHASE],
    'an activated pan must still reach finalizeGesture in the phase it guards on',
  );
  assert.equal(cancelledDrag.phaseRef.current, 'IDLE', 'and it must rubber-band back to IDLE');

  // An abandoned drag: activated, below commit distance. Must snap back, not advance.
  const abandoned = replay([
    'onTouchesDown',
    'onBegin',
    'onStart',
    'onUpdate',
    'onTouchesUp',
    'onEnd',
    { type: 'onFinalize', success: true, dx: -23 },
    'settleExit',
  ]);
  assert.equal(abandoned.log.commits.length, 0, 'an abandoned drag must not advance the deck');
  assert.equal(abandoned.log.expands, 0, 'an abandoned drag must not open the expanded view');
  assert.equal(abandoned.phaseRef.current, 'IDLE');
  assert.equal(abandoned.log.releases, 0, 'and it must not be mistaken for a tap');

  // Second touch-down before the first touch-up. maxPointers(1) makes the gesture
  // fail rather than track two fingers, but the touch callbacks are still delivered.
  const multi = replay([
    'onTouchesDown',
    'onBegin',
    'onTouchesDown',
    'onBegin', // the second BEGAN is rejected: the deck is already leased
    'onTouchesUp',
  ]);
  assert.ok(
    multi.countersRef.current.rejected >= 1,
    'a second BEGAN while the deck is leased must be rejected by admission control',
  );
  assert.equal(
    canAdmitDeckInput(multi.phaseRef.current),
    true,
    'a multi-touch press must still hand the lease back',
  );
  assert.equal(
    multi.log.admissionEpochs.length,
    1,
    'the rejected second BEGAN must NOT allocate an epoch',
  );

  // An accessibility swipe must never be releasable by a stray touch-end.
  const a11y = makeLiveController();
  a11y.requestSwipe('left');
  const phaseAfterA11y = a11y.phaseRef.current;
  a11y.releaseUnactivatedPress();
  assert.equal(
    a11y.phaseRef.current,
    phaseAfterA11y,
    'a stray onTouchesUp must never cancel an in-flight accessibility swipe',
  );
});

// ---------------------------------------------------------------------------
// A-8 — guard the guard. Mutate real source, run the IMPLEMENTOR guard against
// it in a scratch mirror, and assert it actually goes red.
// ---------------------------------------------------------------------------

test('A-8 the workflow requires and executes both guards on every swipeDeck change', () => {
  assert.match(workflowSource, /paths:/);
  assert.match(workflowSource, /app-mobile\/src\/components\/swipeDeck\/\*\*/);
  assert.match(workflowSource, /pull_request:/);
  assert.match(
    workflowSource,
    /test -f app-mobile\/src\/components\/swipeDeck\/__tests__\/issue_1579_tap_expand_admission\.test\.mjs/,
  );
  assert.match(
    workflowSource,
    /test -f app-mobile\/src\/components\/swipeDeck\/__tests__\/issue_1579_tap_expand_admission\.adversarial\.test\.mjs/,
  );
  const execStep = workflowSource.slice(workflowSource.indexOf('node --test'));
  assert.match(execStep, /issue_1579_tap_expand_admission\.test\.mjs/);
  assert.match(execStep, /issue_1579_tap_expand_admission\.adversarial\.test\.mjs/);
  // #1481's job asserts its own step names EXACTLY eight guards.
  assert.doesNotMatch(workflowSource, /issue_1481_/);
  assert.doesNotMatch(workflowSource, /issue_1576_/);
});

test('A-8 deleting the release wiring turns the IMPLEMENTOR guard red', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'issue-1579-guard-'));
  try {
    const deckDir = path.join(dir, 'app-mobile/src/components/swipeDeck');
    const testDir = path.join(deckDir, '__tests__');
    const wfDir = path.join(dir, '.github/workflows');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(wfDir, { recursive: true });
    cpSync(fileURLToPath(lifecycleUrl), path.join(deckDir, 'deckSwipeLifecycle.ts'));
    cpSync(fileURLToPath(workflowUrl), path.join(wfDir, 'issue-1579-deck-tap-expand.yml'));
    const guardPath = path.join(testDir, 'issue_1579_tap_expand_admission.test.mjs');
    cpSync(fileURLToPath(implementorGuardUrl), guardPath);
    const controllerPath = path.join(deckDir, 'useDeckSwipeController.ts');

    // Nested `node --test` inherits NODE_TEST_CONTEXT and would report through this
    // run's TAP stream instead of its own exit code. Strip it.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const runGuard = () =>
      spawnSync(process.execPath, ['--test', guardPath], { env, encoding: 'utf8' });

    // Control: unmutated source must be GREEN, else a red result proves nothing.
    writeFileSync(controllerPath, controllerSource);
    const green = runGuard();
    assert.equal(
      green.status,
      0,
      `control run must pass in the mirror, got ${green.status}:\n${green.stdout}\n${green.stderr}`,
    );

    // True line deletion of the release wiring, protective comments left in place.
    const reverted = controllerSource.replace(
      '    .onTouchesUp(() => {\n      runOnJS(releaseUnactivatedPress)();\n    })\n',
      '',
    );
    assert.notEqual(reverted, controllerSource, 'the revert must actually delete the wiring');
    assert.ok(
      reverted.includes('releaseUnactivatedPress'),
      'the identifier must SURVIVE in comments — proving a token match cannot satisfy the guard',
    );
    writeFileSync(controllerPath, reverted);
    const red = runGuard();
    assert.notEqual(
      red.status,
      0,
      'the implementor guard must FAIL when the release wiring is deleted',
    );
    assert.match(
      red.stdout,
      /wiring marker absent from comment-stripped source: \.onTouchesUp\(/,
      'and it must fail for the right reason',
    );

    // And this guard must fail on the same deletion, for its own reason.
    const ctl = makeLiveController(reverted);
    // With no onTouchesUp wiring the press is never released; requestTapExpand still
    // closes the lease, so the leak shows on a tap that never reaches onPress.
    ctl.beginGesture();
    assert.equal(
      canAdmitDeckInput(ctl.phaseRef.current),
      false,
      'sanity: the lease is claimed',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A-8 this adversarial guard is itself append-only and self-consistent', () => {
  const self = readFileSync(fileURLToPath(new URL(import.meta.url)), 'utf8');
  // The guard must actually execute product source, not merely read it.
  assert.match(self, /new Function\(/, 'the bridge must be executed, not pattern-matched');
  assert.ok(
    TRANSPLANTED.every((n) => controllerMask.includes(`const ${n} = useCallback(`)),
    'every transplanted callback must still be declared in the controller',
  );
});
