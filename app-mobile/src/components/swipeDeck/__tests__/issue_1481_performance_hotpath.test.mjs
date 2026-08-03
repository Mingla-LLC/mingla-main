import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const urls = {
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  context: new URL('../../../contexts/RecommendationsContext.tsx', import.meta.url),
  appStore: new URL('../../../store/appStore.ts', import.meta.url),
  historyStore: new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url),
  appHandlers: new URL('../../AppHandlers.tsx', import.meta.url),
  heroPolicy: new URL('../deckHeroPolicy.ts', import.meta.url),
  workflow: new URL('../../../../../.github/workflows/issue-1481-explorer-deck-tests.yml', import.meta.url),
};

const sourceEntries = await Promise.all(
  Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
);
const source = Object.fromEntries(sourceEntries);

class HistoryHarness {
  cards = [];
  generation = 0;
  pending = null;
  serializations = 0;
  writes = [];

  append(card) {
    this.cards = [...this.cards, card].slice(-200);
    this.generation += 1;
    this.pending = { generation: this.generation, cards: this.cards };
  }

  rollback(cardId) {
    const index = this.cards.map((card) => card.id).lastIndexOf(cardId);
    if (index < 0) return;
    this.cards = this.cards.filter((_, cardIndex) => cardIndex !== index);
    this.generation += 1;
    this.pending = { generation: this.generation, cards: this.cards };
  }

  settle() {
    if (!this.pending) return;
    this.serializations += 1;
    this.writes.push(this.pending);
    this.pending = null;
  }
}

class SerializedPersistenceHarness {
  pending = null;
  draining = null;
  stored = null;
  writes = [];

  enqueue(snapshot) {
    this.pending = snapshot;
  }

  drain(write) {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (this.pending) {
        const snapshot = this.pending;
        this.pending = null;
        await write(snapshot);
        this.stored = snapshot;
        this.writes.push(snapshot.generation);
      }
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }
}

async function migrateLegacyHistory(storage) {
  if (await storage.get('dedicated')) return;
  const legacy = JSON.parse(await storage.get('legacy'));
  const cards = legacy.state.sessionSwipedCards.slice(-200);
  await storage.set('dedicated', JSON.stringify({ generation: 0, cards }));
  delete legacy.state.sessionSwipedCards;
  await storage.set('legacy', JSON.stringify(legacy));
}

class HydrationResetHarness {
  cards = [];
  generation = 0;
  persistedGeneration = -1;
  resetIntent = 0;
  queuedResetIntent = 0;
  pending = null;
  errors = [];
  legacyPresentOnFailure = false;

  constructor(storage) {
    this.storage = storage;
  }

  reset() {
    this.resetIntent += 1;
    this.cards = [];
    this.generation += 1;
  }

  async hydrate(readDedicated) {
    const snapshot = JSON.parse(await readDedicated());
    this.persistedGeneration = snapshot.generation;
    if (this.queuedResetIntent >= this.resetIntent) {
      this.cards = snapshot.cards;
      this.generation = snapshot.generation;
      return;
    }
    this.queueResetAbove(snapshot.generation);
    await this.flush();
  }

  queueResetAbove(durableGeneration) {
    this.generation = Math.max(
      this.generation,
      durableGeneration,
      this.persistedGeneration,
    ) + 1;
    this.cards = [];
    this.queuedResetIntent = this.resetIntent;
    this.pending = { version: 1, generation: this.generation, cards: [] };
  }

  async flush() {
    if (!this.pending) return;
    const snapshot = this.pending;
    this.pending = null;
    try {
      await this.storage.writeDedicated(snapshot);
      this.persistedGeneration = snapshot.generation;
      await this.storage.removeLegacy();
    } catch {
      this.errors.push('persistence failed');
      this.legacyPresentOnFailure = this.storage.hasLegacy();
      this.pending = snapshot;
    }
  }

  async resetAndFlush(hydration) {
    this.reset();
    await hydration;
    await this.flush();
  }
}

