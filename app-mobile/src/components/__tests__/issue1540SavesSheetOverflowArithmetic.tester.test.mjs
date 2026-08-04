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

// ── Comment blanking ──────────────────────────────────────────────────────
// [TEST-MOD-APPROVED #1540] TESTER round-2 repair. The walker below tracks
// string literals so it can ignore '>' inside props. It did NOT skip comments,
// so a single apostrophe in ordinary prose inside the element — round 2 added
// `// … This sheet's defining bug …` inside the saves sheet's opening tag —
// put it into permanent "inside a string" mode, ran it to EOF, and made
// extractSheetSubtree return null. A-0 then failed and A-2 died on a null
// deref, i.e. the ORACLE WENT BLIND rather than reporting on the product.
//
// This returns a SAME-LENGTH copy with comment bodies replaced by spaces, so
// every index still maps 1:1 onto the original. Scanning happens on the blanked
// copy; returned slices come from the ORIGINAL, so nothing else changes.
// No assertion is weakened by this — it only restores the parser's ability to
// see the code it was always meant to police.
function blankComments(src) {
  const out = src.split("");
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i++;
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let k = i; k < stop; k++) if (out[k] !== "\n") out[k] = " ";
      i = stop;
      continue;
    }
    i++;
  }
  return out.join("");
}

