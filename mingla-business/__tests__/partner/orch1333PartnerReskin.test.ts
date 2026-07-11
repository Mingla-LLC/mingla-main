import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1333 [partner-pages re-skin + latent close-glyph fix] — fails-on-revert
 * regression contract.
 *
 * Two complaints + one latent bug fixed:
 *   1. Close glyph was `icon="x"` (a SOLID filled letterform-X, the social
 *      glyph) instead of the canonical `icon="close"` thin two-stroke ✕. There
 *      were exactly 4 `icon="x"` usages app-wide, all in these files.
 *   2. The partner pages diverged from the rest of the business app (orange
 *      `MINGLA PARTNER` eyebrow, `canvas.profile` warmer canvas, hand-rolled
 *      orange Pressable buttons). The re-skin drops the eyebrow, moves to
 *      `canvas.discover`, and renders the shared `<Button>` primitive.
 *
 * Source-contract test (readFileSync, no RN renderer).
 *
 * fails-on-revert verified at b6765d26 (all 4 assertions go RED on file revert)
 */

const repoRoot = path.resolve(__dirname, "../..");
const readBusinessFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// All four in-scope files: the 2 re-skinned partner pages + the 2 latent
// close-glyph swaps.
const CLOSE_GLYPH_FILES = [
  "app/partner/brands.tsx",
  "app/partner/earnings.tsx",
  "src/components/trip/TripManageMenu.tsx",
  "src/components/venue/VenueCreatorWizard.tsx",
];

const PARTNER_PAGES = ["app/partner/brands.tsx", "app/partner/earnings.tsx"];

describe("ORCH-1333 partner-pages re-skin + close-glyph contract", () => {
  test("D1/§7 — no in-scope file uses the filled letterform icon=\"x\" for a close/cancel control; each uses icon=\"close\"", () => {
    for (const rel of CLOSE_GLYPH_FILES) {
      const source = readBusinessFile(rel);
      // Reverting any swap re-introduces the filled letterform glyph → RED.
      expect(source).not.toContain('icon="x"');
      expect(source).toContain('icon="close"');
    }
  });

  test("D2 — both partner pages drop the MINGLA PARTNER screen-chrome eyebrow", () => {
    for (const rel of PARTNER_PAGES) {
      const source = readBusinessFile(rel);
      expect(source).not.toContain("MINGLA PARTNER");
    }
  });

  test("D3 — both partner pages use canvas.discover (not the off-brand canvas.profile)", () => {
    for (const rel of PARTNER_PAGES) {
      const source = readBusinessFile(rel);
      expect(source).toContain("canvas.discover");
      expect(source).not.toContain("canvas.profile");
    }
  });

  test("D4 — both partner pages render the shared Button primitive (bespoke orange Pressables removed)", () => {
    for (const rel of PARTNER_PAGES) {
      const source = readBusinessFile(rel);
      expect(source).toContain("src/components/ui/Button");
      // The hand-rolled button styles are gone.
      expect(source).not.toContain("primaryBtnText");
      expect(source).not.toContain("secondaryBtnText");
    }
  });
});
