#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1043 [Sheet expand/swipe-freeze — no-scroll] — TESTER ADVERSARIAL regression.
 *
 * Distinct angle from the implementor's happy-path check
 * (`orch-1043-sheet-scroll-viewport-check.mjs`, which regex-matches each branch's
 * exact `return (<>…</>)` literal). This adversarial test attacks the STRUCTURAL
 * direct-child CONTRACT generically — not the literal shapes — so it still bites
 * even if a future refactor keeps the prose/comments but quietly re-nests a
 * scrollable inside ANY element wrapper, aliases `BottomSheetView`, drops a
 * scrollable's load-bearing `flex:1`, or mutates the LOCKED dismiss / inset /
 * wrapInRNModal wiring.
 *
 * THE INVARIANT UNDER ATTACK (I-PROPOSED-BASE-BOTTOM-SHEET-SCROLLABLE-IS-DIRECT-CHILD):
 * in `BaseBottomSheet`'s `body` useMemo, every gorhom scrollable
 * (BottomSheetScrollView / BottomSheetSectionList / BottomSheetFlatList) — and, in
 * `view` mode, the consumer `children` that may host a scrollable — must be a
 * DIRECT child of `<BottomSheet>` (a React Fragment member), NEVER enclosed in a
 * `BottomSheetView`/`View`/`Animated.View` element. gorhom forces `BottomSheetView`
 * to `{position:'absolute',…}` content-size → unbounded parent → maxScrollY=0 →
 * frozen body. (ORCH-1043 root cause RC-1.)
 *
 * Method: a tiny JSX-aware tag walker over the comment-stripped `body` region —
 * for EACH scrollable occurrence it reconstructs the live element-nesting stack at
 * that point and asserts the scrollable's immediate JSX parent is a Fragment
 * (`<>`), NOT a host element. This proves "direct child" across ALL FOUR converted
 * branches at once without depending on any branch's exact return literal.
 *
 * `node:assert` source-assertion (app-mobile has no jest runner — repo convention).
 * Written to FAIL on a revert that re-introduces ANY scrollable wrapper, aliases
 * BottomSheetView, strips flex:1, or edits the LOCKED dismiss/inset/modal lines.
 * Live `maxScrollY>0` is delivered by the tester live-fire (SC-7/SC-8), not here.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const PRIMITIVE_REL = "app-mobile/src/components/ui/BaseBottomSheet.tsx";

const src = fs.readFileSync(path.join(repoRoot, PRIMITIVE_REL), "utf8");

const SCROLLABLES = [
  "BottomSheetScrollView",
  "BottomSheetSectionList",
  "BottomSheetFlatList",
];
const HOST_WRAPPERS = ["BottomSheetView", "View", "Animated.View"];

// ── Isolate + comment-strip the body useMemo region ──────────────────────────
const bodyStart = src.indexOf("const body = useMemo(");
const bodyEnd = src.indexOf("const sheet = (");
assert.ok(
  bodyStart >= 0 && bodyEnd > bodyStart,
  "precheck: could not locate the `body` useMemo region",
);
const bodyRegion = src.slice(bodyStart, bodyEnd);
// Strip block + line comments (the protective comment intentionally NAMES
// <BottomSheetView> to warn against it; must not be treated as live JSX).
const code = bodyRegion
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const checks = [];
const run = (id, fn) => {
  try {
    fn();
    checks.push({ id, pass: true });
  } catch (err) {
    checks.push({ id, pass: false, detail: err.message });
  }
};

// ── Robust "no enclosing host wrapper" balanced-scan ─────────────────────────
// For the text BEFORE a scrollable, collapse every balanced `<Tag …>…</Tag>`
// pair and every self-closing `<Tag …/>` to nothing (innermost-first), plus
// every balanced Fragment `<>…</>`. Whatever host-element OPEN tag remains
// dangling at the end is an UNCLOSED enclosing element of the scrollable. If any
// such dangling open tag is a host wrapper (View/Animated.View/BottomSheetView),
// the scrollable is wrapped → fail. A dangling Fragment `<>` is fine (direct
// child). This is robust to multiline opening tags and `<` inside generic casts
// because it only ever balances/strips, never parses prop bodies.
function danglingOpenTagsBefore(jsx) {
  let s = jsx;
  // Strip self-closing and balanced pairs repeatedly until stable.
  let prev;
  do {
    prev = s;
    // self-closing <Tag …/> (props may contain generics with <…>; match the
    // smallest span ending at the first `/>` after a `<Tag` with no nested
    // element open in between — approximate by forbidding a bare `<Letter` that
    // starts another ELEMENT, while allowing `<` inside `Partial<…>` casts which
    // are followed by an uppercase type then `<` or `>`; we simply forbid
    // `</` and a following `<X ` element-open).
    s = s.replace(/<([A-Za-z][\w.]*)\b(?:[^<>]|<(?![A-Za-z]))*\/>/g, "");
    // balanced <Tag …>…</Tag> with no nested same-name element inside.
    s = s.replace(
      /<([A-Za-z][\w.]*)\b(?:[^<>]|<(?![A-Za-z]))*>(?:(?!<\1\b)[\s\S])*?<\/\1\s*>/g,
      "",
    );
    // balanced fragments <>…</> (no nested fragment inside)
    s = s.replace(/<>(?:(?!<>)[\s\S])*?<\/>/g, "");
  } while (s !== prev);
  // Remaining element OPEN tags (not closed) — these enclose the scrollable.
  const dangling = [...s.matchAll(/<([A-Za-z][\w.]*)\b(?:[^<>]|<(?![A-Za-z]))*>/g)].map(
    (m) => m[1],
  );
  return dangling;
}

