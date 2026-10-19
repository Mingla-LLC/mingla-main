/**
 * #3040 T-A11 [A-11] — a prepared native copy the OS purged ends on "Choose
 * the video again" (H-12): the server job is cancelled and the record is
 * cleared, instead of a Resume that can never read the file.
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

describe("#3040 T-A11 — purged native source", () => {
  beforeEach(() => h.resetAll());

  test("resume finds the source gone: terminal source_file_gone, job cancelled, record cleared", async () => {
    h.persistedJobs.set(KEY, h.persistedJob(KEY, { sourceAcknowledged: false, sourceUri: "file:///cache/event-cover-gone.mp4" }));
    h.presence.preparedSourceStillExists.mockImplementation(async () => false);
    render();
    await h.flushEffects();
    const stage = render().stage;
    expect(stage).toMatchObject({ phase: "error", code: "source_file_gone" });
    expect(stage.phase).not.toBe("detached");
    expect(h.service.cancelEventCoverVideoJob).toHaveBeenCalledWith("job-1");
    expect(h.persistedJobs.has(KEY)).toBe(false);
    expect(h.service.createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
  });

  test("a present source resumes the same operation as before", async () => {
    h.persistedJobs.set(KEY, h.persistedJob(KEY, { sourceAcknowledged: false }));
    render();
    await h.flushEffects();
    expect(h.service.createEventCoverVideoUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: "11111111-1111-4111-8111-111111111111" }),
    );
  });
});
