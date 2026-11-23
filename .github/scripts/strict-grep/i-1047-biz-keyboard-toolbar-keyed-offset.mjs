#!/usr/bin/env node
/**
 * I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET  (issue #1047, extended by #1850)
 *
 * Re-homes the load-bearing parts of the keyboard Done-bar invariant previously
 * pinned by `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts`
 * (ORCH-1165 / ORCH-1170), which is quarantined by the #1047 block of
 * `mingla-business/jest.config.cjs`.
 *
 * WHAT THAT QUARANTINED FILE ACTUALLY PINNED — measured, not estimated (#1850).
 * The header this gate shipped with said "~13 checkout-scrollview paddings (some
 * drifted)". That was wrong in three ways, and #1850 replayed all of it against
 * the tree to get the real numbers:
 *
 *   - It is TWO describe blocks, not one: 41 assertions over 17 source files.
 *   - The second block is the ORCH-1170 per-Modal-window provider rule (8
 *     assertions). The old header did not mention it at all, and this gate did
 *     not enforce it — see rule (C), which restores it.
 *   - "(some drifted)" is exactly 3 assertions, all on the three checkout BUYER
 *     screens, all red since 2026-07-01 (ORCH-1252 / PR #701 migrated them to
 *     SmartScrollView and deleted the pinned expression). The PIN was wrong, not
 *     the code, and no live defect is attributable to the drift.
 *
 * The full moved/dropped ledger for the hand-off now lives beside the quarantine
 * entry in `mingla-business/jest.config.cjs`, and
 * `issue-1850-quarantine-invariant-handoff-complete.mjs` fails if it stops
 * reconciling against this gate's own target list.
 *
 * THE RULE:
 *  (A) MOUNT COVERAGE — the Done bar can only reach a focused field if a
 *      <KeyboardToolbarRoot/> is rendered in the SAME native window. Three host
 *      windows must each render it: app/_layout.tsx (root), SheetMobile.tsx (sheet
 *      Modal window), Modal.tsx (dialog Modal window).
 *  (B) KEYED-ON-KEYBOARD-OPEN OFFSET — the Done-bar clearance MUST be gated on the
 *      keyboard being open (`> 0 ? … + 42`), NEVER unconditional (an unconditional
 *      offset leaves a permanent dead gap). Pinned on the three stable surfaces
 *      (auth welcome, waitlist sheet, marketing composer).
 *  (C) ORCH-1170 PER-WINDOW PROVIDER NESTING (restored by #1850) — in the two
 *      Modal hosts the toolbar must render INSIDE that window's own
 *      <KeyboardRoot>. A toolbar that is a SIBLING of the provider mounts and then
 *      never appears: this was a proven Samsung defect, where rule (A) passed, the
 *      bar mounted, and it still never showed, because a RN <Modal> is a separate
 *      native window that the app-root provider does not reach.
 *  (D) NO NUMERIC DONE-BAR LITERAL (added by #1850) — the four surfaces that
 *      budget clearance for the bar by hand must derive it from
 *      `DONE_BAR_OCCUPIED`, never type a number. `42` is the library's
 *      KEYBOARD_TOOLBAR_HEIGHT — the bar's own height — which is NOT what the bar
 *      occupies above the keyboard: #1834 measured 53 on iOS 26+, because the
 *      library floats the bar 11pt clear of the keyboard's rounded corners. Every
 *      hand-typed 42 was therefore 11pt short on iOS 26+, leaving the composer
 *      partially behind the bar. `DONE_BAR_OCCUPIED` is derived in
 *      `src/wrappers/SmartScrollView.native.tsx` from the same inputs the library
 *      uses, so an OS bump or a library change to OPENED_OFFSET moves it with no
 *      edit here.
 *
 *  (E) ARI COMPOSER IS FLUSH ON THE KEYBOARD (REPLACED by #4572 item 16).
 *      Rule (E) pinned Ari's keyboard-open lift as EXACTLY
 *      `keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE` (#1890; before
 *      that it demanded the opposite, a measured pill height, which is the double
 *      count #1890 removed). Seth approved a different contract on 2026-11-23: the
 *      Ari composer rides the keyboard frame by frame in a keyboard-controller
 *      KeyboardAvoidingView (the #4173 messages pattern) and sits FLUSH on it, with
 *      no Done bar and no clearance while it is focused. So the lift expression no
 *      longer exists, and the rule now pins that: AriChatScreen must render its
 *      composer inside the wrapper's `<KeyboardAvoidingView behavior="padding">`,
 *      and must NOT carry DONE_BAR_OCCUPIED, MIN_VISIBLE_CLEARANCE, the old
 *      `composerOccupiedPxFor` lift, a keyboard-open ternary, or the pill-measuring
 *      plumbing. AriChatScreen also leaves rule (D), which only applies to
 *      surfaces that still budget the bar by hand. ASSERTION REPLACED: "the lift is
 *      exactly keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE".
 *
 * Rule (B) still names 42 on purpose: those three surfaces add the clearance to a
 * `spacing.*` term and were NOT migrated by #1850 (two of them are additionally
 * pinned by live jest suites that append-only forbids editing). Rule (D)'s
 * allowlist is exactly the four that were migrated. Widening (D) means migrating
 * the surface first — that ordering is the whole point.
 *
 * VACUITY: resolving zero target files for any rule is `exit 2` (VACUOUS), never a
 * silent pass. `--self-test` runs the fixture battery below.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BIZ = path.join(REPO, "mingla-business");
const SELF_TEST = process.argv.includes("--self-test");
/**
 * Only scan when invoked directly. `run` is imported by
 * `__tests__/issue-1850-quarantine-invariant-handoff.happy.test.mjs`, which drives it
 * with a mutated file map; without this guard the import alone would scan and exit.
 */