test('history is exact, ordered, rollback-safe, capped, and coalesced', () => {
  const history = new HistoryHarness();
  const acceptedTokens = new Set();
  const commit = (epoch, card) => {
    const token = `${epoch}:${card.id}:right`;
    if (acceptedTokens.has(token)) return;
    acceptedTokens.add(token);
    history.append(card);
  };

  commit(1, { id: 'a', title: 'A' });
  commit(1, { id: 'a', title: 'A' }); // duplicate callback
  commit(2, { id: 'b', title: 'B' });
  assert.deepEqual(history.cards.map((card) => card.id), ['a', 'b']);
  history.rollback('b');
  assert.deepEqual(history.cards.map((card) => card.id), ['a']);

  for (let index = 0; index < 201; index += 1) {
    history.append({ id: `cap-${index}` });
  }
  assert.equal(history.cards.length, 200);
  assert.equal(history.cards[0].id, 'cap-1');
  assert.equal(history.cards.at(-1).id, 'cap-200');

  const rapid = new HistoryHarness();
  for (let index = 0; index < 50; index += 1) rapid.append({ id: `rapid-${index}` });
  assert.equal(rapid.cards.length, 50, 'visible memory truth is immediate');
  assert.equal(rapid.serializations, 0, 'append never serializes on the hot path');
  rapid.settle();
  assert.equal(rapid.serializations, 1);
  assert.equal(rapid.writes.length, 1);
  assert.deepEqual(
    rapid.writes[0].cards.map((card) => card.id),
    Array.from({ length: 50 }, (_, index) => `rapid-${index}`),
  );
});

test('production commit batches visible history with removal and defers only I/O/business work', () => {
  const commit = source.swipeable.slice(
    source.swipeable.indexOf('onCommitRequested: (token:'),
    source.swipeable.indexOf('onExpandValidated:', source.swipeable.indexOf('onCommitRequested: (token:')),
  );
  const tokenGuardAt = commit.indexOf('token.epoch !== latestValidatedSwipeEpochRef.current');
  const cardGuardAt = commit.indexOf('card.id !== token.cardId');
  const appendAt = commit.indexOf('appendDeckSessionHistory(card)');
  const removalAt = commit.indexOf('removedCardsRef.current = nextRemoved');
  const reactRemovalAt = commit.indexOf('setRemovedCards(nextRemoved)');
  assert.ok(tokenGuardAt >= 0 && cardGuardAt > tokenGuardAt);
  assert.ok(appendAt > cardGuardAt && removalAt > appendAt && reactRemovalAt > removalAt);

  const deferredBusiness = source.swipeable.slice(
    source.swipeable.indexOf('const handleSwipe = async'),
    source.swipeable.indexOf('// Sync gesture-boundary function refs'),
  );
  assert.doesNotMatch(deferredBusiness, /appendDeckSessionHistory|addSwipedCard/);
  assert.match(source.swipeable, /rollbackDeckSessionHistory\(card\.id\)[\s\S]*rolledBack\.delete\(card\.id\)/);
  assert.match(source.swipeable, /InteractionManager\.runAfterInteractions/);
});

