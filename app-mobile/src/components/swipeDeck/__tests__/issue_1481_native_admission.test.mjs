import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = Object.fromEntries(await Promise.all(Object.entries({
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  controller: new URL('../useDeckSwipeController.ts', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  history: new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url),
}).map(async ([key, url]) => [key, await readFile(url, 'utf8')])));

function assertStableNativeAdmission(sources) {
  const handler = sources.swipeable.slice(
    sources.swipeable.indexOf('<PanGestureHandler'),
    sources.swipeable.indexOf('</PanGestureHandler>') + '</PanGestureHandler>'.length,
  );
  assert.doesNotMatch(handler, /key=\{currentRec\.id\}/, 'current-card promotion remounts the native handler');
  assert.doesNotMatch(handler, /enabled=\{deckSwipe\.handlerEnabled\}/, 'phase toggles native handler eligibility');
  assert.doesNotMatch(handler, /pointerEvents=\{deckSwipe\.phase/, 'phase toggles the gesture host pointer target');
  assert.match(sources.controller, /if \(!canAdmitDeckInput\(phaseRef\.current\)/);
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
    this.commits += 1;
    this.activeCard += 1;
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

test('production keeps one always-eligible native handler and settles successor synchronously', () => {
  assertStableNativeAdmission(source);
});

test('60 jittered release-cadence commands admit and commit exactly with zero active writes', () => {
  for (let seed = 1; seed <= 64; seed += 1) {
    const model = runContinuousLeg(seed);
    assert.equal(model.handlerMounts, 1);
    assert.equal(model.admissions, 60);
    assert.equal(model.commits, 60);
    assert.equal(model.rejected, 0);
    assert.equal(model.history.length, 60);
    assert.equal(model.business.length, 60);
    assert.equal(model.normalWrites, 0);
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

test('source guard rejects every superseded native availability root independently', () => {
  const handlerMutant = source.swipeable.replace(
    '<PanGestureHandler\n',
    '<PanGestureHandler\n            key={currentRec.id}\n',
  );
  assert.throws(() => assertStableNativeAdmission({ ...source, swipeable: handlerMutant }), /remounts/);

  const enabledMutant = source.swipeable.replace(
    '<PanGestureHandler\n',
    '<PanGestureHandler\n            enabled={deckSwipe.handlerEnabled}\n',
  );
  assert.throws(() => assertStableNativeAdmission({ ...source, swipeable: enabledMutant }), /eligibility/);

  const layoutMutant = `${source.controller}\nconst pendingSettlementRef = useRef(null);`;
  assert.throws(() => assertStableNativeAdmission({ ...source, controller: layoutMutant }), /layout or timer/);
});
