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

test('T2 pre-presentation cancellation cannot create an unhandled rejected Promise', () => {
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
  const rejectionObservedAtCreation = /(?:deferred|promise)\.promise\.catch\(|void\s+deferred\.promise\.catch\(/.test(deferredFactory);
  assert.ok(
    !cancellationRejectsPresented || rejectionObservedAtCreation,
    'Back/cancel may occur before the handoff awaits `presented`; rejecting it requires an attached rejection observer',
  );
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
