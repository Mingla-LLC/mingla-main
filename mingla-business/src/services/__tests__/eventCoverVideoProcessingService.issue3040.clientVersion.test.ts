/**
 * #3040 T-A1 (service half) [A-1, A-19, B-C1] — the lane's 426 becomes the
 * named client_version_required error with "update" copy, whatever body the
 * edge sends; native requests carry the version headers the edge logs; web
 * sends none (the lane's CORS allow-list would reject them in a browser).
 *
 * Invariant I-VIDEO-OLD-CLIENT-TOLD (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_old_client_426.test.ts): a client too old for the lane always receives human "update" copy, and the rejection is logged
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockPlatform = { OS: "android" };
const invokeMock = jest.fn<(name: string, options: { headers?: Record<string, string> }) => Promise<unknown>>();
jest.mock("react-native", () => ({ Platform: mockPlatform }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.1.6" } } }));
jest.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: "jwt" } }, error: null })) },
    functions: { invoke: (name: string, options: { headers?: Record<string, string> }) => invokeMock(name, options) },
  },
}));

import { createEventCoverVideoUploadIntent, EventCoverVideoProcessingError } from "../eventCoverVideoProcessingService";
import { laneVersionHeaders, UPDATE_REQUIRED_COPY } from "../eventCoverVideoEdgeContract";

const input = {
  target: "event" as const, eventId: "e", brandId: "b", applyMode: "draft_auto" as const,
  clientOperationId: "op", sourceExtension: "mp4", sourceSha256: "a".repeat(64),
  sourceBytes: 1, sourceDurationMs: 1000,
};

const httpError = (status: number, body: unknown) => ({
  message: "Edge Function returned a non-2xx status code",
  context: { status, json: async () => body },
});

describe("#3040 T-A1 — 426 client_version_required", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    mockPlatform.OS = "android";
  });

  test("a 426 with the edge body maps to the named error and update copy", async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(426, { error: "client_version_required", code: "client_operation_id_required", detail: "Update Mingla Host to upload videos." }) });
    const failure = await createEventCoverVideoUploadIntent(input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EventCoverVideoProcessingError);
    expect((failure as EventCoverVideoProcessingError).code).toBe("client_version_required");
    expect((failure as Error).message).toBe(UPDATE_REQUIRED_COPY.body);
  });

  test("a bare 426 (no readable body) is still the update error", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "x", context: { status: 426, json: async () => { throw new Error("no body"); } } } });
    const failure = await createEventCoverVideoUploadIntent(input).catch((error: unknown) => error);
    expect((failure as EventCoverVideoProcessingError).code).toBe("client_version_required");
  });

  test("native requests carry the version headers; web carries none", async () => {
    invokeMock.mockResolvedValue({ data: { jobId: "j", upload: { url: "u", fields: {}, protocol: "tus" } }, error: null });
    await createEventCoverVideoUploadIntent(input);
    expect(invokeMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer jwt", "x-mingla-app-version": "1.1.6", "x-mingla-platform": "android",
    });
    expect(laneVersionHeaders("web", "1.1.6")).toEqual({});
  });
});
