import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canAdmitDeckInput,
  consumeDeckTokenIntent,
  deckCommitTokenKey,
  isCurrentDeckCompletion,
  nextDeckGestureEpoch,
} from '../deckSwipeLifecycle.ts';
import {
  DECK_HERO_MAX_LONG_EDGE_PX,
  DECK_VISIBLE_POSTER_CACHE_POLICY,
  getDeckHeroDecodeTarget,
} from '../deckHeroPolicy.ts';

const swipeableUrl = new URL('../../SwipeableCards.tsx', import.meta.url);
const controllerUrl = new URL('../useDeckSwipeController.ts', import.meta.url);
const stageUrl = new URL('../DeckSwipeStage.tsx', import.meta.url);
const workflowUrl = new URL('../../../../../.github/workflows/issue-1481-explorer-deck-tests.yml', import.meta.url);

const [swipeableSource, controllerSource, stageSource, workflowSource] = await Promise.all([
  readFile(swipeableUrl, 'utf8'),
  readFile(controllerUrl, 'utf8'),
  readFile(stageUrl, 'utf8'),
  readFile(workflowUrl, 'utf8'),
]);

const FORBIDDEN_CONTROLLER_PATTERNS = [
  'PanResponder',
  'react-native-reanimated',
  'react-native-worklets',
  'GestureDetector',
  'Gesture.Pan',
  'useSharedValue',
  'runOnJS',
  'flattenOffset',
  'extractOffset',
  'setOffset',
  '._value',
  'Animated.spring',
];