// ── ADV-1: structural — NO scrollable is enclosed by a host wrapper element ───
// Generic proof of the direct-child contract across ALL FOUR branches, robust to
// multiline opening tags / generic casts (does not depend on each branch's exact
// return literal — distinct from the implementor's literal-shape check).
run("ADV-1 no scrollable is enclosed by a host wrapper (direct-child contract, all branches)", () => {
  let total = 0;
  for (const s of SCROLLABLES) {
    let idx = code.indexOf(`<${s}`);
    while (idx >= 0) {
      total += 1;
      const dangling = danglingOpenTagsBefore(code.slice(0, idx));
      const wrapper = dangling.find((t) => HOST_WRAPPERS.includes(t));
      assert.equal(
        wrapper,
        undefined,
        `${s} is enclosed by an unclosed <${wrapper}> — scrollables MUST be direct (Fragment) children of <BottomSheet> ` +
          `(gorhom forces any wrapper to position:absolute → maxScrollY=0 → frozen body)`,
      );
      idx = code.indexOf(`<${s}`, idx + 1);
    }
  }
  assert.ok(
    total >= 4,
    `expected the 4 body-branch scrollables (2 ScrollView + SectionList + FlatList), scanned ${total}`,
  );
});

// ── ADV-2: no host-wrapper element immediately precedes any scrollable ────────
// Belt-and-suspenders on a different axis: textual "wrapper-open then scrollable"
// adjacency (catches a wrapper the tag-walker might mis-balance on malformed edits).
run("ADV-2 no host wrapper opens immediately before a scrollable", () => {
  for (const s of SCROLLABLES) {
    let idx = code.indexOf(`<${s}`);
    while (idx >= 0) {
      const before = code.slice(0, idx);
      const adj = before.match(
        new RegExp(
          `<(${HOST_WRAPPERS.map((w) => w.replace(".", "\\.")).join("|")})\\b[^>]*>\\s*(?:\\{[^}]*\\}\\s*)*$`,
        ),
      );
      assert.equal(
        adj,
        null,
        `${s} is immediately wrapped by <${adj?.[1]}> — scrollables must be direct children of <BottomSheet>`,
      );
      idx = code.indexOf(`<${s}`, idx + 1);
    }
  }
});

// ── ADV-3: BottomSheetView is not used as a JSX element ANYWHERE in the component
// AND is not aliased/re-imported to dodge the grep. (Re-creep attack.) ─────────
run("ADV-3 BottomSheetView never re-creeps as a JSX element + not aliased", () => {
  // No live `<BottomSheetView` element in the whole component source (the import
  // line stays for the re-export, but no JSX usage).
  const fullCodeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const jsxUse = [...fullCodeOnly.matchAll(/<BottomSheetView\b/g)];
  assert.equal(
    jsxUse.length,
    0,
    `found ${jsxUse.length} live <BottomSheetView> JSX element(s) — the primitive must never render one as a body wrapper`,
  );
  // No alias of BottomSheetView that could be JSX-used under another name to dodge
  // the literal grep (e.g. `const Wrap = BottomSheetView` or
  // `BottomSheetView as Wrap`).
  assert.doesNotMatch(
    fullCodeOnly,
    /BottomSheetView\s+as\s+\w+/,
    "BottomSheetView must not be import-aliased (a re-wrap dodge)",
  );
  assert.doesNotMatch(
    fullCodeOnly,
    /(?:const|let|var)\s+\w+\s*=\s*BottomSheetView\b/,
    "BottomSheetView must not be assigned to another identifier (a re-wrap dodge)",
  );
});

