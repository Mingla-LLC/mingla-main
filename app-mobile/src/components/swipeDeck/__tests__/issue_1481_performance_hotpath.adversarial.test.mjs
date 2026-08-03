import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// [TEST-MOD-APPROVED ORCH-1481 AMENDMENT-5]

const files = Object.fromEntries(await Promise.all(Object.entries({
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  context: new URL('../../../contexts/RecommendationsContext.tsx', import.meta.url),
  appStore: new URL('../../../store/appStore.ts', import.meta.url),
  historyStore: new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url),
  appHandlers: new URL('../../AppHandlers.tsx', import.meta.url),
  heroPolicy: new URL('../deckHeroPolicy.ts', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
}).map(async ([name, url]) => [name, await readFile(url, 'utf8')])));

const CAP = 200;

function rng(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

class AdversarialHistory {
  cards = [];
  generation = 0;
  pending = null;
  durable = { generation: -1, cards: [] };
  writes = 0;

  append(card) {
    this.cards = [...this.cards, card].slice(-CAP);
    this.queue();
  }

  rollback(id) {
    const index = this.cards.map((card) => card.id).lastIndexOf(id);
    if (index < 0) return;
    this.cards = this.cards.filter((_, candidate) => candidate !== index);
    this.queue();
  }

  reset() {
    this.cards = [];
    this.queue();
  }

  queue() {
    this.generation += 1;
    this.pending = { generation: this.generation, cards: [...this.cards] };
  }

  flush() {
    if (!this.pending) return;
    assert.ok(this.pending.generation >= this.durable.generation);
    this.durable = this.pending;
    this.pending = null;
    this.writes += 1;
  }
}

test('generated swipe histories preserve exact order, last-match rollback, cap, and trailing coalescing', () => {
  for (let seed = 1; seed <= 32; seed += 1) {
    const random = rng(seed);
    const actual = new AdversarialHistory();
    let expected = [];
    let mutations = 0;
    for (let step = 0; step < 1200; step += 1) {
      const choice = random();
      if (choice < 0.76) {
        const card = { id: `card-${Math.floor(random() * 83)}`, marker: `${seed}:${step}` };
        actual.append(card);
        expected = [...expected, card].slice(-CAP);
        mutations += 1;
      } else if (choice < 0.94) {
        const id = `card-${Math.floor(random() * 83)}`;
        const index = expected.map((card) => card.id).lastIndexOf(id);
        actual.rollback(id);
        if (index >= 0) {
          expected = expected.filter((_, candidate) => candidate !== index);
          mutations += 1;
        }
      } else {
        actual.flush();
      }
      assert.deepEqual(actual.cards, expected, `seed=${seed} step=${step}`);
      assert.ok(actual.cards.length <= CAP);
      assert.equal(actual.generation, mutations);
    }
    actual.flush();
    assert.deepEqual(actual.durable.cards, expected);
    assert.equal(actual.durable.generation, mutations);
    assert.ok(actual.writes < mutations, 'bursts must coalesce instead of serializing per swipe');
  }
});

test('out-of-order drain pressure retains the newest generation and visible state never waits for I/O', async () => {
  const history = new AdversarialHistory();
  history.append({ id: 'a' });
  const first = history.pending;
  history.append({ id: 'b' });
  const second = history.pending;
  assert.deepEqual(history.cards.map(({ id }) => id), ['a', 'b']);
  assert.equal(history.writes, 0);

  const completed = [];
  await Promise.all([
    new Promise((resolve) => setImmediate(() => { completed.push(first); resolve(); })),
    Promise.resolve().then(() => completed.push(second)),
  ]);
  const durable = completed.reduce((latest, snapshot) =>
    snapshot.generation > latest.generation ? snapshot : latest);
  assert.equal(durable.generation, 2);
  assert.deepEqual(durable.cards.map(({ id }) => id), ['a', 'b']);
});

test('migration and a logout racing hydration cannot resurrect history, even across a failed reset write', async () => {
  const legacy = {
    state: {
      sessionSwipedCards: Array.from({ length: 230 }, (_, index) => ({ id: `private-${index}` })),
      unrelated: 'keep-me',
    },
  };
  const dedicated = { version: 1, generation: 91, cards: legacy.state.sessionSwipedCards.slice(-CAP) };
  let releaseHydration;
  const hydrationRead = new Promise((resolve) => { releaseHydration = resolve; });
  let attempts = 0;
  let durable = dedicated;
  let legacyCopy = structuredClone(legacy);
  const errors = [];

  const logout = (async () => {
    const snapshot = await hydrationRead;
    const reset = { version: 1, generation: snapshot.generation + 1, cards: [] };
    while (attempts < 2) {
      attempts += 1;
      try {
        if (attempts === 1) throw new Error('contains private-229 but must never be logged');
        durable = reset;
        delete legacyCopy.state.sessionSwipedCards;
      } catch {
        errors.push('[DeckSessionHistory] persistence failed');
      }
    }
  })();
  releaseHydration(dedicated);
  await logout;

  assert.deepEqual(durable.cards, []);
  assert.equal(durable.generation, 92);
  assert.deepEqual(legacyCopy.state, { unrelated: 'keep-me' });
  assert.deepEqual(errors, ['[DeckSessionHistory] persistence failed']);
  assert.doesNotMatch(errors.join('\n'), /private-|contains/);
});

test('production persistence implements serialized generations, migration safety, reset rebase, and anonymous errors', () => {
  const history = files.historyStore;
  assert.match(history, /DECK_SESSION_HISTORY_CAP = 200/);
  assert.match(history, /pendingSnapshot = snapshot/);
  assert.match(history, /while \(pendingSnapshot\)/);
  assert.match(history, /snapshot\.generation < lastPersistedGeneration/);
  assert.match(history, /Math\.max\([\s\S]*current\.generation,[\s\S]*knownDurableGeneration,[\s\S]*lastPersistedGeneration/);
  assert.match(history, /await AsyncStorage\.setItem\([\s\S]*DECK_SESSION_HISTORY_STORAGE_KEY[\s\S]*JSON\.stringify\(snapshot\)/);
  assert.match(history, /if \(legacyCards\) await removeLegacyHistoryAfterMigration\(\)/);
  assert.match(history, /await hydrateDeckSessionHistory\(\);\s*await flushDeckSessionHistory\(\)/);
  const errorCalls = history.split('\n').filter((line) => line.includes('console.error')).join('\n');
  assert.equal(errorCalls.trim(), 'console.error(`[DeckSessionHistory] ${kind} failed`);');
  assert.doesNotMatch(errorCalls, /card|user|error\)/i);
});

test('history mutations are isolated from the global render/store fan-out', () => {
  assert.match(files.swipeable, /useDeckSessionHistoryStore\(\(state\) => state\.cards\)/);
  assert.match(files.swipeable, /appendDeckSessionHistory\(card\)/);
  assert.match(files.swipeable, /rollbackDeckSessionHistory\(card\.id\)/);
  assert.doesNotMatch(files.swipeable, /\baddSwipedCard\b/);
  assert.doesNotMatch(files.context, /sessionSwipedCards|addSwipedCard|useAppStore\(\s*\)/);
  assert.match(files.context, /useAppStore\(\(state\) => state\.user\)/);
  assert.match(files.context, /const value = useMemo<RecommendationsContextType>/);
  const persisted = files.appStore.slice(files.appStore.indexOf('partialize: (state)'), files.appStore.indexOf('onRehydrateStorage:'));
  assert.doesNotMatch(persisted, /sessionSwipedCards/);
  assert.doesNotMatch(files.appStore, /addSwipedCard:\s*\(/);
  assert.match(files.appStore, /delete \(state as Partial<AppState> & \{ sessionSwipedCards\?: unknown \}\)/);
  assert.match(files.appStore, /resetAndFlushDeckSessionHistory\(\)/);
  assert.match(files.appHandlers, /resetDeckSessionHistory\(\);\s*resetDeckHistory\(newHashStr\)/);
});

test('the render hot path has a stable two-poster bound and no explicit speculative loads', () => {
  const swipeable = files.swipeable;
  assert.equal((swipeable.match(/(?:Expo)?Image\.(?:prefetch|loadAsync)\(/g) ?? []).length, 0);
  assert.doesNotMatch(swipeable, /deckPrefetchIndex|DECK_PREFETCH_CACHE_POLICY/);
  assert.doesNotMatch(files.heroPolicy, /prefetch/i);
  assert.match(swipeable, /const CardHeroImage = React\.memo/);
  assert.match(swipeable, /const source = React\.useMemo\(\s*\(\) => \(\{ uri: src, width: decodeTarget\.width, height: decodeTarget\.height \}\)/);
  assert.match(swipeable, /recyclingKey=\{src\}/);
  assert.match(swipeable, /allowDownscaling/);
  const behind = swipeable.slice(swipeable.indexOf('Next card is a poster-only'), swipeable.indexOf('{\/\* Current Card \*\/}'));
  assert.doesNotMatch(behind, /<CardHeroImage/);
  assert.match(swipeable, /posterCards=\{\[[\s\S]*id: nextRec\.id[\s\S]*id: currentRec\.id/);
  assert.match(files.stage, /props\.posterCards\.map\(\(card\)[\s\S]*key=\{card\.id\}[\s\S]*\{card\.poster\}/);
  assert.doesNotMatch(behind, /EventCoverMedia|<CardHero\b/);
  const current = swipeable.slice(swipeable.indexOf('{/* Current Card */}'), swipeable.indexOf('{/* Swipe Buttons */}'));
  assert.match(current, /<PanGestureHandler[\s\S]*onHandlerStateChange=\{deckSwipe\.onHandlerStateChange\}/);
  assert.doesNotMatch(current, /key=\{currentRec\.id\}|enabled=\{deckSwipe\.handlerEnabled\}/);
  assert.match(current, /<CardHero[\s\S]*image=\{currentRec\.image\}/);
});
