// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts / curatedStopsAvailability.adversarial.test.ts).
//
// ORCH-1371 [add-friend-country-picker-hidden] + ORCH-1372
// [pair-request-country-picker-hidden] — TESTER (mingla-tester) ADVERSARIAL suite.
//
// DIFFERENT ANGLE from the implementor's structural strict-grep gate
// (`orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs`, which only asserts
// the picker is HOISTED/RENDERED/GATED — i.e. structural presence/absence). That
// gate is BLIND to the BEHAVIOR that actually makes the round-trip correct:
//
//   • Whether the friends-sheet reset effect is keyed on `showFriendsModal`
//     (fires only on a GENUINE reopen) vs `anyFriendsChildOpen` (would fire
//     mid-round-trip and WIPE the typed phone when the picker opens — SC-3 break
//     that the structural gate passes clean).
//   • Whether AddFriendView's phone field is FULLY prop-controlled (value from
//     the hoisted prop, clear-on-success via `onPhoneNumberChange`, NOT an orphan
//     local `setPhoneNumber`) — the data path that carries the typed value across
//     the sheet drop.
//   • Whether PairRequestModal SWALLOWS the suppress-for-child close
//     (`onClose={handleSheetClose}` with `if (showCountryPicker) return;`) rather
//     than the bare `onClose={handleClose}` that tears down the whole flow and
//     clears the phone when the sheet drops for the picker (SC-8 break that
//     INV-3's `visible` check passes clean).
//
// This suite (a) EXECUTES a faithful state-machine model of the ConnectionsPage
// gate + reset + AddFriendView controlled-input to lock the observable behavior
// (picker-open drops the sheet + preserves phone; close restores + applies
// country; genuine reopen clears), and (b) welds those behaviors to the REAL
// source via comment-stripped reads so the suite FAILS-ON-REVERT of the fix.
//
// House style: read source → strip comments → assert (1157/1163/1340/1341).
// Run: deno test --allow-read --no-check app-mobile/src/components/__tests__/orch_1371_1372_picker_behavior.adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── Source loading + comment strip (mirrors the strict-grep gate helper) ──────
function readSrc(rel: string): string {
  return Deno.readTextFileSync(new URL(rel, import.meta.url));
}
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const CONNECTIONS = code(readSrc("../ConnectionsPage.tsx"));
const ADD_FRIEND = code(readSrc("../connections/AddFriendView.tsx"));
const PAIR_MODAL = code(readSrc("../PairRequestModal.tsx"));

// =============================================================================
// PART A — Executable behavioral model (locks the OBSERVABLE state machine).
// Faithful reproduction of the SPEC §4B/§4A/§4C contract. If a future edit
// "passes structure" but breaks the behavior, PART B (source weld) catches it;
// PART A documents WHAT correct looks like and proves the model is self-consistent.
// =============================================================================

const DEFAULT_COUNTRY = { code: "US", dialCode: "+1" };

// Model of the ConnectionsPage owner + AddFriendView controlled child.
class FriendsFlowModel {
  showFriendsModal = false;
  addFriendPhone = "";
  addFriendCountry = { ...DEFAULT_COUNTRY };
  addFriendPickerOpen = false;
  // other §13 children (unrelated to the picker) — kept to model the gate honestly
  otherChildOpen = false;

  // SPEC §4B B-3: the friends sheet's visible prop.
  get anyFriendsChildOpen(): boolean {
    return this.addFriendPickerOpen || this.otherChildOpen;
  }
  get friendsSheetVisible(): boolean {
    return this.showFriendsModal && !this.anyFriendsChildOpen;
  }

