import { readFileSync } from "fs";
import path from "path";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

import { buildTrimmedVideoUploadFile } from "../coverPickerVideoTrimUpload";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

afterEach(() => {
  jest.dontMock("react-native-video-trim");
  jest.resetModules();
});

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

  // [TEST-MOD-APPROVED issue #1338] Repointed (was ORCH-1001): issue #1338
  // fixed the SILENT bail. The old CoverPicker assertion pinned the exact
  // `if (isNative && trimResult === null) return;` line — the very silent-close
  // being removed. The cancel→no-upload CONTRACT is preserved but now surfaces
  // an in-sheet notice: the trim call is gated on `needsNativeTrim`, and a null
  // (genuine cancel) sets `setVideoPickNotice` + early-returns BEFORE the upload.
  // The editor-side assertions (onCancelTrimming + settle(resolve(null)) + the
  // no-top-level-value-import guard) remain valid and are unchanged.
  test("T-AMEND9-02 trimmer cancel surfaces an in-sheet notice without starting an upload", () => {
    const editor = repoFile("src/components/ui/coverPickerVideoTrimEditor.ts");
    const picker = repoFile("src/components/ui/CoverPicker.tsx");

    // Editor module: cancel handler resolves null (UNCHANGED contract).
    expect(editor.indexOf("videoTrim.onCancelTrimming")).toBeGreaterThan(-1);
    expect(editor).toContain("settle(() => resolve(null))");

    // CoverPicker (#1338): the trim call is gated on needsNativeTrim, and a null
    // trim result surfaces an in-sheet cancel notice + early-returns before the
    // upload. The old silent `if (isNative && trimResult === null) return;` is gone.
    expect(picker).not.toContain(
      "if (isNative && trimResult === null) return;",
    );
    expect(picker).toContain("if (needsNativeTrim) {");
    // [TEST-MOD-APPROVED #2715] Cancel copy follows the exact 15-second ceiling.
    const cancelNoticeIndex = picker.indexOf(
      "No video added — trim to 15 seconds or pick a shorter clip.",
    );
    const uploadStartIndex = picker.indexOf("await videoUpload.start(uploadFile);");
    expect(cancelNoticeIndex).toBeGreaterThan(-1);
    expect(uploadStartIndex).toBeGreaterThan(cancelNoticeIndex);

    // The native-only import is gone from CoverPicker; it lives only in the split module.
    expect(picker).not.toMatch(/from\s+["']react-native-video-trim["']/);
    expect(editor).not.toContain("[ORCH-0978-POC]");
  });

  test("T-SUBE-TRIM-01 native editor does not value-import react-native-video-trim at module top level", () => {
    const editor = repoFile("src/components/ui/coverPickerVideoTrimEditor.ts");

    expect(editor).not.toMatch(
      /(?:^|\n)\s*import\s+(?!type\b)[\s\S]*?from\s+["']react-native-video-trim["']/,
    );
    expect(editor).not.toMatch(
      /(?:^|\n)\s*import\s+(?!type\b)["']react-native-video-trim["']/,
    );
    expect(editor).toMatch(/require\(\s*["']react-native-video-trim["']\s*\)/);
  });

  test("T-SUBE-TRIM-02 missing native VideoTrim module rejects on trim invocation, not import", async () => {
    const nativeModuleError =
      "TurboModuleRegistry.getEnforcing('VideoTrim') could not be found";

    jest.doMock("react-native-video-trim", () => {
      throw new Error(nativeModuleError);
    });

    const editorModule = await import("../coverPickerVideoTrimEditor");
    await expect(
      editorModule.trimVideoWithDedicatedEditor("file:///clip.mov", 29_000),
    ).rejects.toThrow("updated Mingla Host native build");
    await expect(
      editorModule.trimVideoWithDedicatedEditor("file:///clip.mov", 29_000),
    ).rejects.toThrow(nativeModuleError);
  });
});
