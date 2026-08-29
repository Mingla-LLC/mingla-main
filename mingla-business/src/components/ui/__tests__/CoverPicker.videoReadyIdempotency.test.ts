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
  // [TEST-MOD-APPROVED #2715 A14] The ready URL is durable before ack, remembered
  // only after both awaits, and remains retryable when either durable step fails.
  test("persists then acknowledges a ready upload before remembering success, and retries failures", () => {
    const pickerSource = repoFile("src/components/ui/CoverPicker.tsx");
    const persistStartIndex = pickerSource.indexOf(
      "const persistReadyVideo = useCallback(async (): Promise<void> => {",
    );
    const durablePersistIndex = pickerSource.indexOf("await emitChange({", persistStartIndex);
    const durableAckIndex = pickerSource.indexOf(
      "if (isVenue) await videoUpload.acknowledgeApplied();",
      durablePersistIndex,
    );
    const rememberUrlIndex = pickerSource.indexOf(
      "lastEmittedProcessedVideoUrlRef.current = readyUrl;",
      durableAckIndex,
    );
    const successNoticeIndex = pickerSource.indexOf(
      'setVideoPickNotice({ tone: "info", text: "Video cover added." });',
      rememberUrlIndex,
    );
    const catchIndex = pickerSource.indexOf("} catch {", successNoticeIndex);
    const clearRememberedIndex = pickerSource.indexOf(
      "lastEmittedProcessedVideoUrlRef.current = null;",
      catchIndex,
    );
    const retryCopyIndex = pickerSource.indexOf(
      'text: "The video is ready, but the cover could not be saved. Retry saving it."',
      clearRememberedIndex,
    );
    const retryActionIndex = pickerSource.indexOf(
      'label="Retry saving"',
      retryCopyIndex,
    );

    expect(pickerSource).toContain(
      "const lastEmittedProcessedVideoUrlRef = useRef<string | null>(null);",
    );
    expect(persistStartIndex).toBeGreaterThan(-1);
    expect(durablePersistIndex).toBeGreaterThan(persistStartIndex);
    expect(durableAckIndex).toBeGreaterThan(durablePersistIndex);
    expect(rememberUrlIndex).toBeGreaterThan(durableAckIndex);
    expect(successNoticeIndex).toBeGreaterThan(rememberUrlIndex);
    expect(catchIndex).toBeGreaterThan(successNoticeIndex);
    expect(clearRememberedIndex).toBeGreaterThan(catchIndex);
    expect(retryCopyIndex).toBeGreaterThan(clearRememberedIndex);
    expect(retryActionIndex).toBeGreaterThan(retryCopyIndex);
    // The success feedback no longer flows through the root Toast.
    expect(pickerSource).not.toContain('onShowToast("Video cover updated.");');
  });
});
