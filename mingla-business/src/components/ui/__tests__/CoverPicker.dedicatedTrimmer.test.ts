import { readFileSync } from "fs";
import path from "path";

import { describe, expect, jest, test } from "@jest/globals";

import { buildTrimmedVideoUploadFile } from "../coverPickerVideoTrimUpload";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("CoverPicker dedicated trimmer wiring", () => {
  test("T-AMEND9-01 builds the upload from the trimmer outputPath and selected segment", async () => {
    const statFile = jest.fn(async () => ({ exists: true, size: 1_234_567 }));

    const uploadFile = await buildTrimmedVideoUploadFile({
      originalFileName: null,
      originalMimeType: null,
      statFile,
      trimResult: {
        duration: 59_652,
        endTime: 29_000,
        outputPath: "file:///Documents/trimmedVideo_1780000151.mp4",
        startTime: 4_000,
      },
    });

    expect(statFile).toHaveBeenCalledWith(
      "file:///Documents/trimmedVideo_1780000151.mp4",
    );
    expect(uploadFile).toEqual({
      bytes: 1_234_567,
      durationMs: 25_000,
      fileName: "trimmedVideo_1780000151.mp4",
      mimeType: "video/mp4",
      trimEndMs: 25_000,
      trimStartMs: 0,
      uri: "file:///Documents/trimmedVideo_1780000151.mp4",
    });
  });

  // [TEST-MOD-APPROVED ORCH-1001] Repointed: the native trimmer wiring
  // (onCancelTrimming + settle(resolve(null))) moved out of CoverPicker.tsx
  // into the Metro platform-split module coverPickerVideoTrimEditor.ts so the
  // native-only `react-native-video-trim` import never reaches the web bundle
  // (the ORCH-0989 white-page crash). The cancel→no-upload CONTRACT is
  // unchanged — it now spans the editor module (cancel resolves null) and
  // CoverPicker.tsx (early-return before videoUpload.start). Both halves verified.
  test("T-AMEND9-02 trimmer cancel resolves without starting an upload", () => {
    const editor = repoFile("src/components/ui/coverPickerVideoTrimEditor.ts");
    const picker = repoFile("src/components/ui/CoverPicker.tsx");

    // Editor module: cancel handler resolves null.
    expect(editor.indexOf("videoTrim.onCancelTrimming")).toBeGreaterThan(-1);
    expect(editor).toContain("settle(() => resolve(null))");

    // CoverPicker: the early-return on a null trim result precedes the upload.
    const cancelReturnIndex = picker.indexOf("if (isNative && trimResult === null) return;");
    const uploadStartIndex = picker.indexOf("await videoUpload.start(uploadFile);");
    expect(cancelReturnIndex).toBeGreaterThan(-1);
    expect(uploadStartIndex).toBeGreaterThan(cancelReturnIndex);

    // The native-only import is gone from CoverPicker; it lives only in the split module.
    expect(picker).not.toMatch(/from\s+["']react-native-video-trim["']/);
    expect(editor).not.toContain("[ORCH-0978-POC]");
  });
});
