/**
 * #3040 T-A5 [A-5] — Replace uses the NEW clip's own duration and trim.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("react", () => require("./issue3040HookHarness").reactMock);
jest.mock("react-native", () => ({ Platform: require("./issue3040HookHarness").platform }));
jest.mock("@tanstack/react-query", () => require("./issue3040HookHarness").keyMocks.queryClient);
jest.mock("../../services/eventCoverVideoProcessingService", () => require("./issue3040HookHarness").service);
jest.mock("../../services/eventCoverVideoJobPersistence", () => require("./issue3040HookHarness").persistence);
jest.mock("../../services/eventCoverVideoPreparedSource", () => require("./issue3040HookHarness").prepared);
jest.mock("../../services/eventCoverVideoSourcePresence", () => require("./issue3040HookHarness").presence);
jest.mock("../../services/supabase", () => require("./issue3040HookHarness").supabaseMock);
jest.mock("../useBusinessEvents", () => require("./issue3040HookHarness").keyMocks.businessEvents);
jest.mock("../useServerDraftEvents", () => require("./issue3040HookHarness").keyMocks.drafts);
jest.mock("../usePublicEvents", () => require("./issue3040HookHarness").keyMocks.publicEvents);
jest.mock("../upcomingKeys", () => require("./issue3040HookHarness").keyMocks.upcoming);
jest.mock("../useBrands", () => require("./issue3040HookHarness").keyMocks.brands);
/* eslint-enable @typescript-eslint/no-require-imports */

import * as h from "./issue3040HookHarness";
import { useEventCoverVideoUpload } from "../useEventCoverVideoUpload";

const KEY = `event:${h.EVENT_ID}`;
const render = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {});
};

describe("#3040 T-A5 — replacement trim", () => {
  beforeEach(() => h.resetAll());

  test("replacing a 60 s in-flight video with an 8 s clip sends trimEndMs 8000", async () => {
    h.persistedJobs.set(KEY, h.persistedJob(KEY, { sourceDurationMs: 60000, trimEndMs: 60000, sourceAcknowledged: true }));
    await render().replace({ uri: "file:///different-8s.mp4", fileName: "short.mp4", mimeType: "video/mp4", bytes: 1000, durationMs: 8000 });
    const body = h.service.createEventCoverVideoUploadIntent.mock.calls[0]?.[0] as unknown as { trimStartMs: number; trimEndMs: number; sourceDurationMs: number };
    expect(body.sourceDurationMs).toBe(8000);
    expect(body.trimStartMs).toBe(0);
    expect(body.trimEndMs).toBe(8000);
  });

  test("a same-operation resume still keeps its own persisted trim", async () => {
    h.persistedJobs.set(KEY, h.persistedJob(KEY, {
      clientOperationId: "op-same", trimStartMs: 2000, trimEndMs: 10000, sourceAcknowledged: false,
    }));
    render();
    await h.flushEffects();
    const body = h.service.createEventCoverVideoUploadIntent.mock.calls[0]?.[0] as unknown as { clientOperationId: string; trimStartMs: number; trimEndMs: number };
    expect(body.clientOperationId).toBe("op-same");
    expect(body.trimStartMs).toBe(2000);
    expect(body.trimEndMs).toBe(10000);
  });
});
