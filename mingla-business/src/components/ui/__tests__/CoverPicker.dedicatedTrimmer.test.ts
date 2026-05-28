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

  test("T-AMEND9-02 trimmer cancel resolves without starting an upload", () => {
    const source = repoFile("src/components/ui/CoverPicker.tsx");
    const cancelHandlerIndex = source.indexOf("videoTrim.onCancelTrimming");
    const cancelReturnIndex = source.indexOf("if (isNative && trimResult === null) return;");
    const uploadStartIndex = source.indexOf("await videoUpload.start(uploadFile);");

    expect(cancelHandlerIndex).toBeGreaterThan(-1);
    expect(cancelReturnIndex).toBeGreaterThan(cancelHandlerIndex);
    expect(uploadStartIndex).toBeGreaterThan(cancelReturnIndex);
    expect(source).toContain("settle(() => resolve(null))");
    expect(source).not.toContain("[ORCH-0978-POC]");
  });
});
