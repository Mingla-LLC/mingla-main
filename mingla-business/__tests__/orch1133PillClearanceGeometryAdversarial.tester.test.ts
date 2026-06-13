import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1133 [revert-cover-pill-bottom] — TESTER adversarial regression.
//
// DIFFERENT ANGLE than the implementor's source-introspection happy-path and the
// inverted orch1132 token-absence guard. Those assert WHICH literals are present.
// This test PROVES THE GEOMETRY those literals encode — the two physical
// invariants Seth actually complained about — by parsing the real numbers out of
// the shared source and computing the resulting layout:
//
//   (1) CLEARANCE: the public-event Sound pill, anchored bottom:<B> on the hero,
//       must clear the blue details panel whose top sits |marginTop| px above the
//       hero bottom (PublicEventPage.bodyContent.marginTop = -28). The signed gap
//       = B - |marginTop| MUST be a POSITIVE, visible value (Seth: "still needs
//       some space"). Forensics measured prod (B=22) at -6px overlap; round-3
//       (B=40) must yield ~+12px. We assert gap >= +10 AND that the OLD value
//       (22) would have FAILED this same predicate (regression proof in-test).
//
//   (2) ON-SCREEN SAFETY: a bottomRight pill of minHeight <MH> at bottom:<B>
//       occupies the band [boxH-(B+MH) .. boxH-B] inside its cover box. For the
//       SHORTEST real bottomRight consumer (expandedCard ImageGallery, height:300)
//       the pill's TOP edge (boxH-(B+MH)) MUST stay > 0 (fully inside the box,
//       never clipped off the top by top chrome). This is the SC-6 cross-consumer
//       invariant computed, not assumed.
//
// fails-on-revert: reverting bottom 40->22 makes (1) gap = -6 (< 10) -> FAILS.
// Pushing bottom absurdly high (e.g. 280) on the 300px box would make the pill
// top edge negative -> (2) FAILS. Both directions are guarded.

const repoRoot = path.resolve(__dirname, "..", "..");
const ECM = fs.readFileSync(
  path.join(repoRoot, "packages/event-rendering/EventCoverMedia.tsx"),
  "utf8",
);
const PEP = fs.readFileSync(
  path.join(repoRoot, "packages/event-rendering/PublicEventPage.tsx"),
  "utf8",
);

/** Pull the body of `styleKey: { ... }` from a StyleSheet.create block. */
function styleBody(src: string, styleKey: string): string {
  const m = src.match(new RegExp(`\\n\\s*${styleKey}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`));
  if (!m) throw new Error(`Could not locate \`${styleKey}:\` style block`);
  return m[1];
}

/**
 * Read a numeric `key: <n>,` out of a style body. Matches ONLY a real
 * declaration line (start-of-line whitespace then `key:`), so it never reads a
 * value out of a `//` comment that happens to mention `bottom:22` etc.
 */
function numProp(body: string, key: string): number {
  const lines = body.split("\n");
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) continue; // skip comment lines
    const m = line.match(new RegExp(`^\\s*${key}:\\s*(-?[0-9]+)`));
    if (m) return Number(m[1]);
  }
  throw new Error(`Could not read numeric \`${key}\` declaration from style body`);
}

describe("ORCH-1133 (1) — Sound pill clears the public-event details panel with a positive visible gap", () => {
  const pill = styleBody(ECM, "audioControlBottomRight");
  const body = styleBody(PEP, "bodyContent");

  const pillBottom = numProp(pill, "bottom"); // anchor inset from hero bottom
  const panelMarginTop = numProp(body, "marginTop"); // -28: panel pulled up over hero
  const panelOverlap = Math.abs(panelMarginTop); // 28: how far the panel top sits above hero bottom

  // Signed gap between the pill's bottom anchor and the panel's top edge.
  // Both measured from the hero bottom going up: gap = pillBottom - panelOverlap.
  const gap = pillBottom - panelOverlap;

  test("the live values are the round-3 contract (bottom=40, panelOverlap=28)", () => {
    expect(pillBottom).toBe(40);
    expect(panelOverlap).toBe(28);
  });

  test("gap is a POSITIVE visible clearance (>= +10px, target +12)", () => {
    expect(gap).toBeGreaterThanOrEqual(10);
    expect(gap).toBe(12);
  });

  test("the pre-revert value (bottom:22) would have OVERLAPPED the panel (regression proof)", () => {
    const oldGap = 22 - panelOverlap;
    expect(oldGap).toBeLessThan(0); // -6: the exact bug forensics measured
  });
});

describe("ORCH-1133 (2) — pill stays fully on-screen on the SHORTEST bottomRight consumer (ImageGallery h=300)", () => {
  const pill = styleBody(ECM, "audioControlBottomRight");
  const base = styleBody(ECM, "audioControl"); // base style carries minHeight
  const pillBottom = numProp(pill, "bottom"); // 40
  const pillMinHeight = numProp(base, "minHeight"); // 36

  // expandedCard/ImageGallery renders a full-bleed video cover at height:300 with
  // audioControlPosition="bottomRight" — the shortest real bottomRight box.
  const SHORTEST_BOTTOMRIGHT_BOX = 300;

  test("ImageGallery still uses a 300px bottomRight cover (guards the assumption)", () => {
    const gallery = fs.readFileSync(
      path.join(repoRoot, "app-mobile/src/components/expandedCard/ImageGallery.tsx"),
      "utf8",
    );
    expect(gallery).toMatch(/audioControlPosition="bottomRight"/);
    expect(gallery).toMatch(/height:\s*300/);
  });

  test("pill TOP edge stays inside the box (not clipped off the top)", () => {
    // band occupied: [boxH-(bottom+minHeight) .. boxH-bottom]
    const pillTopEdge = SHORTEST_BOTTOMRIGHT_BOX - (pillBottom + pillMinHeight);
    expect(pillTopEdge).toBeGreaterThan(0); // 300-(40+36)=224 -> safely inside
  });

  test("pill base minHeight (36) is preserved at the round-3 value", () => {
    expect(pillMinHeight).toBe(36);
  });
});
