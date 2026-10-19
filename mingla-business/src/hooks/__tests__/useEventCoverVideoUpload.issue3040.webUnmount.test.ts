/**
 * #3040 T-A10 [A-10] — web keeps no bytes across a remount. Closing the sheet
 * before any byte left cancels the job and drops the record; after bytes,
 * the record stays and the reopened sheet asks for the video again (H-12),
 * never claiming it uploaded.
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
const file = { uri: "blob:https://host/abc", fileName: "clip.mp4", mimeType: "video/mp4", bytes: 289420, durationMs: 12000 };

describe("#3040 T-A10 — web unmount", () => {
  beforeEach(() => {
    h.resetAll();
    h.platform.OS = "web";
  });

  test("unmount while no byte has been confirmed: cancel the job, clear the record", async () => {
    render();
    await h.flushEffects();
    // The transfer starts but no chunk is confirmed yet.
    h.service.uploadEventCoverVideoSource.mockImplementation((() => new Promise(() => undefined)) as never);
    void render().start(file);
    await h.settle(80);
    expect(h.persistedJobs.has(KEY)).toBe(true);
    h.unmountEffects();
    await h.settle(10);
    expect(h.service.cancelEventCoverVideoJob).toHaveBeenCalledWith("job-1");
    expect(h.persistence.removePersistedCoverVideoJob).toHaveBeenCalledWith("user-3040", KEY);
  });

  test("unmount during intent_pending clears the record (no 0-byte job left behind)", async () => {
    render();
    await h.flushEffects();
    h.service.createEventCoverVideoUploadIntent.mockImplementation((() => new Promise(() => undefined)) as never);
    void render().start(file);
    await h.settle(80);
    h.unmountEffects();
    await h.settle(10);
    expect(h.persistence.removePersistedCoverVideoJob).toHaveBeenCalledWith("user-3040", KEY);
  });

  test("after bytes, the record stays and the remount shows the honest re-pick state", async () => {
    render();
    await h.flushEffects();
    h.service.uploadEventCoverVideoSource.mockImplementation(((input: { onProgress?: (p: unknown) => void }) => {
      input.onProgress?.({ phase: "source_upload", bytesSent: 8_388_608, bytesTotal: 20_000_000, percent: 41 });
      return new Promise(() => undefined);
    }) as never);
    void render().start(file);
    await h.settle(80);
    h.unmountEffects();
    await h.settle(10);
    expect(h.service.cancelEventCoverVideoJob).not.toHaveBeenCalled();
    expect(h.persistedJobs.has(KEY)).toBe(true);

    h.resetReactHarness();
    render();
    await h.flushEffects();
    const stage = render().stage;
    expect(stage).toMatchObject({ phase: "detached", sourceAcknowledged: false, reason: "repick" });
    expect(stage.phase).not.toBe("ack_pending");
  });
});
