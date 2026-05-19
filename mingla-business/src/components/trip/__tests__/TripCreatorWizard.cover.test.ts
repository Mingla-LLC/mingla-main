/**
 * ORCH-0876 [Trip CRUD + Purchase Flow Completion] — implementor happy-path
 * regression test per ORCH-0840 [Regression-test enforcement + append-only CI].
 *
 * Pins the 4 surgical mods applied to TripCreatorWizard.tsx in Phase 3b
 * plus the Cover field added to TripCreatorStep1Basics.tsx:
 *
 *   - tripToStep1Draft seeds coverMediaUrl + coverMediaType from the trip row
 *   - isTripWizardPristine compares the cover fields (dirty when cover changes)
 *   - autosaveStep1 persists cover_media_url + cover_media_type to updateBasics
 *   - handleStepBack is async and autosaves before stepping back
 *   - handleClose (edit mode) autosaves the current step before exiting
 *   - Step 1 mounts the shared <CoverPicker> with all 3 providers
 *
 * Spec: SPEC_ORCH-0876_V2_FULL_PARITY §6 + §9.1.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");
function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

describe("ORCH-0876 — TripCreatorWizard cover field + autosave wiring", () => {
  const WIZ = read("components/trip/TripCreatorWizard.tsx");
  const STEP1 = read("components/trip/TripCreatorStep1Basics.tsx");

  // ============================================================
  // TripCreatorWizard mods
  // ============================================================

  test("tripToStep1Draft returns coverMediaUrl + coverMediaType seeded from the trip", () => {
    const fn = WIZ.match(/function tripToStep1Draft\(trip: Trip\): Step1Draft \{[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/coverMediaUrl:\s*trip\.coverMediaUrl/);
    // coverMediaType must be narrowed from string|null to the EventCoverMediaType union.
    expect(fn![0]).toMatch(/coverMediaType:\s*[\s\S]*?trip\.coverMediaType === "image"/);
    expect(fn![0]).toMatch(/"video"/);
    expect(fn![0]).toMatch(/"gif"/);
  });

  test("isTripWizardPristine compares both cover fields", () => {
    const fn = WIZ.match(/function isTripWizardPristine\([\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/step1Draft\.coverMediaUrl !== initStep1\.coverMediaUrl/);
    expect(fn![0]).toMatch(/step1Draft\.coverMediaType !== initStep1\.coverMediaType/);
  });

  test("autosaveStep1 persists coverMediaUrl + coverMediaType in the basics patch", () => {
    const fn = WIZ.match(/const autosaveStep1 = useCallback\([\s\S]*?\}, \[[\s\S]*?\]\);/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/updateBasicsMutation\.mutateAsync\(/);
    expect(fn![0]).toMatch(/coverMediaUrl:\s*step1Draft\.coverMediaUrl/);
    expect(fn![0]).toMatch(/coverMediaType:\s*step1Draft\.coverMediaType/);
  });

  test("handleStepBack is async and autosaves before stepping back", () => {
    const fn = WIZ.match(
      /const handleStepBack = useCallback\(async \(\): Promise<void> => \{[\s\S]*?\}, \[autosaveCurrentStep,\s*step\]\);/,
    );
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/await autosaveCurrentStep\(\)/);
    // Back-button callsites must wrap the async call in `void` to discard the Promise.
    expect(WIZ).toMatch(/onPress=\{\(\) => \{\s*void handleStepBack\(\);/);
  });

  test("handleClose in edit mode autosaves before onExit (silent — banner already flagged)", () => {
    // The else-branch of `if (isCreateMode)` in handleClose must autosave.
    const fn = WIZ.match(/const handleClose = useCallback\(\(\): void => \{[\s\S]*?\}, \[[\s\S]*?autosaveCurrentStep,?\s*\]\);/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/Edit mode[\s\S]*?await autosaveCurrentStep\(\)/);
    // Comment must explain the silent semantics so future readers don't add a toast.
    expect(fn![0]).toMatch(/banner already flagged the failure/i);
  });

  test("Step 1 element passes brandId + tripEventId + onShowToast to the inner component", () => {
    expect(WIZ).toMatch(/<TripCreatorStep1Basics\b[\s\S]*?brandId=\{trip\.brandId\}/);
    expect(WIZ).toMatch(/<TripCreatorStep1Basics\b[\s\S]*?tripEventId=\{trip\.id\}/);
    expect(WIZ).toMatch(/<TripCreatorStep1Basics\b[\s\S]*?onShowToast=\{showToast\}/);
  });

  test("Saved toast fires on autosave success in edit mode only", () => {
    expect(WIZ).toMatch(/prevAutosaveSavedAtRef\s*=\s*useRef<string \| null>\(autosaveSavedAt\)/);
    expect(WIZ).toMatch(/!isCreateMode[\s\S]*?showToast\("Saved"\)/);
  });

  // ============================================================
  // TripCreatorStep1Basics cover field
  // ============================================================

  test("Step1Draft type includes coverMediaUrl + coverMediaType fields", () => {
    expect(STEP1).toMatch(/export interface Step1Draft \{[\s\S]*?coverMediaUrl:\s*string \| null;/);
    expect(STEP1).toMatch(
      /coverMediaType:\s*EventCoverMediaType \| null;/,
    );
  });

  test("Step1Basics props require brandId + tripEventId for CoverPicker context", () => {
    expect(STEP1).toMatch(/brandId:\s*string;/);
    expect(STEP1).toMatch(/tripEventId:\s*string;/);
    expect(STEP1).toMatch(/onShowToast\?\:\s*\(msg:\s*string\)\s*=>\s*void;/);
  });

  test("Step1 renders shared <CoverPicker> with all 3 providers enabled", () => {
    expect(STEP1).toContain('import { CoverPicker, type CoverPatch } from "../ui/CoverPicker"');
    expect(STEP1).toMatch(/<CoverPicker\b[\s\S]*?providers=\{\["upload", "giphy", "pexels"\]\}/);
    expect(STEP1).toMatch(/<CoverPicker\b[\s\S]*?onCoverChange=\{handleCoverChange\}/);
  });

  test("handleCoverChange forwards both cover fields to the parent onChange", () => {
    const fn = STEP1.match(/const handleCoverChange = useCallback\([\s\S]*?\[onChange\],?\s*\);/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/coverMediaUrl:\s*patch\.coverMediaUrl/);
    expect(fn![0]).toMatch(/coverMediaType:\s*patch\.coverMediaType/);
  });
});
