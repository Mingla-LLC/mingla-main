import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const PICKER = "src/components/ui/CoverPicker.tsx";
const DISPLAY_ERROR =
  "Uploaded, but this cover could not be displayed. Try another image or GIF.";

const sourceSection = (
  source: string,
  startNeedle: string,
  endNeedle: string,
): string => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

/**
 * issue #1958 — the local video preview may emit a native playback error while
 * its upload continues successfully. These source-level guards match the
 * established CoverPicker regression-test convention because mounting this
 * Expo-heavy component in Jest would replace the native media behavior under
 * test with mocks.
 */
describe("CoverPicker transient local-video render errors (issue #1958)", () => {
  const picker = repoFile(PICKER);
  const activeUpload = sourceSection(
    picker,
    "const activeVideoUpload =",
    "const activeMediaUrl =",
  );
  const handler = sourceSection(
    picker,
    "const handleMediaRenderError = useCallback(",
    "const switchTab = useCallback(",
  );

  test("T-1958-01 only compressing, uploading, and processing are active upload phases", () => {
    expect(activeUpload).toContain('videoUpload.stage.phase === "compressing"');
    expect(activeUpload).toContain('videoUpload.stage.phase === "uploading"');
    expect(activeUpload).toContain('videoUpload.stage.phase === "processing"');
    expect(activeUpload).not.toContain('videoUpload.stage.phase === "ready"');
    expect(activeUpload).not.toContain('videoUpload.stage.phase === "error"');
  });

  test("T-1958-02 the current non-null local preview is suppressed only during an active upload", () => {
    expect(handler).toMatch(
      /if\s*\(\s*activeVideoUpload\s*&&\s*videoUpload\.localPreviewUri\s*!==\s*null\s*&&\s*event\.mediaUrl\s*===\s*videoUpload\.localPreviewUri\s*\)\s*\{\s*return;\s*\}/s,
    );

    // A broad file:// or phase-only guard would hide stale/persisted failures.
    expect(handler).not.toMatch(/startsWith\(\s*["']file:/);
  });

  test("T-1958-03 logging survives, while the transient return precedes error UI", () => {
    const logIndex = handler.indexOf(
      'console.info("[CoverPicker] cover media render failed", event);',
    );
    const guardIndex = handler.indexOf("if (\n        activeVideoUpload");
    const returnIndex = handler.indexOf("return;", guardIndex);
    const stateIndex = handler.indexOf("setMediaDisplayError(");
    const toastIndex = handler.indexOf("onShowToast(");

    expect(logIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(logIndex);
    expect(returnIndex).toBeGreaterThan(guardIndex);
    expect(stateIndex).toBeGreaterThan(returnIndex);
    expect(toastIndex).toBeGreaterThan(stateIndex);
  });

  test("T-1958-04 persisted, stale, null-preview, and final errors retain the existing copy", () => {
    expect(handler.split(DISPLAY_ERROR)).toHaveLength(3);
    expect(handler).toContain(
      "[activeVideoUpload, onShowToast, videoUpload.localPreviewUri]",
    );
  });
});
