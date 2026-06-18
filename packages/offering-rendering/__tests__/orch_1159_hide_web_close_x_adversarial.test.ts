// ORCH-1159 [hide-web-close-x] — TESTER-OWNED ADVERSARIAL regression.
//
// DIFFERENT ANGLE than the implementor's happy-path test
// (orch_1159_hide_web_close_x.test.ts). The implementor proves the predicate
// returns false on web+opt-in and that the 5 pages opt in. This file attacks the
// SURVIVORS of that happy path:
//
//   A. BOUNDARY — the close button must survive on NON-web, NON-mobile platforms
//      (windows / macos). The predicate's PlatformOSValue union includes them; a
//      naive `platformOS !== "web"` rewrite would pass, but a `platformOS === "ios"
//      || platformOS === "android"` rewrite (the tempting "only show on mobile"
//      refactor) would WRONGLY hide the X on windows/macos. Pin every union member.
//
//   B. INVARIANT — Share + Mute render-presence is PLATFORM-INVARIANT and
//      independent of hideCloseOnWeb. There is NO predicate, NO Platform.OS check,
//      and NO hideCloseOnWeb reference anywhere on the Share or Mute render path in
//      OfferingChrome. Proven structurally: the entire rightGroup (Share + Mute)
//      lives OUTSIDE — strictly AFTER — the `{showClose ? ( ... ) : ( ... )}`
//      ternary, so the close gate can never gate Share/Mute.
//
//   C. STRUCTURAL — when the X is hidden, the replacement placeholder must (1) NOT
//      steal pointer events (`pointerEvents="none"`) and (2) NOT shift the
//      Share/Mute group off the right edge: the row stays `space-between` with the
//      close slot FIRST and rightGroup SECOND, so the right group always pins right
//      whether the close slot is the real button or the empty placeholder.
//
//   D. DEFENSIVE — NO caller, under ANY hideCloseOnWeb value, can hide the X on
//      native. shouldRenderCloseButton(*, "ios"|"android") is unconditionally true.
//      Exhaustive over {true,false} × {ios,android}.
//
// This is NOT a renamed copy of the implementor test: it shares zero assertions
// (the implementor asserts web=false + the 5 opt-in sites; this asserts the
// windows/macos boundary, the Share/Mute structural invariant, the placeholder
// pointer-safety + right-edge pinning, and native-immunity). Append-only: NEW file.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  shouldRenderCloseButton,
  type PlatformOSValue,
} from "../closeButtonVisibility.ts";

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

// ── A. BOUNDARY: non-web non-mobile platforms KEEP the X ────────────────────

Deno.test("ORCH-1159 ADV/A: windows KEEPS the close button even when opted in", () => {
  assertEquals(shouldRenderCloseButton(true, "windows"), true);
});

Deno.test("ORCH-1159 ADV/A: macos KEEPS the close button even when opted in", () => {
  assertEquals(shouldRenderCloseButton(true, "macos"), true);
});

Deno.test("ORCH-1159 ADV/A: web is the ONLY platform the opt-in can hide", () => {
  // Exhaustive over the entire PlatformOSValue union: only "web" + opt-in hides.
  const all: PlatformOSValue[] = ["ios", "android", "web", "windows", "macos"];
  const hidden = all.filter((p) => shouldRenderCloseButton(true, p) === false);
  assertEquals(
    hidden,
    ["web"],
    "exactly one platform (web) may hide the close button under opt-in",
  );
});

// ── B. INVARIANT: Share/Mute never touched by the close gate (structural) ───

