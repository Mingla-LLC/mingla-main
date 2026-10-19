/**
 * #3040 T-A2 [A-2] — a job left mid-transfer is never shown as "Finishing
 * upload" (ack_pending): only this mount's own acknowledgement after the last
 * confirmed byte can say that. And a detached card whose bytes are not all
 * confirmed is not auto-rechecked into that false state.
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
import { shouldRecheckCoverVideo } from "../../components/ui/coverPickerVideoRecheck";

const KEY = `event:${h.EVENT_ID}`;
const render = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {});
};

describe("#3040 T-A2 — no false Finishing upload", () => {
  beforeEach(() => h.resetAll());

  test("web remount of an unacknowledged job is detached, and checkNow keeps it detached", async () => {
    h.platform.OS = "web";
    h.persistedJobs.set(KEY, h.persistedJob(KEY, { sourceUri: null, sourceAcknowledged: false }));
    render();
    await h.flushEffects();
    expect(render().stage).toMatchObject({ phase: "detached", sourceAcknowledged: false, reason: "repick" });

    // The server still says source_uploading (bytes partial). This read used
    // to project "ack_pending" — a spinner with nothing uploading.
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () => h.status({ status: "source_uploading" })) as never);
    await render().checkNow();
    const stage = render().stage;
    expect(stage.phase).toBe("detached");
    expect(stage).toMatchObject({ sourceAcknowledged: false });
    expect(stage.phase).not.toBe("ack_pending");
  });

  test("native: a source_uploading job this mount does not transfer is interrupted, not confirming", async () => {
    h.persistedJobs.set(KEY, h.persistedJob(KEY, { sourceAcknowledged: true }));
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () => h.status({ status: "source_uploading" })) as never);
    // The watch stays open until the sheet unmounts.
    h.service.waitForEventCoverVideoReady.mockImplementation(((_jobId: string, options: { signal: AbortSignal }) =>
      new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted"))))) as never);
    render();
    await h.flushEffects();
    expect(render().stage).toMatchObject({ phase: "detached", sourceAcknowledged: false, reason: "interrupted" });
    expect(render().stage.phase).not.toBe("ack_pending");
    h.unmountEffects();
  });

  test("the recheck rule leaves an unacknowledged detached card alone", () => {
    expect(shouldRecheckCoverVideo({ phase: "detached", sourceAcknowledged: false, checkInFlight: false, msSinceLastCheck: null })).toBe(false);
    expect(shouldRecheckCoverVideo({ phase: "detached", sourceAcknowledged: true, checkInFlight: false, msSinceLastCheck: null })).toBe(true);
    expect(shouldRecheckCoverVideo({ phase: "processing", checkInFlight: false, msSinceLastCheck: null })).toBe(true);
  });
});
