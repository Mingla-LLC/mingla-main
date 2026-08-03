import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// [TEST-MOD-APPROVED ORCH-1481 AMENDMENT-5]

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

const swipeableSource = await readFile(new URL('../../SwipeableCards.tsx', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../useDeckSwipeController.ts', import.meta.url), 'utf8');

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function assertMemoizedBoundedHeroSource(source) {
  assert.match(source, /const source = React\.useMemo\([\s\S]*width: decodeTarget\.width, height: decodeTarget\.height/);
  assert.match(source, /\[decodeTarget\.height, decodeTarget\.width, src\]/);
  assert.match(source, /<ExpoImage[\s\S]*source=\{source\}/);
  assert.doesNotMatch(source, /source=\{\{[\s\S]*decodeTarget\.width/);
}

test('10,000 adversarial lifecycle sequences never validate stale, canceled, wrong-card, or replayed work', () => {
  const random = rng(0x1481cafe);
  const phases = ['IDLE', 'DRAGGING', 'SNAPPING', 'EXITING', 'COMMITTING'];
  const seen = new Set();
  let epoch = 0;
  let admitted = 0;
  let committed = 0;

  for (let sequence = 0; sequence < 10_000; sequence += 1) {
    const phase = phases[Math.floor(random() * phases.length)];
    const cardId = `card-${Math.floor(random() * 19)}`;
    const direction = random() < 0.5 ? 'left' : 'right';

    const wasAdmitted = canAdmitDeckInput(phase);
    if (wasAdmitted) {
      admitted += 1;
      const next = nextDeckGestureEpoch(epoch);
      assert.ok(next > epoch, 'every admitted attempt must receive a newer generation');
      epoch = next;
    }

    const token = { cardId, direction, epoch };
    const mutation = sequence % 7;
    const guard = {
      finished: mutation !== 0,
      mounted: mutation !== 1,
      phase: !wasAdmitted ? 'COMMITTING' : mutation === 2 ? 'COMMITTING' : 'EXITING',
      expectedEpoch: epoch,
      currentEpoch: mutation === 3 ? epoch + 1 : epoch,
      expectedCardId: cardId,
      currentCardId: mutation === 4 ? `${cardId}-replacement` : cardId,
    };
    const valid = isCurrentDeckCompletion(guard);
    const expected = wasAdmitted && mutation > 4;
    assert.equal(valid, expected, `sequence ${sequence} accepted an invalid completion`);

    if (valid) {
      const key = deckCommitTokenKey(token);
      if (!seen.has(key)) {
        seen.add(key);
        committed += 1;
      }
      assert.equal(seen.has(key), true);
    }

    const pending = mutation === 5 ? token : { ...token, epoch: token.epoch + 1 };
    const intent = consumeDeckTokenIntent(pending, token);
    assert.equal(intent.shouldRun, mutation === 5);
    assert.equal(intent.pending, null, 'deferred intent must always clear before any action');
    assert.equal(consumeDeckTokenIntent(intent.pending, token).shouldRun, false, 'intent replayed');
  }

  assert.ok(committed <= admitted, `${committed} commits exceeded ${admitted} admitted attempts`);
  assert.equal(seen.size, committed, 'duplicate commit identity escaped the replay guard model');
});

test('decode policy survives 10,000 hostile dimensions without exceeding the physical cap', () => {
  const random = rng(0xb0ded);
  for (let index = 0; index < 10_000; index += 1) {
    const width = random() < 0.02 ? 0 : random() * 12_000;
    const height = random() < 0.02 ? -10 : random() * 12_000;
    const ratio = random() < 0.02 ? 0 : random() * 8;
    const target = getDeckHeroDecodeTarget(width, height, ratio);
    assert.ok(Number.isInteger(target.width) && target.width >= 1);
    assert.ok(Number.isInteger(target.height) && target.height >= 1);
    assert.ok(Math.max(target.width, target.height) <= DECK_HERO_MAX_LONG_EDGE_PX);
  }
});

test('production source keeps the rejection, media, persistence, and teardown boundaries independently bounded', () => {
  assert.match(controllerSource, /if \(!canAdmitDeckInput\(phaseRef\.current\)/);
  assert.doesNotMatch(controllerSource, /handlerEnabled/);
  assert.match(controllerSource, /activeAnimationRef\.current\?\.stop\(\)/);
  assert.ok((controllerSource.match(/onInvalidated\(/g) ?? []).length >= 3);
  assert.doesNotMatch(controllerSource, /addListener\(|PanResponder|react-native-reanimated|runOnJS/);

  const preview = swipeableSource.slice(
    swipeableSource.indexOf('Next card is a poster-only'),
    swipeableSource.indexOf('{/* Current Card */}'),
  );
  assert.match(preview, /pointerEvents="none"/);
  assert.match(preview, /importantForAccessibility="no-hide-descendants"/);
  assert.doesNotMatch(preview, /EventCoverMedia|TouchableOpacity|<CardHero\b/);
  assert.equal(DECK_VISIBLE_POSTER_CACHE_POLICY, 'disk');
  assertMemoizedBoundedHeroSource(swipeableSource);
  assert.match(swipeableSource, /<CardHeroImage[\s\S]*decodeTarget=\{heroDecodeTarget\}/);
  assert.equal((swipeableSource.match(/ExpoImage\.prefetch\(/g) ?? []).length, 0);
  assert.equal((swipeableSource.match(/ExpoImage\.loadAsync\(/g) ?? []).length, 0);

  assert.match(swipeableSource, /persistenceDrainRef/);
  assert.match(swipeableSource, /pendingPersistenceRef\.current = \{/);
  assert.match(swipeableSource, /InteractionManager\.runAfterInteractions/);
  assert.match(swipeableSource, /pendingPaywallRef\.current = null/);
  assert.doesNotMatch(swipeableSource, /pendingPaywallRef = useRef\(false\)/);
});

test('bounded hero policy rejects the old inline non-memoized source shape', () => {
  assert.throws(
    () => assertMemoizedBoundedHeroSource('<ExpoImage source={{ uri: src, width: decodeTarget.width, height: decodeTarget.height }} />'),
  );
});
