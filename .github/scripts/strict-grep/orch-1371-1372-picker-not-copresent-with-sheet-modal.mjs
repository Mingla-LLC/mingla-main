#!/usr/bin/env node
/**
 * ORCH-1371 [add-friend-country-picker-hidden] + ORCH-1372
 * [pair-request-country-picker-hidden] —
 * I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL.
 *
 * WHY: iOS presents only ONE RN <Modal> at a time. The consumer country picker
 * (`CountryPickerModal` = an RN <Modal presentationStyle="fullScreen">) never
 * appeared in Add-friend / Pair-by-phone because it was rendered CO-PRESENT with
 * the friends/pair sheet's own `wrapInRNModal` RN <Modal> window — iOS refused
 * the second presentation, so the picker stayed hidden (Android stacks Dialog
 * windows, so it worked there). The fix mirrors the proven
 * `AccountSettings.tsx:638-683` gate: DROP the parent sheet's RN-Modal window
 * before the picker presents, restore it when the picker closes — freeing iOS's
 * single presentation slot. This gate fails the build the moment any surface
 * re-introduces the co-present structure.
 *
 * ASSERTS (comment-stripped reads of the three files):
 *  INV-1 (AddFriendView hoisted):   AddFriendView.tsx MUST NOT render
 *        <CountryPickerModal> and MUST NOT own showCountryPicker /
 *        setShowCountryPicker (both hoisted to ConnectionsPage, because a
 *        RN <Modal visible={false}> unmounts its children).
 *  INV-2 (ConnectionsPage renders + gates): ConnectionsPage.tsx MUST render
 *        <CountryPickerModal> (as a sibling of the friends sheet); its
 *        `anyFriendsChildOpen` expression MUST include `addFriendPickerOpen`;
 *        and the friends sheet MUST keep the gated
 *        `visible={showFriendsModal && !anyFriendsChildOpen}` (adversarial:
 *        MUST NOT regress to a bare `visible={showFriendsModal}`).
 *  INV-3 (PairRequestModal self-gates): PairRequestModal.tsx MUST gate its own
 *        sheet `visible={visible && !showCountryPicker}` (adversarial: MUST NOT
 *        use the pre-fix bare `visible={visible}`).
 *  INV-4 (Issue #4114 Wave 2b — the one Add a friend sheet): the Add a friend
 *        flow moved out of the friends sheet into its own sheet
 *        (connections/AddFriendSheet.tsx, whose body is still AddFriendView).
 *        The same invariants hold for the new structure:
 *          - AddFriendSheet.tsx MUST NOT render <CountryPickerModal> and MUST
 *            NOT own the picker flag or the typed number (no showCountryPicker /
 *            setShowCountryPicker / setAddFriendPickerOpen / setAddFriendPhone /
 *            setAddFriendCountry) — a dropped sheet unmounts its children.
 *          - ConnectionsPage.tsx MUST render <AddFriendSheet> gated
 *            `visible={showAddFriendSheet && !addFriendPickerOpen}` (adversarial:
 *            MUST NOT be the bare `visible={showAddFriendSheet}`), and MUST
 *            include `showAddFriendSheet` in `anyFriendsChildOpen` so the friends
 *            sheet drops while the Add a friend sheet is up (never co-present).
 *          - ConnectionsPage.tsx MUST keep feeding the hoisted state into the
 *            sheet: `phoneNumber={addFriendPhone}` and
 *            `selectedCountry={addFriendCountry}`.
 *
 * A revert of §4A (restore the picker in AddFriendView) re-fails INV-1; a revert
 * of §4B (drop the sibling picker or the gate disjunct) re-fails INV-2; a revert
 * of §4C (bare `visible={visible}` in PairRequestModal) re-fails INV-3.
 *
 * `--self-test` proves PASS-on-fixed-structure + FAIL-on-each-revert.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from THIS script's location
// (.github/scripts/strict-grep/ → up three levels), so the gate runs
// identically from CI (repo-root cwd) and from any nested cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

const ADD_FRIEND_VIEW = path.join(
  root,
  "app-mobile/src/components/connections/AddFriendView.tsx",
);
const CONNECTIONS_PAGE = path.join(
  root,
  "app-mobile/src/components/ConnectionsPage.tsx",
);
const PAIR_REQUEST_MODAL = path.join(
  root,
  "app-mobile/src/components/PairRequestModal.tsx",
);
// Issue #4114 Wave 2b — the one Add a friend sheet (INV-4).
const ADD_FRIEND_SHEET = path.join(
  root,
  "app-mobile/src/components/connections/AddFriendSheet.tsx",
);

/**
 * Strip block + line comments so prose mentions of a token don't trip a guard
 * (the `[^:]` guard leaves `https://` intact). Mirrors the WaveCBatch3 helper.
 */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Core check: given the three comment-strippable source strings, push a
 * human-readable message to `failures` for every violated invariant.
 */
