/**
 * #1880 tester-owned adversarial guard.
 *
 * Different angle from the implementor's happy-path topology suite: this file
 * attacks platform asymmetry and interruption windows where a syntactically
 * correct callback graph can still dead-tap, strand provider ownership, or
 * reject a Promise after its waiter has been cancelled.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.ISSUE_1880_ROOT
  ? path.resolve(process.env.ISSUE_1880_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const FILES = {
  modal: 'app-mobile/src/components/ExpandedCardModal.tsx',
  eventLayout: 'app-mobile/src/components/expandedCard/EventDetailLayout.tsx',
  provider: 'app-mobile/src/components/share/UnifiedShareProvider.tsx',
  base: 'app-mobile/src/components/ui/BaseBottomSheet.tsx',
  mapper: 'app-mobile/src/components/utils/savedCardToExpandedCardData.ts',
  controller: 'app-mobile/src/services/contentShareController.ts',
};

function sliceBetween(source, startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  assert.notEqual(start, -1, `missing start anchor: ${startAnchor}`);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(end, -1, `missing end anchor: ${endAnchor}`);
  return source.slice(start, end);
}

test('T1 Android dismissal acknowledgement cannot depend on RN Modal onDismiss', () => {
  const base = read(FILES.base);
  const explicitAck = base.indexOf('onNativeDismiss?.()');
  assert.notEqual(
    explicitAck,
    -1,
    'Android has no RN Modal onDismiss event; BaseBottomSheet needs an explicit Android dismissal acknowledgement',
  );
  const acknowledgementPath = base.slice(
    Math.max(0, explicitAck - 1_200),
    Math.min(base.length, explicitAck + 1_200),
  );
  assert.match(
    acknowledgementPath,
    /Platform\.OS\s*===\s*['"]android['"]|Platform\.OS\s*!==\s*['"]ios['"]|androidNativeDismiss/i,
    'the explicit fallback must be Android-scoped, not a second iOS acknowledgement',
  );
  assert.match(
    acknowledgementPath,
    /visible|previous|wasVisible|dismiss/i,
    'the Android acknowledgement must be tied to a real visible-to-dismissed lifecycle boundary',
  );
});

test('T2 pre-presentation cancellation cannot create an unhandled rejected Promise', async () => {
  const provider = read(FILES.provider);
  const deferredFactory = sliceBetween(
    provider,
    'function createPresentationDeferred',
    'export function UnifiedShareProvider',
  );
  const cancellation = sliceBetween(
    provider,
    'cancel: (failureClass)',
    'const openContentShare',
  );
  const cancellationRejectsPresented = /attempt\.presented\.reject\(/.test(cancellation);
  const returnDeferred = deferredFactory.indexOf('return deferred;');
  assert.notEqual(returnDeferred, -1, 'the deferred factory must return its original container');
  const creationWindow = deferredFactory.slice(0, returnDeferred);

  function readBalancedArguments(source, openIndex) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = ['('];
    const args = [];
    let current = '';
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = openIndex + 1; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (lineComment) {
        current += character;
        if (character === '\n') lineComment = false;
        continue;
      }
      if (blockComment) {
        current += character;
        if (character === '*' && next === '/') {
          current += next;
          index += 1;
          blockComment = false;
        }
        continue;
      }
      if (quote !== null) {
        current += character;
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '/' && next === '/') {
        current += character + next;
        index += 1;
        lineComment = true;
        continue;
      }
      if (character === '/' && next === '*') {
        current += character + next;
        index += 1;
        blockComment = true;
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
        current += character;
        continue;
      }
      if (Object.hasOwn(pairs, character)) {
        stack.push(character);
        current += character;
        continue;
      }
      if (character === pairs[stack.at(-1)]) {
        stack.pop();
        if (stack.length === 0) {
          args.push(current.trim());
          return { args, endIndex: index };
        }
        current += character;
        continue;
      }
      if (character === ',' && stack.length === 1) {
        args.push(current.trim());
        current = '';
        continue;
      }
      current += character;
    }
    assert.fail('rejection observer call has an unterminated argument list');
  }

  function isCompleteHandler(handler, scopeBeforeCall) {
    const trimmed = handler.trim();
    const bareIdentifier = /^[A-Za-z_$][\w$]*$/u.exec(trimmed);
    if (bareIdentifier) {
      const name = bareIdentifier[0].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const declaration = new RegExp(
        String.raw`(?:function\s+${name}\s*\(|(?:const|let|var)\s+${name}\s*=\s*(?:async\s+)?(?:function(?:\s+[A-Za-z_$][\w$]*)?\s*\(|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))`,
        'u',
      );
      return declaration.test(scopeBeforeCall);
    }
    const inlineFunction = /^(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{[\s\S]*\}$/u;
    const parenthesizedArrow = /^(?:async\s+)?\([^)]*\)\s*=>[\s\S]+$/u;
    const singleParameterArrow = /^(?:async\s+)?[A-Za-z_$][\w$]*\s*=>[\s\S]+$/u;
    if (!inlineFunction.test(trimmed) && !parenthesizedArrow.test(trimmed) && !singleParameterArrow.test(trimmed)) {
      return false;
    }
    try {
      return typeof new Function(`return (${trimmed});`)() === 'function';
    } catch {
      return false;
    }
  }

  function hasCompleteCreationObserver(source) {
    for (const method of ['catch', 'then']) {
      const marker = `deferred.promise.${method}`;
      let searchFrom = 0;
      while (searchFrom < source.length) {
        const callStart = source.indexOf(marker, searchFrom);
        if (callStart === -1) break;
        searchFrom = callStart + marker.length;
        const lineStart = source.lastIndexOf('\n', callStart) + 1;
        const prefix = source.slice(lineStart, callStart).trim();
        if (prefix !== '' && prefix !== 'void') continue;
        let openIndex = searchFrom;
        while (/\s/u.test(source[openIndex] ?? '')) openIndex += 1;
        if (source[openIndex] !== '(') continue;
        const { args } = readBalancedArguments(source, openIndex);
        const handler = method === 'catch' && args.length === 1
          ? args[0]
          : method === 'then' && args.length === 2 && args[0] === 'undefined'
            ? args[1]
            : null;
        if (handler !== null && isCompleteHandler(handler, source.slice(0, callStart))) return true;
      }
    }
    return false;
  }

  const fixtureRecognized = (fixture) => {
    const source = fixture.includes('return deferred;') ? fixture : `${fixture}\nreturn deferred;`;
    return hasCompleteCreationObserver(source.slice(0, source.indexOf('return deferred;')));
  };
  const acceptedFixtures = [
    'void deferred.promise.then(undefined, () => undefined);',
    'void deferred.promise.then(undefined, async () => undefined);',
    'void deferred.promise.then(undefined, error => undefined);',
    'void deferred.promise.catch(function () {});',
    'void deferred.promise.catch(async function named(error) {});',
    'const handleThen = () => undefined;\nvoid deferred.promise.then(undefined, handleThen);',
    'function handleCatch(error) {}\nvoid deferred.promise.catch(handleCatch);',
  ];
  const rejectedFixtures = [
    'const makeObserver = () => undefined;\nvoid deferred.promise.then(undefined, makeObserver());',
    'void deferred.promise.then(undefined, observer.handle);',
    "void deferred.promise.then(undefined, observer['handle']);",
    'void deferred.promise.then(undefined, observer?.handle);',
    'void deferred.promise.then(undefined, handler?.());',
    'void deferred.promise.then(undefined, handler.bind(null));',
    'const handler = () => undefined;\nvoid deferred.promise.then(undefined, (handler));',
    'void deferred.promise.then(undefined, undefined);',
    'void deferred.promise.then(undefined, null);',
    'void deferred.promise.then(undefined);',
    'void deferred.promise.catch();',
    'void deferred.promise.catch(true);',
    'void deferred.promise.catch({});',
    'void deferred.promise.catch([]);',
    'void deferred.promise.catch(class {});',
    'void deferred.promise.catch(1 + 1);',
    'void deferred.promise.then(handler, undefined);',
    'void deferred.promise.then(null, () => undefined);',
    'void deferred.promise.then(undefined, undeclaredHandler);',
    'return deferred;\nvoid deferred.promise.then(undefined, () => undefined);',
    'deferred.promise = deferred.promise.then(undefined, () => undefined);',
  ];
  for (const fixture of acceptedFixtures) assert.equal(fixtureRecognized(fixture), true, fixture);
  for (const fixture of rejectedFixtures) assert.equal(fixtureRecognized(fixture), false, fixture);

  const rejectionObservedAtCreation = hasCompleteCreationObserver(creationWindow);
  const observerChainReplacesOriginal = /deferred\.promise\s*=\s*deferred\.promise\.(?:catch|then)\s*\(|return\s+deferred\.promise\.(?:catch|then)\s*\(|promise\s*:\s*deferred\.promise\.(?:catch|then)\s*\(/.test(deferredFactory);
  assert.ok(
    cancellationRejectsPresented,
    'Back/cancel must reject `presented` so the real handoff waiter receives cancellation',
  );
  assert.ok(
    rejectionObservedAtCreation,
    'Back/cancel may occur before the handoff awaits `presented`; rejecting it requires an attached rejection observer',
  );
  assert.equal(
    observerChainReplacesOriginal,
    false,
    'the observer-chain Promise must never replace the original Promise exposed to real waiters',
  );

  const typeStart = provider.indexOf('type PresentationDeferred');
  const typeEnd = provider.indexOf('type PresentationAttempt', typeStart);
  const factoryStart = provider.indexOf('function createPresentationDeferred');
  const factoryEnd = provider.indexOf('export function UnifiedShareProvider', factoryStart);
  assert.notEqual(typeStart, -1, 'production deferred type start is missing');
  assert.notEqual(typeEnd, -1, 'production deferred type end is missing');
  assert.notEqual(factoryStart, -1, 'production deferred factory start is missing');
  assert.notEqual(factoryEnd, -1, 'production deferred factory end is missing');
  const strippedFactory = stripTypeScriptTypes(
    `${provider.slice(typeStart, typeEnd)}\n${provider.slice(factoryStart, factoryEnd)}`,
    { mode: 'strip' },
  );
  const createPresentationDeferred = new Function(
    `${strippedFactory}\nreturn createPresentationDeferred;`,
  )();
  assert.equal(typeof createPresentationDeferred, 'function', 'production deferred factory did not load');
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const deferred = createPresentationDeferred();
    const originalPromise = deferred.promise;
    const rejection = new Error('presentation_rejected');
    deferred.reject(rejection);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    let received = null;
    await originalPromise.catch((error) => { received = error; });
    assert.equal(received, rejection);
    assert.equal(deferred.promise, originalPromise);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('T3 the Night Out Share affordance exposes the same busy lock as the pool hero', () => {
  const modal = read(FILES.modal);
  const eventLayout = read(FILES.eventLayout);
  const eventMount = sliceBetween(modal, '<EventDetailLayout', '/>');
  assert.match(eventMount, /onShare=\{admitExpandedShare\}/);
  assert.match(
    eventMount,
    /shareBusy=\{shareHandoffBusy\}/,
    'Night Out must receive the admitted handoff busy state',
  );
  assert.match(eventLayout, /shareBusy\??:\s*boolean/);
  assert.match(eventLayout, /disabled=\{shareBusy\}/);
  assert.match(eventLayout, /accessibilityState=\{[^}]*busy:\s*shareBusy|accessibilityState=\{shareBusy\s*\?\s*\{[^}]*busy:\s*true/s);
  assert.match(eventLayout, /ActivityIndicator/);
});

test('T4 restoring the expanded modal keeps Share busy until native show acknowledgement', () => {
  const modal = read(FILES.modal);
  const busyDerivation = sliceBetween(
    modal,
    'const shareHandoffBusy',
    'const rootSuspendedForShare',
  );
  assert.match(
    busyDerivation,
    /expanded_restoring/,
    'an enabled Share control would silently coalesce taps while the restored modal is not yet acknowledged visible',
  );
});

test('T5 provider native show moves accessibility focus into the visible share sheet', () => {
  const provider = read(FILES.provider);
  const nativeShow = sliceBetween(provider, 'const handleNativeShow', 'const handleNativeDismiss');
  assert.match(
    nativeShow,
    /setAccessibilityFocus|focusShareHeading|focus.*Heading/i,
    'native presentation acknowledgement must also establish the provider as the active accessibility focus owner',
  );
  assert.match(provider, /findNodeHandle|setAccessibilityFocus/);
});

test('T6 modal lifecycle is platform-specific, cycle-guarded, and post-commit on Android', () => {
  const base = read(FILES.base);
  const modal = read(FILES.modal);
  const provider = read(FILES.provider);
  assert.match(base, /useLayoutEffect/,
    'Android dismissal acknowledgement must run after the committed visible transition');
  assert.match(base, /Platform\.OS\s*===\s*['"]android['"]/,
    'Android post-commit dismissal must be hard platform-gated');
  assert.match(base, /Platform\.OS\s*===\s*['"]ios['"]/,
    'iOS native onDismiss must be hard platform-gated');
  assert.match(base, /(?:cycle|dismiss).*(?:ref|delivered)|(?:ref|delivered).*(?:cycle|dismiss)/is,
    'show/dismiss delivery must be latched per genuine visible cycle');
  assert.doesNotMatch(base, /setTimeout\([^)]*onNativeDismiss|requestAnimationFrame\([^)]*onNativeDismiss/s,
    'the lifecycle boundary cannot be guessed with a timer or frame delay');
  const lifecycleEffect = sliceBetween(base, 'useLayoutEffect(() => {', 'return <>{children({');
  assert.match(
    lifecycleEffect,
    /if \(visible && !wasVisible\)[\s\S]*Platform\.OS === 'android' && androidPostCommitNativeShow[\s\S]*deliverNativeShow\(\)/,
    'Android must acknowledge a restored visible=true host after commit because RN Modal.onShow may not fire again',
  );
  const expandedRoot = modal.slice(
    modal.indexOf('<BaseBottomSheet', modal.indexOf('const renderNightOutContent')),
    modal.indexOf('>', modal.indexOf('<BaseBottomSheet', modal.indexOf('const renderNightOutContent'))) + 1,
  );
  assert.match(expandedRoot, /androidPostCommitNativeShow=\{shareHandoffPhase === 'expanded_restoring'\}/,
    'only the restored expanded-card host may opt into Android post-commit show acknowledgement');
  const providerSheetStart = provider.indexOf('<BaseBottomSheet');
  assert.notEqual(providerSheetStart, -1, 'provider Share sheet mount is missing');
  const providerSheet = provider.slice(providerSheetStart, provider.indexOf('\n', providerSheetStart));
  assert.doesNotMatch(providerSheet, /androidPostCommitNativeShow/,
    'the Share sheet initial presentation must wait for RN Modal.onShow and its watchdog');
  assert.match(base, /androidPostCommitNativeShow = false/,
    'post-commit Android show acknowledgement must remain default-off');
  const showDelivery = sliceBetween(base, 'const deliverNativeShow = useCallback', 'const deliverNativeDismiss');
  const showGuard = sliceBetween(showDelivery, 'if (', ') return;');
  assert.match(
    showGuard,
    /showDeliveredRef\.current/,
    'a later native onShow callback must be deduplicated against the post-commit Android acknowledgement',
  );
  assert.ok(
    showDelivery.indexOf('showDeliveredRef.current = true') < showDelivery.indexOf('onNativeShow?.()'),
    'the per-cycle show latch must close before invoking the native-show callback',
  );
});

test('T7 provider dismissal finalization supports Android direct reopen and ignores stale callbacks', () => {
  const provider = read(FILES.provider);
  const nativeShow = sliceBetween(provider, 'const handleNativeShow', 'const handleNativeDismiss');
  const nativeDismiss = sliceBetween(provider, 'const handleNativeDismiss', 'const close');
  assert.match(nativeShow, /dismissalRequested|dismiss|cancel/i,
    'a late native show must reject an attempt already being dismissed');
  assert.match(nativeDismiss, /attempt|token|generation|cycle/i,
    'dismissal must be bound to the attempt/cycle that owns the callback');
  assert.match(nativeDismiss, /activePresentationAttempt\.current\s*=\s*null/,
    'truthful dismissal must release ownership so Android direct Share can reopen');
  assert.match(nativeDismiss, /inputRef\.current\s*=\s*null|setInput\(null\)/,
    'private input must be cleared by the one dismissal finalizer');
});

test('T8 cancellation and unmount settle waiters and detach owned lifecycle work', () => {
  const modal = read(FILES.modal);
  const provider = read(FILES.provider);
  assert.match(modal, /AbortController|cancel(?:led|lation|Wait)|settle/i,
    'expanded waits need an explicit cancellation/settlement primitive');
  assert.match(modal, /waitUntilAppActive\([^)]*(?:signal|cancel)|(?:signal|cancel)[\s\S]{0,300}waitUntilAppActive/i,
    'the foreground wait itself must accept cancellation, not only remove on a normal resolve');
  assert.match(modal, /subscription\.remove\(\)|remove\(\).*subscription/s,
    'AppState waits must detach their listeners');
  assert.match(modal, /return\s*\(\)\s*=>[\s\S]{0,1000}(?:cancel|settle|generation)/,
    'expanded unmount must invalidate and settle in-flight handoff work');
  assert.match(provider, /return\s*\(\)\s*=>[\s\S]{0,1000}(?:cancel|settle|generation)/,
    'provider unmount must settle pending and active attempts');
});

test('T9 provider dismissal while backgrounded waits for active before restore', () => {
  const modal = read(FILES.modal);
  const restorePath = sliceBetween(modal, 'await observation.dismissed', 'expanded_restoring');
  assert.match(restorePath, /waitUntilAppActive|AppState/,
    'provider dismissal in background must not immediately restore the expanded modal');
  assert.match(restorePath, /generation|captured|card|visible/i,
    'foreground restore must revalidate the admitted caller/card generation');
});

test('T10 mapper preserves proven identity without fabricating Google identity', () => {
  const mapper = read(FILES.mapper);
  const controller = read(FILES.controller);
  assert.match(mapper, /placePoolId|place_pool_id/);
  assert.match(mapper, /googlePlaceId|google_place_id/);
  assert.match(mapper, /sourceRecordId|source_record_id/);
  assert.match(mapper, /savedCardId|saved_card_id/);
  assert.match(mapper, /sourceScope|source/);
  assert.doesNotMatch(controller, /googlePlaceId:\s*card\.googlePlaceId\s*\?\?\s*card\.placeId/,
    'a display/raw placeId must never be relabelled as a Google Place ID');
  assert.match(controller, /expanded_share_identity_unavailable/,
    'missing proven identity must fail visibly instead of being fabricated');
});

test('T11 expanded admission freezes message context with the historical defaults', () => {
  const modal = read(FILES.modal);
  const admission = sliceBetween(modal, 'const admitExpandedShare', 'const handleRootNativeDismiss');
  assert.match(admission, /shareMessageContext|planningPreference/,
    'expanded Share must preserve the preparation context bypassed by the old bridge');
  assert.match(admission, /timeOfDay/);
  assert.match(admission, /dayOfWeek/);
  assert.match(admission, /planningTimeframe/);
  assert.match(admission, /Afternoon/);
  assert.match(admission, /Weekend/);
  assert.match(admission, /This month/);
  assert.match(admission, /captured|freeze|Object\.freeze/i,
    'message context must be captured with the admitted identity, not reread after dismissal');
});

test('T12 all nine expanded-card mount owners remain in the guarded workflow', () => {
  const workflow = read('.github/workflows/issue-1880-expanded-share-handoff.yml');
  for (const owner of [
    'DiscoverScreen.tsx',
    'MessageInterface.tsx',
    'SessionViewModal.tsx',
    'SwipeableCards.tsx',
    'CalendarTab.tsx',
    'SavedTab.tsx',
    'CollabSessionChatBanners.tsx',
    'deckCardPlate.tsx',
    'ViewFriendProfileScreen.tsx',
  ]) {
    assert.match(workflow, new RegExp(owner.replace('.', '\\.')),
      `${owner} must remain under the #1880 regression workflow`);
  }
});
