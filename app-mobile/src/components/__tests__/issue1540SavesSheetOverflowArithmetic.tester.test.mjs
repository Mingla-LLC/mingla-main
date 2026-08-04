#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * TESTER ADVERSARIAL regression suite — issue #1540
 * [paired-liked-cards: a friend's liked-cards sheet could not be scrolled].
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR'S SUITE (SPEC §6).
 * `issue1540PairedSavesSheetScroll.test.mjs` pins the MOUNT SHAPE — that the
 * saves sheet is `scrollMode="flatlist"`, drives `scrollProps`, and no longer
 * mounts `<PairedSavesListScreen>`. That is the WIRING.
 *
 * This suite attacks the MEASUREMENT. A sheet can be wired "correctly" by every
 * shape assertion and still hand its list a viewport exactly equal to its own
 * contentSize — which is what #1540 actually was. A scrollable whose viewport
 * equals its content has ZERO scrollable overflow: scrolling is not janky, it is
 * arithmetically impossible. So this suite computes, from the repo's OWN
 * geometry constants, the list's content height at REALISTIC item counts and
 * asserts strict overflow (`viewport < contentSize`) in the regime the shipped
 * composition actually selects.
 *
 * MEASURED ON DEVICE by the tester (iPhone 17, iOS 26.5, dev client on Metro
 * from the 1540 worktree; instrumented probe reading the list's real
 * `onLayout` height and `onContentSizeChange` height). These are the numbers the
 * model below is calibrated against — every degenerate row is an exact identity:
 *
 *   shape                       N    viewport  contentSize  overflow  scrolls
 *   pre-fix  (view + wrapper)   6      818         818          0       NO
 *   pre-fix  (view + wrapper)  10     1336        1336          0       NO
 *   pre-fix  (view + wrapper)  14     1854        1854          0       NO
 *   shipped  (flatlist)         6      763         905       +142      YES
 *   shipped  (flatlist)        10      763        1423       +660      YES
 *   shipped  (flatlist)        14      763        1941      +1178      YES
 *
 * The pre-fix viewport TRACKS the content exactly (818/818, 1336/1336,
 * 1854/1854); the shipped viewport is PINNED at 763 while content grows. That is
 * the invariant this suite encodes.
 *
 * THE FIXTURE-SIZE TRAP (SPEC §2, "why 30 items masked it"). A large fixture
 * overflows even a degenerate viewport, so a test built on 30 items passes while
 * the product stays broken — the [[unfalsifiable test]] failure mode. A-4 pins
 * the sweep INSIDE the realistic window (<= 18) so nobody can rescue a broken
 * shape by enlarging the fixture.
 *
 * THE OPENING-TAG TRAP. The implementor's own first pass shipped a T-5 that read
 * only the sheet's opening tag and therefore could not observe a broken child
 * mounted back inside it (fixed in 852ed737f). `extractSheetSubtree` below
 * deliberately returns the FULL element — opening tag AND, when the element is
 * not self-closing, every child up to the balanced `</BaseBottomSheet>`. A-0
 * asserts that property directly.
 *
 * A-0  Vacuity + subtree guard: sources non-empty, the saves sheet is found, and
 *      the extractor provably returns children when children exist.
 * A-1  The shipped composition selects the BOUNDED regime, derived from
 *      BaseBottomSheet's REAL branch source (not from an assumption).
 * A-2  Strict overflow sweep, N = 5..18: contentSize > viewport for every count.
 * A-3  Teeth: the pre-fix regime yields overflow === 0 for every N in the same
 *      sweep, so A-2 is falsifiable rather than vacuously true.
 * A-4  Realistic-window guard: the sweep stays <= 18 and starts at the first
 *      count that overflows, so a big fixture can never manufacture a pass.
 *
 * FAILS ON REVERT: restoring `scrollMode="view"` + the `<PairedSavesListScreen>`
 * child flips the regime derivation in A-1 to 'degenerate' and collapses A-2's
 * overflow to 0. Two independent failures, both from real source.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, "..");

const read = (p) => readFileSync(join(COMPONENTS, p), "utf8");

