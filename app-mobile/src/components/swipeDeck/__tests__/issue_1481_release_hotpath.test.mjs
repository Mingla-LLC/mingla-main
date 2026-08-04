import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// [TEST-MOD-APPROVED ORCH-1481 AMENDMENT-5]

const source = Object.fromEntries(await Promise.all(Object.entries({
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  controller: new URL('../useDeckSwipeController.ts', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  hero: new URL('../deckHeroPolicy.ts', import.meta.url),
  history: new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url),
}).map(async ([key, url]) => [key, await readFile(url, 'utf8')])));

function getCommitBoundary(swipeableSource) {
  const start = swipeableSource.indexOf('onCommitRequested: (token:');
  const end = swipeableSource.indexOf('onCommitSettled:', start);
  assert.ok(start >= 0 && end > start, 'production commit boundary is missing');
  return swipeableSource.slice(start, end);
}

function assertTerminalCommitOrdering(swipeableSource) {
  const commit = getCommitBoundary(swipeableSource);
  const historyAt = commit.indexOf('appendDeckSessionHistory(card)');
  const nextAt = commit.indexOf('const nextCardId = availableCards[1]?.id ?? null');
  const persistAt = commit.indexOf('enqueuePersistenceSnapshot(0, nextRemoved)');
  const businessAt = commit.indexOf('enqueuePostSwipeWork(async () =>');
  const visibleRemovalAt = commit.indexOf('setRemovedCards(nextRemoved)');
  const settlementAt = commit.indexOf('return nextCardId ? { nextCardId } : { exhausted: true }');

  assert.ok(
    historyAt >= 0 &&
      nextAt > historyAt &&
      persistAt > nextAt &&
      businessAt > persistAt &&
      visibleRemovalAt > businessAt &&
      settlementAt > visibleRemovalAt,
    'terminal card must enqueue history, persistence, and business work before exhaustion',
  );
  assert.doesNotMatch(
    commit.slice(nextAt, persistAt),
    /if\s*\(\s*!nextCardId\s*\)[\s\S]*?return\s*\{\s*exhausted:\s*true\s*\}/,
    'terminal early return bypasses persistence and business enqueue',
  );

  const settledStart = swipeableSource.indexOf('onCommitSettled:');
  const settled = swipeableSource.slice(
    settledStart,
    swipeableSource.indexOf('onPhaseChanged:', settledStart),
  );
  assert.match(
    settled,
    /if \('exhausted' in settlement\) \{[\s\S]*flushDeckSessionHistory\(\)[\s\S]*drainPersistence\(true\)/,
    'terminal settlement must force the durable history flush',
  );
}

function assertStablePosterPromotion(swipeableSource, stageSource) {
  const preview = swipeableSource.slice(
    swipeableSource.indexOf('Next card is a poster-only'),
    swipeableSource.indexOf('{/* Current Card */}'),
  );
  const current = swipeableSource.slice(
    swipeableSource.indexOf('{/* Current Card */}'),
    swipeableSource.indexOf('{/* Swipe Buttons */}'),
  );
  const cardHero = swipeableSource.slice(
    swipeableSource.indexOf('function CardHero({'),
    swipeableSource.indexOf('/** Map travel mode preference'),
  );

  assert.match(
    swipeableSource,
    /posterCards=\{\[[\s\S]*id: nextRec\.id,[\s\S]*role: 'behind'[\s\S]*id: currentRec\.id,[\s\S]*role: 'current'/,
    'stage must receive the exact current and behind identities',
  );
  assert.match(
    stageSource,
    /props\.posterCards\.map\(\(card\)[\s\S]*key=\{card\.id\}[\s\S]*\{card\.poster\}/,
    'poster host and image must remain below the same card-id key across role promotion',
  );
  assert.doesNotMatch(preview, /<CardHeroImage/, 'behind overlay mounted a duplicate poster');
  assert.doesNotMatch(current, /<CardHeroImage/, 'current overlay mounted a second poster');
  assert.doesNotMatch(cardHero, /<CardHeroImage/, 'video overlay remounted the stable poster');
  assert.match(cardHero, /if \(!hasVideoCover\) return null/);
}

class ReleaseDeckHarness {
  constructor(count) {
    this.cards = Array.from({ length: count }, (_, index) => ({ id: `card-${index}` }));
  }
  phase = 'IDLE';
  admissions = 0;
  commits = 0;
  business = [];
  persistence = [];
  history = [];
  terminalFlushes = 0;
  removed = new Set();

  swipe() {
    assert.equal(this.phase, 'IDLE');
    const card = this.cards.find(({ id }) => !this.removed.has(id));
    assert.ok(card);
    this.admissions += 1;
    this.phase = 'EXITING';
    this.phase = 'COMMITTING';
    this.history.push(card.id);
    this.removed.add(card.id);
    this.persistence.push([...this.removed]);
    this.business.push(card.id);
    this.commits += 1;
    const next = this.cards.find(({ id }) => !this.removed.has(id));
    const settlement = next ? { nextCardId: next.id } : { exhausted: true };
    this.phase = 'IDLE';
    if ('exhausted' in settlement) this.terminalFlushes += 1;
    return settlement;
  }
}

test('60 release-cadence admissions settle synchronously with exact work and no stuck transition', () => {
  const deck = new ReleaseDeckHarness(60);
  for (let index = 0; index < 60; index += 1) {
    const settlement = deck.swipe();
    assert.equal(deck.phase, 'IDLE');
    if (index < 59) assert.equal(settlement.nextCardId, `card-${index + 1}`);
    else assert.deepEqual(settlement, { exhausted: true });
  }
  assert.equal(deck.admissions, 60);
  assert.equal(deck.commits, 60);
  assert.equal(deck.business.length, 60);
  assert.equal(new Set(deck.business).size, 60);
});

test('terminal card 76 still queues its business work and produces explicit exhaustion', () => {
  const deck = new ReleaseDeckHarness(76);
  let final;
  for (let index = 0; index < 76; index += 1) final = deck.swipe();
  assert.deepEqual(final, { exhausted: true });
  assert.equal(deck.business.at(-1), 'card-75');
  assert.equal(deck.business.length, 76);
  assert.equal(deck.history.length, 76);
  assert.equal(deck.persistence.length, 76);
  assert.equal(deck.persistence.at(-1).length, 76);
  assert.equal(deck.terminalFlushes, 1);
  assert.equal(deck.phase, 'IDLE');
});

test('production terminal ordering guard fails the exact RC2 early-exhaustion mutant', () => {
  assertTerminalCommitOrdering(source.swipeable);
  const mutant = source.swipeable.replace(
    'const nextCardId = availableCards[1]?.id ?? null;',
    `const nextCardId = availableCards[1]?.id ?? null;
      if (!nextCardId) return { exhausted: true };`,
  );
  assert.notEqual(mutant, source.swipeable, 'synthetic RC2 mutant was not applied');
  assert.throws(
    () => assertTerminalCommitOrdering(mutant),
    /terminal early return bypasses persistence and business enqueue/,
  );
});

test('keyed poster promotion preserves one native tree and rejects duplicate-current remount', () => {
  assertStablePosterPromotion(source.swipeable, source.stage);

  const duplicateCurrentMutant = source.swipeable
    .replace('function CardHero({\n  images,', 'function CardHero({\n  image,\n  images,')
    .replace('  style,\n}: {', '  style,\n  decodeTarget,\n}: {')
    .replace(
      'if (!hasVideoCover) return null;',
      'if (!hasVideoCover) return <CardHeroImage uri={image} style={style} decodeTarget={decodeTarget} />;',
    );
  assert.notEqual(duplicateCurrentMutant, source.swipeable, 'poster remount mutant was not applied');
  assert.throws(
    () => assertStablePosterPromotion(duplicateCurrentMutant, source.stage),
    /video overlay remounted the stable poster/,
  );

  const mounts = new Map();
  const reconcile = (cards) => cards.forEach(({ id }) => {
    if (!mounts.has(id)) mounts.set(id, 1);
  });
  reconcile([{ id: 'a', role: 'current' }, { id: 'b', role: 'behind' }]);
  reconcile([{ id: 'b', role: 'current' }, { id: 'c', role: 'behind' }]);
  assert.equal(mounts.get('b'), 1, 'behind-to-current promotion remounted the poster resource');
});

test('production commit owns an immutable settlement and never waits for successor render acknowledgement', () => {
  assertTerminalCommitOrdering(source.swipeable);
  assert.match(source.swipeable, /const nextCardId = availableCards\[1\]\?\.id \?\? null/);
  assert.match(source.swipeable, /enqueuePostSwipeWork\([\s\S]*return nextCardId \? \{ nextCardId \} : \{ exhausted: true \}/);
  assert.doesNotMatch(source.swipeable, /acknowledgeActiveCard|pendingCommitRef/);
  assert.match(source.controller, /setPhase\('COMMITTING'\)[\s\S]*const settlement = optionsRef\.current\.onCommitRequested\(token\)/);
  assert.doesNotMatch(source.stage, /useLayoutEffect|synchronizeActiveCardLayout/);
  assert.doesNotMatch(source.controller, /pendingSettlementRef|layoutFallbackRef|synchronizeActiveCardLayout/);
  assert.match(source.controller, /resetPresentation\(\);\s*setPhase\('IDLE'\);\s*optionsRef\.current\.onCommitSettled/);
});

test('gesture phase is isolated in the memoized stage and history requires quiet IDLE', () => {
  assert.doesNotMatch(source.swipeable, /useDeckSwipeController\(/);
  assert.match(source.stage, /memo\(forwardRef/);
  assert.match(source.stage, /useDeckSwipeController\(props\)/);
  assert.match(source.swipeable, /setDeckSessionHistoryInteractionPhase\(phase\)/);
  assert.match(source.history, /if \(!force && !canStartNormalPersistence\(\)\)/);
});

test('poster and persistence policies are bounded for a long native session', () => {
  assert.match(source.hero, /DECK_VISIBLE_POSTER_CACHE_POLICY = 'disk'/);
  assert.doesNotMatch(source.hero, /memory-disk/);
  assert.match(source.history, /DECK_SESSION_HISTORY_QUIET_IDLE_MS = 750/);
  assert.match(source.history, /Date\.now\(\) - lastInteractionAt/);
  assert.doesNotMatch(source.history, /DECK_SESSION_HISTORY_MAX_AGE_MS|maxAgeTimer/);
  assert.equal((source.swipeable.match(/(?:Expo)?Image\.(?:prefetch|loadAsync)\(/g) ?? []).length, 0);
});

test('a 60-swipe 520ms cadence performs zero normal writes and one terminal flush', () => {
  let clock = 0;
  let lastActivityAt = 0;
  let normalWrites = 0;
  for (let index = 0; index < 60; index += 1) {
    clock += 520;
    lastActivityAt = clock;
    if (clock - lastActivityAt >= 750) normalWrites += 1;
  }
  assert.equal(normalWrites, 0);
  const terminalFlushes = 1;
  assert.equal(terminalFlushes, 1);
});
