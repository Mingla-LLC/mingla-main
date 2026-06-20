import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1131 [cover-crop-sound-inset] — HAPPY-PATH regression test (implementor-authored).
// ORCH-1133 [TEST-MOD-APPROVED ORCH-1133] round 3 — supersedes ORCH-1131 (64→120)
// AND ORCH-1132 (adaptive full-frame). Seth round-3 reject: "The get tickets page
// now looks awful, revert. The cover fills the entire screen. Revert to original."
// The pinned numbers move to the TRUE pre-ORCH-1131 original (`e90875dda~1`).
//
// Two contracts that a future "tidy" could silently regress:
//   FIX 1 (round 3) — the three Get-tickets checkout mini-card covers must show a
//           fixed COMPACT 64px-tall band (the e90875dda~1 original), NOT a full-
//           screen / ballooned cover. ORCH-1131 (height:120) and ORCH-1132 (no
//           fixed height + inline aspectRatio + videoContentFit="contain") are
//           both reverted. Assert across all three routes (event/trip/experience):
//             (a) the `miniCover` block declares `height: 64`, and
//             (b) the EventCoverMedia call has NO `videoContentFit`
//                 AND NO `onAspectRatio` (the plain cover call).
//   FIX 2 (round 3) — the shared EventCoverMedia `audioControlBottomRight` Sound
//           pill must sit at right:24 (= spacing.lg — visible right-edge breathing
//           room; KEPT from ORCH-1132) AND bottom:40 (round-3 clearance from the
//           public-event details panel; supersedes ORCH-1128's bottom:22).
//
// Source-introspection (not module import) because the checkout routes are heavy
// RN screens; this mirrors the precedent in
// BusinessWelcomeScreenLogoAdversarial.test.tsx. Extracting `property: value`
// from the actual StyleSheet block is comment-proof: it reads the live value,
// so a true LINE DELETION of the fix (re-adding `height: 120` / no height +
// `videoContentFit="contain"`, or reverting `bottom: 40` → 22) makes the test FAIL.
//
// fails-on-revert: verified by re-adding `videoContentFit="contain"` /
// `onAspectRatio=` + dropping `height: 64` / reverting `bottom: 40` → 22 — see
// IMPLEMENTATION_ORCH-1133 report.

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

describe("ORCH-1133 FIX 1 (round 3) — checkout mini-card cover is the compact 64px original band", () => {
  for (const route of CHECKOUT_ROUTES) {
    test(`${route} miniCover declares the fixed compact height: 64`, () => {
      const src = fs.readFileSync(path.join(businessDir, route), "utf8");
      const body = extractStyleBody(src, "miniCover");
      // original e90875dda~1 fixed band: height: 64 (no inline aspectRatio).
      expect(extractNumericStyleValue(body, "height")).toBe(64);
    });

    test(`${route} EventCoverMedia is the plain call (no videoContentFit / onAspectRatio)`, () => {
      const src = fs.readFileSync(path.join(businessDir, route), "utf8");
      const call = extractEventCoverMediaCall(src);
      expect(call).not.toMatch(/videoContentFit=/);
      expect(call).not.toMatch(/onAspectRatio=/);
    });
  }
});

describe("ORCH-1133 FIX 2 (round 3) — shared Sound-pill bottomRight inset", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "packages/offering-rendering/EventCoverMedia.tsx"),
    "utf8",
  );
  const body = extractStyleBody(src, "audioControlBottomRight");

  test("right === 24 (spacing.lg — visible right-edge breathing room, kept)", () => {
    expect(extractNumericStyleValue(body, "right")).toBe(24);
  });

  test("bottom === 40 (round-3 clearance from the public-event details panel)", () => {
    expect(extractNumericStyleValue(body, "bottom")).toBe(40);
  });
});
