import { afterEach, describe, expect, jest, test } from "@jest/globals";

import {
  BrowserFilePickerError,
  browserFileMatchesAccept,
  browserFileToPickedFile,
  pickBrowserFiles,
  readBrowserFileAsBase64,
  revokeBrowserPickedFiles,
  validateBrowserFile,
} from "../browserFilePicker";

type TestFile = File & { size: number; type: string; name: string };

const file = (name: string, type: string, size: number): TestFile =>
  ({ name, size, type } as TestFile);

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as { document?: unknown }).document;
});

describe("browserFilePicker", () => {
  const withFakeDocument = (
    files: TestFile[],
    options: { triggerChange?: boolean } = {},
  ): { input: { accept: string; multiple: boolean; attributes: Record<string, string> } } => {
    const input = {
      accept: "",
      attributes: {} as Record<string, string>,
      files,
      multiple: false,
      onchange: null as null | (() => void),
      remove: jest.fn(),
      setAttribute: jest.fn((name: string, value: string) => {
        input.attributes[name] = value;
      }),
      style: {} as Record<string, string>,
      type: "",
      click: jest.fn(() => {
        if (options.triggerChange !== false) {
          input.onchange?.();
        }
      }),
    };
    (global as { document?: unknown }).document = {
      body: {
        appendChild: jest.fn(),
      },
      createElement: jest.fn(() => input),
    };
    return { input };
  };

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

  test("pickBrowserFiles resolves canceled when the chooser returns no files", async () => {
    withFakeDocument([]);

    await expect(pickBrowserFiles({ accept: "image/*" })).resolves.toEqual({
      canceled: true,
      files: [],
    });
  });

  test("pickBrowserFiles returns one selected image with object URL metadata", async () => {
    jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:single");
    const { input } = withFakeDocument([file("cover.png", "image/png", 20)]);

    await expect(
      pickBrowserFiles({ accept: "image/*", maxFiles: 1 }),
    ).resolves.toMatchObject({
      canceled: false,
      files: [
        {
          name: "cover.png",
          mimeType: "image/png",
          objectUrl: "blob:single",
          size: 20,
          uri: "blob:single",
        },
      ],
    });
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(false);
  });

  test("pickBrowserFiles preserves multi-select order and enforces maxFiles", async () => {
    jest.spyOn(URL, "createObjectURL").mockImplementation((picked) => {
      const named = picked as File & { name?: string };
      return `blob:${named.name ?? "file"}`;
    });
    const { input } = withFakeDocument([
      file("one.jpg", "image/jpeg", 20),
      file("two.gif", "image/gif", 30),
      file("three.webp", "image/webp", 40),
    ]);

    const result = await pickBrowserFiles({
      accept: "image/*",
      maxFiles: 2,
      multiple: true,
    });

    expect(input.multiple).toBe(true);
    expect(result.canceled).toBe(false);
    expect(result.files.map((picked) => picked.name)).toEqual(["one.jpg", "two.gif"]);
  });

  test("pickBrowserFiles accepts PDF files by MIME or extension", async () => {
    jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
    withFakeDocument([file("menu.PDF", "", 20)]);

    const result = await pickBrowserFiles({
      accept: "application/pdf,.pdf",
      maxFiles: 1,
    });

    expect(result.canceled).toBe(false);
    expect(result.files[0]).toMatchObject({
      name: "menu.PDF",
      mimeType: null,
      uri: "blob:pdf",
    });
  });

  test("pickBrowserFiles can defer validation so callers skip invalid files per-file", async () => {
    jest.spyOn(URL, "createObjectURL").mockImplementation((picked) => {
      const named = picked as File & { name?: string };
      return `blob:${named.name ?? "file"}`;
    });
    withFakeDocument([
      file("valid.jpg", "image/jpeg", 20),
      file("empty.txt", "text/plain", 0),
    ]);

    const result = await pickBrowserFiles({
      accept: "image/*",
      maxFiles: 2,
      multiple: true,
      validate: false,
    });

    expect(result.canceled).toBe(false);
    expect(result.files.map((picked) => picked.name)).toEqual(["valid.jpg", "empty.txt"]);
  });
});
