import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canAdmitDeckInput,
  deckCommitTokenKey,
  isCurrentDeckCompletion,
  nextDeckGestureEpoch,
} from '../deckSwipeLifecycle.ts';
import {
  DECK_HERO_MAX_LONG_EDGE_PX,
  DECK_PREFETCH_CACHE_POLICY,
  DECK_VISIBLE_POSTER_CACHE_POLICY,
  deckPrefetchIndex,
  getDeckHeroDecodeTarget,
} from '../deckHeroPolicy.ts';

const swipeableUrl = new URL('../../SwipeableCards.tsx', import.meta.url);
const controllerUrl = new URL('../useDeckSwipeController.ts', import.meta.url);
const workflowUrl = new URL('../../../../../.github/workflows/issue-1481-explorer-deck-tests.yml', import.meta.url);

const [swipeableSource, controllerSource, workflowSource] = await Promise.all([
  readFile(swipeableUrl, 'utf8'),
  readFile(controllerUrl, 'utf8'),
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

function assertSingleOwnerSource(swipeable, controller) {
  assert.match(swipeable, /useDeckSwipeController\(\{/);
  assert.match(swipeable, /<PanGestureHandler/);
  assert.match(controller, /Animated\.event<[\s\S]*translationX: positionX[\s\S]*useNativeDriver: true/);
  assert.match(controller, /onHandlerStateChange/);
  for (const pattern of FORBIDDEN_CONTROLLER_PATTERNS) {
    assert.equal(swipeable.includes(pattern), false, `SwipeableCards contains forbidden ${pattern}`);
    assert.equal(controller.includes(pattern), false, `controller contains forbidden ${pattern}`);
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

test('production deck has one native-driver owner and no forbidden competing primitive', () => {
  assertSingleOwnerSource(swipeableSource, controllerSource);
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
});

test('single-owner source guard detects the reverted competing responder', () => {
  assert.throws(
    () => assertSingleOwnerSource(`${swipeableSource}\nPanResponder.create({})`, controllerSource),
    /forbidden PanResponder/,
  );
});

test('hero policy caps physical decode while preserving rendered aspect', () => {
  const portrait = getDeckHeroDecodeTarget(360, 640, 3);
  assert.equal(Math.max(portrait.width, portrait.height), DECK_HERO_MAX_LONG_EDGE_PX);
  assert.ok(Math.abs(portrait.width / portrait.height - 360 / 640) < 0.002);
  const small = getDeckHeroDecodeTarget(200, 100, 2);
  assert.deepEqual(small, { width: 400, height: 200 });
  assert.equal(DECK_VISIBLE_POSTER_CACHE_POLICY, 'memory-disk');
  assert.equal(DECK_PREFETCH_CACHE_POLICY, 'disk');
  assert.equal(deckPrefetchIndex(0), 2);
});

test('behind layer is poster-only and +2 is the sole explicit prefetch', () => {
  const preview = swipeableSource.slice(
    swipeableSource.indexOf('Next card is a poster-only'),
    swipeableSource.indexOf('{/* Current Card */}'),
  );
  assert.match(preview, /<CardHeroImage/);
  assert.match(preview, /pointerEvents="none"/);
  assert.match(preview, /accessibilityElementsHidden/);
  assert.doesNotMatch(preview, /<CardHero\b|EventCoverMedia|TouchableOpacity/);
  const prefetchCalls = swipeableSource.match(/ExpoImage\.prefetch\(/g) ?? [];
  assert.equal(prefetchCalls.length, 1);
  assert.match(swipeableSource, /availableRecommendations\[deckPrefetchIndex\(0\)\]/);
  assert.match(swipeableSource, /cachePolicy: DECK_PREFETCH_CACHE_POLICY/);
});

test('commit acknowledgement precedes persistence and deferred business work', () => {
  const acknowledgement = swipeableSource.slice(
    swipeableSource.indexOf('const pending = pendingCommitRef.current'),
    swipeableSource.indexOf('useEffect(() => {', swipeableSource.indexOf('const pending = pendingCommitRef.current') + 20),
  );
  const acknowledgeAt = acknowledgement.indexOf('acknowledgeActiveCard');
  const persistAt = acknowledgement.indexOf('enqueuePersistenceSnapshot');
  const workAt = acknowledgement.indexOf('enqueuePostSwipeWork');
  assert.ok(acknowledgeAt >= 0 && persistAt > acknowledgeAt && workAt > persistAt);
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
