/**
 * META-ORCH-1059 [cover picker selected-state] regression.
 *
 * Operator-reported gap: tapping a GIF / Pexels / Library tile applied the cover
 * live + flashed a toast, but the tapped tile got NO persistent selected state
 * and the sheet only offered a generic "Done" — the user couldn't tell their
 * pick registered. Operator-chosen fix: a persistent SELECTED indicator on the
 * chosen tile (accent border + checkmark) + a confirm button that reflects the
 * selection ("Use this cover" with a thumbnail), keep-open + confirm.
 *
 * Two layers of coverage:
 *   1. REAL LOGIC — the pure selection helpers (coverMediaMatches /
 *      findSelectedProviderId) are imported and exercised directly. These fail
 *      on revert of the matching logic.
 *   2. SOURCE WIRING — CoverPicker.tsx + CoverPickerSheet.tsx carry heavy native
 *      deps (expo-video / expo-image-picker / react-native-video-trim) the jest
 *      env cannot render, so the render-side wiring is asserted via source. Each
 *      assertion fails on revert of the corresponding change.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  coverMediaMatches,
  findSelectedProviderId,
} from "../coverPickerSelection";

const UI = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(UI, rel), "utf8");

describe("META-ORCH-1059 selection logic (real)", () => {
  test("coverMediaMatches: same non-empty URL is a match", () => {
    expect(coverMediaMatches("https://x/a.gif", "https://x/a.gif")).toBe(true);
  });

  test("coverMediaMatches: different URLs do not match", () => {
    expect(coverMediaMatches("https://x/a.gif", "https://x/b.gif")).toBe(false);
  });

  test("coverMediaMatches: null / empty on either side is never a match", () => {
    expect(coverMediaMatches(null, "https://x/a.gif")).toBe(false);
    expect(coverMediaMatches("https://x/a.gif", null)).toBe(false);
    expect(coverMediaMatches("", "https://x/a.gif")).toBe(false);
    expect(coverMediaMatches("https://x/a.gif", "")).toBe(false);
  });

  test("findSelectedProviderId: returns the matching tile id, scoped by provider", () => {
    const giphy = [
      { id: "g1", mediaUrl: "https://giphy/1.gif" },
      { id: "g2", mediaUrl: "https://giphy/2.gif" },
    ];
    expect(
      findSelectedProviderId("https://giphy/2.gif", "giphy", "giphy", giphy),
    ).toBe("g2");
  });

  test("findSelectedProviderId: only one tile can be selected at a time", () => {
    const pexels = [
      { id: 11, mediaUrl: "https://pexels/11.jpg" },
      { id: 22, mediaUrl: "https://pexels/22.jpg" },
      { id: 33, mediaUrl: "https://pexels/33.jpg" },
    ];
    const matches = pexels.filter(
      (p) =>
        findSelectedProviderId(
          "https://pexels/22.jpg",
          "pexels",
          "pexels",
          pexels,
        ) === p.id,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(22);
  });

  test("findSelectedProviderId: provider mismatch never selects (giphy URL cannot light a pexels tile)", () => {
    const pexels = [{ id: 11, mediaUrl: "https://giphy/1.gif" }];
    expect(
      findSelectedProviderId("https://giphy/1.gif", "giphy", "pexels", pexels),
    ).toBeNull();
  });

  test("findSelectedProviderId: no match returns null", () => {
    const giphy = [{ id: "g1", mediaUrl: "https://giphy/1.gif" }];
    expect(
      findSelectedProviderId("https://other/x.gif", "giphy", "giphy", giphy),
    ).toBeNull();
  });
});

describe("META-ORCH-1059 CoverPicker selected-state wiring (source)", () => {
  const src = read("CoverPicker.tsx");

  test("the picker computes selected GIF + Pexels ids via the shared helper", () => {
    expect(src).toContain("findSelectedProviderId");
    expect(src).toMatch(/const\s+selectedGiphyId\s*=\s*findSelectedProviderId\(/);
    expect(src).toMatch(/const\s+selectedPexelsId\s*=\s*findSelectedProviderId\(/);
  });

  test("the selected ids are passed into both provider grids", () => {
    expect(src).toMatch(/selectedGiphyId=\{selectedGiphyId\}/);
    expect(src).toMatch(/selectedPexelsId=\{selectedPexelsId\}/);
  });

  test("each grid tile receives a selected flag matched by id", () => {
    expect(src).toMatch(/selected=\{selectedGiphyId === r\.id\}/);
    expect(src).toMatch(/selected=\{selectedPexelsId === r\.id\}/);
  });

  test("the selected tile renders an accent border + checkmark badge", () => {
    expect(src).toMatch(/selected && styles\.tileSelected/);
    expect(src).toContain("styles.selectedBadge");
    expect(src).toMatch(/<Icon\s+name="check"/);
    // accent.border is the selected ring colour
    expect(src).toMatch(/tileSelected:\s*\{[^}]*borderColor:\s*accent\.border/s);
  });

  test("the Library preview also shows the selected check when a cover is applied", () => {
    expect(src).toMatch(/hasCover && !activeVideoUpload && styles\.coverPreviewSelected/);
  });
});

describe("META-ORCH-1059 CoverPickerSheet confirm button (source)", () => {
  const src = read("CoverPickerSheet.tsx");

  test("the sheet tracks the live selection so the confirm button can reflect it", () => {
    expect(src).toMatch(/useState<CoverPatch>\(initial\)/);
    expect(src).toMatch(/const\s+handleCoverChange\s*=\s*useCallback/);
    // the wrapped handler is what the picker emits into
    expect(src).toMatch(/onCoverChange=\{handleCoverChange\}/);
  });

  test('confirm button reads "Use this cover" with a thumbnail when something is selected', () => {
    expect(src).toContain("Use this cover");
    expect(src).toMatch(/testID="cover-picker-confirm"/);
    // thumbnail of the current selection
    expect(src).toMatch(/source=\{\{ uri: currentPatch\.coverMediaUrl \}\}/);
  });

  test("confirm + close: the confirm button calls onClose (cover already persisted live)", () => {
    expect(src).toMatch(/testID="cover-picker-confirm"[\s\S]*?onPress=\{onClose\}|onPress=\{onClose\}[\s\S]*?testID="cover-picker-confirm"/);
  });

  test('falls back to a plain "Done" dismiss when nothing is selected', () => {
    expect(src).toMatch(/hasSelection \?[\s\S]*?:\s*\(\s*<Button\s+label="Done"/);
    expect(src).toMatch(/testID="cover-picker-done"/);
  });
});