  // SPEC §4B B-5: reset effect keyed on the false→true edge of showFriendsModal.
  #prevShowFriendsModal = false;
  #runResetEffect() {
    if (this.showFriendsModal && !this.#prevShowFriendsModal) {
      this.addFriendPhone = "";
      this.addFriendCountry = { ...DEFAULT_COUNTRY };
      this.addFriendPickerOpen = false;
    }
    this.#prevShowFriendsModal = this.showFriendsModal;
  }

  openFriendsModal() {
    this.showFriendsModal = true;
    this.#runResetEffect();
  }
  closeFriendsModal() {
    this.showFriendsModal = false;
    this.#runResetEffect();
  }
  // AddFriendView controlled input → onPhoneNumberChange → owner setter
  typePhone(v: string) {
    this.addFriendPhone = v;
    this.#runResetEffect(); // no edge → no wipe
  }
  // chip tap → onOpenCountryPicker
  openPicker() {
    this.addFriendPickerOpen = true;
    this.#runResetEffect(); // showFriendsModal stays true → NO reset
  }
  // CountryPickerModal.handleSelect: onSelect(code) then onClose()
  pickCountry(c: { code: string; dialCode: string }) {
    this.addFriendCountry = { ...c }; // handleAddFriendCountrySelect
    this.addFriendPickerOpen = false; // onClose
    this.#runResetEffect();
  }
  // picker X / backdrop → onClose only (no select)
  closePickerNoSelect() {
    this.addFriendPickerOpen = false;
    this.#runResetEffect();
  }
}

Deno.test("ADV-A1: picker-open DROPS the friends sheet but PRESERVES the typed phone (SC-3/SC-4)", () => {
  const m = new FriendsFlowModel();
  m.openFriendsModal();
  m.typePhone("7700900123");
  assertEquals(m.friendsSheetVisible, true, "sheet visible before picker");

  m.openPicker();
  // SC-4: while the picker is up, the friends sheet's RN-Modal window is dropped.
  assertEquals(m.friendsSheetVisible, false, "friends sheet MUST drop while picker open");
  // SC-3: the typed phone MUST survive the drop (owner does not unmount).
  assertEquals(m.addFriendPhone, "7700900123", "typed phone MUST survive picker-open");
});

Deno.test("ADV-A2: close-with-select RESTORES the sheet, APPLIES the country, KEEPS the phone (SC-3)", () => {
  const m = new FriendsFlowModel();
  m.openFriendsModal();
  m.typePhone("7700900123");
  m.openPicker();
  m.pickCountry({ code: "GB", dialCode: "+44" });

  assertEquals(m.friendsSheetVisible, true, "friends sheet MUST re-present on picker close");
  assertEquals(m.addFriendCountry.dialCode, "+44", "picked country MUST apply to the chip/E.164");
  assertEquals(m.addFriendPhone, "7700900123", "typed phone MUST remain intact after the round-trip");
});

Deno.test("ADV-A3: a GENUINE reopen RESETS to empty + default (SC-5 pre-1371 semantics)", () => {
  const m = new FriendsFlowModel();
  m.openFriendsModal();
  m.typePhone("7700900123");
  m.openPicker();
  m.pickCountry({ code: "GB", dialCode: "+44" });
  m.closeFriendsModal();

  m.openFriendsModal(); // false→true edge → reset fires
  assertEquals(m.addFriendPhone, "", "reopen MUST clear the phone");
  assertEquals(m.addFriendCountry.dialCode, "+1", "reopen MUST reset the country to default");
});

Deno.test("ADV-A4: COUNTER-MODEL — keying the reset on anyFriendsChildOpen WOULD wipe the phone (the bug the structural gate cannot see)", () => {
  // Prove the failure mode is real: a reset keyed on the picker gate wipes SC-3.
  let phone = "7700900123";
  let pickerOpen = false;
  let prevGate = false;
  const badResetOnGate = () => {
    const gate = pickerOpen; // anyFriendsChildOpen surrogate
    if (gate && !prevGate) phone = ""; // WRONG dependency
    prevGate = gate;
  };
  pickerOpen = true; // open the picker
  badResetOnGate();
  assertEquals(phone, "", "counter-model confirms: an anyFriendsChildOpen-keyed reset DESTROYS the typed phone");
  // The real code must therefore NOT key the reset on the child-open gate (ADV-B1).
});

