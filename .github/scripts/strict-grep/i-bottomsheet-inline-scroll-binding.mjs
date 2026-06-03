#!/usr/bin/env node

/**
 * I-BOTTOMSHEET-INLINE-SCROLL-BINDING
 *   (ORCH-1016 origin → ORCH-1043 re-targeted at the primitive)
 *   I-PROPOSED-BASE-BOTTOM-SHEET-SCROLLABLE-IS-DIRECT-CHILD
 *
 * THE BUG (root-caused + measured on-device, ORCH-1016 → ORCH-1043): gorhom's
 * `BottomSheetScrollView`/`BottomSheetSectionList`/`BottomSheetFlatList` only get
 * a bounded viewport — and therefore only scroll — when they are the DIRECT child
 * of gorhom's height-bounded `BottomSheetContent`. The moment a sheet wraps its
 * scroll in a gorhom `BottomSheetView`, gorhom forces that wrapper to
 * `{ position:'absolute', … }` content-size, so the scroll viewport == content,
 * maxScroll == 0, and the body FREEZES — the last row / Buy / Reserve / Confirm
 * CTA can never be reached.
 *
 * ── ORCH-1043 CORRECTION (the gate was giving FALSE assurance) ───────────────
 * The original ORCH-1016 gate (a) scanned CONSUMER files for header/stickyFooter/
 * bodyContainerStyle props, and (b) EXEMPTED any file using `wrapInRNModal` on the
 * theory that the RN Modal gives gorhom a bounded full-screen parent so the
 * wrapped scroll still binds. That exemption is EMPIRICALLY FALSE: ORCH-1040
 * measured the wrapped AccountSettings sheet collapsing to maxScrollY=0 (Pixel 8
 * Pro, 0px bounds-delta) INSIDE a `wrapInRNModal` window. The RN Modal bounds
 * gorhom's OUTER container, but the inner `BottomSheetView` wrapper still forces
 * position:absolute/content-size around the scrollable regardless of the modal.
 * So the old gate reported "OK — 0 violations" while ~26 wrapped sheets were
 * frozen. The defect lived in the SHARED PRIMITIVE's body-composition branches,
 * not in the consumers' props (which are legitimate API).
 *
 * THE RULE (ORCH-1043): the fix and the invariant live in the PRIMITIVE
 * `app-mobile/src/components/ui/BaseBottomSheet.tsx`. EVERY body-composition
 * branch must return its gorhom scrollable (and, in `view` mode, consumer
 * `children` that may host a scrollable) as a DIRECT child of `<BottomSheet>` —
 * i.e. a React Fragment of [header?, scrollable/children, footer?] direct
 * children — and must NEVER enclose a scrollable/children inside a
 * `<BottomSheetView>` wrapper. Header/footer are intrinsic-height sibling direct
 * children. This makes the bounded-viewport guarantee hold for ALL ~45 sheets at
 * once. Consumers MAY freely pass `header`/`stickyFooter`/`bodyContainerStyle` —
 * they are now safe.
 *
 * This gate therefore asserts the PRIMITIVE never wraps a scrollable in
 * `BottomSheetView`. It FAILS on a revert of the ORCH-1043 fix (re-adding any
 * `<BottomSheetView>…scrollable…</BottomSheetView>` body wrapper), which is the
 * structural fails-on-revert regression guard.
 *
 * Scope: the single shared primitive (app-mobile/src/components/ui/BaseBottomSheet.tsx).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const PRIMITIVE_REL = "app-mobile/src/components/ui/BaseBottomSheet.tsx";
const SCROLLABLE_TAGS = [
  "BottomSheetScrollView",
  "BottomSheetSectionList",
  "BottomSheetFlatList",
];

const primitivePath = path.join(repoRoot, PRIMITIVE_REL);
let src;
try {
  src = fs.readFileSync(primitivePath, "utf8");
} catch {
  console.error(
    `\nFAIL [I-BOTTOMSHEET-INLINE-SCROLL-BINDING]: cannot read the primitive at ${PRIMITIVE_REL}\n`,
  );
  process.exit(1);
}

// Isolate the `body` useMemo region (where the body-composition branches live)
// so the assertion is precise and not fooled by doc-comment prose elsewhere.
const bodyStart = src.indexOf("const body = useMemo(");
const bodyEnd = src.indexOf("const sheet = (");
const bodyRegion =
  bodyStart >= 0 && bodyEnd > bodyStart ? src.slice(bodyStart, bodyEnd) : src;

// Strip line + block comments from the body region so the protective comment
// (which intentionally NAMES `<BottomSheetView>` to warn against it) does not
// trip the structural assertion. We only care about live JSX.
const codeOnly = bodyRegion
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violations = [];

// (1) No `<BottomSheetView>` JSX element may appear in the body region at all —
// the ORCH-1043 fix removed every wrapper; any re-introduction is the regression.
const bsvOpenTags = [...codeOnly.matchAll(/<BottomSheetView\b/g)];
if (bsvOpenTags.length > 0) {
  violations.push(
    `the body composition re-introduced ${bsvOpenTags.length} <BottomSheetView> wrapper(s); ` +
      `the scrollable/children must be a DIRECT child of <BottomSheet> (React Fragment), never wrapped.`,
  );
}

// (2) Belt-and-suspenders: no scrollable may sit inside ANY enclosing JSX element
// in the body region other than the bare returns. Detect the specific anti-pattern
// "<SomeWrapper …> … <BottomSheetScrollView/SectionList/FlatList … > … </SomeWrapper>"
// where SomeWrapper is a View/Animated.View/BottomSheetView wrapper around the scroll.
for (const tag of SCROLLABLE_TAGS) {
  const scrollIdx = codeOnly.indexOf(`<${tag}`);
  if (scrollIdx < 0) continue;
  // Look backwards from each scrollable for an immediately-enclosing wrapper open
  // tag that is NOT a Fragment (<>) and NOT the gorhom <BottomSheet> itself.
  const before = codeOnly.slice(0, scrollIdx);
  // The nearest unclosed wrapper open-tag before the scrollable.
  const wrapperMatch = before.match(
    /<(View|Animated\.View|BottomSheetView)\b[^>]*>\s*(?:\{[^}]*\}\s*)*$/,
  );
  if (wrapperMatch) {
    violations.push(
      `${tag} appears to be wrapped in <${wrapperMatch[1]}> — scrollables must be direct children of <BottomSheet>.`,
    );
  }
}

// (3) The fails-on-revert anchor must be present: the four converted branches now
// return Fragments. Assert the load-bearing scrollable flex:1 styles are intact
// (removing them re-collapses the scrollable to content-size even as a direct child).
if (!/stickyBody:\s*\{\s*flex:\s*1\s*\}/.test(src)) {
  violations.push(
    "styles.stickyBody { flex:1 } is missing — the sticky-footer scroll body needs flex:1 as a direct child.",
  );
}
if (!/sectionList:\s*\{\s*flex:\s*1\s*\}/.test(src)) {
  violations.push(
    "styles.sectionList { flex:1 } is missing — the sectionlist needs flex:1 as a direct child.",
  );
}
if (!/flexContainer:\s*\{\s*flex:\s*1\s*\}/.test(src)) {
  violations.push(
    "styles.flexContainer { flex:1 } is missing — the scroll+header body needs flex:1 as a direct child.",
  );
}

if (violations.length > 0) {
  console.error(
    "\nFAIL [I-BOTTOMSHEET-INLINE-SCROLL-BINDING / SCROLLABLE-IS-DIRECT-CHILD]:",
  );
  console.error(
    `  BaseBottomSheet must render its gorhom scrollable (and view-mode children) as a`,
  );
  console.error(
    `  DIRECT child of <BottomSheet>, never inside a <BottomSheetView> wrapper (ORCH-1043).`,
  );
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error("");
  process.exit(1);
}

console.log(
  "OK [I-BOTTOMSHEET-INLINE-SCROLL-BINDING / SCROLLABLE-IS-DIRECT-CHILD]: BaseBottomSheet renders every scrollable as a direct child of <BottomSheet> (no BottomSheetView wrapper).",
);