test('dedicated generation persistence is trailing, serialized, lifecycle-flushed, and resettable', () => {
  assert.match(source.historyStore, /DECK_SESSION_HISTORY_CAP = 200/);
  assert.match(source.historyStore, /pendingSnapshot = snapshot/);
  assert.match(source.historyStore, /DECK_SESSION_HISTORY_MAX_AGE_MS = 5_000/);
  assert.match(source.historyStore, /trailingTimer = setTimeout\([\s\S]*maxAgeTimer = setTimeout/);
  assert.match(source.historyStore, /InteractionManager\.runAfterInteractions/);
  assert.match(source.historyStore, /if \(persistenceBlocked && !force\)/);
  assert.match(source.historyStore, /while \(pendingSnapshot\)/);
  assert.match(source.historyStore, /snapshot\.generation < lastPersistedGeneration/);
  assert.match(source.historyStore, /JSON\.stringify\(snapshot\)/);
  assert.match(source.historyStore, /state === 'background' \|\| state === 'inactive'/);
  assert.match(source.swipeable, /return \(\) => \{\s*void flushDeckSessionHistory\(\)/);
  assert.match(source.appStore, /void resetAndFlushDeckSessionHistory\(\)/);
  assert.match(source.appHandlers, /resetDeckSessionHistory\(\);\s*resetDeckHistory\(newHashStr\)/);
  assert.match(source.context, /resetDeckSessionHistory\(\);\s*resetDeckHistory\(''\)/);
  assert.match(source.historyStore, /catch \{[\s\S]*pendingSnapshot = snapshot;[\s\S]*break;/);
  assert.match(source.historyStore, /if \(hydrationSettled\)[\s\S]*scheduleSnapshot/);
  assert.match(
    source.historyStore,
    /Math\.max\([\s\S]*current\.generation,[\s\S]*knownDurableGeneration,[\s\S]*lastPersistedGeneration/,
  );
  assert.match(
    source.historyStore,
    /if \(!hasPendingHydrationReset\(\)\)[\s\S]*cards: snapshot\.cards/,
  );
  assert.match(source.historyStore, /legacyCleanupAfterGeneration = generation/);
  assert.match(
    source.historyStore,
    /await hydrateDeckSessionHistory\(\);\s*await flushDeckSessionHistory\(\)/,
  );
});

test('a delayed generation N write completes before and cannot overwrite N+1', async () => {
  const persistence = new SerializedPersistenceHarness();
  let releaseFirstWrite;
  const firstWrite = new Promise((resolve) => {
    releaseFirstWrite = resolve;
  });
  const write = async (snapshot) => {
    if (snapshot.generation === 1) await firstWrite;
  };

  persistence.enqueue({ generation: 1, cards: [{ id: 'a' }] });
  const draining = persistence.drain(write);
  await Promise.resolve();
  persistence.enqueue({ generation: 2, cards: [{ id: 'a' }, { id: 'b' }] });
  releaseFirstWrite();
  await draining;

  assert.deepEqual(persistence.writes, [1, 2]);
  assert.equal(persistence.stored.generation, 2);
  assert.deepEqual(persistence.stored.cards.map((card) => card.id), ['a', 'b']);
});

test('mid-hydration reset rebases above durable history and cannot resurrect old cards', async () => {
  let releaseRead;
  const delayedDedicated = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const values = new Map([
    ['dedicated', { version: 1, generation: 100, cards: [{ id: 'old' }] }],
    ['legacy', [{ id: 'old' }]],
  ]);
  const storage = {
    writeDedicated: async (snapshot) => values.set('dedicated', snapshot),
    removeLegacy: async () => values.delete('legacy'),
    hasLegacy: () => values.has('legacy'),
  };
  const history = new HydrationResetHarness(storage);
  const hydration = history.hydrate(() => delayedDedicated);
  const logout = history.resetAndFlush(hydration);
  releaseRead(JSON.stringify(values.get('dedicated')));
  await logout;

  assert.deepEqual(history.cards, []);
  assert.ok(history.generation > 100);
  assert.deepEqual(values.get('dedicated').cards, []);
  assert.equal(values.get('dedicated').generation, history.generation);
  assert.equal(values.has('legacy'), false);
});

test('mid-hydration reset write failure retains legacy, reports no PII, and retries empty', async () => {
  let releaseRead;
  const delayedDedicated = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const values = new Map([
    ['dedicated', { version: 1, generation: 500, cards: [{ id: 'private-card' }] }],
    ['legacy', [{ id: 'private-card' }]],
  ]);
  let writes = 0;
  const storage = {
    writeDedicated: async (snapshot) => {
      writes += 1;
      if (writes === 1) throw new Error('synthetic write failure for private-card');
      values.set('dedicated', snapshot);
    },
    removeLegacy: async () => values.delete('legacy'),
    hasLegacy: () => values.has('legacy'),
  };
  const history = new HydrationResetHarness(storage);
  const hydration = history.hydrate(() => delayedDedicated);
  const logout = history.resetAndFlush(hydration);
  releaseRead(JSON.stringify(values.get('dedicated')));
  await logout;

  assert.equal(writes, 2, 'logout flush retries the reset after hydration write failure');
  assert.equal(history.legacyPresentOnFailure, true);
  assert.deepEqual(history.cards, []);
  assert.deepEqual(values.get('dedicated').cards, []);
  assert.ok(values.get('dedicated').generation > 500);
  assert.equal(values.has('legacy'), false);
  assert.deepEqual(history.errors, ['persistence failed']);
  assert.doesNotMatch(history.errors.join('\n'), /private-card/);
});

test('legacy migration writes exact dedicated history before removing the global copy', async () => {
  const hydrate = source.historyStore.slice(
    source.historyStore.indexOf('export function hydrateDeckSessionHistory'),
    source.historyStore.indexOf('export function appendDeckSessionHistory'),
  );
  const dedicatedReadAt = hydrate.indexOf('DECK_SESSION_HISTORY_STORAGE_KEY');
  const legacyReadAt = hydrate.indexOf('LEGACY_APP_STORAGE_KEY');
  const dedicatedWriteAt = hydrate.lastIndexOf('DECK_SESSION_HISTORY_STORAGE_KEY');
  const cleanupAt = hydrate.lastIndexOf('removeLegacyHistoryAfterMigration()');
  assert.ok(dedicatedReadAt >= 0 && legacyReadAt > dedicatedReadAt);
  assert.ok(dedicatedWriteAt > legacyReadAt && cleanupAt > dedicatedWriteAt);
  assert.match(source.historyStore, /!legacy\.every\(isValidHistoryCard\)/);
  assert.match(source.historyStore, /return capHistory\(legacy\)/);
  assert.match(source.historyStore, /Never remove the legacy value unless the dedicated write succeeded/);
  assert.match(source.historyStore, /console\.error\(`\[DeckSessionHistory\] \$\{kind\} failed`\)/);

  const originalLegacy = JSON.stringify({
    state: { sessionSwipedCards: [{ id: 'a' }, { id: 'b' }], unrelated: 'preserved' },
  });
  const successfulValues = new Map([['legacy', originalLegacy]]);
  const successfulStorage = {
    get: async (key) => successfulValues.get(key) ?? null,
    set: async (key, value) => successfulValues.set(key, value),
  };
  await migrateLegacyHistory(successfulStorage);
  assert.deepEqual(JSON.parse(successfulValues.get('dedicated')).cards, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(JSON.parse(successfulValues.get('legacy')).state, { unrelated: 'preserved' });

  const failedValues = new Map([['legacy', originalLegacy]]);
  const failedStorage = {
    get: async (key) => failedValues.get(key) ?? null,
    set: async (key, value) => {
      if (key === 'dedicated') throw new Error('synthetic write failure');
      failedValues.set(key, value);
    },
  };
  await assert.rejects(migrateLegacyHistory(failedStorage), /synthetic write failure/);
  assert.equal(failedValues.get('legacy'), originalLegacy, 'legacy truth survives a failed dedicated write');
  assert.equal(failedValues.has('dedicated'), false);

  const errorLines = source.historyStore
    .split('\n')
    .filter((line) => line.includes('console.error'))
    .join('\n');
  assert.doesNotMatch(errorLines, /card\.id|card\.title|user\.id|,\s*error/);
});

test('main app store and RecommendationsProvider are isolated from history appends', () => {
  const partialize = source.appStore.slice(
    source.appStore.indexOf('partialize: (state)'),
    source.appStore.indexOf('onRehydrateStorage:'),
  );
  assert.doesNotMatch(partialize, /sessionSwipedCards/);
  assert.doesNotMatch(source.appStore, /addSwipedCard:/);
  assert.doesNotMatch(source.context, /sessionSwipedCards|addSwipedCard/);
  assert.doesNotMatch(source.context, /useAppStore\(\s*\)/);
  assert.match(source.context, /useAppStore\(\(state\) => state\.user\)/);
  assert.match(source.context, /const value = useMemo<RecommendationsContextType>/);
  assert.match(source.context, /<RecommendationsContext\.Provider value=\{value\}>/);
});

test('current and behind are the only stable bounded poster loads', () => {
  assert.equal((source.swipeable.match(/ExpoImage\.prefetch\(/g) ?? []).length, 0);
  assert.equal((source.swipeable.match(/ExpoImage\.loadAsync\(/g) ?? []).length, 0);
  assert.doesNotMatch(source.swipeable, /Image\.prefetch\(|deckPrefetchIndex|DECK_PREFETCH_CACHE_POLICY/);
  assert.doesNotMatch(source.heroPolicy, /PREFETCH|Prefetch|prefetch/);
  assert.match(source.swipeable, /const CardHeroImage = React\.memo/);
  assert.match(
    source.swipeable,
    /const source = React\.useMemo\([\s\S]*uri: src, width: decodeTarget\.width, height: decodeTarget\.height/,
  );
  assert.match(source.swipeable, /source=\{source\}/);
  assert.match(source.swipeable, /cachePolicy=\{DECK_VISIBLE_POSTER_CACHE_POLICY\}/);
  assert.match(source.swipeable, /allowDownscaling/);
  assert.match(source.swipeable, /recyclingKey=\{src\}/);
  const preview = source.swipeable.slice(
    source.swipeable.indexOf('Next card is a poster-only'),
    source.swipeable.indexOf('{/* Current Card */}'),
  );
  assert.match(preview, /<CardHeroImage/);
  assert.doesNotMatch(preview, /EventCoverMedia|<CardHero\b/);
});

test('issue workflow requires all six independent guards', () => {
  for (const filename of [
    'issue_1481_swipe_lifecycle.test.mjs',
    'issue_1481_swipe_lifecycle.adversarial.test.mjs',
    'issue_1481_performance_hotpath.test.mjs',
    'issue_1481_performance_hotpath.adversarial.test.mjs',
    'issue_1481_release_hotpath.test.mjs',
    'issue_1481_release_hotpath.adversarial.test.mjs',
  ]) {
    assert.match(source.workflow, new RegExp(filename.replaceAll('.', '\\.')));
  }
  assert.match(source.workflow, /test -f/);
  assert.match(source.workflow, /node --test/);
});
