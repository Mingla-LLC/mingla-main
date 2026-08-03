import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = Object.fromEntries(await Promise.all(Object.entries({
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  controller: new URL('../useDeckSwipeController.ts', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  history: new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url),
}).map(async ([key, url]) => [key, await readFile(url, 'utf8')])));

function assertModernNativeAdmission(sources) {
  const handler = sources.swipeable.slice(
    sources.swipeable.indexOf('<GestureDetector'),
    sources.swipeable.indexOf('</GestureDetector>') + '</GestureDetector>'.length,
  );
  assert.match(handler, /key=\{currentRec\.id\}/, 'promoted card reuses the completed UI-thread recognizer');
  assert.doesNotMatch(handler, /enabled=\{deckSwipe\.handlerEnabled\}/, 'phase toggles native handler eligibility');
  assert.doesNotMatch(handler, /pointerEvents=\{deckSwipe\.phase/, 'phase toggles the gesture host pointer target');
  assert.doesNotMatch(handler, /deckSwipe\.phase/, 'rendered phase decisions reconcile the native handler subtree');
  assert.match(handler, /<GestureDetector key=\{currentRec\.id\} gesture=\{deckSwipe\.gesture\}>/);
  assert.doesNotMatch(sources.controller, /setRenderedPhase/, 'gesture phase is mirrored into React state');
  assert.match(sources.controller, /from 'react-native-reanimated'/);
  assert.match(sources.controller, /useSharedValue\(0\)/);
  assert.match(sources.controller, /Gesture\.Pan\(\)[\s\S]*\.onBegin[\s\S]*runOnJS\(beginGesture\)[\s\S]*\.onUpdate[\s\S]*positionX\.value = event\.translationX[\s\S]*\.onFinalize[\s\S]*runOnJS\(finalizeGesture\)/);
  assert.doesNotMatch(sources.controller, /\.runOnJS\(true\)|positionX\.setValue|positionY\.setValue/);
  assert.doesNotMatch(sources.controller, /Animated\.event|PanGestureHandlerStateChangeEvent/);
  assert.match(sources.controller, /const isIdle = useCallback\(\(\): boolean => phaseRef\.current === 'IDLE'/);
  assert.match(sources.swipeable, /pendingAccessibilityFocusRef\.current \|\| !deckSwipe\.isIdle\(\)/);
  assert.match(sources.controller, /if \(!canAdmitDeckInput\(phaseRef\.current\)/);
  assert.match(
    sources.controller,
    /phaseRef\.current === 'EXITING' && !fastForwardPendingExit\(\)/,
    'a delivered successor BEGAN is recovered through exact pending-exit settlement',
  );
  assert.match(
    sources.controller,
    /setPhase\('COMMITTING'\);[\s\S]{0,260}cancelAnimation\(positionX\);[\s\S]{0,260}settleCommit\(token, true\)/,
    'the stopped native callback must be stale before the shared commit path runs',
  );
  assert.equal(
    (sources.controller.match(/onCommitRequested\(token\)/g) ?? []).length,
    1,
    'fast-forward and natural completion must not fork business settlement',
  );
  assert.doesNotMatch(
    sources.controller,
    /pendingSettlementRef|layoutFallbackRef|synchronizeActiveCardLayout/,
    'successor admission still waits on layout or timer settlement',
  );
  const completion = sources.controller.slice(
    sources.controller.indexOf("setPhase('COMMITTING')"),
    sources.controller.indexOf('const onGestureEvent'),
  );
  assert.match(
    completion,
    /activeCardIdRef\.current =[\s\S]*clearTransitionTimers\(\);[\s\S]*resetPresentation\(\);[\s\S]*setPhase\('IDLE'\);[\s\S]*onCommitSettled/,
  );
  assert.doesNotMatch(sources.stage, /useLayoutEffect|synchronizeActiveCardLayout/);
  assert.doesNotMatch(
    sources.swipeable,
    /phase === 'IDLE'[\s\S]{0,160}void drainPersistence\(\)/,
    'IDLE directly starts local persistence instead of waiting for quiet',
  );
  assert.match(sources.swipeable, /DECK_PERSISTENCE_QUIET_IDLE_MS = 750/);
  assert.match(sources.swipeable, /DECK_POST_SWIPE_QUIET_IDLE_MS = 750/);
  assert.match(
    sources.swipeable,
    /const scheduleQuietPostSwipeDrain[\s\S]*localDeckInteractionPhaseRef\.current !== 'IDLE'[\s\S]*DECK_POST_SWIPE_QUIET_IDLE_MS - quietForMs/,
  );
  assert.match(
    sources.swipeable,
    /await new Promise<void>\(\(resolve\) => setTimeout\(resolve, 0\)\);[\s\S]{0,160}localDeckInteractionPhaseRef\.current !== 'IDLE'/,
    'a completed deck monopolizes the JS event loop across deferred FIFO items',
  );
  assert.match(
    sources.swipeable,
    /if \('exhausted' in settlement\) \{[\s\S]{0,100}scheduleQuietPostSwipeDrain\(\)/,
    'terminal settlement force-drains the entire business queue',
  );
  assert.doesNotMatch(
    sources.swipeable,
    /if \('exhausted' in settlement\) \{[\s\S]{0,100}drainPostSwipeQueue\(true\)/,
  );
  const postSwipeScheduler = sources.swipeable.slice(
    sources.swipeable.indexOf('const enqueuePostSwipeWork'),
    sources.swipeable.indexOf('const drainPersistence'),
  );
  assert.doesNotMatch(postSwipeScheduler, /}, 250\)/, 'post-swipe work has an active-cadence fallback');
  assert.doesNotMatch(
    postSwipeScheduler,
    /InteractionManager\.runAfterInteractions/,
    'enqueue starts post-swipe work before the quiet-idle scheduler',
  );
  assert.match(
    sources.swipeable,
    /while \(postSwipeQueueRef\.current\.length > 0\) \{\s*if \(!force && !isQuietIdle\(\)\) break;/,
    'a normal drain must pause between FIFO items when a new gesture starts',
  );
  assert.match(sources.history, /DECK_SESSION_HISTORY_QUIET_IDLE_MS = 750/);
}

class NativeCadenceModel {
  phase = 'IDLE';
  activeCard = 0;
  admissions = 0;
  commits = 0;
  rejected = 0;
  history = [];
  business = [];
  handlerMounts = 1;
  normalWrites = 0;
  checkpointPending = false;
  postSwipePending = [];
  postSwipeDrained = [];
  lastActivityAt = 0;
  settleDurations = [];

  begin(at) {
    this.lastActivityAt = at;
    if (this.phase !== 'IDLE') {
      this.rejected += 1;
      return false;
    }
    this.phase = 'DRAGGING';
    this.admissions += 1;
    return true;
  }

  commit(releaseAt, renderDelayMs, persistenceDelayMs) {
    this.phase = 'EXITING';
    const settledAt = releaseAt + 200;
    this.phase = 'COMMITTING';
    const id = `card-${this.activeCard}`;
    this.history.push(id);
    this.business.push(id);
    this.postSwipePending.push(id);
    this.commits += 1;
    this.activeCard += 1;
    this.handlerMounts += 1;
    this.phase = 'IDLE';
    this.lastActivityAt = settledAt;
    this.settleDurations.push(settledAt - releaseAt);
    // Rendering and non-critical persistence may finish later, but neither owns admission.
    void renderDelayMs;
    void persistenceDelayMs;
    return settledAt;
  }

  requestCheckpoint() {
    this.checkpointPending = true;
  }

  maybeDrain(at) {
    if (this.checkpointPending && this.phase === 'IDLE' && at - this.lastActivityAt >= 750) {
      this.normalWrites += 1;
      this.checkpointPending = false;
    }
    if (this.phase === 'IDLE' && at - this.lastActivityAt >= 750) {
      this.postSwipeDrained.push(...this.postSwipePending);
      this.postSwipePending = [];
    }
  }
}

function runContinuousLeg(seed) {
  const model = new NativeCadenceModel();
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let startAt = 0;
  let nextCheckpointAt = 5_000;
  for (let index = 0; index < 60; index += 1) {
    while (nextCheckpointAt <= startAt) {
      model.requestCheckpoint();
      nextCheckpointAt += 5_000;
    }
    model.maybeDrain(startAt);
    assert.equal(model.begin(startAt), true, `seed=${seed} command=${index} was not admitted`);
    const releaseAt = startAt + 220;
    model.commit(releaseAt, Math.floor(random() * 151), Math.floor(random() * 151));
    const interval = 520 + Math.floor(random() * 181);
    model.maybeDrain(startAt + interval);
    startAt += interval;
  }
  return model;
}

test('production gives every promoted card a fresh UI-thread native recognizer', () => {
  assertModernNativeAdmission(source);
});

test('60 jittered release-cadence commands admit and commit exactly with zero active writes', () => {
  for (let seed = 1; seed <= 64; seed += 1) {
    const model = runContinuousLeg(seed);
    assert.equal(model.handlerMounts, 61);
    assert.equal(model.admissions, 60);
    assert.equal(model.commits, 60);
    assert.equal(model.rejected, 0);
    assert.equal(model.history.length, 60);
    assert.equal(model.business.length, 60);
    assert.equal(model.normalWrites, 0);
    assert.equal(model.postSwipeDrained.length, 0);
    assert.equal(model.postSwipePending.length, 60);
    model.maybeDrain(model.lastActivityAt + 750);
    assert.deepEqual(model.postSwipeDrained, model.business);
    assert.ok(Math.max(...model.settleDurations) <= 250);
  }
});

test('80-120ms true overlap reaches phaseRef and rejects without mutation', () => {
  for (const overlapMs of [80, 100, 120]) {
    const model = new NativeCadenceModel();
    assert.equal(model.begin(0), true);
    assert.equal(model.begin(overlapMs), false);
    assert.equal(model.admissions, 1);
    assert.equal(model.rejected, 1);
    assert.equal(model.commits, 0);
    assert.deepEqual(model.history, []);
    assert.deepEqual(model.business, []);
    model.commit(220, 150, 150);
    assert.equal(model.commits, 1);
  }
});

test('60 delivered successor gestures fast-forward pending exits without loss or replay', () => {
  const cards = Array.from({ length: 61 }, (_, index) => `card-${index}`);
  let phase = 'IDLE';
  let activeIndex = 0;
  let epoch = 0;
  let pending = null;
  const admitted = [];
  const committed = [];

  const settlePending = () => {
    assert.equal(phase, 'EXITING');
    assert.ok(pending);
    assert.equal(pending.epoch, epoch);
    assert.equal(pending.cardId, cards[activeIndex]);
    phase = 'COMMITTING';
    committed.push(`${pending.epoch}:${pending.cardId}`);
    activeIndex += 1;
    pending = null;
    phase = 'IDLE';
  };

  for (let index = 0; index < 60; index += 1) {
    if (phase === 'EXITING') settlePending();
    assert.equal(phase, 'IDLE');
    epoch += 1;
    phase = 'DRAGGING';
    admitted.push(`${epoch}:${cards[activeIndex]}`);
    pending = { epoch, cardId: cards[activeIndex] };
    phase = 'EXITING';
  }
  settlePending();

  assert.equal(admitted.length, 60);
  assert.equal(committed.length, 60);
  assert.equal(new Set(admitted).size, 60);
  assert.deepEqual(committed, admitted);
  assert.equal(activeIndex, 60);
  assert.equal(phase, 'IDLE');
});

test('source guard rejects every superseded native availability root independently', () => {
  const handlerMutant = source.swipeable.replace(' key={currentRec.id}', '');
  assert.throws(() => assertModernNativeAdmission({ ...source, swipeable: handlerMutant }), /reuses/);

  const enabledMutant = source.swipeable.replace(
    '<GestureDetector key={currentRec.id} gesture={deckSwipe.gesture}>',
    '<GestureDetector key={currentRec.id} enabled={deckSwipe.handlerEnabled} gesture={deckSwipe.gesture}>',
  );
  assert.throws(() => assertModernNativeAdmission({ ...source, swipeable: enabledMutant }), /eligibility/);

  const renderedPhaseMutant = source.controller.replace(
    "const phaseRef = useRef<DeckSwipePhase>('IDLE');",
    "const [phase, setRenderedPhase] = useState<DeckSwipePhase>('IDLE');\n  const phaseRef = useRef<DeckSwipePhase>('IDLE');",
  );
  assert.throws(
    () => assertModernNativeAdmission({ ...source, controller: renderedPhaseMutant }),
    /mirrored into React state/,
  );

  const layoutMutant = `${source.controller}\nconst pendingSettlementRef = useRef(null);`;
  assert.throws(() => assertModernNativeAdmission({ ...source, controller: layoutMutant }), /layout or timer/);

  const droppedBeginMutant = source.controller.replaceAll(
    "phaseRef.current === 'EXITING' && !fastForwardPendingExit()",
    "phaseRef.current === 'EXITING'",
  );
  assert.throws(
    () => assertModernNativeAdmission({ ...source, controller: droppedBeginMutant }),
    /delivered successor BEGAN/,
  );

  const unsafeStopMutant = source.controller.replace(
    "setPhase('COMMITTING');\n    cancelAnimation(positionX);",
    'cancelAnimation(positionX);',
  );
  assert.throws(
    () => assertModernNativeAdmission({ ...source, controller: unsafeStopMutant }),
    /stopped native callback/,
  );

  const jsFrameMutant = source.controller.replace('.maxPointers(1)', '.maxPointers(1)\n    .runOnJS(true)');
  assert.throws(
    () => assertModernNativeAdmission({ ...source, controller: jsFrameMutant }),
    /runOnJS/,
  );

  const noYieldMutant = source.swipeable.replace(
    'await new Promise<void>((resolve) => setTimeout(resolve, 0));',
    'await Promise.resolve();',
  );
  assert.throws(
    () => assertModernNativeAdmission({ ...source, swipeable: noYieldMutant }),
    /monopolizes/,
  );

});