function assertSingleOwnerSource(swipeable, controller, stage) {
  assert.doesNotMatch(swipeable, /useDeckSwipeController\(/);
  assert.match(stage, /useDeckSwipeController\(props\)/);
  assert.match(stage, /export const DeckSwipeStage = memo\(forwardRef/);
  assert.match(swipeable, /<PanGestureHandler/);
  assert.match(controller, /Animated\.event<[\s\S]*translationX: positionX[\s\S]*useNativeDriver: true/);
  assert.match(controller, /onHandlerStateChange/);
  for (const pattern of FORBIDDEN_CONTROLLER_PATTERNS) {
    assert.equal(swipeable.includes(pattern), false, `SwipeableCards contains forbidden ${pattern}`);
    assert.equal(controller.includes(pattern), false, `controller contains forbidden ${pattern}`);
    assert.equal(stage.includes(pattern), false, `stage contains forbidden ${pattern}`);
  }
}

test('nominal lifecycle admits only IDLE and accepts only current finished completion', () => {
  assert.equal(canAdmitDeckInput('IDLE'), true);
  for (const phase of ['DRAGGING', 'SNAPPING', 'EXITING', 'COMMITTING']) {
    assert.equal(canAdmitDeckInput(phase), false);
  }
  const base = {
    finished: true,
    mounted: true,
    phase: 'EXITING',
    expectedEpoch: 8,
    currentEpoch: 8,
    expectedCardId: 'card-a',
    currentCardId: 'card-a',
  };
  assert.equal(isCurrentDeckCompletion(base), true);
  assert.equal(isCurrentDeckCompletion({ ...base, finished: false }), false);
  assert.equal(isCurrentDeckCompletion({ ...base, currentEpoch: 9 }), false);
  assert.equal(isCurrentDeckCompletion({ ...base, currentCardId: 'card-b' }), false);
  assert.equal(isCurrentDeckCompletion({ ...base, phase: 'COMMITTING' }), false);
});

test('commit identity is stable and direction-specific', () => {
  const right = deckCommitTokenKey({ cardId: 'card-a', direction: 'right', epoch: 5 });
  assert.equal(right, '5:card-a:right');
  assert.notEqual(right, deckCommitTokenKey({ cardId: 'card-a', direction: 'left', epoch: 5 }));
});

test('same-card same-direction rollback retry gets a fresh identity and old replay stays inert', () => {
  const firstEpoch = nextDeckGestureEpoch(4);
  const retryEpoch = nextDeckGestureEpoch(firstEpoch);
  const first = { cardId: 'card-a', direction: 'right', epoch: firstEpoch };
  const retry = { cardId: 'card-a', direction: 'right', epoch: retryEpoch };

  assert.equal(firstEpoch, 5);
  assert.equal(retryEpoch, 6);
  assert.notEqual(deckCommitTokenKey(first), deckCommitTokenKey(retry));
  assert.equal(isCurrentDeckCompletion({
    finished: true,
    mounted: true,
    phase: 'EXITING',
    expectedEpoch: first.epoch,
    currentEpoch: retry.epoch,
    expectedCardId: first.cardId,
    currentCardId: retry.cardId,
  }), false, 'replayed completion from the rolled-back attempt is stale');
  assert.equal(isCurrentDeckCompletion({
    finished: true,
    mounted: true,
    phase: 'EXITING',
    expectedEpoch: retry.epoch,
    currentEpoch: retry.epoch,
    expectedCardId: retry.cardId,
    currentCardId: retry.cardId,
  }), true, 'new admitted retry remains valid');
});

test('paywall intent is exact-token, one-shot, and inert after cancellation', () => {
  const paywall = { cardId: 'curated-a', direction: 'right', epoch: 12 };
  const unrelated = { cardId: 'place-b', direction: 'left', epoch: 13 };

  // A canceled snap/invalidation clears the pending intent. A later unrelated
  // centered rejection therefore cannot open the old paywall.
  let pending = paywall;
  pending = null;
  const afterCancel = consumeDeckTokenIntent(pending, unrelated);
  assert.equal(afterCancel.shouldRun, false);
  assert.equal(afterCancel.pending, null);

  // The exact successful snap consumes once; replay cannot run it twice.
  const exact = consumeDeckTokenIntent(paywall, paywall);
  assert.equal(exact.shouldRun, true);
  assert.equal(exact.pending, null);
  const replay = consumeDeckTokenIntent(exact.pending, paywall);
  assert.equal(replay.shouldRun, false);
});

test('production deck has one native-driver owner and no forbidden competing primitive', () => {
  assertSingleOwnerSource(swipeableSource, controllerSource, stageSource);
  assert.match(controllerSource, /DECK_EXIT_MS = 200/);
  assert.match(controllerSource, /DECK_SNAP_MS = 240/);
  assert.match(controllerSource, /Easing\.bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(controllerSource, /isCurrentDeckCompletion\(\{\s*finished,/);
  assert.match(controllerSource, /setPhase\('COMMITTING'\)[\s\S]*onCommitRequested/);
  assert.equal(
    (controllerSource.match(/epochRef\.current = nextDeckGestureEpoch\(epochRef\.current\)/g) ?? []).length,
    2,
    'native Pan and accessibility swipe admission must each allocate a generation',
  );
  assert.match(controllerSource, /lastRequestedCommitKeyRef = useRef<string \| null>\(null\)/);
  assert.doesNotMatch(controllerSource, /requestedCommitKeysRef|new Set<string>\(\)/);
  assert.match(swipeableSource, /lastCommittedTokenKeyRef = useRef<string \| null>\(null\)/);
  assert.doesNotMatch(swipeableSource, /committedTokenKeysRef/);
  assert.match(controllerSource, /onSwipeRejectedCentered\(token\)/);
  assert.ok(
    (controllerSource.match(/onInvalidated\(/g) ?? []).length >= 3,
    'watchdog/invalidate/unmount must all clear deferred intents',
  );
});

test('single-owner source guard detects the reverted competing responder', () => {
  assert.throws(
    () => assertSingleOwnerSource(`${swipeableSource}\nPanResponder.create({})`, controllerSource, stageSource),
    /forbidden PanResponder/,
  );
});

test('hero policy caps physical decode while preserving rendered aspect', () => {
  const portrait = getDeckHeroDecodeTarget(360, 640, 3);
  assert.equal(Math.max(portrait.width, portrait.height), DECK_HERO_MAX_LONG_EDGE_PX);
  assert.ok(Math.abs(portrait.width / portrait.height - 360 / 640) < 0.002);
  const small = getDeckHeroDecodeTarget(200, 100, 2);
  assert.deepEqual(small, { width: 400, height: 200 });
  assert.equal(DECK_VISIBLE_POSTER_CACHE_POLICY, 'disk');
});

test('behind layer is the sole bounded lookahead with zero explicit prefetch', () => {
  const preview = swipeableSource.slice(
    swipeableSource.indexOf('Next card is a poster-only'),
    swipeableSource.indexOf('{/* Current Card */}'),
  );
  assert.match(preview, /<CardHeroImage/);
  assert.match(preview, /pointerEvents="none"/);
  assert.match(preview, /accessibilityElementsHidden/);
  assert.doesNotMatch(preview, /<CardHero\b|EventCoverMedia|TouchableOpacity/);
  assert.equal((swipeableSource.match(/ExpoImage\.prefetch\(/g) ?? []).length, 0);
  assert.equal((swipeableSource.match(/ExpoImage\.loadAsync\(/g) ?? []).length, 0);
  assert.doesNotMatch(swipeableSource, /deckPrefetchIndex|DECK_PREFETCH_CACHE_POLICY/);
  assert.match(swipeableSource, /const CardHeroImage = React\.memo/);
  assert.match(
    swipeableSource,
    /const source = React\.useMemo\([\s\S]*uri: src, width: decodeTarget\.width, height: decodeTarget\.height/,
  );
  assert.match(swipeableSource, /<ExpoImage[\s\S]*source=\{source\}/);
});

test('immutable commit work is queued before explicit successor or terminal settlement', () => {
  const commit = swipeableSource.slice(
    swipeableSource.indexOf('onCommitRequested: (token:'),
    swipeableSource.indexOf('onCommitSettled:', swipeableSource.indexOf('onCommitRequested: (token:')),
  );
  const persistAt = commit.indexOf('enqueuePersistenceSnapshot');
  const workAt = commit.indexOf('enqueuePostSwipeWork');
  const settlementAt = commit.indexOf('return nextCardId ? { nextCardId } : { exhausted: true }');
  assert.ok(persistAt >= 0 && workAt > persistAt && settlementAt > workAt);
  assert.doesNotMatch(swipeableSource, /acknowledgeActiveCard|pendingCommitRef/);
  assert.match(controllerSource, /activeCardIdRef\.current = 'nextCardId' in settlement/);
  assert.match(swipeableSource, /persistenceDrainRef/);
  assert.match(swipeableSource, /pendingPersistenceRef\.current = \{/);
  assert.match(swipeableSource, /InteractionManager\.runAfterInteractions/);
  assert.match(swipeableSource, /}, 250\);/);
  const validationBoundary = swipeableSource.slice(
    swipeableSource.indexOf('onSwipeValidated: (token:'),
    swipeableSource.indexOf('onSwipeRejectedCentered:', swipeableSource.indexOf('onSwipeValidated: (token:')),
  );
  const epochCheckAt = validationBoundary.indexOf('token.epoch <= latestValidatedSwipeEpochRef.current');
  const accessCheckAt = validationBoundary.indexOf("!canAccessRef.current('curated_cards')");
  const rememberAt = validationBoundary.indexOf('latestValidatedSwipeEpochRef.current = token.epoch');
  const hapticAt = validationBoundary.indexOf('HapticFeedback.cardLike()');
  const acceptAt = validationBoundary.lastIndexOf('return true');
  assert.ok(
    epochCheckAt >= 0 && accessCheckAt > epochCheckAt && rememberAt > accessCheckAt &&
      hapticAt > rememberAt && acceptAt > hapticAt,
    'Save/Pass haptic follows card/access/epoch validation and immediately precedes exit admission',
  );
  assert.match(validationBoundary, /HapticFeedback\.medium\(\)[\s\S]*return false/);

  const rejectedBoundary = swipeableSource.slice(
    swipeableSource.indexOf('onSwipeRejectedCentered: (token:'),
    swipeableSource.indexOf('onCommitRequested:', swipeableSource.indexOf('onSwipeRejectedCentered: (token:')),
  );
  assert.match(rejectedBoundary, /consumeDeckTokenIntent\(pendingPaywallRef\.current, token\)/);
  assert.ok(
    rejectedBoundary.indexOf('pendingPaywallRef.current = intent.pending') <
      rejectedBoundary.indexOf('if (!intent.shouldRun) return'),
    'paywall intent must be cleared before its exact one-shot action runs',
  );
  assert.match(swipeableSource, /onInvalidated: \(\): void => \{\s*pendingPaywallRef\.current = null/);
  assert.match(
    swipeableSource,
    /pendingPaywallRef\.current = null;\s*\}, \[activeDeckContextKey, currentMode, refreshKey, user\?\.id\]\);/,
  );

  const controllerExit = controllerSource.slice(
    controllerSource.indexOf('const beginExit ='),
    controllerSource.indexOf('const onGestureEvent ='),
  );
  assert.ok(
    controllerExit.indexOf('onSwipeValidated(token)') <
      controllerExit.indexOf("setPhase('EXITING')"),
  );

  const commitBoundary = swipeableSource.slice(
    swipeableSource.indexOf('onCommitRequested: (token:'),
    swipeableSource.indexOf('onExpandValidated:', swipeableSource.indexOf('onCommitRequested: (token:')),
  );
  assert.doesNotMatch(commitBoundary, /HapticFeedback\.(cardLike|cardDislike|medium)/);
  assert.match(commitBoundary, /token\.epoch !== latestValidatedSwipeEpochRef\.current/);

  const accessibilityBoundary = swipeableSource.slice(
    swipeableSource.indexOf('onAccessibilityAction={(event)'),
    swipeableSource.indexOf('onLayout={() =>', swipeableSource.indexOf('onAccessibilityAction={(event)')),
  );
  assert.match(accessibilityBoundary, /requestTapExpand\(\)/);
  assert.doesNotMatch(accessibilityBoundary, /HapticFeedback\.medium/);
  const expandValidation = swipeableSource.slice(
    swipeableSource.indexOf('onExpandValidated:'),
    swipeableSource.indexOf('onExpandRequested:', swipeableSource.indexOf('onExpandValidated:')),
  );
  assert.match(expandValidation, /HapticFeedback\.medium\(\)/);
});

test('issue workflow requires both exact append-only guards on Node 22', () => {
  assert.match(workflowSource, /node-version: ['"]22['"]/);
  assert.match(workflowSource, /issue_1481_swipe_lifecycle\.test\.mjs/);
  assert.match(workflowSource, /issue_1481_swipe_lifecycle\.adversarial\.test\.mjs/);
  assert.match(workflowSource, /test -f/);
  assert.match(workflowSource, /node --test/);
});
