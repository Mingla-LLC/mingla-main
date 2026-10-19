/**
 * #3040 T-ADMIN5S (hook backstop) — an ad_creative clip under 5 s never
 * reaches prepare or the intent, even if a caller skips the pick check.
 * Covers have no minimum.
 *
 * MINGLA-INVARIANT: I-AD-VIDEO-MIN-5S | issue #3040 | an ad_creative source shorter than 5 s never leaves the device (pick check), and the edge and DB refuse it; covers have no minimum
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

const short = { uri: "file:///short.mp4", fileName: "short.mp4", mimeType: "video/mp4", bytes: 1000, durationMs: 4200 };

describe("#3040 — ad video minimum in the hook", () => {
  beforeEach(() => h.resetAll());

  test("ad_creative 4.2 s: error ad_video_too_short, no prepare, no intent", async () => {
    h.resetRenderCursor();
    const hook = useEventCoverVideoUpload("", h.BRAND_ID, "published_manual", "ad_creative", { draftOwnerKey: "host-ad:draft-1" });
    await hook.start(short);
    h.resetRenderCursor();
    const stage = useEventCoverVideoUpload("", h.BRAND_ID, "published_manual", "ad_creative", { draftOwnerKey: "host-ad:draft-1" }).stage;
    expect(stage).toMatchObject({ phase: "error", code: "ad_video_too_short" });
    expect(h.prepared.prepareEventCoverVideoSource).not.toHaveBeenCalled();
    expect(h.service.createEventCoverVideoUploadIntent).not.toHaveBeenCalled();
  });

  test("an ad intent targets ad_creative with the owner key and published_manual", async () => {
    h.resetRenderCursor();
    const hook = useEventCoverVideoUpload("", h.BRAND_ID, "draft_auto", "ad_creative", { draftOwnerKey: "host-ad:draft-1" });
    await hook.start({ ...short, durationMs: 8000 });
    expect(h.service.createEventCoverVideoUploadIntent).toHaveBeenCalledWith(expect.objectContaining({
      target: "ad_creative", draftOwnerKey: "host-ad:draft-1", applyMode: "published_manual", brandId: h.BRAND_ID,
    }));
  });

  test("a 3 s cover is not refused", async () => {
    h.resetRenderCursor();
    await useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {}).start({ ...short, durationMs: 3000 });
    expect(h.service.createEventCoverVideoUploadIntent).toHaveBeenCalled();
  });
});
