import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modal = fs.readFileSync(path.join(ROOT, 'app-mobile/src/components/ExpandedCardModal.tsx'), 'utf8');
const require = createRequire(import.meta.url);
const ts = require('../../app-mobile/node_modules/typescript');

function loadProductionRecoveryHelpers() {
  const start = modal.indexOf('type ExpandedShareRecoveryDependencies');
  const end = modal.indexOf('// ============================================================================', start);
  assert.notEqual(start, -1, 'production recovery helper start is missing');
  assert.notEqual(end, -1, 'production recovery helper end is missing');
  const source = `${modal.slice(start, end)}\nexport { runExpandedShareRecovery, observeExpandedShareTask };`;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', output)(loaded, loaded.exports);
  return loaded.exports;
}

const { runExpandedShareRecovery, observeExpandedShareTask } = loadProductionRecoveryHelpers();
const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sideEffects() {
  return { toast: 0, announce: 0, focus: 0, state: 0, restore: 0, modal: 0, diagnostic: 0 };
}

async function withUnhandledCapture(run) {
  const unhandled = [];
  const listener = (error) => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    await run();
    await flush();
    await flush();
  } finally {
    process.off('unhandledRejection', listener);
  }
  assert.deepEqual(unhandled, []);
}

function ownedDismissalWait() {
  const gate = deferred();
  const listeners = { appAdded: 0, appRemoved: 0, timerAdded: 0, timerRemoved: 0 };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    listeners.appRemoved += 1;
    listeners.timerRemoved += 1;
  };
  return {
    listeners,
    wait: () => {
      listeners.appAdded += 1;
      listeners.timerAdded += 1;
      return gate.promise.finally(cleanup);
    },
    settle: () => gate.resolve(),
  };
}

