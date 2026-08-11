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
  const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const hero = read('app-mobile/src/components/expandedCard/ExpandedCardHero.tsx');
  const plate = read('app-mobile/src/components/deckCardPlate.tsx');
  const heroStart = modal.indexOf('<ExpandedCardHero');
  const heroMount = modal.slice(heroStart, modal.indexOf('onClosePress=', heroStart));
  assert.match(heroMount, /shareControlRef=\{shareControlRef\}/);
  assert.match(hero, /shareControlRef=\{shareControlRef\}/);
  const plateRef = plate.indexOf('ref={shareControlRef}');
  const poolShareControl = plate.slice(plate.lastIndexOf('<Pressable', plateRef), plate.indexOf('</Pressable>', plateRef));
  assert.match(poolShareControl, /ref=\{shareControlRef\}/);
  assert.match(poolShareControl, /onPress=\{onSharePress\}/);
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