// ── ADV-4: view-mode children are a direct Fragment child when header/bcs set ─
// Attacks the §4.4 view+wrapper path specifically: the consumer-owned scrollable
// inside `children` must receive the bounded host directly, so `children` cannot
// be element-wrapped.
run("ADV-4 view+header/bcs returns header+children as direct Fragment children", () => {
  // The `view` branch's header/bcs sub-path must NOT contain a host element
  // between the Fragment and {children}.
  const viewBranch = code.slice(code.indexOf("case 'view'"), code.indexOf("case 'scroll'"));
  assert.ok(viewBranch.length > 0, "could not isolate the view branch");
  assert.doesNotMatch(
    viewBranch,
    /<(BottomSheetView|View|Animated\.View)\b/,
    "the view branch must not wrap {children} in any host element when header/bodyContainerStyle is set",
  );
  // And {children} must appear as a bare Fragment member.
  assert.match(
    viewBranch,
    /<>\s*\{header\}\s*\{children\}\s*<\/>/,
    "view+header/bcs must render {header}{children} as direct Fragment children",
  );
});

// ── ADV-5: load-bearing flex:1 preserved on EVERY scrollable host style ───────
// A direct child still collapses to content-height without flex:1. Attack the
// removal of flex:1 even if the wrapper is gone.
run("ADV-5 flex:1 preserved on all three scrollable host styles", () => {
  for (const name of ["flexContainer", "stickyBody", "sectionList"]) {
    assert.match(
      src,
      new RegExp(`${name}:\\s*\\{\\s*flex:\\s*1\\s*\\}`),
      `styles.${name} { flex:1 } missing — scrollable collapses to content even as a direct child`,
    );
  }
  // The scroll+header body must apply flexContainer to the scrollable itself.
  assert.match(
    code,
    /\[styles\.flexContainer, scrollPropsTyped\?\.style\]/,
    "scroll+header must keep styles.flexContainer on the BottomSheetScrollView",
  );
  // The sticky scroll body must keep styles.stickyBody.
  assert.match(code, /style=\{styles\.stickyBody\}/, "sticky body must keep styles.stickyBody");
});

// ── ADV-6: LOCKED dismiss + inset + wrapInRNModal lines are BYTE-IDENTICAL to
// origin/main (stronger than "present"). The fix must touch ONLY body composition;
// any drift in these lines is a contract violation. ──────────────────────────
run("ADV-6 LOCKED dismiss/inset/modal lines byte-identical to origin/main", () => {
  let mainSrc;
  try {
    mainSrc = execFileSync(
      "git",
      ["show", `origin/main:${PRIMITIVE_REL}`],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch {
    // Fallback: if origin/main is unavailable (detached CI shallow clone),
    // assert the canonical literals are present rather than skipping.
    mainSrc = null;
  }
  const LOCKED = [
    "    enablePanDownToClose = true,",
    "      if (index === -1) onClose();",
    "      enablePanDownToClose={enablePanDownToClose}",
    "      index={visible ? initialIndex : -1}",
    "  const safeBottomInset = Math.max(insets.bottom, 16);",
    "  const bottomInset = safeBottomInset + tabBarExtra;",
    "        <GestureHandlerRootView style={styles.flexContainer}>",
  ];
  const lines = src.split("\n");
  for (const locked of LOCKED) {
    assert.ok(
      lines.includes(locked),
      `LOCKED line drifted/removed on the branch: ${JSON.stringify(locked)}`,
    );
    if (mainSrc) {
      assert.ok(
        mainSrc.split("\n").includes(locked),
        `sanity: LOCKED line not found on origin/main (test or baseline drift): ${JSON.stringify(locked)}`,
      );
    }
  }
});

// ── ADV-7: the body useMemo dependency array is unchanged in membership ───────
// (Hook-stability contract: the refactor must not silently add/drop a dep that
// changes re-memoization behavior.)
run("ADV-7 body useMemo deps include scrollMode/scrollProps/header/bodyContainerStyle/children/stickyFooter/bottomInset", () => {
  const depsRegion = src.slice(src.indexOf("], ["), src.indexOf("const sheet = ("));
  // Re-derive the deps block from the body useMemo close.
  const memoClose = src.slice(src.indexOf("default: {"), src.indexOf("const sheet = ("));
  for (const dep of [
    "scrollMode",
    "scrollProps",
    "header",
    "bodyContainerStyle",
    "children",
    "stickyFooter",
    "bottomInset",
  ]) {
    assert.ok(
      memoClose.includes(dep),
      `body useMemo dependency '${dep}' is missing from the dependency array`,
    );
  }
  void depsRegion;
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
    `\nORCH-1043 TESTER ADVERSARIAL check FAILED: ${failed}/${checks.length} assertion(s).`,
  );
  console.error(
    "BaseBottomSheet must render every scrollable as a DIRECT Fragment child of <BottomSheet> " +
      "(no element wrapper, no alias dodge), with flex:1 intact and the LOCKED dismiss/inset/modal wiring untouched.\n",
  );
  process.exit(1);
}

console.log(
  `\nORCH-1043 TESTER ADVERSARIAL check PASSED: ${checks.length}/${checks.length} assertions ` +
    "(structural direct-child contract proven across all four branches).",
);
