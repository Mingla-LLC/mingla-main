import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  evaluateAndroidFrameStats,
  parseFrameStats,
} from '../../../../scripts/ci/issue-1481-parse-framestats.mjs';

const [fixture, parserSource, swipeable, history] = await Promise.all([
  readFile(new URL('./fixtures/issue_1481_framestats_synthetic.txt', import.meta.url), 'utf8'),
  readFile(new URL('../../../../scripts/ci/issue-1481-parse-framestats.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../SwipeableCards.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../../store/deckSessionHistoryStore.ts', import.meta.url), 'utf8'),
]);

test('reordered framestats columns use FrameDeadline instead of a raw 16.7ms cutoff', () => {
  const stats = parseFrameStats(fixture, { refreshRateHz: 120 });
  assert.equal(stats.refreshRateHz, 120);
  assert.equal(stats.totalFrames, 4);
  assert.equal(stats.deadlineMissedFrames, 2);
  assert.equal(stats.deadlineJankPercent, 50);
  assert.equal(stats.rawDurationsMs[0], 18);
  assert.equal(stats.frames[0].deadlineMissed, false, '18ms frame met its named FrameDeadline');
  assert.equal(stats.frames[1].deadlineMissed, true, '20ms frame missed its named FrameDeadline');
  assert.equal(stats.frozenFrames, 1);
  const verdict = evaluateAndroidFrameStats(stats);
  assert.equal(verdict.passes.deadlineJank, false);
  assert.equal(verdict.passes.p50, undefined, 'p50 is recorded but is not a fail gate');
});

test('parser is header-named and forbids legacy numeric/raw-duration jank rules', () => {
  assert.match(parserSource, /requiredColumns = \['Flags', 'IntendedVsync', 'FrameDeadline', 'FrameCompleted'\]/);
  assert.doesNotMatch(parserSource, /values\[(?:0|1|2|3|4|5|6|7|8|9|10|11|12|13|14)\]/);
  assert.doesNotMatch(parserSource, />\s*16\.7|p50[^\n]*(?:<=|>)/i);
  assert.match(parserSource, /frameCompletedNs > frameDeadlineNs/);
  assert.match(parserSource, /rawDurationsMs/);
});

test('production persistence has no active-cadence max-age escape hatch', () => {
  assert.match(history, /DECK_SESSION_HISTORY_QUIET_IDLE_MS = 750/);
  assert.match(history, /Date\.now\(\) - lastInteractionAt/);
  assert.doesNotMatch(history, /DECK_SESSION_HISTORY_MAX_AGE_MS/);
  assert.doesNotMatch(
    swipeable,
    /onPhaseChanged:[\s\S]*phase === 'IDLE'[\s\S]{0,200}drainPersistence\(/,
  );
});

test('deferred swipe work cannot cross users and lifecycle exits force the owned FIFO', () => {
  assert.match(swipeable, /const postSwipeUserIdRef = useRef<string \| undefined>\(user\?\.id\)/);
  assert.match(
    swipeable,
    /postSwipeUserIdRef\.current !== user\?\.id[\s\S]{0,260}swipeQueueEpochRef\.current \+= 1;[\s\S]{0,260}postSwipeQueueRef\.current = \[\];[\s\S]{0,260}cancelPostSwipeSchedule\(\)/,
    'a replacement identity must invalidate every old-user work item before it can drain',
  );
  assert.match(
    swipeable,
    /nextState !== 'active'[\s\S]{0,180}drainPostSwipeQueue\(true\)/,
    'backgrounding must force the current-user FIFO instead of abandoning it behind the quiet gate',
  );
  assert.match(
    swipeable,
    /cancelPostSwipeSchedule\(\);\s*void drainPostSwipeQueue\(true\);/,
    'unmount must cancel delayed callbacks before force-draining the owned FIFO',
  );
});
