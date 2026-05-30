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
  test.each(S5_FILES)("%s tabActive Android elevation resolves to 0", (rel) => {
    const code = stripComments(read(rel));
    // No bare `elevation: 8` remains.
    expect(code).not.toMatch(/elevation:\s*8\s*,/);
    // Android elevation is explicitly zeroed via Platform.select (ios:8, android:0).
    const tabActive = code.match(/tabActive:\s*\{[\s\S]*?\n\s{2}\},/);
    expect(tabActive).not.toBeNull();
    expect(tabActive![0]).toMatch(
      /elevation:\s*Platform\.select\(\{[\s\S]*?ios:\s*8[\s\S]*?android:\s*0[\s\S]*?\}\)/,
    );
  });

  test.each(S5_FILES)("%s imports Platform from react-native", (rel) => {
    const code = stripComments(read(rel));
    expect(code).toMatch(
      /import\s+\{[^}]*\bPlatform\b[^}]*\}\s+from\s+["']react-native["']/,
    );
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
      expect(host![0]).toMatch(
        /backgroundColor:\s*Platform\.select\(\{[\s\S]*?android:\s*["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']/,
      );
    },
  );
});

describe("META-ORCH-1002 Sub-1 — T-07 iOS frozen (business)", () => {
  test.each(S5_FILES)("%s keeps iOS elevation 8 + glow shadow", (rel) => {
    const code = stripComments(read(rel));
    expect(code).toMatch(/shadowColor:\s*["']#eb7825["']/);
    expect(code).toMatch(/ios:\s*8/);
  });

  test.each(S6_FILES)("%s keeps iOS translucent profileBase fill", (rel) => {
    const code = stripComments(read(rel));
    const host = code.match(/host:\s*\{[\s\S]*?\n\s{2}\},/);
    expect(host).not.toBeNull();
    expect(host![0]).toMatch(/ios:\s*glass\.tint\.profileBase/);
    expect(host![0]).toMatch(/default:\s*glass\.tint\.profileBase/);
  });
});
