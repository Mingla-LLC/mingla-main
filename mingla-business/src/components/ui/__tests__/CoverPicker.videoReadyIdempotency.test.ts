import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("CoverPicker video-ready idempotency", () => {
  // [TEST-MOD-APPROVED issue #1338] Repointed the final ordering assertion only.
  // issue #1338 moves the video-ready SUCCESS feedback off the root-portal Toast
  // (which iOS drops while the CoverPickerSheet modal is up) onto the in-sheet
  // notice — SPEC §4.2 replaces `onShowToast("Video cover updated.")` with
  // `setVideoPickNotice({ tone: "info", text: "Video cover added." })`, mandated
  // by SC-6 + I-PROPOSED-1338-COVER-FLOW-FEEDBACK-IN-SHEET. The idempotency-
  // ordering guarantee this test exists to protect (remember-url → clear-error →
  // emit → success-feedback) is UNCHANGED; only the success-feedback channel the
  // last assertion pins changed from the Toast literal to the in-sheet notice.
  test("guards the ready upload effect against callback identity churn", () => {
    const pickerSource = repoFile("src/components/ui/CoverPicker.tsx");

    const readyGuardIndex = pickerSource.indexOf(
      'if (videoUpload.stage.phase !== "ready" || videoUpload.processedUrl === null)',
    );
    const duplicateGuardIndex = pickerSource.indexOf(
      "lastEmittedProcessedVideoUrlRef.current === videoUpload.processedUrl",
    );
    const rememberUrlIndex = pickerSource.indexOf(
      "lastEmittedProcessedVideoUrlRef.current = videoUpload.processedUrl",
    );
    const clearErrorIndex = pickerSource.indexOf(
      "setMediaDisplayError(null);",
      rememberUrlIndex,
    );
    const emitIndex = pickerSource.indexOf("emitChange({", rememberUrlIndex);
    // #1338 — success feedback now renders in-sheet, never via the root Toast.
    const successNoticeIndex = pickerSource.indexOf(
      'setVideoPickNotice({ tone: "info", text: "Video cover added." });',
      rememberUrlIndex,
    );

    expect(pickerSource).toContain(
      "const lastEmittedProcessedVideoUrlRef = useRef<string | null>(null);",
    );
    expect(readyGuardIndex).toBeGreaterThan(-1);
    expect(duplicateGuardIndex).toBeGreaterThan(readyGuardIndex);
    expect(rememberUrlIndex).toBeGreaterThan(duplicateGuardIndex);
    expect(clearErrorIndex).toBeGreaterThan(rememberUrlIndex);
    expect(emitIndex).toBeGreaterThan(rememberUrlIndex);
    expect(successNoticeIndex).toBeGreaterThan(emitIndex);
    // The success feedback no longer flows through the root Toast.
    expect(pickerSource).not.toContain('onShowToast("Video cover updated.");');
  });
});
