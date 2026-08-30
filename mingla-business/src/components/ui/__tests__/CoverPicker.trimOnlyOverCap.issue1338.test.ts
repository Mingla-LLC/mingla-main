import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * issue #1338 — video cover picker silently bails (business app).
 *
 * Source-grep regression guards (matching the existing `repoFile` convention in
 * CoverPicker.videoSourceCeiling.test.ts / CoverPicker.dedicatedTrimmer.test.ts).
 * Each assertion FAILS when the corresponding fix line is reverted:
 *  - T-1338-01 fails if the unconditional `const trimResult = isNative ? await …`
 *    is restored (trim would run for every clip again).
 *  - T-1338-02 fails if the silent `if (isNative && trimResult === null) return;`
 *    bail is restored.
 *  - T-1338-03 fails if any video-flow message is routed back through onShowToast.
 *  - T-1338-04 fails if present-after-dismissal (InteractionManager +
 *    waitForPickerDismissal await) is removed.
 */
const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const PICKER = "src/components/ui/CoverPicker.tsx";

describe("CoverPicker trim-only-over-cap + in-sheet feedback (issue #1338)", () => {
  test("T-1338-01 native trim is gated on isNative AND over the source ceiling", () => {
    const picker = repoFile(PICKER);

    // The trim-decision gate exists and is gated on BOTH conditions.
    expect(picker).toContain("const needsNativeTrim =");
    expect(picker).toContain(
      "isNative && sourceDurationMs > EVENT_COVER_SOURCE_CEILING_MS",
    );
    expect(picker).toContain(
      "const sourceDurationMs = normalizePickerDurationMs(asset.duration);",
    );

    // The OLD unconditional trim call is GONE (would run trim for every clip).
    expect(picker).not.toContain("const trimResult = isNative");
    expect(picker).not.toMatch(
      /const trimResult = isNative\s*\?\s*await trimVideoWithDedicatedEditor/,
    );

    // The trimmer is only invoked inside the needsNativeTrim branch.
    const branchIdx = picker.indexOf("if (needsNativeTrim) {");
    const trimCallIdx = picker.indexOf("await trimVideoWithDedicatedEditor(");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(trimCallIdx).toBeGreaterThan(branchIdx);
  });

  test("T-1338-02 the silent null-bail is gone; cancel surfaces an in-sheet notice", () => {
    const picker = repoFile(PICKER);

    // The exact silent-bail line is removed.
    expect(picker).not.toContain(
      "if (isNative && trimResult === null) return;",
    );

    // [TEST-MOD-APPROVED #2715] The cancel notice follows the exact 15-second ceiling.
    // The cancel branch emits an in-sheet info notice with the "No video added" copy.
    expect(picker).toMatch(
      /setVideoPickNotice\(\{\s*tone:\s*"info",\s*text:\s*"No video added — trim to 15 seconds or pick a shorter clip\.",/,
    );
  });

  test("T-1338-03 every video-flow message is emitted via setVideoPickNotice, not onShowToast", () => {
    const picker = repoFile(PICKER);

    // For each video-flow copy string, the ENCLOSING call must be
    // setVideoPickNotice (nearest preceding), never onShowToast.
    // [TEST-MOD-APPROVED #2715 A14] Every duration notice uses the binding
    // 15-second copy, including the distinct web path where no trimmer exists.
    const videoFlowCopy = [
      '"Trim it to 15 seconds or less, then choose it again."',
      '"Choose a video that is 15 seconds or shorter."',
      '"No video added — trim to 15 seconds or pick a shorter clip."',
      '"Video cover added."',
      "\"Could not read this video's duration. Try another clip.\"",
      "\"Could not read this video's size. Try another clip.\"",
    ];

    for (const copy of videoFlowCopy) {
      const idx = picker.indexOf(copy);
      expect(idx).toBeGreaterThan(-1);
      const noticeIdx = picker.lastIndexOf("setVideoPickNotice(", idx);
      const toastIdx = picker.lastIndexOf("onShowToast(", idx);
      expect(noticeIdx).toBeGreaterThan(-1);
      // The nearest preceding emit call is setVideoPickNotice, not onShowToast.
      expect(noticeIdx).toBeGreaterThan(toastIdx);
    }
  });

  test("T-1338-04 present-after-dismissal: InteractionManager import + awaited on the trim branch", () => {
    const picker = repoFile(PICKER);

    // InteractionManager is imported from react-native.
    expect(picker).toMatch(
      /import\s*\{[\s\S]*?\bInteractionManager\b[\s\S]*?\}\s*from\s*"react-native";/,
    );

    // The dismissal helper is defined.
    expect(picker).toContain("const waitForPickerDismissal = ()");
    expect(picker).toContain("InteractionManager.runAfterInteractions(");

    // It is awaited INSIDE the needsNativeTrim branch, before the trim call.
    const branchIdx = picker.indexOf("if (needsNativeTrim) {");
    const awaitDismissIdx = picker.indexOf("await waitForPickerDismissal();");
    const trimCallIdx = picker.indexOf("await trimVideoWithDedicatedEditor(");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(awaitDismissIdx).toBeGreaterThan(branchIdx);
    expect(trimCallIdx).toBeGreaterThan(awaitDismissIdx);
  });
});