function checkPickerNotCopresent(
  { addFriendSrc, connectionsSrc, pairSrc, addFriendSheetSrc },
  failures,
) {
  const af = code(addFriendSrc);
  const cp = code(connectionsSrc);
  const pr = code(pairSrc);
  const as = code(addFriendSheetSrc);

  // ── INV-1 — AddFriendView hoisted (renders no picker, owns no picker flag) ──
  if (/<CountryPickerModal\b/.test(af)) {
    failures.push(
      "INV-1: app-mobile/src/components/connections/AddFriendView.tsx MUST NOT " +
        "render <CountryPickerModal> — the picker is hoisted to ConnectionsPage " +
        "and rendered as a sibling of the friends sheet (iOS one-modal-at-a-time; " +
        "mirror AccountSettings.tsx:638-683).",
    );
  }
  if (/\bshowCountryPicker\b/.test(af) || /\bsetShowCountryPicker\b/.test(af)) {
    failures.push(
      "INV-1: AddFriendView.tsx MUST NOT own showCountryPicker/setShowCountryPicker " +
        "state — it is hoisted to ConnectionsPage (a RN <Modal visible={false}> " +
        "unmounts the sheet's children, so the transient flag+phone state must live " +
        "in a component that does not unmount during the sheet drop).",
    );
  }

  // ── INV-2 — ConnectionsPage renders the sibling picker AND gates the sheet ──
  if (!/<CountryPickerModal\b/.test(cp)) {
    failures.push(
      "INV-2: app-mobile/src/components/ConnectionsPage.tsx MUST render " +
        "<CountryPickerModal> as a sibling of the friends <BaseBottomSheet> so it " +
        "presents into the freed iOS slot when the friends sheet drops.",
    );
  }
  const gateDecl = cp.match(/const\s+anyFriendsChildOpen\s*=([\s\S]*?);/);
  if (!gateDecl) {
    failures.push(
      "INV-2: ConnectionsPage.tsx MUST derive `anyFriendsChildOpen` " +
        "(META-ORCH-0991 §13 one-sheet-at-a-time gate).",
    );
  } else if (!/\baddFriendPickerOpen\b/.test(gateDecl[1])) {
    failures.push(
      "INV-2: the `anyFriendsChildOpen` expression MUST include " +
        "`addFriendPickerOpen` so the friends sheet's RN-Modal window drops while " +
        "the add-friend country picker is open (frees iOS's single presentation slot).",
    );
  }
  if (
    !/visible=\{\s*showFriendsModal\s*&&\s*!anyFriendsChildOpen\s*\}/.test(cp)
  ) {
    failures.push(
      "INV-2: the friends <BaseBottomSheet> MUST keep the gated " +
        "`visible={showFriendsModal && !anyFriendsChildOpen}`.",
    );
  }
  if (/visible=\{\s*showFriendsModal\s*\}/.test(cp)) {
    failures.push(
      "INV-2 (adversarial): the friends sheet MUST NOT regress to a bare " +
        "`visible={showFriendsModal}` — that re-introduces the co-present-modal bug.",
    );
  }

  // ── INV-3 — PairRequestModal self-gates its own sheet against its picker ────
  if (!/visible=\{\s*visible\s*&&\s*!showCountryPicker\s*\}/.test(pr)) {
    failures.push(
      "INV-3: app-mobile/src/components/PairRequestModal.tsx MUST gate its own " +
        "<BaseBottomSheet> `visible={visible && !showCountryPicker}` so its picker " +
        "never co-presents (mirror AccountSettings.tsx:683).",
    );
  }
  if (/visible=\{\s*visible\s*\}/.test(pr)) {
    failures.push(
      "INV-3 (adversarial): the PairRequestModal sheet MUST NOT use the pre-fix " +
        "bare `visible={visible}` — that re-introduces the co-present-modal bug.",
    );
  }

  // ── INV-4 — the Add a friend sheet (#4114 Wave 2b) ───────────────────────
  if (/<CountryPickerModal\b/.test(as)) {
    failures.push(
      "INV-4: app-mobile/src/components/connections/AddFriendSheet.tsx MUST NOT " +
        "render <CountryPickerModal> — the picker is a sibling in ConnectionsPage.",
    );
  }
  if (
    /\b(showCountryPicker|setShowCountryPicker|setAddFriendPickerOpen|setAddFriendPhone|setAddFriendCountry)\b/
      .test(as)
  ) {
    failures.push(
      "INV-4: AddFriendSheet.tsx MUST NOT own the picker flag, the typed number " +
        "or the country — they are hoisted to ConnectionsPage (a dropped RN " +
        "<Modal> unmounts the sheet's children).",
    );
  }
  if (!/<AddFriendSheet\b/.test(cp)) {
    failures.push(
      "INV-4: ConnectionsPage.tsx MUST render <AddFriendSheet> (the one Add a " +
        "friend flow) next to the hoisted CountryPickerModal.",
    );
  }
  if (
    !/visible=\{\s*showAddFriendSheet\s*&&\s*!addFriendPickerOpen\s*\}/.test(cp)
  ) {
    failures.push(
      "INV-4: the Add a friend sheet MUST be gated " +
        "`visible={showAddFriendSheet && !addFriendPickerOpen}` so it drops " +
        "while the country picker presents (iOS one-modal-at-a-time).",
    );
  }
  if (/visible=\{\s*showAddFriendSheet\s*\}/.test(cp)) {
    failures.push(
      "INV-4 (adversarial): the Add a friend sheet MUST NOT use a bare " +
        "`visible={showAddFriendSheet}` — it would co-present with the picker.",
    );
  }
  if (gateDecl && !/\bshowAddFriendSheet\b/.test(gateDecl[1])) {
    failures.push(
      "INV-4: the `anyFriendsChildOpen` expression MUST include " +
        "`showAddFriendSheet` so the friends sheet drops while the Add a friend " +
        "sheet is up.",
    );
  }
  if (
    !/<AddFriendSheet\b[\s\S]*?phoneNumber=\{\s*addFriendPhone\s*\}/.test(cp) ||
    !/<AddFriendSheet\b[\s\S]*?selectedCountry=\{\s*addFriendCountry\s*\}/.test(cp)
  ) {
    failures.push(
      "INV-4: ConnectionsPage MUST pass the hoisted `phoneNumber={addFriendPhone}` " +
        "and `selectedCountry={addFriendCountry}` into <AddFriendSheet> so the " +
        "number and country survive the picker round-trip.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // Minimal fixtures modelling the fixed structure and each reverted variant.
  const GOOD_ADD_FRIEND = `
    export function AddFriendView({ selectedCountry, phoneNumber, onPhoneNumberChange, onOpenCountryPicker }) {
      return (
        <View>
          <TouchableOpacity onPress={onOpenCountryPicker}>
            <Text>{selectedCountry.dialCode}</Text>
          </TouchableOpacity>
          <BottomSheetTextInput value={phoneNumber} onChangeText={onPhoneNumberChange} />
        </View>
      );
    }`;
  const GOOD_CONNECTIONS = `
    const anyFriendsChildOpen =
      friendPickerVisible ||
      addFriendPickerOpen ||
      showAddFriendSheet ||
      showPairRequestModal;
    return (
      <>
        <BaseBottomSheet visible={showFriendsModal && !anyFriendsChildOpen} onClose={handleFriendsModalClose}>
          <FriendsManagementList />
        </BaseBottomSheet>
        <CountryPickerModal visible={addFriendPickerOpen} selectedCode={addFriendCountry.code} onSelect={handleAddFriendCountrySelect} onClose={() => setAddFriendPickerOpen(false)} />
        <AddFriendSheet visible={showAddFriendSheet && !addFriendPickerOpen} onSheetClose={handleAddFriendSheetClose} selectedCountry={addFriendCountry} phoneNumber={addFriendPhone} onPhoneNumberChange={setAddFriendPhone} onOpenCountryPicker={() => setAddFriendPickerOpen(true)} />
      </>
    );`;
  const GOOD_ADD_SHEET = `
    export function AddFriendSheet({ visible, onSheetClose, onDismiss, ...viewProps }) {
      return (
        <BaseBottomSheet visible={visible} onClose={onSheetClose} wrapInRNModal>
          <AddFriendView {...viewProps} onDone={onDismiss} />
        </BaseBottomSheet>
      );
    }`;
  const GOOD_PAIR = `
    return (
      <>
        <BaseBottomSheet visible={visible && !showCountryPicker} onClose={handleSheetClose}>
          <View />
        </BaseBottomSheet>
        <CountryPickerModal visible={showCountryPicker} onClose={() => setShowCountryPicker(false)} />
      </>
    );`;

  const good = (o = {}) => ({
    addFriendSrc: GOOD_ADD_FRIEND,
    connectionsSrc: GOOD_CONNECTIONS,
    pairSrc: GOOD_PAIR,
    addFriendSheetSrc: GOOD_ADD_SHEET,
    ...o,
  });

  // 1. All-good fixed structure → must pass clean.
  let f = [];
  checkPickerNotCopresent(good(), f);
  if (f.length) self.push("fixed structure wrongly flagged: " + f.join("; "));

  // 2. Comment-only mention of the picker in AddFriendView → still clean.
  f = [];
  checkPickerNotCopresent(
    good({
      addFriendSrc:
        "// the picker (a CountryPickerModal) is hoisted to ConnectionsPage\n" +
        GOOD_ADD_FRIEND,
    }),
    f,
  );
  if (f.length) self.push("comment mention wrongly flagged: " + f.join("; "));

  // 3. Revert §4A — AddFriendView renders the picker again → INV-1 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      addFriendSrc:
        GOOD_ADD_FRIEND +
        "\n<CountryPickerModal visible={showCountryPicker} onClose={() => setShowCountryPicker(false)} />",
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-1")))
    self.push("reverted AddFriendView picker not flagged (INV-1)");

  // 4. Revert §4A — AddFriendView re-owns the picker flag → INV-1 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      addFriendSrc:
        "const [showCountryPicker, setShowCountryPicker] = useState(false);\n" +
        GOOD_ADD_FRIEND,
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-1")))
    self.push("reverted AddFriendView picker flag not flagged (INV-1)");

  // 5. Revert §4B — ConnectionsPage drops the sibling picker → INV-2 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      connectionsSrc: GOOD_CONNECTIONS.replace(
        /<CountryPickerModal[\s\S]*?\/>/,
        "",
      ),
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-2")))
    self.push("missing ConnectionsPage sibling picker not flagged (INV-2)");

  // 6. Revert §4B — gate disjunct drops addFriendPickerOpen → INV-2 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      connectionsSrc: GOOD_CONNECTIONS.replace("addFriendPickerOpen ||\n", ""),
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-2")))
    self.push("gate missing addFriendPickerOpen not flagged (INV-2)");

  // 7. Revert §4B — friends sheet regresses to a bare ungated visible → INV-2 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      connectionsSrc: GOOD_CONNECTIONS.replace(
        "visible={showFriendsModal && !anyFriendsChildOpen}",
        "visible={showFriendsModal}",
      ),
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-2")))
    self.push("ungated friends sheet not flagged (INV-2)");

  // 8. Revert §4C — PairRequestModal sheet is bare visible={visible} → INV-3 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      pairSrc: GOOD_PAIR.replace(
        "visible={visible && !showCountryPicker}",
        "visible={visible}",
      ),
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-3")))
    self.push("bare PairRequestModal visible={visible} not flagged (INV-3)");

  // 9. #4114 — the Add a friend sheet renders the picker itself → INV-4 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      addFriendSheetSrc:
        GOOD_ADD_SHEET +
        "\n<CountryPickerModal visible={pickerOpen} onClose={() => setPickerOpen(false)} />",
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-4")))
    self.push("AddFriendSheet rendering the picker not flagged (INV-4)");

  // 10. #4114 — the Add a friend sheet re-owns the typed number → INV-4 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      addFriendSheetSrc:
        'const [addFriendPhone, setAddFriendPhone] = useState("");\n' + GOOD_ADD_SHEET,
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-4")))
    self.push("AddFriendSheet owning the phone state not flagged (INV-4)");

  // 11. #4114 — the Add a friend sheet regresses to a bare ungated visible → INV-4 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      connectionsSrc: GOOD_CONNECTIONS.replace(
        "visible={showAddFriendSheet && !addFriendPickerOpen}",
        "visible={showAddFriendSheet}",
      ),
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-4")))
    self.push("ungated Add a friend sheet not flagged (INV-4)");

  // 12. #4114 — the friends sheet no longer drops for the Add a friend sheet → INV-4 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      connectionsSrc: GOOD_CONNECTIONS.replace("showAddFriendSheet ||\n", ""),
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-4")))
    self.push("gate missing showAddFriendSheet not flagged (INV-4)");

  // 13. #4114 — the Add a friend sheet loses the hoisted number → INV-4 fires.
  f = [];
  checkPickerNotCopresent(
    good({
      connectionsSrc: GOOD_CONNECTIONS.replace(
        "phoneNumber={addFriendPhone}",
        "phoneNumber={localPhone}",
      ),
    }),
    f,
  );
  if (!f.some((m) => m.startsWith("INV-4")))
    self.push("Add a friend sheet without the hoisted phone not flagged (INV-4)");

  if (self.length) {
    console.error(
      "ORCH-1371-1372 picker-not-copresent self-test FAIL:",
    );
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1371-1372 picker-not-copresent self-test PASS (13/13 cases).",
  );
  process.exit(0);
}

