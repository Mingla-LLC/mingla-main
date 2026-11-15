import fs from "node:fs";
import path from "node:path";

/**
 * META-ORCH-1002 Sub-1 (Android glass first strike) — business-side regression check.
 *
 * Pixel rendering can't be unit-asserted (ts-jest testEnvironment:node). These are
 * style/Platform.select source assertions — the established business CI pattern.
 * On-device pixel verification is the tester's live-fire job (SPEC §8.3).
 *
 *   T-05  S5 elevation zeroed on Android (×2 trip tab-bars); iOS elevation:8 kept
 *   T-06  S6 host clipped + opaque Android fill (×2 list cards); iOS profileBase kept
 *   T-07  iOS frozen (business): every Platform.select keeps its ios/default original
 */

const componentsDir = path.resolve(__dirname, "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(componentsDir, rel), "utf8");

// Strip comments so our own explanatory comments never satisfy/false-trip a match.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const S5_FILES = [
  "trip/EditPublishedTripIntakeAccordion.tsx",
  "trip/TripCreatorStep6Intake.tsx",
];
const S6_FILES = ["event/EventListCard.tsx", "trip/TripListCard.tsx"];

describe("META-ORCH-1002 Sub-1 — S5 trip tab-bar Android elevation zeroed", () => {
  // [TEST-MOD-APPROVED #4420] Graphite Glass retires the orange tab glow on
  // every platform: tabActive spreads shadow.none, whose elevation is 0, so
  // Android still draws no elevation artefact (the Sub-1 intent).
  test.each(S5_FILES)("%s tabActive Android elevation resolves to 0", (rel) => {
    const code = stripComments(read(rel));
    expect(code).not.toMatch(/elevation:\s*[1-9]/);
    const tabActive = code.match(/tabActive:\s*\{[\s\S]*?\n\s{2}\},/);
    expect(tabActive).not.toBeNull();
    expect(tabActive![0]).toMatch(/\.\.\.shadow\.none/);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shadow } = require("../../constants/designSystem") as typeof import("../../constants/designSystem");
    expect(shadow.none.elevation).toBe(0);
    expect(shadow.none.shadowOpacity).toBe(0);
  });
});

describe("META-ORCH-1002 Sub-1 — S6 list-card host clipped + opaque on Android", () => {
  test.each(S6_FILES)("%s host has overflow: 'hidden'", (rel) => {
    const code = stripComments(read(rel));
    const host = code.match(/host:\s*\{[\s\S]*?\n\s{2}\},/);
    expect(host).not.toBeNull();
    expect(host![0]).toMatch(/overflow:\s*["']hidden["']/);
    // The old non-clipping value must be gone from the host block.
    expect(host![0]).not.toMatch(/overflow:\s*["']visible["']/);
  });

  test.each(S6_FILES)(
    "%s host uses opaque rgba(20,22,26,0.92) Android fill via Platform.select",
    (rel) => {
      const code = stripComments(read(rel));
      const host = code.match(/host:\s*\{[\s\S]*?\n\s{2}\},/);
      expect(host).not.toBeNull();
      // [TEST-MOD-APPROVED #4420] — the opaque Android fill may be the
      // Graphite solid material token instead of the old literal.
      expect(host![0]).toMatch(
        /backgroundColor:\s*Platform\.select\(\{[\s\S]*?android:\s*(?:["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']|materials\.\w+\.solidFill)/,
      );
    },
  );
});

describe("META-ORCH-1002 Sub-1 — T-07 iOS frozen (business)", () => {
  // [TEST-MOD-APPROVED #4420] the iOS orange glow is retired by design (no
  // orange shadow anywhere in the Host chrome); the tab must not bring it back.
  test.each(S5_FILES)("%s carries no orange glow shadow", (rel) => {
    const code = stripComments(read(rel));
    expect(code).not.toMatch(/shadowColor:\s*["']#eb7825["']/);
    expect(code).not.toMatch(/shadowColor:\s*(?:accent\.warm|color\.accent)\b/);
  });


  test.each(S6_FILES)("%s keeps iOS translucent profileBase fill", (rel) => {
    const code = stripComments(read(rel));
    const host = code.match(/host:\s*\{[\s\S]*?\n\s{2}\},/);
    expect(host).not.toBeNull();
    // [TEST-MOD-APPROVED #4420] — the translucent wash may be its Graphite
    // role token (`glass.tint.profileBase` aliases `color.fill.inset`).
    expect(host![0]).toMatch(/ios:\s*(?:glass\.tint\.profileBase|color\.fill\.inset)/);
    expect(host![0]).toMatch(/default:\s*(?:glass\.tint\.profileBase|color\.fill\.inset)/);
  });
});
