// Issue #3802 (Wave 1, homes rework) — regression tests for the tester's
// verdict on the role homes pull request.
//
//   W-1  D-1  one stacking order: board < card < dialog < toast, defined in
//             one file and used by every overlay (the rendered proof that the
//             question opened from a card is the top element at the centre of
//             the screen is in issue3802_wave1_overlay_stack.rendered.test.js)
//   W-2  D-2  a toast never covers an open card: every width from 320 to 1600
//   W-3  F-1  Add to Hosts is always on screen: a card per lead below 1280px
//   W-4  P3a  names by Unicode category, the same answers as the server
//   W-5  P3b  Undo from the keyboard with nothing open goes somewhere real
//   W-6  P3c  the rollback note says which statements need CREATE OR REPLACE
//   W-7  P3d  touch targets are 44px on the screens this work adds or changes
//   W-8  P3e  Enter on an empty target says what is wrong
//   W-9  P3f  an address value that names nothing is dropped from the address
//   W-10      the invite rule is strict, and both sides say the same thing
//
// Fails-on-revert is recorded on the issue.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CRM_LAYER_ORDER, CRM_LAYER_Z, layerStyle } from "../lib/crmLayers.js";
import { EDGE_GAP, NARROWEST_TOAST, PANEL_GAP, USUAL_TOAST, stackEdges, stackPlace } from "../lib/toastPlace.js";
import { nameKey } from "../lib/crmModel.js";
import { buildTeamSearch, parseTeamSearch } from "../lib/crmUrl.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const cp = (...points) => String.fromCodePoint(...points);

const PAGE = read("pages/PipelinePage.jsx");
const LAYER = read("components/crm/CrmLayer.jsx");
const TOAST = read("components/ui/Toast.jsx");
const BETA = read("pages/BetaLeadsPage.jsx");
const TEAM = read("pages/TeamDashboardPage.jsx");
const EDITOR = read("components/crm/home/TargetEditor.jsx");
const DRAWER = read("components/crm/RecordDrawer.jsx");
const CSS = read("globals.css");
const MIGRATION = fs.readFileSync(
  path.resolve(SRC, "../../supabase/migrations/20270823003802_issue_3802_wave1_homes_targets_beta.sql"),
  "utf8"
);
const token = (name) => Number(CSS.match(new RegExp(`--${name}:\\s*(\\d+);`))[1]);