const IS_MAIN =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const stripImports = (s) => s.split("\n").filter((l) => !/^\s*import\b/.test(l)).join("\n");
/**
 * Removes whole import STATEMENTS, including the multi-line `import {\n  A,\n  B,\n}
 * from "…"` form that a line-prefix filter leaves half-standing — which would let the
 * bare name `DONE_BAR_OCCUPIED,` sitting on its own line inside an import count as a
 * USE. Used only by rule (D)'s use-check, where that distinction decides the verdict.
 */
const stripImportStatements = (s) =>
  s
    .replace(/^[ \t]*import\b[\s\S]*?\bfrom\s*["'][^"']*["'][ \t]*;?/gm, "")
    .replace(/^[ \t]*import\s*["'][^"']*["'][ \t]*;?/gm, "");
/** Comments never satisfy — and never violate — a source rule. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** (A) the three host windows that must render the toolbar in their own window. */
const MOUNT_HOSTS = [
  "app/_layout.tsx",
  "src/components/ui/SheetMobile.tsx",
  "src/components/ui/Modal.tsx",
];

/**
 * (B) surfaces whose clearance is added to a spacing term and stays literal.
 *
 * #2262 REMOVED the marketing composer from this cohort, and that is a
 * PROMOTION, not an exemption. This rule's contract is "if you hand-type a 42,
 * at least gate it on keyboard-open so it does not leave a permanent dead gap".
 * Rule (D)'s contract is "do not hand-type it at all — derive it from
 * DONE_BAR_OCCUPIED", which is strictly stronger: (B) tolerates the literal,
 * (D) forbids it.
 *
 * This gate's own header states the ordering: "Rule (D)'s allowlist is exactly
 * the four that were migrated. Widening (D) means migrating the surface first —
 * that ordering is the whole point." #2262 migrated the composer. It deleted the
 * hand-rolled `Keyboard.addListener` + `keyboardHeight > 0 ? keyboardHeight + 42`
 * shrink entirely and moved the budget to `SmartKeyboardAvoidingView` with
 * `keyboardVerticalOffset={DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE}`, read from
 * the canonical `wrappers/keyboardClearance` module.
 *
 * The composer therefore appears in DERIVED_CLEARANCE below, at its new home:
 * the budget now lives in the ROUTE (`compose.tsx`), not in `ComposerV2Editor`,
 * which no longer has any keyboard responsibility at all. `ComposerV2Editor` is
 * separately forbidden from re-growing one — `i-2262-composer-measured-not-
 * computed-layout.mjs` rule R4 bans `Keyboard.addListener` in that file
 * outright, with or without an inline marker, and R1/R3 ban the constants.
 *
 * A permanent dead gap is impossible under the new mechanism: the library's
 * `KeyboardAvoidingView` interpolates the offset off `keyboard.progress.value`
 * inside a Reanimated worklet, so with the keyboard closed progress is 0 and the
 * offset contributes nothing. The gating moved from a hand-rolled ternary into
 * the library's own progress track — which is what (B) was approximating.
 */
