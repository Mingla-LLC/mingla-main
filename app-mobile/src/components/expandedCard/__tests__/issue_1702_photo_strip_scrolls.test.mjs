/**
 * Issue #1702 — the expanded sheet's photo thumbnails scroll sideways on Android.
 * Implementor happy-path suite.
 *
 * Seth, on a physical Samsung: "the single card photo gallery thumbnails don't
 * scroll horizontally when i scroll them on the expanded sheet. Only when i
 * expand them."
 *
 * A plain RN list nested in a gorhom bottom sheet does not join the sheet's
 * gesture negotiation, so Android's sheet pan handler claims the horizontal drag
 * first. It works in the lightbox because that view is OUTSIDE the sheet — which
 * is the "only when i expand them" half of the report, and the thing that makes
 * the diagnosis falsifiable rather than a guess.
 *
 * THE ASSERTIONS ARE ON WHICH COMPONENT IS MOUNTED, and that is honest about its
 * own limits: no Node test can prove a drag reaches a list on a device. What it
 * CAN prove is that the component known to fight the sheet is not the one
 * mounted, and that the sheet-aware one is reachable through the single
 * permitted importer. The drag itself is verified on hardware.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

function stripComments(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '{' && d === '/' && src[i + 2] === '*') { i += 3; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/' && src[i + 2] === '}')) i += 1; i += 3; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += src[i]; i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i += 1; } out += src[i]; i += 1; }
      out += src[i]; i += 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

const MODAL_RAW = read('app-mobile/src/components/ExpandedCardModal.tsx');
const MODAL = stripComments(MODAL_RAW);
const BASE = stripComments(read('app-mobile/src/components/ui/BaseBottomSheet.tsx'));
// #4347 wave 2 — the single place's photos moved out of the body strip into
// PlaceGallery at the TOP of the sheet (a full-width pager + a thumbnail row).
// Every protection below now applies to that file, where the lists live.
const GALLERY = stripComments(read('app-mobile/src/components/expandedCard/PlaceGallery.tsx'));

test('P-0 the stripper strips, and the needle is real', () => {
  assert.ok(MODAL.length < MODAL_RAW.length, 'P-0: nothing was stripped');
  // The fix's own comment names the defective component, so a raw scan for
  // "<FlatList" would find it in the sentence recording its removal.
  assert.ok(MODAL_RAW.includes('FlatList'), 'P-0 (vacuity): the needle is misspelled');
});

test('P-1 no plain React Native list is mounted inside the sheet', () => {
  assert.equal(
    /<FlatList[\s>]/.test(MODAL), false,
    'P-1: a raw <FlatList> is mounted in the expanded sheet. On Android the sheet\'s pan handler '
    + 'claims its horizontal drag and the thumbnails do not scroll.',
  );
  assert.equal(
    /<SectionList[\s>]|<VirtualizedList[\s>]/.test(MODAL), false,
    'P-1: another raw virtualised list appeared in the sheet',
  );
  // And it must not be IMPORTABLE either — an unused import is how the wrong
  // component gets picked next time somebody adds a list here.
  const rnImport = /import \{([\s\S]*?)\} from ["']react-native["']/.exec(MODAL);
  assert.ok(rnImport, 'P-1: the react-native import block is gone');
  assert.equal(
    /\bFlatList\b/.test(rnImport[1]), false,
    'P-1: FlatList is still imported from react-native in this file',
  );
});

test('P-2 the gallery mounts the sheet-aware list', () => {
  // REWRITTEN (#4347 wave 2), same protection: BOTH of the gallery's lists
  // (the pager and the thumbnail row) are the sheet-aware list, horizontal.
  const lists = GALLERY.match(/<BottomSheetFlatList/g) ?? [];
  assert.equal(lists.length, 2, 'P-2: the gallery lists are not both BottomSheetFlatList');
  assert.equal((GALLERY.match(/\bhorizontal\b/g) ?? []).length, 2, 'P-2: the gallery lists are no longer horizontal');
  assert.equal(/<FlatList[\s>]|<ScrollView[\s>]/.test(GALLERY), false, 'P-2: a raw list is in the gallery');
  assert.match(MODAL, /<PlaceGallery\b/, 'P-2: the sheet no longer mounts the gallery');
});

test('P-3 it comes through the ONE permitted importer, not straight from gorhom', () => {
  // BaseBottomSheet is the sole permitted importer of @gorhom/bottom-sheet.
  // Importing the list directly would work and would also quietly break that
  // rule, which exists so the sheet's configuration has one owner.
  assert.match(
    GALLERY, /import \{[^}]*BottomSheetFlatList[^}]*\} from ["']\.\.\/ui\/BaseBottomSheet["']/,
    'P-3: BottomSheetFlatList is not imported from BaseBottomSheet',
  );
  assert.equal(/from ["']@gorhom\/bottom-sheet["']/.test(GALLERY), false, 'P-3: PlaceGallery imports gorhom directly');
  assert.equal(
    /from ["']@gorhom\/bottom-sheet["']/.test(MODAL), false,
    'P-3: ExpandedCardModal imports @gorhom/bottom-sheet directly',
  );
  // ...and the re-export must actually exist, or the import above is a lie that
  // only fails at runtime.
  assert.match(BASE, /export \{ BottomSheetFlatList \}/, 'P-3: BaseBottomSheet no longer re-exports it');
  assert.match(BASE, /BottomSheetFlatList,/, 'P-3: BaseBottomSheet does not import it from gorhom');
});

test('P-4 the lightbox still opens on tap — scrolling did not eat the press', () => {
  // The strip's items are TouchableOpacity, and a horizontal list that claims
  // the drag must still pass a tap through. Regressing this would trade one
  // broken gesture for another.
  // REWRITTEN (#4347 wave 2): a pager page is a TouchableOpacity that calls
  // onOpen, and the sheet's onOpen opens the ImageLightbox.
  const pager = GALLERY.slice(GALLERY.indexOf('<BottomSheetFlatList'), GALLERY.indexOf('<BottomSheetFlatList') + 1600);
  assert.match(pager, /<TouchableOpacity/, 'P-4: the gallery pages are no longer pressable');
  assert.match(pager, /onPress=\{\(\) => onOpen\(item\.uri\)\}/, 'P-4: tapping a page no longer reaches onOpen');
  const mount = MODAL.slice(MODAL.indexOf('<PlaceGallery'), MODAL.indexOf('<PlaceGallery') + 800);
  assert.match(mount, /setCuratedLightbox\(\{ visible: true/, 'P-4: the gallery no longer opens the lightbox');
});