// =============================================================================
// PART B — Source weld (FAILS-ON-REVERT). Distinct properties from INV-1/2/3.
// =============================================================================

Deno.test("ADV-B1: ConnectionsPage reset effect is keyed on [showFriendsModal] and NOT on [anyFriendsChildOpen] (round-trip preservation)", () => {
  // The reset that clears addFriendPhone must fire ONLY on a genuine reopen.
  assert(
    /setAddFriendPhone\(""\)/.test(CONNECTIONS),
    "ConnectionsPage MUST reset addFriendPhone on the friends-modal reopen edge",
  );
  // Isolate the useEffect that resets the phone and verify its dependency array.
  const idx = CONNECTIONS.indexOf('setAddFriendPhone("")');
  assert(idx > 0, "reset call not found");
  const after = CONNECTIONS.slice(idx, idx + 400);
  const depMatch = after.match(/\}\s*,\s*\[([^\]]*)\]\s*\)/);
  assert(depMatch, "reset useEffect dependency array not found after the reset body");
  const deps = depMatch![1];
  assert(
    /\bshowFriendsModal\b/.test(deps),
    `reset effect MUST depend on showFriendsModal (found deps: [${deps.trim()}])`,
  );
  assert(
    !/\banyFriendsChildOpen\b/.test(deps),
    "reset effect MUST NOT be keyed on anyFriendsChildOpen — it would fire mid-round-trip and WIPE the typed phone (SC-3 regression the structural gate misses)",
  );
});

Deno.test("ADV-B2: ConnectionsPage passes the HOISTED controlled phone/country + picker-open props to AddFriendView (round-trip data path)", () => {
  assert(
    /phoneNumber=\{addFriendPhone\}/.test(CONNECTIONS),
    "AddFriendView MUST receive phoneNumber={addFriendPhone} (hoisted value)",
  );
  assert(
    /onPhoneNumberChange=\{setAddFriendPhone\}/.test(CONNECTIONS),
    "AddFriendView MUST receive onPhoneNumberChange={setAddFriendPhone} (writes flow to the non-unmounting owner)",
  );
  assert(
    /selectedCountry=\{addFriendCountry\}/.test(CONNECTIONS),
    "AddFriendView MUST receive selectedCountry={addFriendCountry}",
  );
  assert(
    /onSelect=\{handleAddFriendCountrySelect\}/.test(CONNECTIONS),
    "the sibling CountryPickerModal MUST wire onSelect to a handler that applies the picked country to addFriendCountry",
  );
});

