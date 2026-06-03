/**
 * META-ORCH-1059 [experiences-business-parity] · COVER FREEZE regression.
 *
 * Operator-reported bug: opening the experience-wizard Cover step (Step 5) and
 * selecting a cover (Library image, Giphy GIF, OR a video) froze the whole
 * wizard so it could not be used.
 *
 * Root causes hardened here (all confirmed on a physical Android, R58R54YV7JT):
 *   1. `ExperienceCoverStep` rebuilt the discriminated `CoverTarget` object
 *      INLINE on every render. Because the wizard re-renders on every cover
 *      selection (`onCoverChange={setCover}`), each render handed CoverPickerSheet
 *      → CoverPicker a brand-new `target` reference, forcing the entire picker
 *      subtree (two expo-video previews + provider grids) to re-reconcile on
 *      every pick. Fix: memoize `target` keyed on [brandId, experienceId].
 *   2. The step's INLINE preview mounted a SECOND autoplaying expo-video player
 *      for the same URL while the picker sheet (which renders its own live
 *      preview) was open — two native video surfaces for one clip on Android.
 *      Fix: pause the inline player while the sheet is open
 *      (`autoplay={!pickerVisible}` + `playbackActive={!pickerVisible}`).
 *   3. The step re-rendered on every wizard render. Fix: `React.memo`.
 *
 * The same three hardenings are mirrored on the EVENT cover step (the
 * CoverPicker is shared) so the parity surface cannot regress.
 *
 * These are SOURCE assertions (the components carry heavy native deps —
 * expo-video / expo-image-picker / react-native-video-trim — that the jest
 * environment cannot render headlessly; there is no react-test-renderer or
 * @testing-library/react-native in this package). Each assertion FAILS on
 * revert of the corresponding fix.
 */

import { readFileSync } from "fs";
import { join } from "path";

const COMPONENTS = join(__dirname, "..", "..");
const read = (rel: string): string =>
  readFileSync(join(COMPONENTS, rel), "utf8");

const EXPERIENCE_STEP = "experience/ExperienceCoverStep.tsx";
const EVENT_STEP = "event/CreatorStep4Cover.tsx";

describe("META-ORCH-1059 cover freeze — ExperienceCoverStep hardening", () => {
  const src = read(EXPERIENCE_STEP);

  test("the CoverTarget is memoized (not rebuilt inline each render)", () => {
    // The memoized target keyed on the stable draft identity must exist.
    expect(src).toMatch(
      /const\s+target\s*=\s*useMemo<CoverTarget\s*\|\s*null>/,
    );
    // useMemo must key on brandId + experienceId only (so cover-selection
    // re-renders keep the SAME reference).
    expect(src).toMatch(/\[brandId,\s*experienceId\]/);
  });

  test("CoverPickerSheet receives the memoized target, not an inline literal", () => {
    // The picker must consume the stable variable...
    expect(src).toMatch(/target=\{target\}/);
    // ...and the old inline object literal must be GONE (fails on revert).
    expect(src).not.toMatch(/target=\{\{/);
  });

  test("the inline preview pauses its video player while the picker is open", () => {
    expect(src).toMatch(/autoplay=\{!pickerVisible\}/);
    expect(src).toMatch(/playbackActive=\{!pickerVisible\}/);
    expect(src).toMatch(
      /showAudioControl=\{cover\.coverMediaType === "video" && !pickerVisible\}/,
    );
  });

  test("the step is wrapped in React.memo", () => {
    expect(src).toMatch(/React\.memo\(ExperienceCoverStepImpl\)/);
  });
});

describe("META-ORCH-1059 cover freeze — event cover step PARITY (shared CoverPicker)", () => {
  const src = read(EVENT_STEP);

  test("the CoverTarget is memoized (not rebuilt inline each render)", () => {
    expect(src).toMatch(/const\s+target\s*=\s*useMemo<CoverTarget>/);
    expect(src).toMatch(/target=\{target\}/);
    expect(src).not.toMatch(/target=\{\{/);
  });

  test("the inline preview pauses its video player while the picker is open", () => {
    expect(src).toMatch(/autoplay=\{!pickerVisible\}/);
    expect(src).toMatch(/playbackActive=\{!pickerVisible\}/);
  });
});
