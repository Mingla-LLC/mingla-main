#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1043 [Sheet expand/swipe-freeze — no-scroll] structural regression.
 *
 * THE BUG: BaseBottomSheet's four wrapped body-composition branches (sticky-
 * footer, scroll+header, sectionlist, view+header/bodyContainerStyle) enclosed
 * the gorhom scrollable inside a `<BottomSheetView>`. gorhom forces
 * BottomSheetView to `{ position:'absolute', … }` content-size, so the scrollable
 * got an UNBOUNDED parent → viewport == content → maxScrollY=0 → the body froze
 * and the bottom control was unreachable. ~26 sheet instances were affected.
 *
 * THE FIX (LOCKED, ORCH-1043 SPEC §10.3): each branch now returns a React
 * Fragment of DIRECT children of <BottomSheet> — [header?, scrollable/children,
 * footer?] — so the scrollable (carrying its own flex:1) fills gorhom's
 * height-bounded BottomSheetContent → bounded viewport → scrolls. The scrollable
 * flex:1 styles (flexContainer / stickyBody / sectionList) are load-bearing.
 *
 * This check is a `node:assert` source-assertion (app-mobile has no jest runner;
 * repo convention — see orch-1022-expanded-card-modal-gating-check.mjs,
 * orch_1016_nav_container_clearance.test.tsx). It is written to FAIL on a revert
 * that re-introduces ANY <BottomSheetView> body wrapper or strips the flex:1
 * styles (fails-on-revert per SPEC §13 T-10).
 *
 * Live `maxScrollY > 0` is not machine-runnable here; it is delivered by the
 * tester's SC-7/SC-8 live-fire on iOS + Android (SPEC §13 T-07/T-08).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const PRIMITIVE_REL = "app-mobile/src/components/ui/BaseBottomSheet.tsx";
const src = read(PRIMITIVE_REL);

// Isolate the `body` useMemo region (the body-composition branches).
const bodyStart = src.indexOf("const body = useMemo(");
const bodyEnd = src.indexOf("const sheet = (");
assert.ok(
  bodyStart >= 0 && bodyEnd > bodyStart,
  "T-precheck: could not locate the `body` useMemo region in BaseBottomSheet.tsx",
);
const bodyRegion = src.slice(bodyStart, bodyEnd);

// Strip comments so the protective comment (which names <BottomSheetView> to warn
// against it) and prose do not satisfy/trip the live-JSX assertions.
const code = bodyRegion
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const checks = [];
function check(id, fn) {
  try {
    fn();
    checks.push({ id, pass: true });
  } catch (err) {
    checks.push({ id, pass: false, detail: err.message });
  }
}

// T-01 — scroll+header no longer wraps. The scroll+header branch returns a
// Fragment, not a <BottomSheetView>. After the `if (hasHeader)` we must find a
// `return (<>` with {header} and {scroll}, and there must be no <BottomSheetView.
check("T-01 scroll+header returns a Fragment, not a BottomSheetView", () => {
  assert.match(
    code,
    /if \(hasHeader\) \{\s*return \(\s*<>\s*\{header\}\s*\{scroll\}\s*<\/>\s*\);\s*\}/,
    "scroll+header branch must `return (<>{header}{scroll}</>)`",
  );
});