describe("#3802 W-1 (D-1): one stacking order, in one place", () => {
  it("the order is board, card, dialog, toast, and the numbers follow it", () => {
    assert.deepEqual(CRM_LAYER_ORDER, ["board", "card", "dialog", "toast"]);
    assert.deepEqual(Object.keys(CRM_LAYER_Z), ["card", "dialog"]);
    assert.ok(CRM_LAYER_Z.card < CRM_LAYER_Z.dialog, "a dialog opened from a card must be above the card");
    assert.ok(CRM_LAYER_Z.dialog < token("z-toast"), "toasts must be above a dialog");
    assert.ok(CRM_LAYER_Z.card > token("z-overlay") + 1, "a card must be above the phone menu and its scrim");
    assert.ok(CRM_LAYER_Z.card > token("z-sticky"), "a card must be above the page header");
    assert.ok(Object.isFrozen(CRM_LAYER_Z));
  });
  it("a layer's box is a stacking context of its own, so nothing inside it can climb out", () => {
    assert.deepEqual(layerStyle("card"), { position: "relative", zIndex: CRM_LAYER_Z.card });
    assert.deepEqual(layerStyle("dialog"), { position: "relative", zIndex: CRM_LAYER_Z.dialog });
    assert.throws(() => layerStyle("toast"));
    assert.throws(() => layerStyle("constructor"));
  });
  it("every overlay of the boards goes through the one layer component", () => {
    assert.match(LAYER, /<div data-crm-layer=\{name\} style=\{layerStyle\(name\)\}>/);
    assert.match(LAYER, /\{card \? <CrmLayer name="card">\{card\}<\/CrmLayer> : null\}\s*\{dialog \? <CrmLayer name="dialog">\{dialog\}<\/CrmLayer> : null\}/);
    // The page hands the card panel (or the add form) and the Lost/Passed
    // question to that component, and draws no overlay any other way.
    const code = stripComments(PAGE);
    assert.match(code, /<PipelineOverlays\s+card=\{/);
    assert.match(code, /dialog=\{\s*reasonFor \? \(\s*<ReasonPrompt/);
    const overlays = code.slice(code.indexOf("<PipelineOverlays"));
    for (const tag of ["<Drawer ", "<RecordDrawer", "<ReasonPrompt"]) {
      assert.equal(code.split(tag).length - 1, 1, `${tag} is drawn once`);
      assert.ok(overlays.includes(tag), `${tag} is drawn outside the layers`);
    }
    assert.ok(!/createPortal|zIndex|z-\[|z-\d/.test(code), "the page sets a stacking number or a portal of its own");
  });
  it("nothing else on these screens sets a stacking number", () => {
    const dir = path.join(SRC, "components/crm");
    const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, "home")).map((f) => path.join(dir, "home", f))].filter((f) => f.endsWith(".jsx"));
    for (const f of files) {
      const code = stripComments(fs.readFileSync(f, "utf8"));
      if (f.endsWith("CrmLayer.jsx")) continue;
      assert.ok(!/zIndex|\bz-\[|\bz-\d+\b|createPortal/.test(code), `${path.basename(f)} sets a stacking number or a portal`);
    }
  });
});

describe("#3802 W-2 (D-2): a toast never covers an open card, at any width", () => {
  // A side panel is the whole screen below 640px and 440px wide from there up
  // (components/ui/Drawer.jsx: "w-full ... sm:w-[min(440px,100%)]").
  const panelAt = (vw) => (vw < 640 ? vw : Math.min(440, vw));
  it("the drawer is still the width this test assumes", () => {
    assert.match(read("components/ui/Drawer.jsx"), /"relative flex h-full w-full flex-col sm:w-\[min\(440px,100%\)\]"/);
  });
  it("from 640px to 1600px the stack sits wholly to the left of the card, on screen, and wide enough to read", () => {
    for (let vw = 640; vw <= 1600; vw++) {
      const place = stackPlace(vw, panelAt(vw), true);
      assert.ok(place.beside > 0, `${vw}px: the stack is not beside the card`);
      const edges = stackEdges(vw, place);
      const cardLeft = vw - panelAt(vw);
      assert.ok(edges.right <= cardLeft - PANEL_GAP + 0.001, `${vw}px: the stack reaches the card`);
      assert.ok(edges.left >= EDGE_GAP, `${vw}px: the stack leaves the screen`);
      assert.ok(edges.right - edges.left >= NARROWEST_TOAST, `${vw}px: only ${edges.right - edges.left}px for a toast`);
      assert.equal(place.fill, edges.right - edges.left < USUAL_TOAST, `${vw}px: fill`);
    }
  });
  it("the widths the tester named (640 to 807) are no longer the bottom-of-the-card case", () => {
    for (const vw of [640, 700, 768, 799]) assert.deepEqual(stackPlace(vw, 440, true), { beside: 440, fill: true });
    for (const vw of [800, 807, 808]) assert.deepEqual(stackPlace(vw, 440, true), { beside: 440, fill: false });
    assert.deepEqual(stackPlace(1400, 440, true), { beside: 440, fill: false });
  });
  it("on a phone the card is the whole screen: the stack stays at the bottom and the card makes room", () => {
    for (let vw = 320; vw < 640; vw++) assert.deepEqual(stackPlace(vw, panelAt(vw), false), { beside: 0, fill: false }, `${vw}px`);
    assert.deepEqual(stackPlace(1400, 0, true), { beside: 0, fill: false }, "no card open");
    assert.deepEqual(stackPlace(700, 660, true), { beside: 0, fill: false }, "no room beside a wider panel");
    // The stack tells the page how tall it is; the card and the add form leave that much room after their last field.
    assert.match(TOAST, /root\.style\.setProperty\("--toast-clear", `\$\{region\.offsetHeight \+ CLEAR_GAP\}px`\);/);
    assert.match(TOAST, /root\.style\.removeProperty\("--toast-clear"\);/);
    assert.match(TOAST, /useClearSpace\(regionRef, toasts\.length > 0 && besidePanel === 0\);/);
    assert.match(DRAWER, /<div className="flex flex-col gap-5" style=\{\{ paddingBottom: "var\(--toast-clear, 0px\)" \}\}>/);
    assert.match(PAGE, /<div style=\{\{ paddingBottom: "var\(--toast-clear, 0px\)" \}\}>\s*<AddRecordForm/);
  });
  it("a toast narrower than usual takes the room there is instead of spilling over", () => {
    assert.match(TOAST, /style=\{fill \? \{ minWidth: 0, width: "100%" \} : undefined\}/);
    assert.match(TOAST, /style=\{fill \? \{ width: "100%" \} : undefined\}/);
    assert.match(TOAST, /left: `\$\{EDGE_GAP\}px`, right: `\$\{besidePanel \+ PANEL_GAP\}px`/);
  });
});

describe("#3802 W-3 (F-1): Add to Hosts is always on screen", () => {
  it("below 1280px every lead is a card with the control in it; the table is only drawn from 1280px", () => {
    assert.match(BETA, /<div className="hidden xl:block">\s*<DataTable/);
    assert.match(BETA, /<div className="xl:hidden">/);
    assert.match(BETA, /<div className="shrink-0 sm:w-\[220px\]">\{renderAction\(row, \{ block: true \}\)\}<\/div>/);
    assert.match(BETA, /render: \(_v, row\) => <div className="min-w-\[150px\]">\{renderAction\(row\)\}<\/div>,/);
  });
  it("both layouts use the one control, so they cannot drift apart", () => {
    assert.equal((BETA.match(/Add to Hosts"\}/g) || []).length, 1);
    assert.equal((BETA.match(/>\s*Open host\s*<\/a>/g) || []).length, 1);
    assert.equal((BETA.match(/onClick=\{\(\) => addToHosts\(row\)\}/g) || []).length, 1);
  });
  it("the table has five columns, so it fits beside the menu at 1280px", () => {
    const keys = [...BETA.slice(BETA.indexOf("const columns = useMemo"), BETA.indexOf("const emptyMessage")).matchAll(/^\s{8}key: "([a-z_]+)",$/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ["business", "contact_name", "city", "created_at", "host"]);
    assert.ok(!/width: "\d+px"/.test(BETA), "a column has a fixed width again");
  });
  it("the contact name and email stay readable in both", () => {
    assert.match(BETA, /\{row\.contact_name\}<\/p>\s*\{renderEmail\(row\)\}/);
    assert.equal((BETA.match(/\{renderEmail\(row\)\}/g) || []).length, 2);
    assert.match(BETA, /break-all rounded-md text-left font-mono/);
  });
  it("the card states are all there: loading, nothing yet, nothing new", () => {
    const cards = BETA.slice(BETA.indexOf('<div className="xl:hidden">'));
    assert.match(cards, /aria-busy="true"/);
    assert.match(cards, /\{emptyMessage\}<\/p>\s*\{emptyAction\}/);
    assert.match(BETA, /"No new leads\. Every lead is already in Hosts\."/);
    assert.match(BETA, /Open Hosts/);
  });
});

describe("#3802 W-4 (P3a): names by Unicode category", () => {
  // The same inputs as H-3 in the SQL suite.
  const REFUSED = [
    ["a Devanagari mark alone", [0x93f]], ["Thai marks alone", [0xe34, 0xe48]], ["Hebrew points alone", [0x5b4, 0x5c1]],
    ["Arabic marks alone", [0x64e, 0x651]], ["an enclosing mark alone", [0x20dd]], ["a spacing mark alone", [0x903]],
    ["marks of five scripts", [0x301, 0x93f, 0xe34, 0x5b4, 0x1e8d0]], ["a shapeless note head", [0x1d159]], ["a script filler", [0x16fe4]],
    ["a sign fill modifier", [0x1da9b]], ["private use", [0xe000, 0xf0000, 0x100000]], ["unassigned", [0x378, 0xe0080]],
    ["format characters", [0x600, 0x200e]], ["joiners alone", [0x200c, 0x200d]], ["tag characters", [0xe0020, 0xe007f]],
    ["variation selectors", [0xfe0f, 0xe0100]], ["controls", [0x7, 0x85]], ["a lone surrogate", [0xd800]],
  ];
  const KEPT = [
    ["accented Latin", cp(0xc9) + "cole Fran" + cp(0xe7) + "aise", cp(0xe9) + "colefran" + cp(0xe7) + "aise"],
    ["Hebrew with points", cp(0x5e9, 0x5b4, 0x5c1, 0x5dc, 0x5d5, 0x5dd), cp(0x5e9, 0x5dc, 0x5d5, 0x5dd)],
    ["Arabic with marks", cp(0x645, 0x64e, 0x637, 0x639, 0x64e, 0x645), cp(0x645, 0x637, 0x639, 0x645)],
    ["kana", cp(0x3059, 0x3057, 0x20, 0x30e9, 0x30fc, 0x30e1, 0x30f3), cp(0x3059, 0x3057, 0x30e9, 0x30fc, 0x30e1, 0x30f3)],
    ["CJK", cp(0x65e5, 0x672c, 0x6599, 0x7406), cp(0x65e5, 0x672c, 0x6599, 0x7406)],
    ["Hangul", cp(0xd55c, 0xad6d, 0x20, 0xc2dd, 0xb2f9), cp(0xd55c, 0xad6d, 0xc2dd, 0xb2f9)],
    ["star symbols", cp(0x2605, 0x2605), cp(0x2605, 0x2605)],
    ["an emoji made with a joiner", cp(0x1f468, 0x200d, 0x1f373), cp(0x1f468, 0x1f373)],
    ["a flag", cp(0x1f1f3, 0x1f1ec), cp(0x1f1f3, 0x1f1ec)],
    ["an emoji", cp(0x1f355), cp(0x1f355)],
  ];
  it("a name with no letter, digit, symbol or emoji left is nothing, whatever script its marks are from", () => {
    for (const [label, points] of REFUSED) assert.equal(nameKey(cp(...points)), "", label);
  });
  it("a name in any script keeps working, with its marks attached to letters", () => {
    for (const [label, input, want] of KEPT) assert.equal(nameKey(input), want, label);
    for (const [label, input] of [["Devanagari", cp(0x915, 0x93f, 0x924, 0x93e, 0x92c)], ["Thai", cp(0xe01, 0xe34, 0xe19, 0xe02, 0xe49, 0xe32, 0xe27)]]) {
      assert.notEqual(nameKey(input), "", label);
    }
  });
  it("the rule is by category on both sides, not a hand-picked list", () => {
    const model = read("lib/crmModel.js");
    assert.match(model, /\\p\{Z\}\\p\{Cc\}\\p\{Cf\}\\p\{Co\}\\p\{Cn\}\\p\{Cs\}/);
    assert.match(model, /const NAME_KEY_MARKS = \/\\p\{M\}\+\/gu;/);
    assert.match(MIGRATION, /GENERATED from the Unicode general categories/);
    // The server's marks class reaches scripts the earlier list did not.
    const fn = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.crm_name_key"), MIGRATION.indexOf("REVOKE EXECUTE ON FUNCTION public.crm_name_key"));
    for (const range of ["-\\u0903", "\\u0E31", "\\u0591-\\u05BD", "\\u064B-\\u065F", "\\u20D0-\\u20F0", "\\uE000-\\uF8FF", "-\\U0010FFFF", "\\U00016FE4", "\\U0001D159"]) {
      assert.ok(fn.includes(range), `the server's classes do not cover ${range}`);
    }
    assert.ok(/^[\x20-\x7e\n]*$/.test(fn), "the function holds a character that is not plain ASCII");
  });
});

describe("#3802 W-5 (P3b): Undo from the keyboard with nothing open", () => {
  it("a toast can say where focus goes when no card or dialog is open", () => {
    assert.match(TOAST, /function focusReturn\(toastEl, elsewhere\)/);
    assert.match(TOAST, /const next = typeof elsewhere === "function" \? elsewhere\(\) : null;\s*if \(next && typeof next\.focus === "function" && document\.body\.contains\(next\)\) next\.focus\(\);/);
    // An open card or dialog still wins.
    assert.ok(TOAST.indexOf("panel.focus();") < TOAST.indexOf("const next = typeof elsewhere"));
  });
  it("the Team dashboard's Undo sends focus to the targets, where the change was made", () => {
    assert.match(TEAM, /focusAfter: \(\) => targetsRef\.current,/);
    assert.match(TEAM, /<section ref=\{targetsRef\} tabIndex=\{-1\} aria-label="Targets this month"/);
  });
  it("the board's Undo sends focus back to the card that moved", () => {
    assert.match(PAGE, /focusAfter: \(\) => \[\.\.\.document\.querySelectorAll\("\[data-record-id\]"\)\]\.find\(\(el\) => el\.getAttribute\("data-record-id"\) === record\.id\) \|\| addButtonRef\.current,/);
  });
});

describe("#3802 W-6 (P3c): the rollback note is accurate", () => {
  const note = MIGRATION.slice(MIGRATION.indexOf("-- ROLLBACK"), MIGRATION.indexOf("\nBEGIN;"));
  it("it says which four statements need CREATE OR REPLACE, and no longer says 'verbatim'", () => {
    assert.ok(!/verbatim/i.test(note));
    assert.match(note, /"CREATE FUNCTION" to "CREATE OR REPLACE FUNCTION"/);
    for (const fn of ["crm_reconcile_live", "crm_validate_fields", "crm_name_key", "admin_team_issue_invite"]) assert.ok(note.includes(fn), fn);
    assert.match(note, /crm_record_move_stage\(uuid, text, text\): copy its CREATE FUNCTION/);
  });
});

describe("#3802 W-7 (P3d): touch targets are 44px on the screens this work adds or changes", () => {
  it("no control on those screens is 40px tall on a phone any more", () => {
    const files = ["pages/RoleHomePage.jsx", "pages/TeamDashboardPage.jsx", "pages/BetaLeadsPage.jsx", "pages/PipelinePage.jsx", "components/crm/RecordDrawer.jsx",
      ...fs.readdirSync(path.join(SRC, "components/crm/home")).map((f) => `components/crm/home/${f}`)];
    for (const f of files) assert.ok(!/max-sm:h-10\b/.test(read(f)), `${f} still has a 40px phone control`);
  });
  it("the shared pieces those screens use are 44px on a phone", () => {
    assert.match(read("components/crm/home/DueList.jsx"), /"inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-semibold no-underline max-sm:h-11",/);
    const fields = read("components/crm/fields.jsx");
    assert.match(fields, /"w-full h-10 max-sm:h-11 px-3 text-sm /);
    assert.match(fields, /"h-10 max-sm:h-11 px-3 text-sm font-medium rounded-md /);
    assert.match(TEAM, /"inline-flex h-10 items-center gap-1\.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150 max-sm:h-11",/);
  });
  it("Add to Hosts, Open host and the email are 44px wherever the cards are shown", () => {
    assert.match(BETA, /className=\{block \? "!h-11 w-full !text-sm" : "max-xl:!h-11"\}/);
    assert.match(BETA, /inline-flex min-h-11 max-w-full cursor-pointer/);
    assert.match(BETA, /className=\{`\$\{LINK_BUTTON_CLASS\} \$\{block \? "!h-11 w-full" : /);
  });
  it("the accept screen's buttons are 44px", () => {
    const accept = read("components/InviteAcceptScreen.jsx");
    assert.match(accept, /width: "100%",\s*minHeight: 44,/);
    assert.ok(!/height: 38,/.test(accept));
    assert.ok(!/minHeight: 40,/.test(accept));
  });
});

describe("#3802 W-8 (P3e): Enter on an empty target says what is wrong", () => {
  it("an empty or unusable number is answered in plain words, and focus stays in the field", () => {
    assert.match(EDITOR, /const EMPTY_HELP = "Type a whole number from 1 to 1000\. To take the target away, press Cancel and then Remove\.";/);
    assert.match(EDITOR, /if \(number === null\) \{[\s\S]{0,120}setError\(typed\.trim\(\) === "" \? EMPTY_HELP : NUMBER_HELP\);\s*inputRef\.current\?\.focus\(\);\s*return;\s*\}/);
    // Save is pressable so that it can answer too; it is only off while offline.
    assert.match(EDITOR, /<Button size="sm" className="max-sm:h-11" disabled=\{offline\} onClick=\{save\}>/);
    assert.match(EDITOR, /if \(e\.key === "Enter"\) \{\s*e\.preventDefault\(\);\s*save\(\);/);
  });
});

describe("#3802 W-9 (P3f): an address value that names nothing is dropped", () => {
  it("the Team dashboard rewrites the address to what it understood", () => {
    assert.match(TEAM, /const clean = buildTeamSearch\(\{ person: picked \}\);\s*if \(search !== clean\) setSearch\(clean, \{ replace: true \}\);/);
    for (const junk of ["person=nobody", "person=%3Cscript%3E", "x=1&person=a", "person="]) assert.equal(buildTeamSearch(parseTeamSearch(junk)), "", junk);
    assert.equal(buildTeamSearch({ person: "" }), "");
  });
  it("Beta leads does the same for its filter", () => {
    assert.match(BETA, /if \(search !== buildBetaSearch\(\{ show \}\)\) setSearch\(buildBetaSearch\(\{ show \}\), \{ replace: true \}\);/);
  });
});

describe("#3802 W-10: the invite rule is strict, in one place", () => {
  it("the database refuses any way of signing in other than email", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.admin_team_invite_address_verdict"), MIGRATION.indexOf("REVOKE EXECUTE ON FUNCTION public.admin_team_invite_address_verdict"));
    assert.match(fn, /AND i\.provider IS DISTINCT FROM 'email'\) THEN\s*RETURN 'conflict';/);
    assert.ok(!/identity_data/.test(fn), "the rule looks at which address a social sign-in is under again");
    assert.match(fn, /IF btrim\(COALESCE\(v_phone, ''\)\) <> '' THEN\s*RETURN 'conflict';/);
  });
  it("opening an invitation asks that same rule", () => {
    const accept = fs.readFileSync(path.resolve(SRC, "../../supabase/functions/admin-team-accept-invite/index.ts"), "utf8");
    assert.match(accept, /"admin_team_invite_address_verdict",\s*\{ p_email: seen\.email \},/);
    const shared = fs.readFileSync(path.resolve(SRC, "../../supabase/functions/_shared/adminTeamInvite.ts"), "utf8");
    assert.match(shared, /if \(identity\.provider !== "email"\) return "conflict";/);
  });
  it("the words on screen say the same thing on both sides", () => {
    assert.match(read("pages/AdminPage.jsx"), /already has a Mingla account that signs in another way \(a phone number, or Google or Apple\)\./);
    assert.match(read("lib/inviteLink.js"), /already has a Mingla account that signs in another way, so team access can't be added to it\./);
  });
});

describe("#3802 W-5 (P3b): the toast's own buttons hand that place on", () => {
  it("Undo and the close button both pass the owner's answer to the focus return", () => {
    assert.match(TOAST, /const restoreFocus = focusReturn\(rootRef\.current, toast\.action\.focusAfter\);\s*onDismiss\(toast\.id\);\s*toast\.action\.onClick\?\.\(\);\s*restoreFocus\(\);/);
    assert.match(TOAST, /const restoreFocus = focusReturn\(rootRef\.current, toast\.action\?\.focusAfter\);\s*onDismiss\(toast\.id\);\s*restoreFocus\(\);/);
  });
});
