import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1131 [cover-crop-sound-inset] — HAPPY-PATH regression test (implementor-authored).
// ORCH-1132 [TEST-MOD-APPROVED ORCH-1132] round 2 — supersedes ORCH-1131's two
// value choices (same file surfaces, opposite design call on both). The
// ORCH-1131 lineage stays here; the pinned numbers move to round-2 values.
//
// Two contracts that a future "tidy" could silently regress:
//   FIX 1 (round 2) — the three Get-tickets checkout mini-card covers must show
//           the WHOLE frame uncropped. ORCH-1131's fixed `miniCover.height:120`
//           band still cropped a 360×640 portrait cover to a mid-frame strip
//           (head cut off). Round 2 removes the fixed height (height now follows
//           an inline `aspectRatio`) and pairs each EventCoverMedia call with
//           `videoContentFit="contain"` + `onAspectRatio` so nothing is cropped.
//           Assert across all three routes (event / trip / experience):
//             (a) the `miniCover` block declares NO numeric `height:`, and
//             (b) the EventCoverMedia call passes `videoContentFit="contain"`
//                 AND `onAspectRatio=`.
//   FIX 2 (round 2) — the shared EventCoverMedia `audioControlBottomRight` Sound
//           pill must sit at right:24 (= spacing.lg — visible right-edge
//           breathing room; ORCH-1131's 16 read cramped to Seth) AND bottom:22
//           (ORCH-1128 cover-seam clearance — load-bearing, preserved verbatim).
//
// Source-introspection (not module import) because the checkout routes are heavy
// RN screens; this mirrors the precedent in
// BusinessWelcomeScreenLogoAdversarial.test.tsx. Extracting `property: value`
// from the actual StyleSheet block is comment-proof: it reads the live value,
// so a true LINE DELETION of the fix (re-adding `height: 120`, dropping
// `videoContentFit="contain"`, or reverting `right: 24`) makes the test FAIL.
//
// fails-on-revert: verified by re-adding `height: 120` / dropping
// `videoContentFit="contain"` / reverting `right: 24` → 16 — see
// IMPLEMENTATION_ORCH-1132 report.

const businessDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(businessDir, "..");

/** Extract the body of `styleKey: { ... }` from a StyleSheet.create block. */
function extractStyleBody(src: string, styleKey: string): string {
  const m = src.match(new RegExp(`\\n\\s*${styleKey}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`));
  if (!m) {
    throw new Error(`Could not locate \`${styleKey}:\` style block`);
  }
  return m[1];
}

/** Extract a numeric property value, skipping commented-out lines. */
function extractNumericStyleValue(styleBody: string, property: string): number | null {
  for (const rawLine of styleBody.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("//")) continue; // ignore comment lines
    const m = line.match(new RegExp(`^${property}:\\s*([0-9]+)\\s*,`));
    if (m) return Number(m[1]);
  }
  return null;
}

const CHECKOUT_ROUTES = [
  "app/checkout/[eventId]/index.tsx",
  "app/checkout-trip/[tripEventId]/index.tsx",
  "app/checkout-experience/[experienceEventId]/index.tsx",
];

/** Extract the first `<EventCoverMedia ... />` JSX call body from source. */
function extractEventCoverMediaCall(src: string): string {
  const m = src.match(/<EventCoverMedia([\s\S]*?)\/>/);
  if (!m) {
    throw new Error("Could not locate an `<EventCoverMedia ... />` call");
  }
  return m[1];
}

describe("ORCH-1132 FIX 1 (round 2) — checkout mini-card cover is full-frame, no crop", () => {
  for (const route of CHECKOUT_ROUTES) {
    test(`${route} miniCover declares NO fixed numeric height`, () => {
      const src = fs.readFileSync(path.join(businessDir, route), "utf8");
      const body = extractStyleBody(src, "miniCover");
      // height now follows an inline aspectRatio; no fixed height: in the block.
      expect(extractNumericStyleValue(body, "height")).toBeNull();
    });

    test(`${route} EventCoverMedia uses videoContentFit="contain" + onAspectRatio`, () => {
      const src = fs.readFileSync(path.join(businessDir, route), "utf8");
      const call = extractEventCoverMediaCall(src);
      expect(call).toMatch(/videoContentFit="contain"/);
      expect(call).toMatch(/onAspectRatio=/);
    });
  }
});

describe("ORCH-1132 FIX 2 (round 2) — shared Sound-pill bottomRight inset", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "packages/event-rendering/EventCoverMedia.tsx"),
    "utf8",
  );
  const body = extractStyleBody(src, "audioControlBottomRight");

  test("right === 24 (spacing.lg — visible right-edge breathing room)", () => {
    expect(extractNumericStyleValue(body, "right")).toBe(24);
  });

  test("bottom === 22 preserved (ORCH-1128 cover-seam clearance, load-bearing)", () => {
    expect(extractNumericStyleValue(body, "bottom")).toBe(22);
  });
});
