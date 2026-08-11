/**
 * #1880 implementor happy-path + topology + inventory guard.
 *
 * This suite reads the production graph, not a parallel hand-written state
 * machine. Every assertion has a population/anchor check so a rename or moved
 * render site fails closed instead of silently checking an empty slice.
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
  hero: 'app-mobile/src/components/expandedCard/ExpandedCardHero.tsx',
  plate: 'app-mobile/src/components/deckCardPlate.tsx',
  provider: 'app-mobile/src/components/share/UnifiedShareProvider.tsx',
  base: 'app-mobile/src/components/ui/BaseBottomSheet.tsx',
  controller: 'app-mobile/src/services/contentShareController.ts',
  adapter: 'app-mobile/src/services/contentShareAdapter.ts',
  types: 'app-mobile/src/types/expandedCardTypes.ts',
};

function balancedCall(source, anchor) {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `missing call anchor: ${anchor}`);
  const open = source.indexOf('(', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    if (source[i] === ')') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced call: ${anchor}`);
}

test('H1 native modal acknowledgements are real RN Modal callbacks and default-off', () => {
  const base = read(FILES.base);
  const modal = read(FILES.modal);
  assert.match(base, /onNativeShow\?: \(\) => void/);
  assert.match(base, /onNativeDismiss\?: \(\) => void/);
  const nativeModal = base.slice(base.indexOf('<RNModal', base.indexOf('if (wrapInRNModal)')), base.indexOf('>', base.indexOf('<RNModal', base.indexOf('if (wrapInRNModal)'))) + 1);
  assert.match(nativeModal, /onShow=\{onNativeShow\}/);
  assert.match(nativeModal, /onDismiss=\{onNativeDismiss\}/);
  assert.doesNotMatch(base, /onNative(?:Show|Dismiss)\s*=\s*\(\)\s*=>\s*setTimeout/);
  const expandedRoot = modal.slice(
    modal.indexOf('<BaseBottomSheet', modal.indexOf('const renderNightOutContent')),
    modal.indexOf('>', modal.indexOf('<BaseBottomSheet', modal.indexOf('const renderNightOutContent'))) + 1,
  );
  assert.match(expandedRoot, /onNativeShow=\{handleRootNativeShow\}/);
  assert.match(expandedRoot, /onNativeDismiss=\{handleRootNativeDismiss\}/);
});

test('H2 the happy path is dismissal ack -> exact callback -> provider show -> provider dismiss -> restore', () => {
  const modal = read(FILES.modal);
  const flow = modal.slice(modal.indexOf('const admitExpandedShare'), modal.indexOf('const handleRootNativeDismiss'));
  const anchors = [
    'await withActiveForegroundWatchdog(dismissed.promise)',
    'beginExpandedPresentation(shareProducerSurface)',
    'onShare(captured)',
    'await withActiveForegroundWatchdog(observation.presented)',
    'await observation.dismissalRequested',
    'await withActiveForegroundWatchdog(observation.dismissed)',
    'await restoreExpandedAfterShare(generation)',
  ];
  let previous = -1;
  for (const anchor of anchors) {
    const index = flow.indexOf(anchor);
    assert.ok(index > previous, `${anchor} is missing or out of lifecycle order`);
    previous = index;
  }
  assert.match(modal, /capturedShareCard\.current = captured/);
  assert.match(modal, /currentCardIdRef\.current !== captured\.id/);
  assert.match(modal, /shareControlRef[\s\S]*AccessibilityInfo\.setAccessibilityFocus/);
});

test('H3 admission is synchronous, single-flight, foreground-only and bounded at exactly 2,000ms', () => {
  const modal = read(FILES.modal);
  assert.match(modal, /const SHARE_PRESENTATION_WATCHDOG_MS = 2_000/);
  const admission = modal.slice(modal.indexOf('const admitExpandedShare'), modal.indexOf('void (async', modal.indexOf('const admitExpandedShare')));
  assert.match(admission, /shareHandoffPhaseRef\.current !== 'idle'/);
  assert.match(admission, /shareHandoffPhaseRef\.current = 'expanded_dismissing'/);
  assert.match(admission, /Haptics\.selectionAsync\(\)/);
  assert.match(admission, /announceForAccessibility\('Opening sharing\.'\)/);
  const watchdog = modal.slice(modal.indexOf('function withActiveForegroundWatchdog'), modal.indexOf('function waitUntilAppActive'));
  assert.match(watchdog, /AppState\.currentState === 'active'/);
  assert.match(watchdog, /if \(state === 'active'\) resume\(\)/);
  assert.match(watchdog, /else pause\(\)/);
  assert.match(watchdog, /remainingMs = Math\.max\(0, remainingMs - \(Date\.now\(\) - activeStartedAt\)\)/);
});

test('H4 the existing Share control owns busy UI while every non-opted-in plate stays default-idle', () => {
  const modal = read(FILES.modal);
  const hero = read(FILES.hero);
  const plate = read(FILES.plate);
  assert.match(modal, /<ExpandedCardHero[\s\S]*shareHandoffEnabled[\s\S]*shareBusy=\{shareHandoffBusy\}[\s\S]*shareControlRef=\{shareControlRef\}/);
  assert.match(hero, /shareHandoffEnabled = false/);
  assert.match(hero, /shareBusy = false/);
  assert.match(hero, /<DeckCardPlate[\s\S]*shareHandoffEnabled=\{shareHandoffEnabled\}[\s\S]*shareBusy=\{shareBusy\}/);
  assert.match(plate, /shareHandoffEnabled = false/);
  assert.match(plate, /shareBusy = false/);
  assert.match(plate, /accessibilityState=\{shareBusy \? \{ disabled: true, busy: true \} : undefined\}/);
  assert.match(plate, /disabled=\{shareBusy\}/);
  assert.match(plate, /shareHandoffEnabled && pressed \? styles\.shareButtonPressed : null/);
  assert.match(plate, /shareButtonPressed:\s*\{\s*opacity: 0\.55/);
  assert.match(plate, /shareBusy \? \([\s\S]*<ActivityIndicator size="small" color=\{SHARE_GLYPH\.color\}/);
  assert.match(plate, /<Icon name="share-outline" size=\{SHARE_GLYPH\.size\} color=\{SHARE_GLYPH\.color\}/);
  assert.match(plate, /width: SHARE_GLYPH\.target[\s\S]*height: SHARE_GLYPH\.target/);
  assert.match(plate, /hitSlop=\{8\}/);
});

test('H5 all nine production render sites have a real controller callback and classified producer', () => {
  const owners = [
    ['app-mobile/src/components/SwipeableCards.tsx', ['explorer_expanded']],
    ['app-mobile/src/components/SessionViewModal.tsx', ['session_expanded']],
    ['app-mobile/src/components/MessageInterface.tsx', ['chat_expanded']],
    ['app-mobile/src/components/activity/CalendarTab.tsx', ['calendar_expanded']],
    ['app-mobile/src/components/activity/SavedTab.tsx', ['saved_expanded']],
    ['app-mobile/src/components/profile/ViewFriendProfileScreen.tsx', ['friend_profile_expanded']],
    ['app-mobile/src/components/chat/CollabSessionChatBanners.tsx', ['collab_locked_expanded', 'collab_saved_expanded']],
    ['app-mobile/src/components/DiscoverScreen.tsx', ['discover_expanded']],
  ];
  let renders = 0;
  for (const [relative, surfaces] of owners) {
    const source = read(relative);
    const mounts = source.match(/<ExpandedCardModal\b/g) ?? [];
    assert.equal(mounts.length, surfaces.length, `${relative}: unexpected mount count`);
    renders += mounts.length;
    for (const surface of surfaces) {
      assert.match(source, new RegExp(`openExpandedCardContentShare\\(card, '${surface}'\\)`), `${relative}: ${surface} callback missing`);
      assert.match(source, new RegExp(`shareProducerSurface="${surface}"`), `${relative}: ${surface} classification missing`);
    }
  }
  assert.equal(renders, 9);
  const joined = owners.map(([relative]) => read(relative)).join('\n');
  assert.doesNotMatch(joined, /onShare=\{\(\) => \{\}\}/);
  assert.doesNotMatch(joined, /Share not implemented/);
});

test('H6 expanded identity is canonical, non-empty and opened only through the one provider controller', () => {
  const controller = read(FILES.controller);
  const adapter = read(FILES.adapter);
  assert.match(controller, /curatedCompositionIdentity\(card\)/);
  assert.match(controller, /sourceRecordId: card\.sourceRecordId/);
  assert.match(controller, /placePoolId: card\.placePoolId/);
  assert.match(controller, /googlePlaceId: card\.googlePlaceId \?\? card\.placeId/);
  assert.match(controller, /savedCardId: card\.savedCardId/);
  assert.equal((controller.match(/openUnifiedContentShare\(\{/g) ?? []).length, 2);
  assert.match(controller, /throw new Error\('expanded_share_identity_unavailable'\)/);
  const direct = adapter.slice(adapter.indexOf('export async function shareContent'));
  assert.match(direct, /openUnifiedContentShare\(\{ kind, identity \}\)/);
  assert.doesNotMatch(direct, /openExpandedCardContentShare/);
});

test('H7 telemetry distinguishes request/presentation/failure and contains no private payload fields', () => {
  const provider = read(FILES.provider);
  const adapter = read(FILES.adapter);
  for (const event of ['share_sheet_opened', 'share_presentation_requested', 'share_sheet_presented', 'share_link_ready', 'share_sheet_returned', 'share_poster_result', 'share_failure']) {
    assert.match(adapter, new RegExp(`'${event}'`), `telemetry union lost ${event}`);
  }
  const telemetryBlocks = {
    share_presentation_requested: balancedCall(provider, "trackContentShareEvent('share_presentation_requested'"),
    share_sheet_presented: provider.slice(provider.indexOf('const handleNativeShow'), provider.indexOf('const handleNativeDismiss')),
  };
  for (const [event, call] of Object.entries(telemetryBlocks)) {
    for (const allowed of ['kind', 'producer_surface', 'platform', 'duration_ms', 'request_correlation']) {
      assert.match(call, new RegExp(`\\b${allowed}\\b`), `${event} missing ${allowed}`);
    }
    assert.doesNotMatch(call, /sourceRecordId|placePoolId|googlePlaceId|savedCardId|canonicalUrl|recipient|senderNote|userId|identity/);
  }
  const failure = provider.slice(provider.indexOf('const emitPresentationFailure'), provider.indexOf('const beginExpandedPresentation'));
  assert.match(failure, /failure_type: failureClass/);
  assert.doesNotMatch(failure, /sourceRecordId|placePoolId|googlePlaceId|savedCardId|canonicalUrl|recipient|senderNote|userId|identity/);
});

test('H8 failure is visible/spoken, retry is the restored same control, and no second retry UI exists', () => {
  const modal = read(FILES.modal);
  assert.match(modal, /toastManager\.show\("Couldn't open sharing\. Please try again\.", 'error'\)/);
  assert.match(modal, /AccessibilityInfo\.announceForAccessibility\("Couldn't open sharing\. Please try again\."\)/);
  assert.match(modal, /setShareHandoffPhase\('idle'\)[\s\S]*focusShareControl\(\)/);
  assert.doesNotMatch(modal, />\s*Retry\s*</);
  assert.doesNotMatch(modal, /setTimeout\([^,]+,\s*2_000\)/);
});