// T-02 — sectionlist no longer wraps. The sectionlist branch returns a Fragment
// with {header}{children}{<BottomSheetSectionList…>} as direct children.
check("T-02 sectionlist returns a Fragment with the list as a direct child", () => {
  assert.match(
    code,
    /return \(\s*<>\s*\{header\}\s*\{children\}\s*\{hasSections \?[\s\S]*?<BottomSheetSectionList[\s\S]*?<\/>\s*\);/,
    "sectionlist branch must return a Fragment with header/children/list as direct children",
  );
});

// T-03 — stickyFooter no longer wraps. header + flex:1 body + footer returned as
// a Fragment.
check("T-03 stickyFooter returns a Fragment (header + body + footer)", () => {
  assert.match(
    code,
    /return \(\s*<>\s*\{header\}\s*\{stickyBody\}\s*\{footerNode\}\s*<\/>\s*\);/,
    "stickyFooter branch must `return (<>{header}{stickyBody}{footerNode}</>)`",
  );
});

// T-04 — view+header/bodyContainerStyle no longer wraps.
check("T-04 view+header returns a Fragment, not a BottomSheetView", () => {
  assert.match(
    code,
    /if \(hasHeader \|\| bodyContainerStyle !== undefined\) \{\s*return \(\s*<>\s*\{header\}\s*\{children\}\s*<\/>\s*\);\s*\}/,
    "view+header/bodyContainerStyle branch must `return (<>{header}{children}</>)`",
  );
});

// T-04b — NO <BottomSheetView> JSX element survives anywhere in the body region.
check("T-04b body region contains zero <BottomSheetView> wrappers", () => {
  const hits = [...code.matchAll(/<BottomSheetView\b/g)];
  assert.equal(
    hits.length,
    0,
    `found ${hits.length} live <BottomSheetView> JSX tag(s) in the body region — the scrollable must be a direct child`,
  );
});

// T-05 — bottom-inset preserved. withBottomInset on scroll/list content;
// withFooterClearance on the sticky body; the Math.max merge retained.
check("T-05 bottom-inset model preserved", () => {
  assert.match(
    code,
    /contentContainerStyle=\{withBottomInset\(/,
    "withBottomInset must still wrap the scroll/list contentContainerStyle",
  );
  assert.match(
    code,
    /contentContainerStyle=\{withFooterClearance\(/,
    "withFooterClearance must still wrap the sticky scroll body contentContainerStyle",
  );
  // Math.max merge lives outside the body region (in the helper closures).
  assert.match(
    src,
    /const paddingBottom = Math\.max\(existing, bottomInset\);/,
    "the withBottomInset Math.max merge (never-reduce) must be retained",
  );
  assert.match(
    src,
    /const paddingBottom = Math\.max\(existing, safeBottomInset\);/,
    "the withFooterClearance Math.max merge (never-reduce) must be retained",
  );
});

// T-06 — swipe-dismiss + wrapInRNModal wiring untouched.
check("T-06 swipe-dismiss + wrapInRNModal wiring preserved", () => {
  assert.match(
    src,
    /enablePanDownToClose = true/,
    "enablePanDownToClose must default to true",
  );
  assert.match(
    src,
    /enablePanDownToClose=\{enablePanDownToClose\}/,
    "enablePanDownToClose must be forwarded to <BottomSheet>",
  );
  assert.match(
    src,
    /if \(index === -1\) onClose\(\);/,
    "handleSheetChange must map onChange(-1) → onClose()",
  );
  assert.match(
    src,
    /<GestureHandlerRootView style=\{styles\.flexContainer\}>\s*\{sheet\}\s*<\/GestureHandlerRootView>/,
    "wrapInRNModal must still wrap {sheet} in a GestureHandlerRootView inside the RN Modal",
  );
});

// T-09 — load-bearing scrollable flex:1 styles intact (removing them re-collapses
// the scrollable to content-size even as a direct child).
check("T-09 load-bearing flex:1 styles on the scrollables intact", () => {
  assert.match(src, /flexContainer:\s*\{\s*flex:\s*1\s*\}/, "styles.flexContainer { flex:1 } required");
  assert.match(src, /stickyBody:\s*\{\s*flex:\s*1\s*\}/, "styles.stickyBody { flex:1 } required");
  assert.match(src, /sectionList:\s*\{\s*flex:\s*1\s*\}/, "styles.sectionList { flex:1 } required");
  // The scroll keeps flex:1 below the header.
  assert.match(
    code,
    /\[styles\.flexContainer, scrollPropsTyped\?\.style\]/,
    "the scroll+header body must keep styles.flexContainer (flex:1)",
  );
  assert.match(
    code,
    /style=\{styles\.stickyBody\}/,
    "the sticky scroll body must keep styles.stickyBody (flex:1)",
  );
});

// T-09b — dead wrapper styles removed (no <BottomSheetView> consumers remain).
check("T-09b dead wrapper styles removed", () => {
  assert.doesNotMatch(
    src,
    /stickyContainer:\s*\{/,
    "styles.stickyContainer (a removed BottomSheetView wrapper) must be deleted",
  );
  assert.doesNotMatch(
    src,
    /sectionListContainer:\s*\{/,
    "styles.sectionListContainer (a removed BottomSheetView wrapper) must be deleted",
  );
});

// T-10 — protective comment present (the "why" that stops a future re-wrap).
check("T-10 protective comment documents the direct-child rule", () => {
  assert.match(
    src,
    /do NOT wrap a scrollable in `BottomSheetView`/,
    "the load-bearing protective comment must document the direct-child rule (ORCH-1043)",
  );
  assert.match(src, /ORCH-1043/, "the comment must cite ORCH-1043");
});

let failed = 0;
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.id}`);
  if (!c.pass) {
    failed += 1;
    console.log(`  ${c.detail}`);
  }
}

if (failed > 0) {
  console.error(
    `\nORCH-1043 sheet-scroll-viewport check FAILED: ${failed}/${checks.length} assertion(s).`,
  );
  console.error(
    "BaseBottomSheet must render every scrollable as a direct child of <BottomSheet> (no BottomSheetView wrapper) with flex:1 intact.\n",
  );
  process.exit(1);
}

console.log(
  `\nORCH-1043 sheet-scroll-viewport check PASSED: ${checks.length}/${checks.length} assertions.`,
);
