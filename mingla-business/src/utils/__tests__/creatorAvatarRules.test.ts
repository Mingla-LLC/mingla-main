import { describe, expect, jest, test } from "@jest/globals";

import {
  CreatorAvatarError,
  resolveCreatorAvatarContentType,
  verifyCreatorAvatarPublicUrl,
} from "../creatorAvatarRules";

const fetchResponse = ({
  bodyBytes = 1,
  contentLength = "1",
  contentRange = null,
  ok = true,
  status = 200,
}: {
  bodyBytes?: number;
  contentLength?: string | null;
  contentRange?: string | null;
  ok?: boolean;
  status?: number;
}): Response =>
  ({
    arrayBuffer: async () => ({ byteLength: bodyBytes }),
    headers: {
      get: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === "content-length") return contentLength;
        if (normalized === "content-range") return contentRange;
        return null;
      },
    },
    ok,
    status,
  }) as unknown as Response;

describe("creatorAvatarRules", () => {
  test("T-09 rejects a public URL with content-length 0", async () => {
    const fetchImpl = jest.fn(async () =>
      fetchResponse({ contentLength: "0" }),
    ) as unknown as typeof fetch;

    await expect(
      verifyCreatorAvatarPublicUrl("https://cdn.example/avatar.jpg", fetchImpl),
    ).rejects.toMatchObject({
      code: "upload_failed",
      name: "CreatorAvatarError",
    });
  });

  test("T-10 accepts a public URL with positive content-length", async () => {
    const fetchImpl = jest.fn(async () =>
      fetchResponse({ contentLength: "1234" }),
    ) as unknown as typeof fetch;

    await expect(
      verifyCreatorAvatarPublicUrl("https://cdn.example/avatar.jpg", fetchImpl),
    ).resolves.toBeUndefined();
  });

  test("T-11 falls back to a ranged GET when HEAD is not supported", async () => {
    const fetchMock = jest.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return fetchResponse({ ok: false, status: 405 });
      }
      return fetchResponse({
        contentLength: "1",
        contentRange: "bytes 0-0/1234",
        status: 206,
      });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(
      verifyCreatorAvatarPublicUrl("https://cdn.example/avatar.jpg", fetchImpl),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://cdn.example/avatar.jpg",
      {
        headers: { Range: "bytes=0-0" },
        method: "GET",
      },
    );
  });

  test("T-12 rejects when HEAD and ranged GET show an empty body", async () => {
    const fetchMock = jest.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return fetchResponse({ ok: false, status: 405 });
      }
      return fetchResponse({ bodyBytes: 0, contentLength: "0" });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(
      verifyCreatorAvatarPublicUrl("https://cdn.example/avatar.jpg", fetchImpl),
    ).rejects.toBeInstanceOf(CreatorAvatarError);
  });

  test("T-13 maps image/jpg to image/jpeg", () => {
    expect(resolveCreatorAvatarContentType({ uri: "file:///photo", mimeType: "image/jpg" })).toBe(
      "image/jpeg",
    );
  });

  test("T-14 rejects unsupported MIME types", () => {
    expect(
      resolveCreatorAvatarContentType({
        fileName: "photo.heic",
        mimeType: "image/heic",
        uri: "file:///photo.heic",
      }),
    ).toBeNull();
  });
});
