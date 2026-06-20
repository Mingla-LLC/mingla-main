#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 [BaseBottomSheet PRIMITIVE REWORK]
 * (sheet bugs 1 / 2 / 4 / 4a). Structural/contract test — the
 * @gorhom/bottom-sheet host is NOT mountable in this harness (same approach as
 * BaseBottomSheet.test.mjs / the locked NotificationsSheet test).
 *
 * Asserts the FOUR rework contracts and that each FAILS-ON-REVERT:
 *
 *   R-1  BUG 1 — swipe-down-close in wrapInRNModal. The primitive's
 *        `wrapInRNModal` branch wraps {sheet} in a <GestureHandlerRootView>
 *        (imported from react-native-gesture-handler) INSIDE the <RNModal>, so
 *        gorhom's pan-down-to-dismiss registers in the modal window.
 *        Fails-on-revert: remove the GHRV import / wrap → R-1 FAILS.
 *
 *   R-4b BUG 4b — bottom inset is APPLIED, not discarded. The primitive no
 *        longer contains `void safeBottom`; it computes a `bottomInset` and
 *        applies it via a `withBottomInset` helper to the scroll/list/footer
 *        contentContainerStyle, reading the canonical floating-nav height from
 *        useAppLayout (BOTTOM_NAV_CONTENT_HEIGHT) behind the `tabBarAware` prop.
 *        Fails-on-revert: re-add `void safeBottom` / drop withBottomInset → FAILS.
 *
 *   R-4a BUG 4a — overflow-safe header/footer slots. With a header present the
 *        scroll claims flex:1 (bounded viewport below the fixed header) so a
 *        tall body still scrolls. Asserts the header-branch scroll style merges
 *        styles.flexContainer.
 *        Fails-on-revert: drop the hasHeader flex:1 branch → FAILS.
 *
 *   R-2  BUG 2 — single scroll host for the event sheet. PublicEventPage renders
 *        its body via an injectable `ScrollComponent` (default RN ScrollView),
 *        and ExpandedBusinessEventSheet injects gorhom's BottomSheetScrollView
 *        + uses scrollMode="view" (no double scroll). Asserts: the shared page
 *        no longer hardcodes <ScrollView> as the body host; EBES passes
 *        ScrollComponent + scrollMode="view"; EBES still imports gorhom ONLY via
 *        the BaseBottomSheet re-export (sole-consumer invariant preserved).
 *        Fails-on-revert: restore the raw <ScrollView> body / scrollMode="scroll"
 *        → R-2 FAILS.
 *
 *   ADV  Adversarial — the rework must NOT regress locked invariants:
 *        center-dialog stays non-swipe (no enablePanDownToClose on the RN-Modal
 *        center card); the primitive still passes NO animationConfigs (stock
 *        gorhom motion); EBES onChange passthrough still does not call onClose.
 *
 * FAILS-ON-REVERT anchor: b0063fcad (HEAD before this rework).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/ui/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

const FAILS_ON_REVERT_COMMIT = "b0063fcad";

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** Strip comments so doc-comments that NAME a pattern (to forbid/explain it)
 *  do not themselves trip a code-only assertion. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** True iff `source` has a real `import ... from '@gorhom/bottom-sheet'`. */
function importsGorhom(source) {
  return /^\s*import\b[\s\S]*?from\s+['"]@gorhom\/bottom-sheet['"]/m.test(
    stripComments(source),
  );
}

