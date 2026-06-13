import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1131 [cover-crop-sound-inset] — HAPPY-PATH regression test (implementor-authored).
//
// Two value-only style contracts that a future "tidy" could silently regress:
//   FIX 1 — the three Get-tickets checkout mini-card cover bands must be 120pt
//           tall (was 64pt). A 64pt band slices a PORTRAIT cover video to an
//           unrecognizable mid-frame strip; 120pt reveals the cover. All three
//           checkout routes (event / trip / experience) carry the byte-identical
//           `miniCover` block — assert all three so a copy-paste can't regress one.
//   FIX 2 — the shared EventCoverMedia `audioControlBottomRight` Sound pill must
//           sit at right:16 (aligns to the public-event floating X/share chrome
//           column at spacing.md = 16) AND bottom:22 (ORCH-1128 cover-seam
//           clearance — load-bearing, preserved verbatim).
//
// Source-introspection (not module import) because the checkout routes are heavy
// RN screens; this mirrors the precedent in
// BusinessWelcomeScreenLogoAdversarial.test.tsx. Extracting `property: value`
// from the actual StyleSheet block is comment-proof: it reads the live value,
// so a true LINE DELETION of `height: 120` / `right: 16` makes the test FAIL.
//
// fails-on-revert: verified by deleting `height: 120` (→ reverts to 64) and
// `right: 16` (→ reverts to 14) — see IMPLEMENTATION_ORCH-1131 report.

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

describe("ORCH-1131 FIX 1 — checkout mini-card cover band height = 120", () => {
  for (const route of CHECKOUT_ROUTES) {
    test(`${route} miniCover.height === 120`, () => {
      const src = fs.readFileSync(path.join(businessDir, route), "utf8");
      const body = extractStyleBody(src, "miniCover");
      expect(extractNumericStyleValue(body, "height")).toBe(120);
    });
  }
});

describe("ORCH-1131 FIX 2 — shared Sound-pill bottomRight inset", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "packages/event-rendering/EventCoverMedia.tsx"),
    "utf8",
  );
  const body = extractStyleBody(src, "audioControlBottomRight");

  test("right === 16 (aligns to public-event floating chrome column)", () => {
    expect(extractNumericStyleValue(body, "right")).toBe(16);
  });

  test("bottom === 22 preserved (ORCH-1128 cover-seam clearance, load-bearing)", () => {
    expect(extractNumericStyleValue(body, "bottom")).toBe(22);
  });
});