const KEYED = [
  ["src/components/auth/BusinessWelcomeScreen.tsx", /keyboardPad\s*>\s*0\s*\?\s*keyboardPad\s*\+\s*42/],
  ["src/components/waitlist/JoinWaitlistSheet.tsx", /keyboardPadding\s*>\s*0\s*\?\s*42/],
];

/** (C) the two Modal windows that must nest the toolbar inside their provider. */
const NESTED_PROVIDER_HOSTS = [
  "src/components/ui/SheetMobile.tsx",
  "src/components/ui/Modal.tsx",
];

/** (D) surfaces migrated off the literal by #1850, extended by #2262. */
const DERIVED_CLEARANCE = [
  "src/components/groupChat/GroupChatPanel.tsx",
  "src/components/support/SupportThread.native.tsx",
  "src/components/brand/BrandPaystackOnboardView.tsx",
  // #4572 item 16: AriChatScreen LEFT this list. Its composer is flush on the
  // keyboard now (no Done-bar budget), pinned by rule (E) below.
  // #2262 — the marketing composer, promoted out of (B). The budget lives in the
  // ROUTE now, not in ComposerV2Editor: the route owns the
  // SmartKeyboardAvoidingView and therefore owns the offset.
  "app/(tabs)/marketing/campaigns/compose.tsx",
];

/**
 * (C) the toolbar must be NESTED inside the window's own provider, not a sibling.
 * Import lines are stripped first so the `import { KeyboardRoot } …` line cannot
 * be mistaken for an opening tag.
 */
const NESTED = /<KeyboardRoot\b[^>]*>[\s\S]*<KeyboardToolbarRoot\s*\/?>[\s\S]*<\/KeyboardRoot>/;

/** (D) a hand-typed offset, and a hand-typed clearance term in a keyboard branch. */
const LITERAL_KAV_OFFSET = /keyboardVerticalOffset\s*=\s*\{\s*\d+(?:\.\d+)?\s*\}/;
const LITERAL_CLEARANCE_TERM = /keyboard[A-Za-z]*\s*(?:>\s*0[\s\S]{0,200}?)?\+\s*42\b/;
/**
 * (D) the derivation must be IMPORTED from the shared model.
 *
 * #2262 widened the accepted module set by one, and it is the canonical one.
 * `wrappers/keyboardClearance` is where #1890 DEFINES these terms ("the terms
 * live here, once, and every surface reads them");
 * `wrappers/SmartScrollView.native.tsx` merely RE-EXPORTS them for #1834's
 * existing consumers. Accepting only the re-export forced a surface with no
 * scroll container to import from the scroll wrapper purely to satisfy a regex —
 * which is how a rule starts shaping code against its own intent.
 *
 * This admits nothing the old pattern rejected except a STRICTER source: the
 * definition site instead of a re-export. The name must still be imported AND
 * used outside imports and comments (USES_DERIVED, below), and the literal bans
 * are untouched.
 */
const IMPORTS_DERIVED = /import\s*\{[^}]*\bDONE_BAR_OCCUPIED\b[^}]*\}\s*from\s*["'][^"']*wrappers\/(?:SmartScrollView|keyboardClearance)["']/;
/** …and it must actually be USED, not just imported (#1850 TEST P2-6). */
const USES_DERIVED = /\bDONE_BAR_OCCUPIED\b/;

/**
 * (E) ARI COMPOSER IS FLUSH ON THE KEYBOARD — replaced by #4572 item 16.
 *
 * `required` patterns must match the comment-stripped source; `banned` must not.
 * An unreadable subject is already exit 2 (the MISSING check in `run`), and an
 * empty rule list is VACUOUS, so neither can read as a pass.
 */