function run() {
  const BASE = "app-mobile/src/components/ui/BaseBottomSheet.tsx";
  const base = read(BASE);
  const baseCode = stripComments(base);

  const EBES =
    "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx";
  const ebes = read(EBES);
  const ebesCode = stripComments(ebes);

  const PAGE = "packages/offering-rendering/PublicEventPage.tsx";
  const page = read(PAGE);
  const pageCode = stripComments(page);

  const LAYOUT = "app-mobile/src/hooks/useAppLayout.ts";
  const layout = read(LAYOUT);

  // ── R-1: BUG 1 — GestureHandlerRootView inside the wrapInRNModal branch ─────
  assert.match(
    baseCode,
    /import\s*\{[^}]*\bGestureHandlerRootView\b[^}]*\}\s*from\s*['"]react-native-gesture-handler['"]/,
    "R-1 primitive imports GestureHandlerRootView from react-native-gesture-handler",
  );
  // The GHRV must wrap {sheet} inside the RN Modal branch. Match the modal
  // branch containing both <RNModal ...> and a <GestureHandlerRootView ...>
  // wrapping {sheet}.
  const modalBranch = baseCode.match(
    /if\s*\(wrapInRNModal\)\s*\{[\s\S]*?<RNModal[\s\S]*?<\/RNModal>/,
  );
  assert.ok(modalBranch, "R-1 wrapInRNModal branch present with RNModal");
  assert.match(
    modalBranch[0],
    /<GestureHandlerRootView[\s\S]*?\{sheet\}[\s\S]*?<\/GestureHandlerRootView>/,
    "R-1 GestureHandlerRootView wraps {sheet} inside the RN Modal (swipe-close in modal window)",
  );

  // ── R-4b: BUG 4b — bottom inset applied, not discarded ─────────────────────
  assert.doesNotMatch(
    baseCode,
    /void\s+safeBottom/,
    "R-4b primitive must NOT discard the computed bottom inset (no `void safeBottom`)",
  );
  assert.match(
    baseCode,
    /const\s+bottomInset\s*=/,
    "R-4b primitive computes a bottomInset",
  );
  assert.match(
    baseCode,
    /const\s+withBottomInset\s*=/,
    "R-4b primitive has a withBottomInset helper",
  );
  // The helper must be applied to the scroll/list contentContainerStyle (the
  // actual fix — discarding it again would drop these call sites).
  // META-ORCH-0991 FINISHING PASS [TEST-MOD-APPROVED META-ORCH-0991]: the
  // sticky-footer scroll body now uses the `withFooterClearance` sibling helper
  // (OS-inset-only, so the tab-bar height is NOT added above the pinned footer),
  // while scroll/flatlist/sectionlist keep `withBottomInset`. Count BOTH helpers
  // as "bottom-padding-applied" call sites; the contract (inset is applied, not
  // discarded) is unchanged — the total must still be >=4.
  const withBottomInsetCalls =
    (baseCode.match(/withBottomInset\(/g) || []).length +
    (baseCode.match(/withFooterClearance\(/g) || []).length;
  assert.ok(
    withBottomInsetCalls >= 4,
    `R-4b withBottomInset/withFooterClearance applied to scroll/flatlist/sectionlist/footer (found ${withBottomInsetCalls}, need >=4)`,
  );
  // Tab-bar awareness — opt-in prop + canonical nav-height source.
  assert.match(base, /tabBarAware\?:\s*boolean/, "R-4b tabBarAware prop typed");
  assert.match(
    baseCode,
    /import\s*\{[^}]*\bBOTTOM_NAV_CONTENT_HEIGHT\b[^}]*\}\s*from\s*['"][^'"]*useAppLayout['"]/,
    "R-4b primitive reads the canonical floating-nav height from useAppLayout (no hardcoded copy)",
  );
  assert.match(
    layout,
    /export\s+const\s+BOTTOM_NAV_CONTENT_HEIGHT\b/,
    "R-4b useAppLayout exports BOTTOM_NAV_CONTENT_HEIGHT",
  );

  // ── R-4a: BUG 4a — overflow-safe header/scroll composition ─────────────────
  // With a header present the scroll must claim flex (styles.flexContainer) so a
  // tall body scrolls below the fixed header. Assert the scroll-mode branch
  // references flexContainer in a hasHeader-conditioned style.
  assert.match(
    baseCode,
    /hasHeader[\s\S]*?styles\.flexContainer[\s\S]*?scrollPropsTyped\?\.style/,
    "R-4a header-present scroll claims flex:1 (bounded viewport, tall body scrolls)",
  );

  // ── R-2: BUG 2 — single scroll host via injectable ScrollComponent ─────────
  assert.match(
    pageCode,
    /ScrollComponent\s*=\s*ScrollView/,
    "R-2 PublicEventPage defaults ScrollComponent to RN ScrollView (web/business unchanged)",
  );
  assert.match(
    pageCode,
    /<ScrollComponent\b/,
    "R-2 PublicEventPage body renders via <ScrollComponent>, not a hardcoded <ScrollView>",
  );
  // The body host must no longer be a raw <ScrollView ...> element with the
  // scroll style (the double-scroll source). The hero/import may still reference
  // ScrollView as the default value, but the body JSX host is ScrollComponent.
  assert.doesNotMatch(
    pageCode,
    /<ScrollView\s+style=\{styles\.scroll\}/,
    "R-2 PublicEventPage no longer hardcodes <ScrollView style={styles.scroll}> as the body host",
  );
  const PAGE_TYPES = "packages/offering-rendering/types.ts";
  assert.match(
    read(PAGE_TYPES),
    /ScrollComponent\?:/,
    "R-2 ScrollComponent typed on PublicEventPageProps (types.ts)",
  );

  // EBES injects gorhom's BottomSheetScrollView via the BaseBottomSheet
  // re-export + uses scrollMode="view" (no primitive-owned second scroll).
  assert.match(
    ebes,
    /import\s*\{[^}]*\bBottomSheetScrollView\b[^}]*\}\s*from\s*['"][^'"]*BaseBottomSheet['"]/,
    "R-2 EBES imports BottomSheetScrollView from BaseBottomSheet (sole-consumer-safe re-export)",
  );
  assert.match(
    ebesCode,
    /scrollMode=["']view["']/,
    "R-2 EBES uses scrollMode='view' (primitive does not add its own scroll)",
  );
  assert.match(
    ebesCode,
    /ScrollComponent=\{[^}]*\}/,
    "R-2 EBES passes ScrollComponent into PublicEventPage",
  );
  assert.ok(
    !importsGorhom(ebes),
    "R-2 EBES must NOT import @gorhom/bottom-sheet directly (sole consumer is BaseBottomSheet)",
  );

  // ── ADV: adversarial — locked invariants preserved by the rework ───────────
  // Stock gorhom motion: still NO animationConfigs.
  assert.doesNotMatch(
    baseCode,
    /animationConfigs=/,
    "ADV primitive still passes NO animationConfigs (stock gorhom motion preserved)",
  );
  // center-dialog stays non-swipe: the CenterDialog uses RN Modal + a centered
  // card, never gorhom's pan-down. Assert the CenterDialog body has no
  // enablePanDownToClose / BottomSheet.
  const centerDialog = baseCode.match(
    /function\s+CenterDialog[\s\S]*?\n\}/,
  );
  assert.ok(centerDialog, "ADV CenterDialog function present");
  assert.doesNotMatch(
    centerDialog[0],
    /enablePanDownToClose|<BottomSheet\b/,
    "ADV center-dialog stays a non-swipe centered card (no gorhom pan-down)",
  );
  // EBES onChange passthrough must NOT call onClose (no double-fire).
  const handleChange = ebes.match(
    /const handleSheetChange[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
  );
  assert.ok(handleChange, "ADV EBES handleSheetChange present");
  assert.doesNotMatch(
    handleChange[0],
    /onClose\(\)/,
    "ADV EBES onChange passthrough must NOT call onClose (no double-fire)",
  );
  // EBES still consumes BaseBottomSheet (did not regress off the primitive).
  assert.match(
    ebes,
    /<BaseBottomSheet\b/,
    "ADV EBES still renders <BaseBottomSheet>",
  );
}

try {
  run();
  console.log(
    `PASS META-ORCH-0991 BaseBottomSheet REWORK regression suite (bugs 1/2/4/4a); fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`,
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
