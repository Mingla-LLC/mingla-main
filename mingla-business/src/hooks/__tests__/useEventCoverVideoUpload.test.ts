import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockStateSlots: unknown[] = [];
const mockRefSlots: Array<{ current: unknown }> = [];
let mockStateCursor = 0;
let mockRefCursor = 0;

const mockResetRenderCursor = (): void => {
  mockStateCursor = 0;
  mockRefCursor = 0;
};

const mockResetReactHarness = (): void => {
  mockStateSlots.length = 0;
  mockRefSlots.length = 0;
  mockResetRenderCursor();
};

jest.mock("react", () => ({
  useCallback: jest.fn((callback: unknown) => callback),
  useRef: jest.fn((initialValue: unknown) => {
    const index = mockRefCursor;
    mockRefCursor += 1;
    if (mockRefSlots[index] === undefined) {
      mockRefSlots[index] = { current: initialValue };
    }
    return mockRefSlots[index];
  }),
  useState: jest.fn((initialValue: unknown) => {
    const index = mockStateCursor;
    mockStateCursor += 1;
    if (mockStateSlots[index] === undefined) {
      mockStateSlots[index] = initialValue;
    }
    const setState = (nextValue: unknown): void => {
      mockStateSlots[index] =
        typeof nextValue === "function"
          ? (nextValue as (previous: unknown) => unknown)(mockStateSlots[index])
          : nextValue;
    };
    return [mockStateSlots[index], setState];
  }),
}));

const invalidateQueries = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const compressVideoLocally = jest.fn();
const createEventCoverVideoUploadIntent = jest.fn();
const uploadEventCoverVideoSource = jest.fn();
const acknowledgeEventCoverVideoSourceUploaded = jest.fn();
const waitForEventCoverVideoReady = jest.fn();
const cancelEventCoverVideoJob = jest.fn();
const logEventCoverVideoUploadTelemetry = jest.fn();

jest.mock("../../services/eventCoverVideoProcessingService", () => ({
  acknowledgeEventCoverVideoSourceUploaded,
  cancelEventCoverVideoJob,
  compressVideoLocally,
  createEventCoverVideoUploadIntent,
  logEventCoverVideoUploadTelemetry,
  uploadEventCoverVideoSource,
  waitForEventCoverVideoReady,
}));

jest.mock("../useBusinessEvents", () => ({
  businessEventKeys: {
    detail: (eventId: string) => ["business-event", eventId],
    list: (brandId: string) => ["business-events", brandId],
  },
}));

jest.mock("../useServerDraftEvents", () => ({
  eventDraftKeys: {
    detail: (eventId: string) => ["draft-event", eventId],
    list: (brandId: string) => ["draft-events", brandId],
  },
}));

jest.mock("../usePublicEvents", () => ({
  publicEventKeys: {
    detailById: (eventId: string) => ["public-event", eventId],
  },
}));

jest.mock("../upcomingKeys", () => ({
  upcomingKeys: { all: ["upcoming"] },
}));

import { useEventCoverVideoUpload } from "../useEventCoverVideoUpload";

const renderHook = () => {
  mockResetRenderCursor();
  return useEventCoverVideoUpload(
    "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
    "22a18413-bfbf-4087-9ba7-45f70deba0f3",
    "published_manual",
  );
};

type LooseMock = {
  mockRejectedValue: (value: unknown) => void;
  mockResolvedValue: (value: unknown) => void;
};

const mockCompressVideoLocally = compressVideoLocally as unknown as LooseMock;
const mockCreateEventCoverVideoUploadIntent =
  createEventCoverVideoUploadIntent as unknown as LooseMock;

describe("useEventCoverVideoUpload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetReactHarness();
    mockCompressVideoLocally.mockResolvedValue({
      bytes: 289420,
      durationMs: 12000,
      uri: "file:///compressed.mp4",
      wasCompressed: false,
    });
  });

  test("clears local preview and never reaches cover change on upload-intent 401", async () => {
    const onCoverChange = jest.fn();
    const authError = Object.assign(
      new Error("Finishing sign-in. Try again in a moment."),
      { code: "unauthenticated" },
    );
    mockCreateEventCoverVideoUploadIntent.mockRejectedValue(authError);

    const firstRender = renderHook();
    await firstRender.start({
      bytes: 289420,
      durationMs: 12000,
      fileName: "cover.mp4",
      mimeType: "video/mp4",
      uri: "file:///cover.mp4",
    });

    const finalRender = renderHook();
    expect(finalRender.localPreviewUri).toBeNull();
    expect(finalRender.processedUrl).toBeNull();
    expect(finalRender.stage).toMatchObject({
      code: "video_upload_failed",
      phase: "error",
    });
    expect(uploadEventCoverVideoSource).not.toHaveBeenCalled();
    expect(waitForEventCoverVideoReady).not.toHaveBeenCalled();
    expect(onCoverChange).not.toHaveBeenCalled();
    expect(logEventCoverVideoUploadTelemetry).toHaveBeenCalledWith(
      "video_cover_upload_preview_rolled_back",
      expect.objectContaining({
        applyMode: "published_manual",
        errorCode: "unauthenticated",
        eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
        phase: "upload_intent",
      }),
    );
  });
});
