import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controller = await readFile(new URL('../useDeckSwipeController.ts', import.meta.url), 'utf8');
const swipeable = await readFile(new URL('../../SwipeableCards.tsx', import.meta.url), 'utf8');
const history = await readFile(new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url), 'utf8');

function shuffled(values, seed) {
  let state = seed >>> 0;
  return [...values].sort(() => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32) - 0.5;
  });
}

test('76 commits remain exactly-once when asynchronous business completions overlap arbitrarily', async () => {
  for (let seed = 1; seed <= 64; seed += 1) {
    const admitted = Array.from({ length: 76 }, (_, index) => `card-${index}`);
    const queued = admitted.map((id) => async () => id);
    const completed = await Promise.all(shuffled(queued, seed).map((run) => run()));
    assert.equal(completed.length, 76);
    assert.equal(new Set(completed).size, 76);
    assert.deepEqual(new Set(completed), new Set(admitted));
    assert.ok(completed.includes('card-75'), 'terminal business work was lost');
  }
});

test('stale, duplicate, and terminal settlement paths cannot retain COMMITTING presentation', () => {
  const commit = controller.slice(
    controller.indexOf("setPhase('COMMITTING')"),
    controller.indexOf('const onGestureEvent'),
  );
  assert.match(commit, /if \(!settlement\) \{\s*recoverCurrentEpoch\('stale_completion_ignored'\)/);
  assert.match(commit, /pendingCommitRef\.current = null/);
  assert.match(commit, /activeCardIdRef\.current = 'nextCardId' in settlement[\s\S]*: null/);
  assert.match(commit, /layoutFallbackRef\.current = setTimeout\([\s\S]*synchronizeActiveCardLayout/);
  assert.match(controller, /const synchronizeActiveCardLayout[\s\S]*resetPresentation\(\);\s*setPhase\('IDLE'\)/);
});

test('normal persistence cannot serialize in DRAGGING, EXITING, or COMMITTING', () => {
  const blockedAt = history.indexOf('if (persistenceBlocked && !force)');
  const stringifyAt = history.indexOf('const serialized = JSON.stringify(snapshot)');
  assert.ok(blockedAt >= 0 && stringifyAt > blockedAt);
  assert.match(swipeable, /onPhaseChanged: \(phase\)[\s\S]*phase !== 'IDLE'/);
  assert.match(history, /setDeckSessionHistoryPersistenceBlocked\(blocked: boolean\)/);
});

test('terminal, background, reset, rollback, and unmount retain forced durability seams', () => {
  assert.match(swipeable, /'exhausted' in settlement[\s\S]*flushDeckSessionHistory\(\)/);
  assert.match(swipeable, /return \(\) => \{\s*void flushDeckSessionHistory\(\)/);
  assert.match(history, /rollback:[\s\S]*void flushDeckSessionHistory\(\)/);
  assert.match(history, /resetDeckSessionHistory\(\)[\s\S]*hydrateDeckSessionHistory\(\)\.then\(\(\) => flushDeckSessionHistory\(\)\)/);
  assert.match(history, /state === 'background' \|\| state === 'inactive'/);
});
