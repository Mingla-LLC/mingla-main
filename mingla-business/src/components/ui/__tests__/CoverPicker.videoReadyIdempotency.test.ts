import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("CoverPicker video-ready idempotency", () => {
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
    const toastIndex = pickerSource.indexOf(
      'onShowToast("Video cover updated.");',
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
    expect(toastIndex).toBeGreaterThan(emitIndex);
  });
});
