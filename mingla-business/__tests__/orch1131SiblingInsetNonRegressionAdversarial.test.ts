import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1131 [cover-crop-sound-inset] — ADVERSARIAL non-regression test (tester-authored).
//
// DIFFERENT ANGLE from the implementor's happy-path test
// (orch1131CoverCropSoundInset.test.ts), which only asserts the POSITIVE changed
// values (miniCover full-frame: no fixed height + videoContentFit="contain";
// bottomRight.right===24, bottom===22 — round 2, ORCH-1132).
//
// This test attacks the SIBLING-INVARIANT / collateral-regression surface that
// the happy-path test does NOT guard — the spec §7 adversarial angles:
//   (A) FIX 2 must NOT have shifted the untouched audioControlTopLeft /
//       audioControlTopRight pill insets. They must STILL read 14 (a careless
//       "tidy all pill insets to 16" copy-paste would silently move the top
//       pills — the happy-path test would stay green and miss it).
//   (B) The public-event hero (PublicEventPage `heroBox`) must NOT have inherited
//       a fixed pixel `height:` from the checkout FIX-1 change. The hero is
//       aspect-adaptive (aspectRatio set inline from the measured cover); a
//       fixed height would re-introduce crop/letterbox on the public page that
//       FIX 1 was explicitly scoped to NOT touch (spec §2 non-goals, SC-6).
//   (C) The shared bottomRight inset has exactly ONE `right:` declaration (guards
//       against a duplicate/override line being introduced that re-shadows 16).
//
// Source-introspection (the styles live in heavy RN screens / a web+native
// shared package; importing them pulls expo-video / react-native-web). Reading
// the live `property: value` from the StyleSheet block is comment-proof: a true
// line edit changes the asserted value. fails-on-revert is verified against a
// hand-mutation that flips topLeft/topRight to 16 and that adds a heroBox height.

const businessDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(businessDir, "..");

const EVENT_COVER_MEDIA = path.join(
  repoRoot,
  "packages/event-rendering/EventCoverMedia.tsx",
);
const PUBLIC_EVENT_PAGE = path.join(
  repoRoot,
  "packages/event-rendering/PublicEventPage.tsx",
);

/** Extract the body of `styleKey: { ... }` from a StyleSheet.create block. */
function extractStyleBody(src: string, styleKey: string): string {
  const m = src.match(
    new RegExp(`\\n\\s*${styleKey}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`),
  );
  if (!m) {
    throw new Error(`Could not locate \`${styleKey}:\` style block`);
  }
  return m[1];
}

/** All numeric values declared for `property` (skips commented-out lines). */
function allNumericValues(styleBody: string, property: string): number[] {
  const out: number[] = [];
  for (const rawLine of styleBody.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("//")) continue;
    const m = line.match(new RegExp(`^${property}:\\s*([0-9]+)\\s*,`));
    if (m) out.push(Number(m[1]));
  }
  return out;
}

describe("ORCH-1131 adversarial — sibling pill insets NOT shifted by FIX 2", () => {
  const src = fs.readFileSync(EVENT_COVER_MEDIA, "utf8");

  test("audioControlTopLeft stays left:14 / top:14 (untouched by FIX 2)", () => {
    const body = extractStyleBody(src, "audioControlTopLeft");
    expect(allNumericValues(body, "left")).toEqual([14]);
    expect(allNumericValues(body, "top")).toEqual([14]);
  });

  test("audioControlTopRight stays right:14 / top:14 (untouched by FIX 2)", () => {
    const body = extractStyleBody(src, "audioControlTopRight");
    expect(allNumericValues(body, "right")).toEqual([14]);
    expect(allNumericValues(body, "top")).toEqual([14]);
  });

  // ORCH-1133 [TEST-MOD-APPROVED ORCH-1133] round 3 — the bottomRight pill bottom
  // moved 22 → 40 (round-3 clearance from the public-event details panel). right
  // stays 24 (kept from ORCH-1132). Still exactly ONE right: and ONE bottom:
  // declaration (no shadow override re-shadows either).
  test("audioControlBottomRight has exactly ONE right: declaration (no shadow override)", () => {
    const body = extractStyleBody(src, "audioControlBottomRight");
    expect(allNumericValues(body, "right")).toEqual([24]);
    expect(allNumericValues(body, "bottom")).toEqual([40]);
  });
});

describe("ORCH-1131 adversarial — public hero did NOT inherit a fixed height", () => {
  const src = fs.readFileSync(PUBLIC_EVENT_PAGE, "utf8");

  test("PublicEventPage heroBox declares NO fixed pixel height (stays aspect-adaptive)", () => {
    const body = extractStyleBody(src, "heroBox");
    // A numeric `height: N,` here would re-introduce crop/letterbox the FIX-1
    // change was scoped away from (SC-6 / spec §2 non-goals). Hero height must
    // follow aspectRatio set inline, never a fixed band like the checkout 120.
    expect(allNumericValues(body, "height")).toEqual([]);
  });
});
