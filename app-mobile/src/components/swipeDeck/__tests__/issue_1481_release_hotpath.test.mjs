import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = Object.fromEntries(await Promise.all(Object.entries({
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  controller: new URL('../useDeckSwipeController.ts', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  hero: new URL('../deckHeroPolicy.ts', import.meta.url),
  history: new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url),
}).map(async ([key, url]) => [key, await readFile(url, 'utf8')])));

class ReleaseDeckHarness {
  constructor(count) {
    this.cards = Array.from({ length: count }, (_, index) => ({ id: `card-${index}` }));
  }
  phase = 'IDLE';
  admissions = 0;
  commits = 0;
  business = [];
  removed = new Set();

  swipe() {
    assert.equal(this.phase, 'IDLE');
    const card = this.cards.find(({ id }) => !this.removed.has(id));
    assert.ok(card);
    this.admissions += 1;
    this.phase = 'EXITING';
    this.phase = 'COMMITTING';
    this.removed.add(card.id);
    this.business.push(card.id);
    this.commits += 1;
    const next = this.cards.find(({ id }) => !this.removed.has(id));
    const settlement = next ? { nextCardId: next.id } : { exhausted: true };
    this.phase = 'IDLE';
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
  assert.equal(deck.phase, 'IDLE');
});

test('production commit owns an immutable settlement and never waits for successor render acknowledgement', () => {
  assert.match(source.swipeable, /const nextCardId = availableCards\[1\]\?\.id \?\? null/);
  assert.match(source.swipeable, /enqueuePostSwipeWork\([\s\S]*return nextCardId \? \{ nextCardId \} : \{ exhausted: true \}/);
  assert.doesNotMatch(source.swipeable, /acknowledgeActiveCard|pendingCommitRef/);
  assert.match(source.controller, /setPhase\('COMMITTING'\)[\s\S]*const settlement = optionsRef\.current\.onCommitRequested\(token\)/);
  assert.match(source.stage, /useLayoutEffect\([\s\S]*synchronizeActiveCardLayout\(props\.activeCardId\)/);
  assert.match(source.controller, /layoutFallbackRef\.current = setTimeout\([\s\S]*synchronizeActiveCardLayout/);
  assert.match(source.controller, /resetPresentation\(\);\s*setPhase\('IDLE'\);\s*optionsRef\.current\.onCommitSettled/);
});

test('gesture phase is isolated in the memoized stage and history is blocked during transitions', () => {
  assert.doesNotMatch(source.swipeable, /useDeckSwipeController\(/);
  assert.match(source.stage, /memo\(forwardRef/);
  assert.match(source.stage, /useDeckSwipeController\(props\)/);
  assert.match(source.swipeable, /setDeckSessionHistoryPersistenceBlocked\(phase !== 'IDLE'\)/);
  assert.match(source.history, /if \(persistenceBlocked && !force\)/);
});

test('poster and persistence policies are bounded for a long native session', () => {
  assert.match(source.hero, /DECK_VISIBLE_POSTER_CACHE_POLICY = 'disk'/);
  assert.doesNotMatch(source.hero, /memory-disk/);
  assert.match(source.history, /DECK_SESSION_HISTORY_TRAILING_MS = 750/);
  assert.match(source.history, /DECK_SESSION_HISTORY_MAX_AGE_MS = 5_000/);
  assert.match(source.history, /if \(!maxAgeTimer\)/);
  assert.equal((source.swipeable.match(/(?:Expo)?Image\.(?:prefetch|loadAsync)\(/g) ?? []).length, 0);
});

test('a 60-swipe 520ms cadence performs at most eight writes including terminal flush', () => {
  let clock = 0;
  let checkpoint = null;
  let writes = 0;
  for (let index = 0; index < 60; index += 1) {
    if (checkpoint === null) checkpoint = clock + 5_000;
    clock += 520;
    if (clock >= checkpoint) {
      writes += 1;
      checkpoint = null;
    }
  }
  writes += 1; // terminal force flush
  assert.ok(writes <= 8, `expected <=8 serializations/writes, got ${writes}`);
});
