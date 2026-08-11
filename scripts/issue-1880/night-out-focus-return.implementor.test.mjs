import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('N-H1 Night Out forwards the canonical ref to its existing Share control', () => {
  const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const layout = read('app-mobile/src/components/expandedCard/EventDetailLayout.tsx');
  const mount = modal.slice(modal.indexOf('<EventDetailLayout'), modal.indexOf('/>', modal.indexOf('<EventDetailLayout')));
  assert.match(mount, /onShare=\{admitExpandedShare\}/);
  assert.match(mount, /shareControlRef=\{shareControlRef\}/);
  assert.match(layout, /shareControlRef\?: React\.Ref<View>/);
  assert.match(layout, /shareControlRef = undefined/);

  const shareStart = layout.lastIndexOf('<TouchableOpacity', layout.indexOf('onPress={handleSharePress}'));
  const shareEnd = layout.indexOf('</TouchableOpacity>', shareStart);
  const shareControl = layout.slice(shareStart, shareEnd);
  assert.match(shareControl, /ref=\{shareControlRef\}/);
  assert.match(shareControl, /onPress=\{handleSharePress\}/);
  assert.match(shareControl, /disabled=\{shareBusy\}/);
  assert.match(shareControl, /accessibilityLabel=\{t\("cards:expanded\.share"\)\}/);
  assert.match(shareControl, /ActivityIndicator/);
  assert.match(shareControl, /share-outline/);
  assert.match(shareControl, /t\("cards:expanded\.share"\)/);
});

test('N-H2 successful and visible-failure restoration focus the admitted control', () => {
  const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const restore = modal.slice(
    modal.indexOf('const restoreExpandedAfterShare'),
    modal.indexOf('const emitParentPresentationFailure'),
  );
  assert.equal((restore.match(/focusShareControl\(\)/g) ?? []).length, 2);
  assert.match(restore, /await withActiveForegroundWatchdog\(shown\.promise\)/);
  assert.match(restore, /if \(!failureAlreadyShown\)/);
  const focus = modal.slice(modal.indexOf('const focusShareControl'), modal.indexOf('const cancelShareHandoff'));
  assert.match(focus, /findNodeHandle\(shareControlRef\.current\)/);
  assert.match(focus, /AccessibilityInfo\.setAccessibilityFocus\(nativeNode\)/);
});
