/**
 * #3040 T-A3 [A-3, A-6] — opening the sheet never re-emits an older job.
 *
 * Invariant I-VIDEO-NO-RESURRECT (declared in supabase/functions/event-cover-video-status/__tests__/issue_3040_active_only.test.ts): opening a sheet never re-emits a finished, failed or cancelled job not started by this device
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

const V = "https://cdn.example/old-video/play_720p.mp4";
const render = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {});
};

describe("#3040 T-A3 — no resurrection on reopen", () => {
  beforeEach(() => h.resetAll());

  test("the mount lookup asks only for an ACTIVE job, and an applied latest job never comes back", async () => {
    // A server honouring activeOnly answers null; an old one would hand back V.
    h.service.fetchEventCoverVideoStatusByTarget.mockImplementation((async (input: { activeOnly?: boolean }) =>
      input.activeOnly === true ? null : h.status({ jobId: "job-old", status: "applied", isTerminal: true, processedUrl: V })) as never);
    render();
    await h.flushEffects();
    expect(h.service.fetchEventCoverVideoStatusByTarget).toHaveBeenCalledWith(expect.objectContaining({ activeOnly: true }));
    const after = render();
    expect(after.stage.phase).toBe("idle");
    expect(after.processedUrl).toBeNull();
    expect(after.ownsJob("job-old")).toBe(false);
    expect(h.service.applyEventCoverVideoJob).not.toHaveBeenCalled();
  });

  test("an old server that ignores activeOnly is filtered on the client", async () => {
    h.service.fetchEventCoverVideoStatusByTarget.mockImplementation((async () =>
      h.status({ jobId: "job-old", status: "failed", isTerminal: true, failureCode: "provider_failed" })) as never);
    render();
    await h.flushEffects();
    const after = render();
    expect(after.stage.phase).toBe("idle");
    expect(after.processedUrl).toBeNull();
  });

  test("this device's OWN persisted job is still settled and owned", async () => {
    const key = `event:${h.EVENT_ID}`;
    h.persistedJobs.set(key, h.persistedJob(key, { jobId: "job-mine", sourceAcknowledged: true }));
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () =>
      h.status({ jobId: "job-mine", status: "applied", isTerminal: true, processedUrl: "https://cdn.example/mine/play_1080p.mp4" })) as never);
    render();
    await h.flushEffects();
    const after = render();
    expect(after.stage.phase).toBe("applied");
    expect(after.ownsJob("job-mine")).toBe(true);
  });
});
