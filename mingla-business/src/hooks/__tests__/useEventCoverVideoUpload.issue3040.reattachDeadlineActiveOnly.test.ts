/**
 * #3040 rework 1 (D-11) — the re-attach DEADLINE fallback in resume() applies
 * the same rule as the main path: a job found by target (this device holds no
 * job id) is resumed only while it is still active. A server that ignores
 * `activeOnly` must not bring a finished video back when the sheet reopens
 * and the normal resume is slow.
 *
 * MINGLA-INVARIANT: I-VIDEO-NO-RESURRECT | issue #3040 | a reopened sheet never re-emits a finished job this device did not start, even from a server that ignores activeOnly and even on the re-attach deadline path
 *
 * FAILS ON REVERT: drop `(byTarget && !isActiveLaneStatus(canonical.status))`
 * from the deadline fallback and the finished video is settled as applied.
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

const V = "https://cdn.example/guid-old/play_1080p.mp4";
const renderEvent = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {});
};

describe("#3040 D-11 the re-attach deadline never resurrects a finished job", () => {
  beforeEach(() => h.resetAll());

  test("a slow resume whose deadline finds an APPLIED job by target goes idle", async () => {
    jest.useFakeTimers();
    try {
      // The normal resume never finishes reading the device record.
      h.persistence.readPersistedCoverVideoJob.mockImplementation((() => new Promise(() => undefined)) as never);
      h.service.fetchEventCoverVideoStatusByTarget.mockImplementation((async () =>
        h.status({ jobId: "job-old", status: "applied", isTerminal: true, processedUrl: V })) as never);
      renderEvent();
      await h.flushEffects();
      await h.settle();
      expect(renderEvent().stage.phase).toBe("reattaching");
      jest.advanceTimersByTime(12_000);
      await h.settle(200);
      const after = renderEvent();
      expect(h.service.fetchEventCoverVideoStatusByTarget).toHaveBeenCalled();
      expect(after.stage.phase).toBe("idle");
      expect(after.processedUrl).toBeNull();
      expect(h.service.applyEventCoverVideoJob).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test("an ACTIVE job found by target on the deadline is still resumed", async () => {
    jest.useFakeTimers();
    try {
      h.persistence.readPersistedCoverVideoJob.mockImplementation((() => new Promise(() => undefined)) as never);
      h.service.fetchEventCoverVideoStatusByTarget.mockImplementation((async () =>
        h.status({ jobId: "job-live", status: "processing" })) as never);
      h.service.waitForEventCoverVideoReady.mockImplementation((() => new Promise(() => undefined)) as never);
      renderEvent();
      await h.flushEffects();
      await h.settle();
      jest.advanceTimersByTime(12_000);
      await h.settle(200);
      expect(renderEvent().stage.phase).not.toBe("idle");
    } finally {
      jest.useRealTimers();
    }
  });
});
