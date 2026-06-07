import { afterEach, describe, expect, jest, test } from "@jest/globals";

import {
  BrowserFilePickerError,
  browserFileMatchesAccept,
  browserFileToPickedFile,
  readBrowserFileAsBase64,
  revokeBrowserPickedFiles,
  validateBrowserFile,
} from "../browserFilePicker";

type TestFile = File & { size: number; type: string; name: string };

const file = (name: string, type: string, size: number): TestFile =>
  ({ name, size, type } as TestFile);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("browserFilePicker", () => {
  test("matches exact MIME, wildcard MIME, and extension accept tokens", () => {
    expect(browserFileMatchesAccept(file("cover.gif", "image/gif", 12), "image/gif")).toBe(true);
    expect(browserFileMatchesAccept(file("cover.webp", "image/webp", 12), "image/*")).toBe(true);
    expect(browserFileMatchesAccept(file("menu.PDF", "", 12), ".pdf")).toBe(true);
    expect(browserFileMatchesAccept(file("menu.pdf", "application/pdf", 12), "image/*")).toBe(false);
  });

  test("rejects unsupported, oversized, and empty files deterministically", () => {
    expect(() => validateBrowserFile(file("x.txt", "text/plain", 10), { accept: "image/*" }))
      .toThrow(BrowserFilePickerError);
    expect(() => validateBrowserFile(file("x.jpg", "image/jpeg", 11), { maxBytes: 10 }))
      .toThrow(BrowserFilePickerError);
    expect(() => validateBrowserFile(file("x.jpg", "image/jpeg", 0))).toThrow(
      BrowserFilePickerError,
    );
  });

  test("creates and revokes object URLs for local previews/uploads", () => {
    const create = jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:orch-1097");
    const revoke = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const picked = browserFileToPickedFile(file("cover.png", "image/png", 20), {
      accept: "image/png",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(picked).toMatchObject({
      name: "cover.png",
      mimeType: "image/png",
      size: 20,
      uri: "blob:orch-1097",
      objectUrl: "blob:orch-1097",
    });

    revokeBrowserPickedFiles([picked]);
    expect(revoke).toHaveBeenCalledWith("blob:orch-1097");
  });

  test("reads browser File bytes as native-compatible base64 payload", async () => {
    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      error: Error | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      readAsDataURL(): void {
        this.result = "data:image/png;base64,SEVMTE8=";
        this.onload?.();
      }
    }
    const previous = global.FileReader;
    global.FileReader = MockFileReader as unknown as typeof FileReader;

    try {
      await expect(readBrowserFileAsBase64(file("cover.png", "image/png", 20))).resolves.toBe(
        "SEVMTE8=",
      );
    } finally {
      global.FileReader = previous;
    }
  });
});