const files = [
  ["AddFriendView.tsx", ADD_FRIEND_VIEW],
  ["ConnectionsPage.tsx", CONNECTIONS_PAGE],
  ["PairRequestModal.tsx", PAIR_REQUEST_MODAL],
  ["AddFriendSheet.tsx", ADD_FRIEND_SHEET],
];
for (const [label, file] of files) {
  if (!fs.existsSync(file)) {
    console.error(
      `ORCH-1371-1372 I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL ` +
        `script error: ${label} not found at ${file}.`,
    );
    process.exit(2);
  }
}

const failures = [];
checkPickerNotCopresent(
  {
    addFriendSrc: fs.readFileSync(ADD_FRIEND_VIEW, "utf8"),
    connectionsSrc: fs.readFileSync(CONNECTIONS_PAGE, "utf8"),
    pairSrc: fs.readFileSync(PAIR_REQUEST_MODAL, "utf8"),
    addFriendSheetSrc: fs.readFileSync(ADD_FRIEND_SHEET, "utf8"),
  },
  failures,
);

if (failures.length > 0) {
  console.error(
    "ORCH-1371-1372 I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL FAIL:\n  " +
      failures.join("\n  ") +
      "\n\nSee Mingla_Artifacts/INVARIANT_REGISTRY.md " +
      "I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1371-1372 I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL PASS — " +
    "AddFriendView hoists the picker, ConnectionsPage renders it as a gated " +
    "sibling, PairRequestModal self-gates its own sheet, and the Add a friend " +
    "sheet drops for the picker with its state hoisted.",
);