// ── Full-subtree extractor ────────────────────────────────────────────────
// Returns the ENTIRE <BaseBottomSheet …> element that carries `marker`,
// including children when the element is not self-closing. Anything that stops
// at the opening tag's '>' is blind to a wrapper child being mounted back in.
// `scan` is the comment-blanked twin of `src` (same length); all index work is
// done on it, all returned text is sliced from `src`.
function extractSheetSubtree(src, marker, scanSrc) {
  const scan = scanSrc ?? blankComments(src);
  const TAG = "<BaseBottomSheet";
  let from = 0;
  for (;;) {
    const open = scan.indexOf(TAG, from);
    if (open === -1) return null;

    // Walk to the end of the opening tag, ignoring '>' inside {…} and "…".
    let i = open + TAG.length;
    let brace = 0;
    let quote = null;
    let selfClosing = false;
    for (; i < scan.length; i++) {
      const c = scan[i];
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
        selfClosing = scan[i - 1] === "/";
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
      return {
        full: openingTag,
        openingTag,
        openingTagCode: scan.slice(open, openTagEnd + 1),
        children: "",
        childrenCode: "",
        selfClosing: true,
      };
    }

    // Balanced scan to the matching close tag.
    let depth = 1;
    let j = openTagEnd + 1;
    while (j < scan.length && depth > 0) {
      const nextOpen = scan.indexOf(TAG, j);
      const nextClose = scan.indexOf("</BaseBottomSheet>", j);
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
            openingTagCode: scan.slice(open, openTagEnd + 1),
            children: src.slice(openTagEnd + 1, nextClose),
            childrenCode: scan.slice(openTagEnd + 1, nextClose),
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

// [TEST-MOD-APPROVED #1540] READER WIDENED — `vs\(` → `(?:s|vs)\(` on the two
// grid-gutter readers. The #1540 design pass (§3.3) deliberately moved the row
// gutter and the grid's top padding from vs() to s(): a gutter between two
// equal-width cards must scale on the SAME axis as the cards, or the grid goes
// non-square on tall devices. The old readers hard-coded `vs\(`, so they stopped
// matching and the suite aborted at module scope with "model would be stale" —
// correct refusal, wrong cause to leave standing. Widening the READER keeps the
// anti-staleness property (the values are still read from source, never
// hard-coded) while tracking a legitimate unit change. NO assertion is relaxed:
// A-1..A-4 are untouched by this edit, and A-1 is STRENGTHENED below.
const CARD_H = num(/card:\s*\{[^}]*height:\s*s\((\d+)\)/, GRID_CARD, "PersonGridCard height");
const ROW_GAP = num(/columnWrapper:\s*\{[^}]*marginBottom:\s*(?:s|vs)\((\d+)\)/, PRESENTATION, "grid row gap");
const PAD_TOP = num(/gridContent:\s*\{[^}]*paddingTop:\s*(?:s|vs)\((\d+)\)/, PRESENTATION, "grid paddingTop");
const PAD_BOTTOM = num(/gridContent:\s*\{[^}]*paddingBottom:\s*(?:s|vs)\((\d+)\)/, PRESENTATION, "grid paddingBottom");
const NUM_COLUMNS = num(/PAIRED_SAVES_NUM_COLUMNS\s*=\s*(\d+)/, PRESENTATION, "numColumns");
const SNAP_PCT = num(/SAVES_LIST_SNAP\s*=\s*\['(\d+)%'\]/, PHV, "saves sheet snap point");

// Reference device: 390 x 844 pt, where the repo's s()/vs() scalers are ~1:1
// (BASE_WIDTH = 390 in src/utils/responsive.ts). The defect is scale-invariant —
// it is an identity (viewport === content), not a threshold — so the reference
// device is sufficient to expose it.
const DEVICE_H = 844;
const SHEET_H = Math.round((SNAP_PCT / 100) * DEVICE_H);
// [TEST-MOD-APPROVED #1540] Was a hard-coded 64. Round 2 PINS the header as a
// real intrinsic-height SIBLING above the list, so this height is now genuinely
// subtracted from the list's viewport and must not be allowed to go stale
// either. Read it from the presentation source, same rule as the grid geometry.
// HANDLE_ZONE is gorhom's own handle padding above the header (~20pt, see
// design §3.2 — defaultHandleStyle drops the token's margins so gorhom's
// padding governs).
const HANDLE_ZONE = 20;
const SHEET_HEADER_MIN_H = num(
  /sheetHeader:\s*\{[^}]*minHeight:\s*(?:s|vs)\((\d+)\)/,
  PRESENTATION,
  "sheet header minHeight",
);
const HEADER_H = HANDLE_ZONE + SHEET_HEADER_MIN_H;

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
  // [TEST-MOD-APPROVED #1540] Structural tests now run against the
  // COMMENT-BLANKED twin, so a `<View` or `<PairedSavesListScreen` merely NAMED
  // in a comment can never be mistaken for one actually mounted. Strictly
  // stronger than matching raw text.
  const tag = sheet.openingTagCode ?? sheet.openingTag;
  const kids = sheet.childrenCode ?? sheet.children;
  const mode = (tag.match(/scrollMode=["'](\w+)["']/) || [, "scroll"])[1];
  const hasHeader = /\bheader=/.test(tag);
  const hasBodyContainerStyle = /\bbodyContainerStyle=/.test(tag);
  const hasStickyFooter = /\bstickyFooter=/.test(tag);

  if (mode === "flatlist") {
    // BaseBottomSheet case 'flatlist' renders the gorhom BottomSheetFlatList as
    // a DIRECT child of <BottomSheet> — either alone, or (round 2) as the second
    // half of a Fragment whose first half is the pinned header sibling. A
    // Fragment is not a host view, so the scrollable stays a direct child and
    // the host still bounds it. A-1 below pins that shape against the REAL
    // branch source, including that no View wrapper was reintroduced.
    return "bounded";
  }
  if (mode === "view" && !hasHeader && !hasBodyContainerStyle && !hasStickyFooter) {
    // case 'view' with none of those returns `children` verbatim, so whatever
    // wrapper the consumer owns becomes the host's content. If a scrollable
    // lives under that wrapper, the host content-sizes. This is #1540's shape.
    const wrapsScrollable =
      /<PairedSavesListScreen/.test(kids) || /<View/.test(kids);
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

  // [TEST-MOD-APPROVED #1540] Regression guard for the exact blindness this
  // suite hit in round 2. The walker tracks string literals so it can ignore
  // '>' inside props; it did not skip COMMENTS, so one apostrophe in ordinary
  // prose inside the element ("This sheet's defining bug …") put it into
  // permanent in-string mode, ran it to EOF and made extraction return null.
  // The suite then reported "model would be stale" / null-deref instead of
  // reporting on the product — a blind oracle, which is the failure mode this
  // whole file exists to prevent. Pin it directly.
  const apostrophe =
    '<BaseBottomSheet visible={__apos} scrollMode="flatlist"\n' +
    "  // #1540 §3.4: this sheet's defining bug was that it didn't scroll —\n" +
    "  // don't let an apostrophe blind the parser again.\n" +
    "  header={<Hdr />}\n" +
    ">\n" +
    "  <View><PairedSavesListScreen /></View>\n" +
    "</BaseBottomSheet>";
  const aprobe = extractSheetSubtree(apostrophe, "visible={__apos}");
  assert.ok(
    aprobe,
    "EXTRACTOR IS BLIND: an apostrophe inside a comment in the opening tag " +
      "defeated the parser. Every downstream assertion would silently stop " +
      "observing the product.",
  );
  assert.match(
    aprobe.openingTag,
    /scrollMode="flatlist"/,
    "extractor mis-bounded the opening tag when a comment contained an apostrophe",
  );
  assert.match(
    aprobe.children,
    /<PairedSavesListScreen/,
    "extractor lost the child subtree when a comment contained an apostrophe",
  );
  // …and the comment-blanked twin must NOT leak comment prose into the
  // structural view, or a `<View` merely named in a comment could be mistaken
  // for one actually mounted.
  const commented =
    '<BaseBottomSheet visible={__c} scrollMode="flatlist">\n' +
    "  // do NOT reintroduce a <View> wrapper here\n" +
    "  <Something />\n" +
    "</BaseBottomSheet>";
  const cprobe = extractSheetSubtree(commented, "visible={__c}");
  assert.ok(cprobe, "extractor failed on the comment-only child case");
  assert.doesNotMatch(
    cprobe.childrenCode,
    /<View\b/,
    "comment blanking failed: a <View> named only in a comment is still visible " +
      "to structural assertions, so deriveRegime could be fooled either way",
  );
});

test("A-1 the shipped saves sheet selects the BOUNDED layout regime (derived from BaseBottomSheet's real branch source)", () => {
  // Pin the branch table this model depends on. If BaseBottomSheet stops
  // rendering the flatlist as the body root, the model is stale and must fail
  // loudly rather than keep asserting against a fiction.
  // [TEST-MOD-APPROVED #1540] Branch source is read COMMENT-BLANKED so the
  // long explanatory comments round 2 added inside this branch (which mention
  // `View`, `ListHeaderComponent` etc. in prose) cannot satisfy or defeat any
  // pattern below. Only real code counts.
  const BASE_SHEET_CODE = blankComments(BASE_SHEET);
  const flatlistBranch = BASE_SHEET_CODE.slice(
    BASE_SHEET_CODE.indexOf("case 'flatlist'"),
    BASE_SHEET_CODE.indexOf("case 'sectionlist'"),
  );
  assert.ok(
    flatlistBranch.length > 50,
    "could not isolate BaseBottomSheet's case 'flatlist' branch",
  );

  // ── The bounded-regime contract, pinned in FOUR parts ────────────────────
  // [TEST-MOD-APPROVED #1540] This assertion previously read, in full:
  //     assert.match(flatlistBranch, /return\s*\(\s*<BottomSheetFlatList/)
  // Round 2 (design §1.4) changed the branch to return a FRAGMENT — header
  // sibling first, list second — so that single regex stopped matching and
  // fired "the bounded-regime assumption is stale". It fired CORRECTLY: the
  // structure really did change. I did not widen it away. I re-derived the
  // regime at RUNTIME on the new shape before touching this file:
  //
  //   shipped (flatlist + pinned header)  N=6   VP=689  CT=835   OVF=+146
  //   shipped                             N=10  VP=689  CT=1361  OVF=+672
  //   shipped                             N=14  VP=689  CT=1887  OVF=+1198
  //   pre-fix (view + wrapper)            N=10  VP=1360 CT=1360  OVF=0
  //
  // (iPhone 17 / iOS 26.5, dev client on Metro from this worktree, list's real
  // onLayout vs onContentSizeChange.) The viewport is PINNED at 689 while the
  // content grows — still bounded — and the pre-fix control still collapses to
  // the degenerate identity. So the regime holds and the model is sound.
  // The replacement below is STRICTER than the line it replaces: it pins the
  // no-wrapper property and the load-bearing flex:1 that the old one never did.
  assert.match(
    flatlistBranch,
    /<BottomSheetFlatList\b/,
    "case 'flatlist' no longer renders a <BottomSheetFlatList> at all — the bounded-regime assumption is stale",
  );
  // (a) NO host-view wrapper may appear anywhere in this branch. This is the
  //     #1540 root cause itself: an intermediate <View> between gorhom's
  //     content host and the scrollable makes the host content-size, and the
  //     list's viewport comes back EQUAL to its own contentSize.
  assert.doesNotMatch(
    flatlistBranch,
    /<(?:View|BottomSheetView|SafeAreaView|ScrollView)\b/,
    "case 'flatlist' now wraps its body in a host View — that is EXACTLY #1540's " +
      "unbounded-wrapper shape (measured viewport === contentSize, zero scrollable " +
      "overflow). I-SHEET-SCROLLABLE-DIRECT-CHILD violated.",
  );
  // (b) The body root must be the bare list, or a FRAGMENT holding the pinned
  //     header sibling + the list. A Fragment adds no host node, so the list
  //     remains a DIRECT child of <BottomSheet>.
  assert.match(
    flatlistBranch,
    /return\s+hasHeader\s*\?\s*\(\s*<>[\s\S]*?<\/>\s*\)\s*:|return\s*\(\s*<BottomSheetFlatList/,
    "case 'flatlist' body root is neither the bare <BottomSheetFlatList> nor a " +
      "Fragment of (header, list) — the bounded-regime assumption is stale",
  );
  // (c) LOAD-BEARING: with a header sibling above it the list MUST claim flex:1,
  //     or it content-sizes below the header and the viewport collapses again.
  assert.match(
    flatlistBranch,
    /style=\{\s*\n?\s*hasHeader\s*\?\s*\[\s*styles\.flexContainer/,
    "the flatlist branch no longer gives the list flex:1 when a header is present — " +
      "without it the list content-sizes under the pinned header and the #1540 " +
      "degenerate identity (viewport === contentSize) returns",
  );

  const viewBranch = BASE_SHEET_CODE.slice(
    BASE_SHEET_CODE.indexOf("case 'view'"),
    BASE_SHEET_CODE.indexOf("case 'scroll'"),
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