export const ARI_COMPOSER_FLUSH = {
  rel: "src/screens/ari/AriChatScreen.tsx",
  required: [
    [
      /import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*["'][^"']*wrappers\/SmartKeyboardAvoidingView["']/,
      "the import of KeyboardAvoidingView from wrappers/SmartKeyboardAvoidingView",
    ],
    [
      /<KeyboardAvoidingView\b[^>]*\bbehavior=["']padding["']/,
      '<KeyboardAvoidingView behavior="padding"> around the composer',
    ],
  ],
  banned: [
    [/\bDONE_BAR_OCCUPIED\b/, "DONE_BAR_OCCUPIED (the composer sits flush: no Done bar)"],
    [/\bMIN_VISIBLE_CLEARANCE\b/, "MIN_VISIBLE_CLEARANCE (the composer sits flush: 0 clearance)"],
    [/\bcomposerOccupiedPxFor\b/, "the old composerOccupiedPxFor lift"],
    [
      /keyboardHeight\s*>\s*0\s*\?/,
      "a keyboard-open ternary (no keyboard height may position the composer; it rides the KeyboardAvoidingView)",
    ],
    [/styles\.inputWrap[\s\S]{0,1500}?\bkeyboardHeight\b/, "keyboardHeight inside the composer wrapper's style"],
    [/onLayout\s*=\s*\{\s*onComposerLayout\s*\}/, "onLayout={onComposerLayout} on a composer wrapper"],
    [/setComposerHeight\s*\(/, "a setComposerHeight(…) call"],
  ],
};

/**
 * The whole check, over an injected file map so `--self-test` can drive it with
 * fixtures instead of the tree. `files` maps a mingla-business-relative path to
 * its source, or to `null` for "not readable".
 *
 * Returns { code, failures }: 0 clean, 1 rule violation, 2 vacuous/unreadable.
 */
export function run({ files, mountHosts, keyed, nestedHosts, derivedHosts, measured }) {
  const get = (rel) => (files.has(rel) ? files.get(rel) : null);

  // ---- VACUITY: a rule that resolves no targets checks nothing. ----
  const empty = [];
  if (mountHosts.length === 0) empty.push("(A) mount coverage");
  if (keyed.length === 0) empty.push("(B) keyed offset");
  if (nestedHosts.length === 0) empty.push("(C) provider nesting");
  if (derivedHosts.length === 0) empty.push("(D) derived clearance");
  if (measured.length === 0) empty.push("(E) Ari composer flush on the keyboard");
  if (empty.length > 0) {
    return {
      code: 2,
      failures: [
        `VACUOUS: ${empty.join(", ")} resolved ZERO target files. A rule with an empty ` +
          "target list passes no matter what the tree looks like, which reads identically " +
          "to a rule that holds. Repoint or delete the rule in the same PR that empties it.",
      ],
    };
  }

  // ---- VACUITY: an unreadable target is a hard stop, never a skip (#1559). ----
  const all = [...new Set([...mountHosts, ...keyed.map(([r]) => r), ...nestedHosts, ...derivedHosts, ...measured.map((sp) => sp.rel)])];
  const missing = all.filter((rel) => typeof get(rel) !== "string");
  if (missing.length > 0) {
    return {
      code: 2,
      failures: missing.map(
        (rel) =>
          `${rel}: MISSING or unreadable. A keyboard host that disappears takes its rule with ` +
          "it; skipping it would turn this gate green by subtraction.",
      ),
    };
  }

  const failures = [];

  // ---- (A) mount coverage -------------------------------------------------
  for (const rel of mountHosts) {
    if (!/<KeyboardToolbarRoot\s*\/?>/.test(stripImports(get(rel)))) {
      failures.push(
        `${rel} no longer renders <KeyboardToolbarRoot/> — inputs in its native window get no Done bar.`,
      );
    }
  }

  // ---- (B) keyed (never-unconditional) offsets ----------------------------
  for (const [rel, re] of keyed) {
    if (!re.test(get(rel))) {
      failures.push(
        `${rel} no longer gates its +42 Done-bar offset on keyboard-open (\`> 0 ? … + 42\`) — ` +
          "an unconditional offset leaves a permanent dead 42pt gap.",
      );
    }
  }

  // ---- (C) ORCH-1170 per-window provider nesting --------------------------
  for (const rel of nestedHosts) {
    const body = stripImports(get(rel));
    if (!NESTED.test(body)) {
      failures.push(
        `${rel}: <KeyboardToolbarRoot/> is not nested inside this window's own <KeyboardRoot>. ` +
          "ORCH-1170: the bar mounts but never appears — a RN Modal is a separate native window " +
          "and the app-root provider does not reach it. A toolbar rendered as a SIBLING of the " +
          "provider passes rule (A) and still shows nothing (proven on Samsung). Wrap it.",
      );
    }
  }

  // ---- (D) no numeric Done-bar literal ------------------------------------
  for (const rel of derivedHosts) {
    const raw = get(rel);
    if (!IMPORTS_DERIVED.test(raw)) {
      failures.push(
        `${rel} does not import DONE_BAR_OCCUPIED from src/wrappers/SmartScrollView — its ` +
          "Done-bar clearance is not derived from #1834's model.",
      );
    }
    const code = stripComments(raw);
    // #1850 TEST P2-6 — the import alone was enough to satisfy this rule, so
    // DELETING the clearance term while keeping the import read as GREEN: no
    // literal, an import present, and no clearance at all. That is the rule
    // failing at its own job, not a documentation gap. The name must be USED,
    // outside imports and outside comments.
    if (!USES_DERIVED.test(stripImportStatements(code))) {
      failures.push(
        `${rel} imports DONE_BAR_OCCUPIED but never USES it. An unused import is not a derivation — ` +
          "deleting the clearance term while keeping the import leaves the surface with NO Done-bar " +
          "budget at all, which is worse than the literal this rule replaced.",
      );
    }
    if (LITERAL_KAV_OFFSET.test(code)) {
      failures.push(
        `${rel} sets keyboardVerticalOffset to a NUMERIC LITERAL. Use DONE_BAR_OCCUPIED: 42 is ` +
          "KEYBOARD_TOOLBAR_HEIGHT (the bar's own height), not what the bar occupies above the " +
          "keyboard — #1834 measured 53 on iOS 26+, so a literal 42 sits 11pt short and leaves " +
          "the composer partly behind the bar.",
      );
    }
    if (LITERAL_CLEARANCE_TERM.test(code)) {
      failures.push(
        `${rel} adds a hand-typed \`+ 42\` clearance term inside a keyboard-conditional ` +
          "expression. Use DONE_BAR_OCCUPIED — the derived value moves with the OS and the " +
          "library; a literal does not.",
      );
    }
  }

  // ---- (E) the Ari composer is flush on the keyboard -----------------------
  for (const spec of measured) {
    const code = stripComments(get(spec.rel));
    for (const [re, what] of spec.required) {
      if (!re.test(code)) {
        failures.push(
          `${spec.rel} no longer has ${what}. #4572 item 16: the Ari composer rides the keyboard ` +
            "frame by frame in the keyboard-controller KeyboardAvoidingView and sits flush on it " +
            "(no Done bar, 0 clearance); without the wrapper it falls back to a React-state lift " +
            "that leaps to the keyboard's final height in one step.",
        );
      }
    }
    for (const [re, what] of spec.banned) {
      if (re.test(code)) {
        failures.push(
          `${spec.rel} carries ${what} again. #4572 item 16 removed it: the Ari composer is flush ` +
            "on the keyboard, positioned by the library, with no Done-bar budget, no clearance " +
            "term and no measured pill height (the #1890 double count).",
        );
      }
    }
  }

  return { code: failures.length > 0 ? 1 : 0, failures };
}

// ───────────────────────────── self-test ──────────────────────────────────
if (IS_MAIN && SELF_TEST) {
  // #4572 — the Ari composer in a KeyboardAvoidingView, flush: no Done-bar budget.
  const ARI_CLEAN =
    `import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";\n` +
    `<KeyboardAvoidingView behavior="padding"><View style={[styles.inputWrap, { paddingBottom: space[2] }]}/></KeyboardAvoidingView>`;
  const CLEAN = new Map([
    ["app/_layout.tsx", `import { KeyboardToolbarRoot } from "x";\n<KeyboardRoot><App/><KeyboardToolbarRoot/></KeyboardRoot>`],
    [
      "src/components/ui/SheetMobile.tsx",
      `import { KeyboardRoot } from "../../wrappers/KeyboardRoot";\n<Modal><KeyboardRoot><Body/><KeyboardToolbarRoot/></KeyboardRoot></Modal>`,
    ],
    [
      "src/components/ui/Modal.tsx",
      `import { KeyboardRoot } from "../../wrappers/KeyboardRoot";\n<RNModal><KeyboardRoot><Body/><KeyboardToolbarRoot/></KeyboardRoot></RNModal>`,
    ],
    ["src/components/auth/BusinessWelcomeScreen.tsx", "paddingBottom: keyboardPad > 0 ? keyboardPad + 42 : 0,"],
    ["src/components/waitlist/JoinWaitlistSheet.tsx", "pad + (keyboardPadding > 0 ? 42 : 0),"],

    // #2262 — the marketing composer, PROMOTED from (B) to (D). Its budget lives
    // in the route, and it derives from the canonical `keyboardClearance` module
    // rather than the `SmartScrollView` re-export, because the composer route
    // deliberately has no scroll container to import from any more.
    [
      "app/(tabs)/marketing/campaigns/compose.tsx",
      `import { DONE_BAR_OCCUPIED, MIN_VISIBLE_CLEARANCE } from "../../../../src/wrappers/keyboardClearance";\n<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE}/>`,
    ],

    [
      "src/components/groupChat/GroupChatPanel.tsx",
      `import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";\n<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED}/>`,
    ],
    [
      "src/components/support/SupportThread.native.tsx",
      `import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";\n<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED}/>`,
    ],
    [
      "src/components/brand/BrandPaystackOnboardView.tsx",
      `import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";\n<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED}/>`,
    ],
    [
      "src/screens/ari/AriChatScreen.tsx",
      ARI_CLEAN,
    ],
  ]);
  const base = () => ({
    files: new Map(CLEAN),
    mountHosts: [...MOUNT_HOSTS],
    keyed: KEYED.map(([r, re]) => [r, re]),
    nestedHosts: [...NESTED_PROVIDER_HOSTS],
    derivedHosts: [...DERIVED_CLEARANCE],
    measured: [{ ...ARI_COMPOSER_FLUSH }],
  });

  const problems = [];
  const check = (label, model, wantCode, wantText) => {
    const r = run(model);
    if (r.code !== wantCode) {
      problems.push(`${label}: expected exit ${wantCode}, got ${r.code} — ${r.failures.join(" | ")}`);
      return;
    }
    if (wantText && !r.failures.some((f) => f.includes(wantText))) {
      problems.push(`${label}: failure did not mention "${wantText}" — ${r.failures.join(" | ")}`);
    }
  };

  // 1 — the clean tree passes.
  check("clean fixture", base(), 0);

  // 2 — (C) the ORCH-1170 defect itself: toolbar is a SIBLING of the provider.
  {
    const m = base();
    m.files.set(
      "src/components/ui/Modal.tsx",
      `import { KeyboardRoot } from "x";\n<RNModal><KeyboardRoot><Body/></KeyboardRoot><KeyboardToolbarRoot/></RNModal>`,
    );
    check("(C) toolbar as sibling of the provider", m, 1, "separate native window");
  }

  // 3 — (C) the provider removed entirely (rule (A) still passes; this must not).
  {
    const m = base();
    m.files.set("src/components/ui/SheetMobile.tsx", `import { X } from "x";\n<Modal><Body/><KeyboardToolbarRoot/></Modal>`);
    check("(C) provider removed", m, 1, "not nested inside this window's own <KeyboardRoot>");
  }

  // 4 — (D) a numeric keyboardVerticalOffset comes back.
  {
    const m = base();
    m.files.set(
      "src/components/groupChat/GroupChatPanel.tsx",
      `import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";\n<KeyboardAvoidingView keyboardVerticalOffset={42}/>`,
    );
    check("(D) literal keyboardVerticalOffset", m, 1, "NUMERIC LITERAL");
  }

  // 5 — (D) the derived import is dropped.
  {
    const m = base();
    m.files.set("src/components/support/SupportThread.native.tsx", `<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED}/>`);
    check("(D) DONE_BAR_OCCUPIED import removed", m, 1, "does not import DONE_BAR_OCCUPIED");
  }

  // 5b — (D) THE P2-6 HOLE: the import stays, the clearance term is DELETED.
  //      Before #1850 TEST this was GREEN — no literal, import present, and no
  //      Done-bar budget at all. The rule was satisfiable by doing nothing.
  //      (#4572: the victim moved from AriChatScreen, which left rule (D), to
  //      the Paystack view.)
  {
    const m = base();
    m.files.set(
      "src/components/brand/BrandPaystackOnboardView.tsx",
      `import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";\n<KeyboardAvoidingView behavior="padding"/>`,
    );
    check("(D) imported but never used", m, 1, "never USES it");
  }

  // 5c — (D) a MULTI-LINE import must not read as a use: the bare name sitting
  //      on its own line inside the import braces is still an import.
  {
    const m = base();
    m.files.set(
      "src/components/groupChat/GroupChatPanel.tsx",
      `import {\n  DONE_BAR_OCCUPIED,\n  ScrollView,\n} from "../../wrappers/SmartScrollView";\n<KeyboardAvoidingView behavior="padding"/>`,
    );
    check("(D) multi-line import is not a use", m, 1, "never USES it");
  }

  // 5d — …and the same multi-line import WITH a real use passes.
  {
    const m = base();
    m.files.set(
      "src/components/groupChat/GroupChatPanel.tsx",
      `import {\n  DONE_BAR_OCCUPIED,\n  ScrollView,\n} from "../../wrappers/SmartScrollView";\n<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED}/>`,
    );
    check("(D) multi-line import plus a real use passes", m, 0);
  }

  // 5e — a mention in a COMMENT is not a use either.
  {
    const m = base();
    m.files.set(
      "src/components/support/SupportThread.native.tsx",
      `import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";\n// we budget DONE_BAR_OCCUPIED here, honest\n<KeyboardAvoidingView behavior="padding"/>`,
    );
    check("(D) a comment mention is not a use", m, 1, "never USES it");
  }

  // 6 — (D) a hand-typed `+ 42` clearance term returns to a keyboard branch.
  {
    const m = base();
    m.files.set(
      "src/components/support/SupportThread.native.tsx",
      `import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";\nconst p = keyboardHeight > 0 ? keyboardHeight + 42 + 12 : 0;\n<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED}/>`,
    );
    check("(D) hand-typed +42 clearance term", m, 1, "hand-typed");
  }

  // 7 — (D) a `42` in a COMMENT is prose, not a violation.
  {
    const m = base();
    m.files.set(
      "src/components/brand/BrandPaystackOnboardView.tsx",
      `import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";\n// the old literal was 42; keyboardVerticalOffset={42} is what we removed\n<KeyboardAvoidingView keyboardVerticalOffset={DONE_BAR_OCCUPIED}/>`,
    );
    check("(D) 42 in a comment does not fail", m, 0);
  }

  // 8 — (A) still enforced.
  {
    const m = base();
    m.files.set("app/_layout.tsx", "<KeyboardRoot><App/></KeyboardRoot>");
    check("(A) toolbar removed from the root window", m, 1, "no longer renders <KeyboardToolbarRoot/>");
  }

  // 9 — (B) still enforced.
  {
    const m = base();
    m.files.set("src/components/auth/BusinessWelcomeScreen.tsx", "paddingBottom: keyboardPad + 42,");
    check("(B) offset becomes unconditional", m, 1, "keyboard-open");
  }

  // 9b — (E) THE OLD LIFT RETURNS: keyboardHeight + the Done-bar term in a
  //      keyboard-open ternary. ASSERTION REPLACED (#4572): "the lift is exactly
  //      keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE".
  {
    const m = base();
    m.files.set(
      "src/screens/ari/AriChatScreen.tsx",
      `${ARI_CLEAN}\nimport { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";\nconst p = keyboardHeight > 0 ? keyboardHeight + DONE_BAR_OCCUPIED : 0;`,
    );
    check("(E) the Done-bar term returns to the Ari composer", m, 1, "DONE_BAR_OCCUPIED");
    check("(E) a keyboard-open ternary returns", m, 1, "keyboard-open ternary");
  }

  // 9b-ii — (E) the KeyboardAvoidingView wrapper is removed (the composer falls
  //         back to a React-state lift that leaps in one step).
  {
    const m = base();
    m.files.set(
      "src/screens/ari/AriChatScreen.tsx",
      `<View style={[styles.inputWrap, { paddingBottom: space[2] }]}/>`,
    );
    check("(E) the KeyboardAvoidingView wrapper is gone", m, 1, "no longer has");
  }

  // 9b-iii — (E) the wrapper stays but its behavior is not "padding".
  {
    const m = base();
    m.files.set(
      "src/screens/ari/AriChatScreen.tsx",
      ARI_CLEAN.replace('behavior="padding"', 'behavior="height"'),
    );
    check('(E) behavior is not "padding"', m, 1, "no longer has");
  }

  // 9b-iv — (E) the clearance constant returns even with the wrapper in place.
  {
    const m = base();
    m.files.set(
      "src/screens/ari/AriChatScreen.tsx",
      `${ARI_CLEAN}\nconst gap = MIN_VISIBLE_CLEARANCE;`,
    );
    check("(E) a clearance term returns", m, 1, "MIN_VISIBLE_CLEARANCE");
  }

  // 9b-v — (E) a keyboard height reaches the composer wrapper's own style.
  {
    const m = base();
    m.files.set(
      "src/screens/ari/AriChatScreen.tsx",
      ARI_CLEAN.replace("{ paddingBottom: space[2] }", "{ paddingBottom: keyboardHeight }"),
    );
    check("(E) keyboardHeight in the composer wrapper style", m, 1, "keyboardHeight inside the composer wrapper");
  }

  // 9b-vi — (E) the pill-measuring plumbing returns (the #1890 double count).
  {
    const m = base();
    m.files.set(
      "src/screens/ari/AriChatScreen.tsx",
      `${ARI_CLEAN}\nsetComposerHeight(h);\n<View onLayout={onComposerLayout}/>`,
    );
    check("(E) the composer-measuring plumbing returns", m, 1, "setComposerHeight");
  }

  // 9b-vii — (E) a comment that mentions the old terms is prose, not a violation.
  {
    const m = base();
    m.files.set(
      "src/screens/ari/AriChatScreen.tsx",
      `${ARI_CLEAN}\n// used to be keyboardHeight > 0 ? keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE : 0`,
    );
    check("(E) the old terms in a comment do not fail", m, 0);
  }

  // 9c — an empty (E) list is VACUOUS too.
  {
    const m = base();
    m.measured = [];
    check("empty (E) target list is VACUOUS", m, 2, "VACUOUS");
  }

  // 10 — an EMPTY target list is exit 2, never a pass.
  {
    const m = base();
    m.derivedHosts = [];
    check("empty (D) target list is VACUOUS", m, 2, "VACUOUS");
  }

  // 11 — an unreadable target is exit 2, never a skip.
  {
    const m = base();
    m.files.delete("src/components/ui/Modal.tsx");
    check("unreadable target is exit 2", m, 2, "MISSING or unreadable");
  }

  if (problems.length > 0) {
    console.error("\nSELF-TEST FAIL [I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET]:");
    for (const p of problems) console.error(`  x ${p}`);
    console.error("");
    process.exit(1);
  }
  console.log("OK [I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET --self-test]: 24 fixtures behaved as specified.");
  process.exit(0);
}

// ───────────────────────────── live run ───────────────────────────────────
function main() {
  const files = new Map();
  for (const rel of new Set([
    ...MOUNT_HOSTS,
    ...KEYED.map(([r]) => r),
    ...NESTED_PROVIDER_HOSTS,
    ...DERIVED_CLEARANCE,
    ARI_COMPOSER_FLUSH.rel,
  ])) {
    try {
      files.set(rel, fs.readFileSync(path.join(BIZ, rel), "utf8"));
    } catch {
      files.set(rel, null);
    }
  }

  const result = run({
    files,
    mountHosts: MOUNT_HOSTS,
    keyed: KEYED,
    nestedHosts: NESTED_PROVIDER_HOSTS,
    derivedHosts: DERIVED_CLEARANCE,
    measured: [ARI_COMPOSER_FLUSH],
  });

  if (result.code !== 0) {
    console.error("\nFAIL [I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET]:");
    for (const v of result.failures) console.error(`  x ${v}`);
    console.error("");
    process.exit(result.code);
  }
  console.log(
    `OK [I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET]: ${MOUNT_HOSTS.length} mount hosts render the toolbar; ` +
      `${KEYED.length} offsets stay keyboard-keyed; ${NESTED_PROVIDER_HOSTS.length} Modal windows nest it in their ` +
      `own provider; ${DERIVED_CLEARANCE.length} surfaces derive clearance from DONE_BAR_OCCUPIED; the Ari ` +
      "composer rides a KeyboardAvoidingView flush on the keyboard (no Done-bar budget).",
  );
}

if (IS_MAIN) main();