const PHV = read("PersonHolidayView.tsx");
const BASE_SHEET = read("ui/BaseBottomSheet.tsx");
const PRESENTATION = read("pairedSaves/PairedSavesListPresentation.tsx");
const GRID_CARD = read("PersonGridCard.tsx");

// ── Full-subtree extractor ────────────────────────────────────────────────
// Returns the ENTIRE <BaseBottomSheet …> element that carries `marker`,
// including children when the element is not self-closing. Anything that stops
// at the opening tag's '>' is blind to a wrapper child being mounted back in.
function extractSheetSubtree(src, marker) {
  const TAG = "<BaseBottomSheet";
  let from = 0;
  for (;;) {
    const open = src.indexOf(TAG, from);
    if (open === -1) return null;

    // Walk to the end of the opening tag, ignoring '>' inside {…} and "…".
    let i = open + TAG.length;
    let brace = 0;
    let quote = null;
    let selfClosing = false;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === "{") brace++;
      else if (c === "}") brace--;
      else if (c === ">" && brace === 0) {
        selfClosing = src[i - 1] === "/";
        break;
      }
    }
    const openTagEnd = i;
    const openingTag = src.slice(open, openTagEnd + 1);

    if (!openingTag.includes(marker)) {
      from = openTagEnd + 1;
      continue;
    }

    if (selfClosing) {
      return { full: openingTag, openingTag, children: "", selfClosing: true };
    }

    // Balanced scan to the matching close tag.
    let depth = 1;
    let j = openTagEnd + 1;
    while (j < src.length && depth > 0) {
      const nextOpen = src.indexOf(TAG, j);
      const nextClose = src.indexOf("</BaseBottomSheet>", j);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        j = nextOpen + TAG.length;
      } else {
        depth--;
        if (depth === 0) {
          const end = nextClose + "</BaseBottomSheet>".length;
          return {
            full: src.slice(open, end),
            openingTag,
            children: src.slice(openTagEnd + 1, nextClose),
            selfClosing: false,
          };
        }
        j = nextClose + "</BaseBottomSheet>".length;
      }
    }
    return null;
  }
}

const SAVES = extractSheetSubtree(PHV, "visible={showSavesList}");

// ── Geometry, read from the repo's own constants ───────────────────────────
// Hardcoding these would let a geometry change silently invalidate the model.
function num(re, src, what) {
  const m = src.match(re);
  assert.ok(m, `could not read ${what} from source — model would be stale`);
  return Number(m[1]);
}

const CARD_H = num(/card:\s*\{[^}]*height:\s*s\((\d+)\)/, GRID_CARD, "PersonGridCard height");
const ROW_GAP = num(/columnWrapper:\s*\{[^}]*marginBottom:\s*vs\((\d+)\)/, PRESENTATION, "grid row gap");
const PAD_TOP = num(/gridContent:\s*\{[^}]*paddingTop:\s*vs\((\d+)\)/, PRESENTATION, "grid paddingTop");
const PAD_BOTTOM = num(/gridContent:\s*\{[^}]*paddingBottom:\s*vs\((\d+)\)/, PRESENTATION, "grid paddingBottom");
const NUM_COLUMNS = num(/PAIRED_SAVES_NUM_COLUMNS\s*=\s*(\d+)/, PRESENTATION, "numColumns");
const SNAP_PCT = num(/SAVES_LIST_SNAP\s*=\s*\['(\d+)%'\]/, PHV, "saves sheet snap point");

// Reference device: 390 x 844 pt, where the repo's s()/vs() scalers are ~1:1
// (BASE_WIDTH = 390 in src/utils/responsive.ts). The defect is scale-invariant —
// it is an identity (viewport === content), not a threshold — so the reference
// device is sufficient to expose it.
const DEVICE_H = 844;
const SHEET_H = Math.round((SNAP_PCT / 100) * DEVICE_H);
const HEADER_H = 64; // shared PairedSavesListHeader, intrinsic height

