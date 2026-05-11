import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { CreatorAvatarError } from "../../utils/creatorAvatarRules";
import { readCreatorAvatarFileBytes } from "../creatorAvatarFileReader";

const mockFileArrayBuffer = jest.fn<() => Promise<ArrayBuffer>>();

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => ({
    arrayBuffer: mockFileArrayBuffer,
  })),
}));

describe("creatorAvatarFileReader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileArrayBuffer.mockResolvedValue(new ArrayBuffer(1024));
  });

  test("T-15 returns the byteLength of the underlying file", async () => {
    const result = await readCreatorAvatarFileBytes("file:///avatar.jpg");

    expect(result.byteLength).toBe(1024);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
  });

  test("T-16 throws a typed error when expo-file-system cannot read the file", async () => {
    mockFileArrayBuffer.mockRejectedValueOnce(new Error("no file"));

    await expect(
      readCreatorAvatarFileBytes("file:///missing.jpg"),
    ).rejects.toMatchObject({
      code: "upload_failed",
      message: "We couldn't read that photo. Try another.",
      name: "CreatorAvatarError",
    } satisfies Partial<CreatorAvatarError>);
  });

  test("T-17 does not call fetch while reading picker bytes", async () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn() as unknown as typeof fetch;
    global.fetch = fetchSpy;

    try {
      await readCreatorAvatarFileBytes("file:///avatar.jpg");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
