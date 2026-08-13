import { readFileSync } from "fs";
import path from "path";
import * as ts from "typescript";

import { describe, expect, test } from "@jest/globals";

type MediaErrorEvent = {
  readonly mediaType: "video";
  readonly mediaUrl: string;
  readonly surface: "video";
};

type HandlerEffects = {
  readonly displayErrors: string[];
  readonly toasts: string[];
};

const PICKER = readFileSync(
  path.join(process.cwd(), "src/components/ui/CoverPicker.tsx"),
  "utf8",
);

const handlerDeclaration = (): string => {
  const start = PICKER.indexOf("const handleMediaRenderError = useCallback(");
  const end = PICKER.indexOf("const switchTab = useCallback(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return PICKER.slice(start, end);
};

/**
 * Execute the actual CoverPicker callback without mounting Expo Video. This is
 * deliberately behavioral: changing the predicate changes the recorded state
 * and toast effects instead of merely changing a source-string assertion.
 */
const runHandler = ({
  activeVideoUpload,
  currentPreviewUri,
  eventMediaUrl,
}: {
  readonly activeVideoUpload: boolean;
  readonly currentPreviewUri: string | null;
  readonly eventMediaUrl: string;
}): HandlerEffects => {
  const source = `${handlerDeclaration()}\nmodule.exports = handleMediaRenderError;`;
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }).outputText;
  const moduleShim: { exports: unknown } = { exports: {} };
  const displayErrors: string[] = [];
  const toasts: string[] = [];
  const useCallback = <T,>(callback: T): T => callback;

  new Function(
    "module",
    "exports",
    "useCallback",
    "activeVideoUpload",
    "videoUpload",
    "setMediaDisplayError",
    "onShowToast",
    "__DEV__",
    compiled,
  )(
    moduleShim,
    moduleShim.exports,
    useCallback,
    activeVideoUpload,
    { localPreviewUri: currentPreviewUri },
    (message: string) => displayErrors.push(message),
    (message: string) => toasts.push(message),
    false,
  );

  const handler = moduleShim.exports as (event: MediaErrorEvent) => void;
  handler({
    mediaType: "video",
    mediaUrl: eventMediaUrl,
    surface: "video",
  });

  return { displayErrors, toasts };
};

describe("CoverPicker transient-render adversarial truth table (issue #1958)", () => {
  const localPreview = "file:///current-preview.mp4";
  const existingCopy =
    "Uploaded, but this cover could not be displayed. Try another image or GIF.";

  test("T-1958-A1 an active upload does not hide a stale preview callback", () => {
    expect(
      runHandler({
        activeVideoUpload: true,
        currentPreviewUri: localPreview,
        eventMediaUrl: "file:///stale-preview.mp4",
      }),
    ).toEqual({
      displayErrors: [existingCopy],
      toasts: [existingCopy],
    });
  });

  test("T-1958-A2 exact URI identity alone cannot hide a post-upload failure", () => {
    expect(
      runHandler({
        activeVideoUpload: false,
        currentPreviewUri: localPreview,
        eventMediaUrl: localPreview,
      }),
    ).toEqual({
      displayErrors: [existingCopy],
      toasts: [existingCopy],
    });
  });

  test("T-1958-A3 a null current preview cannot suppress unrelated local media", () => {
    expect(
      runHandler({
        activeVideoUpload: true,
        currentPreviewUri: null,
        eventMediaUrl: localPreview,
      }),
    ).toEqual({
      displayErrors: [existingCopy],
      toasts: [existingCopy],
    });
  });

  test("T-1958-A4 only the exact current preview during active work is non-terminal", () => {
    expect(
      runHandler({
        activeVideoUpload: true,
        currentPreviewUri: localPreview,
        eventMediaUrl: localPreview,
      }),
    ).toEqual({ displayErrors: [], toasts: [] });
  });
});
