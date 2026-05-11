import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { CreatorAvatarError } from "../../utils/creatorAvatarRules";
import { uploadCreatorAvatar } from "../creatorAvatarService";
import { readCreatorAvatarFileBytes } from "../creatorAvatarFileReader";
import { supabase } from "../supabase";

jest.mock("../creatorAvatarFileReader", () => ({
  readCreatorAvatarFileBytes: jest.fn(),
}));

jest.mock("../supabase", () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
  },
}));

const fetchResponse = ({
  contentLength = "100",
  ok = true,
  status = 200,
}: {
  contentLength?: string | null;
  ok?: boolean;
  status?: number;
}): Response =>
  ({
    arrayBuffer: async () => ({ byteLength: Number(contentLength ?? 1) }),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length" ? contentLength : null,
    },
    ok,
    status,
  }) as unknown as Response;

describe("creatorAvatarService", () => {
  const userId = "b17e3e15-218d-475b-8c80-32d4948d6905";
  const PATH_TOKEN_REGEX = new RegExp(
    `^${userId}\\.[a-z0-9]+\\.(jpe?g|png|webp)$`,
  );
  const STORAGE_BASE =
    "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/creator_avatars";
  const storageUpload = jest.fn() as jest.MockedFunction<
    (
      path: string,
      body: unknown,
      options: unknown,
    ) => Promise<{ error: { message: string } | null }>
  >;
  const storageGetPublicUrl = jest.fn(
    (path: string) => ({ data: { publicUrl: `${STORAGE_BASE}/${path}` } }),
  );
  const storageRemove = jest.fn(async (_paths: string[]) => ({
    data: null,
    error: null,
  }));
  const storageFrom = supabase.storage.from as jest.Mock;
  const mockReadCreatorAvatarFileBytes =
    readCreatorAvatarFileBytes as jest.MockedFunction<
      typeof readCreatorAvatarFileBytes
    >;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadCreatorAvatarFileBytes.mockResolvedValue({
      byteLength: 100,
      bytes: new Uint8Array(100),
    });
    storageUpload.mockResolvedValue({ error: null });
    storageGetPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: `${STORAGE_BASE}/${path}` },
    }));
    storageRemove.mockResolvedValue({ data: null, error: null });
    storageFrom.mockReturnValue({
      getPublicUrl: storageGetPublicUrl,
      remove: storageRemove,
      upload: storageUpload,
    });
    global.fetch = jest.fn(async () =>
      fetchResponse({ contentLength: "100" }),
    ) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test("T-01 uploads valid bytes and returns the canonical public URL", async () => {
    const result = await uploadCreatorAvatar(userId, {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      uri: "file:///photo.jpg",
    });

    expect(result.contentType).toBe("image/jpeg");
    expect(result.storagePath).toMatch(PATH_TOKEN_REGEX);
    expect(result.publicUrl).toBe(`${STORAGE_BASE}/${result.storagePath}`);
    expect(storageUpload).toHaveBeenCalledWith(
      result.storagePath,
      expect.any(Uint8Array),
      { contentType: "image/jpeg", upsert: true },
    );
    expect(storageUpload.mock.calls[0]?.[1]).not.toHaveProperty("size");
  });

  test("T-02 rejects empty local bytes before upload", async () => {
    mockReadCreatorAvatarFileBytes.mockResolvedValueOnce({
      byteLength: 0,
      bytes: new Uint8Array(),
    });

    await expect(
      uploadCreatorAvatar(userId, {
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        uri: "file:///photo.jpg",
      }),
    ).rejects.toMatchObject({
      code: "empty_local_file",
      message: "We couldn't read that photo. Try another.",
    });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test("T-03 rejects oversized files before upload", async () => {
    mockReadCreatorAvatarFileBytes.mockResolvedValueOnce({
      byteLength: 11 * 1024 * 1024,
      bytes: new Uint8Array(1),
    });

    await expect(
      uploadCreatorAvatar(userId, {
        fileName: "photo.png",
        mimeType: "image/png",
        uri: "file:///photo.png",
      }),
    ).rejects.toMatchObject({ code: "file_too_large" });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test("T-04 rejects unsupported MIME types before upload", async () => {
    await expect(
      uploadCreatorAvatar(userId, {
        fileName: "photo.heic",
        mimeType: "image/heic",
        uri: "file:///photo.heic",
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test("T-05 maps jpg extension to image/jpeg, never image/jpg", async () => {
    await uploadCreatorAvatar(userId, {
      fileName: "photo.jpg",
      mimeType: null,
      uri: "file:///photo",
    });

    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(PATH_TOKEN_REGEX),
      expect.any(Uint8Array),
      { contentType: "image/jpeg", upsert: true },
    );
  });

  test("T-06 rejects when public byte verification fails", async () => {
    global.fetch = jest.fn(async () =>
      fetchResponse({ contentLength: "0" }),
    ) as unknown as typeof fetch;

    await expect(
      uploadCreatorAvatar(userId, {
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        uri: "file:///photo.jpg",
      }),
    ).rejects.toBeInstanceOf(CreatorAvatarError);
  });

  test("T-07 surfaces Supabase upload errors as typed upload failures", async () => {
    storageUpload.mockResolvedValueOnce({ error: { message: "denied" } });

    await expect(
      uploadCreatorAvatar(userId, {
        fileName: "photo.webp",
        mimeType: "image/webp",
        uri: "file:///photo.webp",
      }),
    ).rejects.toMatchObject({ code: "upload_failed" });
  });

  test("T-08 returns a canonical URL without a cache-bust suffix", async () => {
    const result = await uploadCreatorAvatar(userId, {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      uri: "file:///photo.jpg",
    });

    expect(result.publicUrl).toMatch(
      /^https:\/\/.+\/storage\/v1\/object\/public\/creator_avatars\/[a-f0-9-]+\.[a-z0-9]+\.(jpe?g|png|webp)$/,
    );
    expect(result.publicUrl).not.toContain("?t=");
    expect(result.publicUrl).not.toContain("?v=");
  });

  test("T-22 rotates the storage path on each upload (no stale-cache reuse)", async () => {
    const first = await uploadCreatorAvatar(userId, {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      uri: "file:///photo.jpg",
    });
    const second = await uploadCreatorAvatar(userId, {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      uri: "file:///photo.jpg",
    });

    expect(first.storagePath).not.toBe(second.storagePath);
    expect(first.publicUrl).not.toBe(second.publicUrl);
  });

  test("T-23 best-effort removes the previously persisted storage path", async () => {
    const previousPath = `${userId}.legacytoken.jpg`;
    const previousPublicUrl = `${STORAGE_BASE}/${previousPath}`;

    const result = await uploadCreatorAvatar(
      userId,
      {
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        uri: "file:///photo.jpg",
      },
      { previousPublicUrl },
    );

    expect(result.storagePath).not.toBe(previousPath);
    expect(storageRemove).toHaveBeenCalledWith([previousPath]);
  });

  test("T-24 skips remove() when no previous URL is supplied", async () => {
    await uploadCreatorAvatar(userId, {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      uri: "file:///photo.jpg",
    });

    expect(storageRemove).not.toHaveBeenCalled();
  });
});