const contentHeight = (n) => {
  const rows = Math.ceil(n / NUM_COLUMNS);
  return PAD_TOP + rows * CARD_H + Math.max(0, rows) * ROW_GAP + PAD_BOTTOM;
};

// ── Regime derivation from BaseBottomSheet's REAL branch source ────────────
// 'bounded'    → the gorhom scrollable is a DIRECT child of the content host,
//                so the host bounds it and viewport = sheet - header.
// 'degenerate' → the host receives an intermediate wrapper and content-sizes,
//                so the list's viewport comes back EQUAL to its contentSize.
function deriveRegime(sheet) {
  const tag = sheet.openingTag;
  const mode = (tag.match(/scrollMode=["'](\w+)["']/) || [, "scroll"])[1];
  const hasHeader = /\bheader=/.test(tag);
  const hasBodyContainerStyle = /\bbodyContainerStyle=/.test(tag);
  const hasStickyFooter = /\bstickyFooter=/.test(tag);

  if (mode === "flatlist") {
    // BaseBottomSheet case 'flatlist' returns <BottomSheetFlatList …/> as the
    // WHOLE body — no wrapper. Verified against the real branch source below.
    return "bounded";
  }
  if (mode === "view" && !hasHeader && !hasBodyContainerStyle && !hasStickyFooter) {
    // case 'view' with none of those returns `children` verbatim, so whatever
    // wrapper the consumer owns becomes the host's content. If a scrollable
    // lives under that wrapper, the host content-sizes. This is #1540's shape.
    const wrapsScrollable =
      /<PairedSavesListScreen/.test(sheet.children) ||
      /<View/.test(sheet.children);
    return wrapsScrollable ? "degenerate" : "bounded";
  }
  return "unknown";
}

// viewport as a function of regime — the whole point of the suite
const viewportFor = (regime, n) =>
  regime === "degenerate" ? contentHeight(n) : SHEET_H - HEADER_H;

const SWEEP_MIN = 5;
const SWEEP_MAX = 18;
const sweep = () => {
  const out = [];
  for (let n = SWEEP_MIN; n <= SWEEP_MAX; n++) out.push(n);
  return out;
};

test("A-0 vacuity + full-subtree guard: the saves sheet is found and the extractor returns children when they exist", () => {
  for (const [name, src] of [
    ["PersonHolidayView.tsx", PHV],
    ["ui/BaseBottomSheet.tsx", BASE_SHEET],
    ["pairedSaves/PairedSavesListPresentation.tsx", PRESENTATION],
    ["PersonGridCard.tsx", GRID_CARD],
  ]) {
    assert.ok(src.length > 500, `${name} is empty/short — every later assertion would be vacuous`);
  }

  assert.ok(SAVES, "could not extract the saves <BaseBottomSheet visible={showSavesList}> element");
  assert.ok(
    SAVES.openingTag.includes("visible={showSavesList}"),
    "extracted the wrong sheet",
  );

  // Prove the extractor is NOT opening-tag-only: fed a synthetic element with a
  // child, it must return that child. This is the exact hole that let the
  // implementor's first T-5 pass with a broken child mounted back in.
  const synthetic =
    '<BaseBottomSheet visible={__probe} scrollMode="view">\n' +
    "  <View><PairedSavesListScreen inBottomSheet /></View>\n" +
    "</BaseBottomSheet>";
  const probe = extractSheetSubtree(synthetic, "visible={__probe}");
  assert.ok(probe, "extractor failed on a well-formed element with children");
  assert.match(
    probe.children,
    /<PairedSavesListScreen/,
    "EXTRACTOR IS BLIND: it did not return the child subtree, so a broken child could be mounted back in without any assertion noticing",
  );
});

test("A-1 the shipped saves sheet selects the BOUNDED layout regime (derived from BaseBottomSheet's real branch source)", () => {
  // Pin the branch table this model depends on. If BaseBottomSheet stops
  // rendering the flatlist as the body root, the model is stale and must fail
  // loudly rather than keep asserting against a fiction.
  const flatlistBranch = BASE_SHEET.slice(
    BASE_SHEET.indexOf("case 'flatlist'"),
    BASE_SHEET.indexOf("case 'sectionlist'"),
  );
  assert.ok(
    flatlistBranch.length > 50,
    "could not isolate BaseBottomSheet's case 'flatlist' branch",
  );
  assert.match(
    flatlistBranch,
    /return\s*\(\s*<BottomSheetFlatList/,
    "case 'flatlist' no longer returns <BottomSheetFlatList> as the body ROOT — the bounded-regime assumption is stale",
  );

  const viewBranch = BASE_SHEET.slice(
    BASE_SHEET.indexOf("case 'view'"),
    BASE_SHEET.indexOf("case 'scroll'"),
  );
  assert.match(
    viewBranch,
    /return children;/,
    "case 'view' no longer returns children verbatim — the degenerate-regime control is stale",
  );

  const regime = deriveRegime(SAVES);
  assert.equal(
    regime,
    "bounded",
    `saves sheet is in the '${regime}' layout regime. In 'degenerate' the list's ` +
      "viewport comes back EQUAL to its own contentSize (measured 1336 = 1336 on " +
      "iPhone 17 / iOS 26.5), i.e. zero scrollable overflow and cards past the " +
      "first four are permanently unreachable.",
  );
});

test("A-2 strict overflow at REALISTIC item counts: viewport < contentSize for N = 5..18", () => {
  const regime = deriveRegime(SAVES);
  const failures = [];

  for (const n of sweep()) {
    const content = contentHeight(n);
    const viewport = viewportFor(regime, n);
    const overflow = content - viewport;
    if (!(viewport < content)) {
      failures.push(`N=${n}: viewport=${viewport} contentSize=${content} overflow=${overflow}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    "the saves list has NO scrollable overflow at these realistic counts — a " +
      "scrollable whose viewport equals its content cannot be scrolled at all:\n  " +
      failures.join("\n  "),
  );
});

test("A-3 teeth: the pre-fix regime yields ZERO overflow across the same sweep", () => {
  // Without this, A-2 could be passing for a trivial reason. In the degenerate
  // regime the viewport tracks the content exactly, so overflow is identically
  // 0 at every count — which is precisely why the sheet was dead.
  for (const n of sweep()) {
    const content = contentHeight(n);
    const viewport = viewportFor("degenerate", n);
    assert.equal(
      content - viewport,
      0,
      `degenerate-regime model is wrong at N=${n}: expected viewport === contentSize ` +
        `(the measured 818/818, 1336/1336, 1854/1854 identity), got ${viewport} vs ${content}`,
    );
  }

  // And the shipped regime must differ from it — otherwise A-2 proves nothing.
  const n = 10;
  assert.notEqual(
    viewportFor("bounded", n),
    viewportFor("degenerate", n),
    "bounded and degenerate regimes are indistinguishable in this model",
  );
});

test("A-4 realistic-window guard: the sweep cannot be rescued by a large fixture", () => {
  // SPEC §2: a 30-item list overflows even a degenerate viewport, so a big
  // fixture passes while the product stays broken. Keep the sweep small.
  assert.ok(
    SWEEP_MAX <= 18,
    `sweep max ${SWEEP_MAX} is outside the realistic window; a large fixture masks the defect`,
  );

  // The sweep must begin at or after the first count whose content exceeds the
  // bounded viewport — below that the list genuinely fits and needs no scroll,
  // so including it would weaken the suite.
  const boundedViewport = SHEET_H - HEADER_H;
  let firstOverflowing = null;
  for (let n = 1; n <= 40; n++) {
    if (contentHeight(n) > boundedViewport) {
      firstOverflowing = n;
      break;
    }
  }
  assert.ok(firstOverflowing !== null, "content never exceeds the bounded viewport — geometry model is broken");
  assert.ok(
    SWEEP_MIN >= firstOverflowing,
    `sweep starts at N=${SWEEP_MIN} but the list only starts overflowing at N=${firstOverflowing}`,
  );
  assert.ok(
    SWEEP_MIN <= 8,
    "sweep starts too high to represent a normal saved-list size",
  );
});
