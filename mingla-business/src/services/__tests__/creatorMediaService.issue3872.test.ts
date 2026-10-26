const launchImageLibraryAsync = jest.fn();
const invoke = jest.fn();
const uploadSourceWeb = jest.fn();
const headTusOffset = jest.fn();
const tusMetadata = jest.fn(() => "encoded-metadata");

jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Videos: "Videos" },
  launchImageLibraryAsync,
}));

jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke } },
}));

jest.mock("@mingla/video-upload", () => ({
  headTusOffset,
  tusMetadata,
  uploadSourceWeb,
}));

jest.mock("../eventCoverVideoTusPatch", () => ({
  patchBunnyTusNative: jest.fn(),
  readEventCoverVideoChunk: jest.fn(),
}));

jest.mock("../../utils/randomId", () => ({
  randomUuid: () => "operation-123",
}));

import { chooseAndUploadCreatorShowcase } from "../creatorMediaService";

describe("#3872 creator showcase upload", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{
        uri: "blob:creator-showcase",
        fileSize: 12_000,
        duration: 30_000,
        width: 1080,
        height: 1920,
        mimeType: "video/mp4",
      }],
    });
    invoke.mockResolvedValue({
      data: {
        jobId: "job-123",
        aspectWarning: false,
        upload: {
          tusEndpoint: "https://video.example/files",
          libraryId: "library-1",
          videoId: "video-1",
          authorizationExpire: 123456,
          authorizationSignature: "signed",
        },
      },
      error: null,
    });
    uploadSourceWeb.mockImplementation(async ({ onProgress }) => {
      onProgress({ confirmedBytes: 12_000, totalBytes: 12_000, final: true });
    });
  });

  it("uses the canonical web TUS uploader and confirms completion", async () => {
    const sourceBlob = new Blob(["video"]);
    const fetchMock = jest.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url === "blob:creator-showcase") {
        return { blob: async () => sourceBlob } as Response;
      }
      expect(url).toBe("https://video.example/files");
      expect(init?.method).toBe("POST");
      return {
        ok: true,
        headers: new Headers({ Location: "/files/upload-1" }),
      } as Response;
    });
    jest.spyOn(global, "fetch").mockImplementation(fetchMock);
    const progress: number[] = [];

    await expect(
      chooseAndUploadCreatorShowcase((fraction) => progress.push(fraction)),
    ).resolves.toEqual({ jobId: "job-123", aspectWarning: false });

    expect(invoke).toHaveBeenCalledWith("creator-media-upload-intent", {
      body: expect.objectContaining({
        ownerKind: "creator",
        purpose: "showcase",
        clientOperationId: "operation-123",
        sourceBytes: 12_000,
        durationSeconds: 30,
      }),
    });
    expect(tusMetadata).toHaveBeenCalledWith({
      filetype: "video/mp4",
      title: "creator-media-job:job-123",
    });
    expect(uploadSourceWeb).toHaveBeenCalledWith(expect.objectContaining({
      file: sourceBlob,
      chunkBytes: 2 * 1024 * 1024,
      transport: {
        url: "https://video.example/files/upload-1",
        headers: {
          AuthorizationSignature: "signed",
          AuthorizationExpire: "123456",
          VideoId: "video-1",
          LibraryId: "library-1",
        },
      },
    }));
    expect(progress.at(-1)).toBe(1);
    expect(headTusOffset).not.toHaveBeenCalled();
  });
});