function abortableForegroundWait(signal, listeners) {
  listeners.appAdded += 1;
  listeners.abortAdded += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      listeners.appRemoved += 1;
      listeners.abortRemoved += 1;
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('handoff_cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function recoveryOptions({ isCurrent, dismissal, waitForActive = async () => {}, effects }) {
  return {
    isCurrent,
    failureClass: 'presentation_rejected',
    cancelObservation: () => {},
    waitForDismissal: dismissal.wait,
    waitForActive,
    releaseObservation: () => { effects.state += 1; },
    showFailure: () => { effects.toast += 1; effects.announce += 1; },
    restore: async () => {
      effects.restore += 1;
      effects.focus += 1;
      effects.modal += 1;
      effects.state += 1;
    },
  };
}

for (const cancellation of ['caller cancellation', 'unmount']) {
  test(`R1 ${cancellation} during provider dismissal settles silently and cleans owners`, async () => {
    await withUnhandledCapture(async () => {
      let current = true;
      const effects = sideEffects();
      const dismissal = ownedDismissalWait();
      let activeCalls = 0;
      const task = runExpandedShareRecovery(recoveryOptions({
        isCurrent: () => current,
        dismissal,
        waitForActive: async () => { activeCalls += 1; },
        effects,
      }));
      let rawOutcome;
      void task.then((value) => { rawOutcome = value; }, () => { rawOutcome = 'rejected'; });
      const settled = observeExpandedShareTask(task, () => current, () => { effects.diagnostic += 1; });
      await flush();
      current = false;
      dismissal.settle();
      await settled;
      assert.equal(rawOutcome, 'cancelled');
      assert.equal(activeCalls, 0);
      assert.deepEqual(effects, sideEffects());
      assert.deepEqual(dismissal.listeners, { appAdded: 1, appRemoved: 1, timerAdded: 1, timerRemoved: 1 });
    });
  });
}

for (const cancellation of ['caller cancellation', 'unmount']) {
  test(`R2 ${cancellation} during background wait detaches and cannot resurrect later`, async () => {
    await withUnhandledCapture(async () => {
      let current = true;
      const controller = new AbortController();
      const effects = sideEffects();
      const dismissal = ownedDismissalWait();
      const foregroundListeners = { appAdded: 0, appRemoved: 0, abortAdded: 0, abortRemoved: 0 };
      const task = runExpandedShareRecovery(recoveryOptions({
        isCurrent: () => current,
        dismissal,
        waitForActive: () => abortableForegroundWait(controller.signal, foregroundListeners),
        effects,
      }));
      let rawOutcome;
      void task.then((value) => { rawOutcome = value; }, () => { rawOutcome = 'rejected'; });
      const settled = observeExpandedShareTask(task, () => current, () => { effects.diagnostic += 1; });
      dismissal.settle();
      await flush();
      current = false;
      controller.abort();
      await settled;
      assert.equal(rawOutcome, 'cancelled');
      await flush(); // a later foreground event has no listener left to revive work
      assert.deepEqual(effects, sideEffects());
      assert.deepEqual(foregroundListeners, { appAdded: 1, appRemoved: 1, abortAdded: 1, abortRemoved: 1 });
    });
  });
}

test('R3 unexpected terminal errors are observed once without becoming unhandled', async () => {
  await withUnhandledCapture(async () => {
    const effects = sideEffects();
    const dismissal = ownedDismissalWait();
    const task = runExpandedShareRecovery(recoveryOptions({
      isCurrent: () => true,
      dismissal,
      waitForActive: async () => { throw new Error('unexpected_recovery_fault'); },
      effects,
    }));
    const settled = observeExpandedShareTask(task, () => true, (error) => {
      assert.equal(error.message, 'unexpected_recovery_fault');
      effects.diagnostic += 1;
    });
    dismissal.settle();
    await flush();
    await flush();
    await settled.catch(() => undefined);
    assert.equal(effects.diagnostic, 1);
    assert.equal(effects.toast, 0);
    assert.equal(effects.restore, 0);
  });
});

test('R4 a genuine current foreground failure remains visible and restores once', async () => {
  await withUnhandledCapture(async () => {
    const effects = sideEffects();
    const dismissal = ownedDismissalWait();
    const task = runExpandedShareRecovery(recoveryOptions({
      isCurrent: () => true,
      dismissal,
      effects,
    }));
    const settled = observeExpandedShareTask(task, () => true, () => { effects.diagnostic += 1; });
    dismissal.settle();
    await settled;
    assert.deepEqual(effects, { toast: 1, announce: 1, focus: 1, state: 2, restore: 1, modal: 1, diagnostic: 0 });
  });
});

test('R5 production wires current ownership, generation-bound release, and terminal observation', () => {
  const admission = modal.slice(modal.indexOf('const admitExpandedShare'), modal.indexOf('const handleRootNativeDismiss'));
  assert.match(admission, /shareHandoffMounted\.current/);
  assert.match(admission, /shareHandoffGeneration\.current === generation/);
  assert.match(admission, /!abortController\.signal\.aborted/);
  assert.match(admission, /visibleRef\.current/);
  assert.match(admission, /currentCardIdRef\.current === captured\.id/);
  assert.match(admission, /capturedShareCard\.current === captured/);
  assert.match(admission, /sharePresentationObservation\.current === recoveryObservation/);
  assert.match(admission, /observeExpandedShareTask\(/);
  assert.match(admission, /expanded handoff task failed/);
  assert.doesNotMatch(admission, /\.catch\(\(\) => undefined\)/);
});

test('R6 normal provider success ordering remains failure-free', async () => {
  const admission = modal.slice(modal.indexOf('const admitExpandedShare'), modal.indexOf('const handleRootNativeDismiss'));
  const anchors = [
    'await withActiveForegroundWatchdog(dismissed.promise)',
    'onShare(captured)',
    'await withActiveForegroundWatchdog(observation.presented)',
    'await observation.dismissalRequested',
    'await withActiveForegroundWatchdog(observation.dismissed)',
    'await waitUntilAppActive(abortController.signal)',
    'await restoreExpandedAfterShare(generation)',
  ];
  let previous = -1;
  for (const anchor of anchors) {
    const found = admission.indexOf(anchor, previous + 1);
    assert.ok(found > previous, `${anchor} missing from success order`);
    previous = found;
  }
  assert.ok(admission.indexOf('toastManager.show', previous) > previous, 'failure UI must remain outside the success sequence');
});
