/**
 * #3040 T-A1 [A-1, A-19] — an app too old for the lane gets "Update Mingla
 * Host", never a generic retry, and the stage carries the REAL code.
 *
 * Invariant I-VIDEO-OLD-CLIENT-TOLD (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_old_client_426.test.ts): a client too old for the lane always receives human "update" copy, and the rejection is logged
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
import { errorCardModel } from "../../components/ui/coverUploadCardModel";

const render = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {});
};
const file = { uri: "file:///clip.mp4", fileName: "clip.mp4", mimeType: "video/mp4", bytes: 289420, durationMs: 12000 };

describe("#3040 T-A1 — old client is told to update", () => {
  beforeEach(() => h.resetAll());

  test("a 426 client_version_required ends on a non-retryable update stage", async () => {
    h.service.createEventCoverVideoUploadIntent.mockImplementation((async () => {
      throw new h.HarnessProcessingError("client_version_required", "This version can’t upload videos anymore. Updating takes a minute.");
    }) as never);
    await render().start(file);
    const stage = render().stage;
    expect(stage).toMatchObject({ phase: "error", code: "client_version_required", canRetry: false });
    expect(h.service.uploadEventCoverVideoSource).not.toHaveBeenCalled();
  });

  test("the card for that stage offers Update app on native, and no Try again", () => {
    const native = errorCardModel("client_version_required", "", {
      isNative: true, hasCover: true, videoOnly: false, finishesWithoutYou: false, phaseElapsedMs: 0,
    });
    expect(native.stateId).toBe("H-14e");
    expect(native.title).toBe("Update Mingla Host to upload videos");
    expect(native.actions.map((action) => action.id)).toEqual(["update_app"]);
    const web = errorCardModel("client_version_required", "", {
      isNative: false, hasCover: true, videoOnly: false, finishesWithoutYou: false, phaseElapsedMs: 0,
    });
    expect(web.actions).toEqual([]);
  });

  test("any other failure keeps its own code on the stage (A-19)", async () => {
    h.service.createEventCoverVideoUploadIntent.mockImplementation((async () => {
      throw new h.HarnessProcessingError("forbidden", "You do not have permission to update this event cover.");
    }) as never);
    await render().start(file);
    expect(render().stage).toMatchObject({ phase: "error", code: "forbidden", canRetry: true });
  });
});
