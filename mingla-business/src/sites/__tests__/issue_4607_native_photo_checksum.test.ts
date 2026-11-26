import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { siteMediaChecksum } from "../siteMediaChecksum.native";
import { putSiteMediaFile, readSiteMediaBytes } from "../siteMediaFile.native";

const mockFileArrayBuffer = jest.fn();
const mockExpoFetch = jest.fn();
const mockFile = jest.fn().mockImplementation((uri: string) => ({
  uri,
  arrayBuffer: mockFileArrayBuffer,
}));

jest.mock("expo-file-system", () => ({ File: mockFile }));
jest.mock("expo/fetch", () => ({ fetch: mockExpoFetch }));

describe("#4607 native Website photo upload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("matches the SHA-256 standard vector without Web Crypto", async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);

    await expect(siteMediaChecksum(bytes)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches Node across the native one-MiB yield boundary", async () => {
    const bytes = new Uint8Array(1024 * 1024 + 17);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    const expected = createHash("sha256").update(bytes).digest("hex");

    await expect(siteMediaChecksum(bytes)).resolves.toBe(expected);
  });

  it("reads picked-file bytes through Expo instead of React Native Blob", async () => {
    const buffer = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]).buffer;
    mockFileArrayBuffer.mockResolvedValue(buffer);

    await expect(readSiteMediaBytes("file:///photo.jpg")).resolves.toEqual(
      Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
    );
    expect(mockFile).toHaveBeenCalledWith("file:///photo.jpg");
  });

  it("streams the native file with Expo fetch", async () => {
    mockExpoFetch.mockResolvedValue({ ok: true });

    await expect(putSiteMediaFile({
      uri: "file:///photo.jpg",
      url: "https://upload.invalid/photo",
      headers: { "content-type": "image/jpeg" },
    })).resolves.toBe(true);
    expect(mockExpoFetch).toHaveBeenCalledWith(
      "https://upload.invalid/photo",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: expect.objectContaining({ uri: "file:///photo.jpg" }),
      }),
    );
  });

  it("keeps the Website upload path behind native-safe file and checksum seams", () => {
    // #4607 invariant: native Website media never depends on Blob.arrayBuffer or Web Crypto.
    const source = readFileSync(resolve(__dirname, "../contentApi.ts"), "utf8");

    expect(source).toContain("await readSiteMediaBytes(input.file.uri)");
    expect(source).toContain("await siteMediaChecksum(bytes)");
    expect(source).toContain("await putSiteMediaFile({");
    expect(source).not.toContain("blob.arrayBuffer");
    expect(source).not.toContain("crypto.subtle.digest");
  });
});
