/**
 * ORCH-1186-B — Safeguard 3: overview-no-listing-recap (Leg 1 hand-off parity).
 *
 * Source-grep on VenueSuiteShell.tsx asserting the Overview slot now renders the
 * intelligence dashboard, NOT the listing recap. The recap content moved to
 * Settings (Leg 1); re-mounting VenueListingContent at Overview is a regression.
 *
 * fails-on-revert: re-mounting <VenueListingContent ...> in the Overview branch
 * (activeModule === "overview") flips this test.
 */
import fs from "node:fs";
import path from "node:path";

const SHELL_PATH = path.resolve(__dirname, "..", "VenueSuiteShell.tsx");

describe("VenueSuiteShell Overview slot (ORCH-1186-B)", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SHELL_PATH, "utf8");
  });

  it("mounts VenueIntelligenceModule (imported + rendered)", () => {
    expect(source.includes("VenueIntelligenceModule")).toBe(true);
    expect(/<VenueIntelligenceModule\b/.test(source)).toBe(true);
  });

  it("does NOT render the listing recap (<VenueListingContent) anywhere", () => {
    // The component file is owned by Leg 1 and may still exist, but the SHELL
    // must not MOUNT it. No JSX usage of <VenueListingContent ...>.
    expect(/<VenueListingContent\b/.test(source)).toBe(false);
  });

  it("keeps the reservations-activation invitation card on Overview", () => {
    // Orthogonal CTA, NOT part of the Leg-1 relocation — must survive.
    expect(source.includes("Turn on Reservations")).toBe(true);
  });
});