Deno.test("ORCH-1159 ADV/B: Share + Mute render OUTSIDE the showClose ternary (never gated)", () => {
  const src = read("../OfferingChrome.tsx");

  // The close ternary block: from `{showClose ? (` to the close of its else branch.
  const ternaryStart = src.indexOf("{showClose ? (");
  assert(ternaryStart >= 0, "showClose ternary must exist");

  // The right-hand button group (Share + optional Mute) must begin AFTER the
  // ternary opens. We require it to begin after the placeholder else-branch too —
  // i.e. the rightGroup View is a SIBLING of the close slot, not nested inside it.
  const rightGroupIdx = src.indexOf('<View style={styles.rightGroup}>');
  assert(rightGroupIdx > ternaryStart, "rightGroup must come after the close slot");

  // Slice the close ternary region (start → rightGroup) and prove NEITHER the
  // Share nor the Mute glyph lives inside it.
  const closeRegion = src.slice(ternaryStart, rightGroupIdx);
  assert(
    !closeRegion.includes("<ShareGlyph"),
    "Share must NOT be inside the close (showClose) gate",
  );
  assert(
    !closeRegion.includes("<VolumeGlyph"),
    "Mute must NOT be inside the close (showClose) gate",
  );

  // And there is NO platform / opt-in token anywhere on the Share/Mute path:
  // the only platform-conditional thing about Share/Mute is `showMute` (a
  // caller-supplied data flag, NOT a Platform.OS / hideCloseOnWeb decision).
  const shareIdx = src.indexOf("onPress={onShare}");
  assert(shareIdx > rightGroupIdx, "Share Pressable lives in the right group");
  // No `hideCloseOnWeb` reference downstream of the Share render (it is consumed
  // exactly once, in the showClose computation above the row).
  const downstreamOfShare = src.slice(shareIdx);
  assert(
    !downstreamOfShare.includes("hideCloseOnWeb"),
    "hideCloseOnWeb must not appear on/after the Share render path",
  );
});

Deno.test("ORCH-1159 ADV/B: hideCloseOnWeb is consumed EXACTLY ONCE in OfferingChrome (only the close decision)", () => {
  const src = read("../OfferingChrome.tsx");
  // Count substantive uses (the prop destructure default + the predicate call).
  // It must NOT proliferate onto Share/Mute. Allow it in the prop signature,
  // JSDoc, destructure, and the single shouldRenderCloseButton(...) call.
  const predicateCallMatches = src.match(
    /shouldRenderCloseButton\(hideCloseOnWeb, Platform\.OS\)/g,
  );
  assertEquals(
    predicateCallMatches?.length,
    1,
    "the close decision must derive from exactly ONE predicate call",
  );
});

// ── C. STRUCTURAL: hidden-X placeholder is pointer-safe + preserves right pin ─

Deno.test("ORCH-1159 ADV/C: the hidden-X placeholder does NOT steal pointer events", () => {
  const src = read("../OfferingChrome.tsx");
  const elseIdx = src.indexOf(") : (");
  assert(elseIdx >= 0, "showClose ternary must have an else branch (placeholder)");
  const rightGroupIdx = src.indexOf('<View style={styles.rightGroup}>');
  // The placeholder lives between the else `(` and the rightGroup. It must carry
  // pointerEvents="none" so the empty left slot can never intercept taps meant
  // for the body underneath.
  const elseRegion = src.slice(elseIdx, rightGroupIdx);
  assert(
    /<View\s+pointerEvents="none"\s*\/>/.test(elseRegion),
    'hidden-X placeholder must be `<View pointerEvents="none" />`',
  );
});

Deno.test("ORCH-1159 ADV/C: the row pins Share/Mute right via space-between with close FIRST", () => {
  const src = read("../OfferingChrome.tsx");
  // The container row uses space-between so the FIRST child (close slot OR
  // placeholder) flushes left and the SECOND child (rightGroup) flushes right.
  assert(
    /row:\s*\{[^}]*justifyContent:\s*"space-between"/s.test(src),
    "the chrome row must use justifyContent: space-between",
  );
  // The close slot ternary must be the FIRST child of the row, and rightGroup the
  // next sibling — so removing the close button (placeholder) never reorders the
  // right group off the right edge.
  const rowOpen = src.indexOf("<View style={styles.row}");
  const ternaryIdx = src.indexOf("{showClose ? (");
  const rightGroupIdx = src.indexOf('<View style={styles.rightGroup}>');
  assert(rowOpen >= 0 && ternaryIdx > rowOpen, "close slot must be first child of row");
  assert(rightGroupIdx > ternaryIdx, "rightGroup must be the sibling AFTER the close slot");
});

// ── D. DEFENSIVE: native immunity is unconditional ──────────────────────────

Deno.test("ORCH-1159 ADV/D: NO caller can hide the X on native (exhaustive over opt-in × mobile)", () => {
  for (const opt of [true, false]) {
    for (const os of ["ios", "android"] as PlatformOSValue[]) {
      assertEquals(
        shouldRenderCloseButton(opt, os),
        true,
        `native ${os} must keep the X regardless of hideCloseOnWeb=${opt}`,
      );
    }
  }
});