Deno.test("ADV-B3: AddFriendView phone is FULLY prop-controlled — no orphan local setPhoneNumber writer", () => {
  assert(
    /value=\{phoneNumber\}/.test(ADD_FRIEND),
    "AddFriendView phone field MUST bind value={phoneNumber} (the hoisted prop)",
  );
  assert(
    /onPhoneNumberChange\(text\)/.test(ADD_FRIEND),
    "onChangeText MUST call onPhoneNumberChange(text)",
  );
  assert(
    /onPhoneNumberChange\(""\)/.test(ADD_FRIEND),
    "clear-on-success MUST call onPhoneNumberChange('') (the hoisted setter)",
  );
  // The orphan local writer must be GONE — otherwise typed value would live in a
  // child that unmounts during the sheet drop (and be lost).
  assert(
    !/\bsetPhoneNumber\b/.test(ADD_FRIEND),
    "AddFriendView MUST NOT contain a local setPhoneNumber — the phone state is hoisted",
  );
  assert(
    !/useState\s*(<[^>]*>)?\s*\(\s*""\s*\)/.test(ADD_FRIEND) || !/const\s*\[\s*phoneNumber\b/.test(ADD_FRIEND),
    "AddFriendView MUST NOT re-declare local phoneNumber useState",
  );
  assert(
    /onPress=\{onOpenCountryPicker\}/.test(ADD_FRIEND),
    "the chip MUST call the hoisted onOpenCountryPicker (not a local setter)",
  );
});

Deno.test("ADV-B4: PairRequestModal SWALLOWS the suppress-for-child close so the picker drop does NOT tear down the flow (SC-8 no-teardown)", () => {
  // handleSheetClose must exist AND early-return while the picker is open.
  const hsc = PAIR_MODAL.match(
    /const\s+handleSheetClose\s*=\s*useCallback\(\s*\(\)\s*=>\s*\{([\s\S]{0,160}?)\}/,
  );
  assert(hsc, "PairRequestModal MUST define handleSheetClose");
  assert(
    /if\s*\(\s*showCountryPicker\s*\)\s*return/.test(hsc![1]),
    "handleSheetClose MUST early-return while showCountryPicker is open (swallow the suppress-for-child close)",
  );
  // The BaseBottomSheet's onClose must use the swallow handler, NOT the bare
  // handleClose (which clears the phone + calls the parent onClose → full teardown).
  assert(
    /onClose=\{handleSheetClose\}/.test(PAIR_MODAL),
    "the PairRequestModal <BaseBottomSheet> onClose MUST be handleSheetClose (no-teardown swallow)",
  );
  // Adversarial: the sheet must NOT wire the raw handleClose (pre-fix teardown path).
  assert(
    !/<BaseBottomSheet[\s\S]{0,200}onClose=\{handleClose\}/.test(PAIR_MODAL),
    "the PairRequestModal sheet MUST NOT wire onClose={handleClose} — that tears the flow down when the sheet drops for the picker",
  );
  // The header X (genuine user dismiss) must still fully close.
  assert(
    /onPress=\{handleClose\}/.test(PAIR_MODAL),
    "the header close (X) MUST keep handleClose so a genuine dismiss fully closes",
  );
});

// =============================================================================
// PART C — Issue #4114 Wave 2b: the one Add a friend sheet (ADDED; nothing above
// is changed). The Add a friend flow left the friends sheet for its own sheet,
// connections/AddFriendSheet.tsx (body: AddFriendView). The same round-trip
// must hold: the picker drops BOTH sheets, the typed number survives, a genuine
// reopen resets, and the drop for the picker never tears the flow down.
// =============================================================================

const ADD_SHEET = code(readSrc("../connections/AddFriendSheet.tsx"));

class AddFriendSheetFlowModel {
  showFriendsModal = false;
  showAddFriendSheet = false;
  addFriendPickerOpen = false;
  addFriendPhone = "";
  addFriendCountry = { ...DEFAULT_COUNTRY };
  #prev = { friends: false, add: false };

  get friendsSheetVisible(): boolean {
    const anyFriendsChildOpen = this.addFriendPickerOpen || this.showAddFriendSheet;
    return this.showFriendsModal && !anyFriendsChildOpen;
  }
  get addSheetVisible(): boolean {
    return this.showAddFriendSheet && !this.addFriendPickerOpen;
  }
  // Mirrors the ConnectionsPage reset effect keyed on [showFriendsModal, showAddFriendSheet].
  #effect() {
    const changed = this.#prev.friends !== this.showFriendsModal || this.#prev.add !== this.showAddFriendSheet;
    if (changed && (this.showFriendsModal || this.showAddFriendSheet)) {
      this.addFriendPhone = "";
      this.addFriendCountry = { ...DEFAULT_COUNTRY };
      this.addFriendPickerOpen = false;
    }
    this.#prev = { friends: this.showFriendsModal, add: this.showAddFriendSheet };
  }
  openFriends() { this.showFriendsModal = true; this.#effect(); }
  openAdd() { this.showAddFriendSheet = true; this.#effect(); }
  // handleAddFriendSheetClose: swallowed while the picker is open.
  sheetOnClose() { if (this.addFriendPickerOpen) return; this.showAddFriendSheet = false; this.#effect(); }
  dismissAdd() { this.showAddFriendSheet = false; this.#effect(); }
  type(v: string) { this.addFriendPhone = v; this.#effect(); }
  openPicker() { this.addFriendPickerOpen = true; this.#effect(); }
  pick(c: { code: string; dialCode: string }) { this.addFriendCountry = { ...c }; this.addFriendPickerOpen = false; this.#effect(); }
}

Deno.test("ADV-C1 (#4114): Add a friend opened over the friends sheet — the picker drops both sheets and keeps the number", () => {
  const m = new AddFriendSheetFlowModel();
  m.openFriends();
  m.openAdd();
  assertEquals(m.friendsSheetVisible, false, "the friends sheet drops while Add a friend is up");
  assertEquals(m.addSheetVisible, true);
  m.type("8035550142");
  m.openPicker();
  m.sheetOnClose(); // BaseBottomSheet fires onClose as the sheet drops for the picker
  assertEquals(m.addSheetVisible, false, "the Add a friend sheet drops while the picker is up");
  assertEquals(m.friendsSheetVisible, false, "no sheet co-presents with the picker");
  assertEquals(m.showAddFriendSheet, true, "the drop for the picker must not tear the flow down");
  m.pick({ code: "NG", dialCode: "+234" });
  assertEquals(m.addSheetVisible, true, "the sheet comes back when the picker closes");
  assertEquals(m.addFriendPhone, "8035550142", "the typed number survives the round-trip");
  assertEquals(m.addFriendCountry.dialCode, "+234", "the picked country applies");
});

Deno.test("ADV-C2 (#4114): closing and reopening Add a friend resets the number and country", () => {
  const m = new AddFriendSheetFlowModel();
  m.openAdd();
  m.type("8035550142");
  m.openPicker();
  m.pick({ code: "NG", dialCode: "+234" });
  m.dismissAdd();
  m.openAdd();
  assertEquals(m.addFriendPhone, "", "reopen clears the number");
  assertEquals(m.addFriendCountry.dialCode, "+1", "reopen resets the country");
});

Deno.test("ADV-C3 (#4114): the reset effect also keys on showAddFriendSheet, never on the picker flag", () => {
  const idx = CONNECTIONS.indexOf('setAddFriendPhone("")');
  const after = CONNECTIONS.slice(idx, idx + 400);
  const deps = after.match(/\}\s*,\s*\[([^\]]*)\]\s*\)/)?.[1] ?? "";
  assert(/\bshowAddFriendSheet\b/.test(deps), `reset effect MUST depend on showAddFriendSheet (deps: [${deps.trim()}])`);
  assert(!/\baddFriendPickerOpen\b/.test(deps), "reset effect MUST NOT key on addFriendPickerOpen — it would wipe the number mid-round-trip");
  assert(!/\banyFriendsChildOpen\b/.test(deps), "reset effect MUST NOT key on anyFriendsChildOpen");
});

Deno.test("ADV-C4 (#4114): the Add a friend sheet's hide-for-picker close is swallowed; Cancel/Done still close", () => {
  const close = CONNECTIONS.match(/const\s+handleAddFriendSheetClose\s*=\s*useCallback\(\s*\(\)\s*=>\s*\{([\s\S]{0,160}?)\}/);
  assert(close, "ConnectionsPage MUST define handleAddFriendSheetClose");
  assert(/if\s*\(\s*addFriendPickerOpen\s*\)\s*return/.test(close![1]), "handleAddFriendSheetClose MUST early-return while the picker is open");
  assert(/<AddFriendSheet\b[\s\S]{0,200}onSheetClose=\{handleAddFriendSheetClose\}/.test(CONNECTIONS), "<AddFriendSheet> MUST wire onSheetClose={handleAddFriendSheetClose}");
  assert(/<BaseBottomSheet\b[\s\S]{0,80}visible=\{visible\}[\s\S]{0,40}onClose=\{onSheetClose\}/.test(ADD_SHEET), "AddFriendSheet's BaseBottomSheet MUST use the parent-gated visible and onClose={onSheetClose}");
  assert(/onPress=\{onDismiss\}/.test(ADD_SHEET), "the header Cancel MUST be the genuine dismiss (onDismiss)");
  assert(!/<CountryPickerModal\b/.test(ADD_SHEET), "AddFriendSheet MUST NOT render the picker");
});
