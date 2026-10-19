/**
 * #3040 T-A9 [A-9, A-18] — errors tell the truth.
 *   - a server failure is "interrupted" (H-11), never "offline", and only
 *     after three automatic retries (1 s, 3 s, 9 s);
 *   - "offline" (H-10) needs the DEVICE to say it is offline;
 *   - a terminal failure after the intent drops the operation, so the next
 *     clip starts a NEW one.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

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
import { videoUploadCardModel } from "../../components/ui/coverUploadCardModel";

let offline = false;
const render = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {}, { isDeviceOffline: () => offline });
};
const file = { uri: "file:///clip.mp4", fileName: "clip.mp4", mimeType: "video/mp4", bytes: 289420, durationMs: 12000 };
const ctx = { isNative: true, hasCover: true, videoOnly: false, finishesWithoutYou: false, phaseElapsedMs: 0 };

describe("#3040 T-A9 — honest errors", () => {
  beforeEach(() => {
    h.resetAll();
    offline = false;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a 500 retries three times, then shows Upload interrupted — never offline copy", async () => {
    h.service.createEventCoverVideoUploadIntent.mockImplementation((async () => {
      throw new h.HarnessProcessingError("edge_error", "Could not prepare video upload.");
    }) as never);
    const run = render().start(file);
    for (let i = 0; i < 6; i += 1) await jest.advanceTimersByTimeAsync(10_000);
    await run;
    expect(h.service.createEventCoverVideoUploadIntent).toHaveBeenCalledTimes(4);
    const stage = render().stage;
    expect(stage).toMatchObject({ phase: "detached", reason: "interrupted" });
    const card = videoUploadCardModel(stage, null, ctx);
    expect(card?.stateId).toBe("H-11");
    expect(`${card?.title} ${card?.body}`).not.toMatch(/offline/i);
  });

  test("offline copy only when the device reports no network", async () => {
    offline = true;
    h.service.createEventCoverVideoUploadIntent.mockImplementation((async () => {
      throw new h.HarnessProcessingError("edge_error", "Could not prepare video upload.");
    }) as never);
    await render().start(file);
    expect(h.service.createEventCoverVideoUploadIntent).toHaveBeenCalledTimes(1);
    const stage = render().stage;
    expect(stage).toMatchObject({ phase: "detached", reason: "offline" });
    expect(videoUploadCardModel(stage, null, ctx)?.body).toMatch(/offline/i);
  });

  test("after a terminal failure past the intent, a different clip is a NEW operation", async () => {
    h.service.acknowledgeEventCoverVideoSourceUploaded.mockImplementation((async () => {
      throw new h.HarnessProcessingError("source_ack_deadline_exceeded", "We couldn't confirm this upload.");
    }) as never);
    await render().start(file);
    expect(render().stage).toMatchObject({ phase: "error", code: "source_ack_deadline_exceeded" });
    const firstOp = (h.service.createEventCoverVideoUploadIntent.mock.calls[0]?.[0] as unknown as { clientOperationId: string }).clientOperationId;

    h.service.acknowledgeEventCoverVideoSourceUploaded.mockImplementation((async () => h.status()) as never);
    await render().start({ ...file, uri: "file:///different.mp4" });
    const calls = h.service.createEventCoverVideoUploadIntent.mock.calls;
    const secondOp = (calls[calls.length - 1]?.[0] as unknown as { clientOperationId: string }).clientOperationId;
    expect(secondOp).not.toBe(firstOp);
    expect(render().stage.phase).not.toBe("error");
  });
});
