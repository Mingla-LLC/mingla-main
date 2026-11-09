import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('N-T1 Night Out ref cannot drift to Save, Tickets, Calendar, or a wrapper', () => {
  const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const layout = read('app-mobile/src/components/expandedCard/EventDetailLayout.tsx');
  assert.equal((modal.match(/const shareControlRef = useRef/g) ?? []).length, 1);
  assert.doesNotMatch(modal, /nightOut(?:Share)?(?:Control)?Ref|focusNightOut/i);
  const eventStart = modal.indexOf('<EventDetailLayout');
  const eventMount = modal.slice(eventStart, modal.indexOf('/>', eventStart));
  assert.match(eventMount, /shareControlRef=\{shareControlRef\}/);

  const savePress = layout.indexOf('onPress={handleSavePress}');
  const sharePress = layout.indexOf('onPress={handleSharePress}');
  const controlsStart = layout.lastIndexOf('<TouchableOpacity', savePress);
  const controlsEnd = layout.indexOf('</TouchableOpacity>', sharePress);
  const controls = layout.slice(controlsStart, controlsEnd);
  assert.equal((controls.match(/ref=\{shareControlRef\}/g) ?? []).length, 1);
  const shareControl = layout.slice(layout.lastIndexOf('<TouchableOpacity', sharePress), controlsEnd);
  assert.match(shareControl, /<TouchableOpacity[\s\S]*ref=\{shareControlRef\}[\s\S]*onPress=\{handleSharePress\}/);
  const saveControl = layout.slice(controlsStart, layout.indexOf('</TouchableOpacity>', savePress));
  assert.doesNotMatch(saveControl, /ref=\{shareControlRef\}/);
});

test('N-T2 the existing pool same-control chain remains complete', () => {
  // #4347 wave 3: the expanded hero is deleted. The pool chain is now modal ->
  // pinned bar (ActionButtons) -> the one Share control's wrapper View.
  const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const actions = read('app-mobile/src/components/expandedCard/ActionButtons.tsx');
  const barStart = modal.indexOf('<ActionButtons');
  assert.notEqual(barStart, -1);
  const bar = modal.slice(barStart, modal.indexOf('/>', modal.indexOf('shareControlRef=', barStart)));
  assert.match(bar, /shareControlRef=\{shareControlRef\}/);
  assert.match(actions, /shareControlRef\?: React\.Ref<View>/);
  const refAt = actions.indexOf('ref={shareControlRef}');
  assert.notEqual(refAt, -1);
  assert.equal((actions.match(/ref=\{shareControlRef\}/g) ?? []).length, 1);
  const poolShareControl = actions.slice(refAt, actions.indexOf('</TrackedTouchableOpacity>', refAt));
  assert.match(poolShareControl, /logId="share"/);
  assert.match(poolShareControl, /onPress=\{onShare\}/);
});

test('N-T3 failure recovery cannot focus before restored native show', () => {
  const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const restore = modal.slice(modal.indexOf('const restoreExpandedAfterShare'), modal.indexOf('const emitParentPresentationFailure'));
  const nativeShow = restore.indexOf('await withActiveForegroundWatchdog(shown.promise)');
  const successFocus = restore.indexOf('focusShareControl()', nativeShow);
  const catchStart = restore.indexOf('} catch', successFocus);
  const failureFocus = restore.indexOf('focusShareControl()', catchStart);
  assert.ok(nativeShow !== -1 && successFocus > nativeShow);
  assert.ok(catchStart > successFocus && failureFocus > catchStart);
});
