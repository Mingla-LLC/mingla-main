/**
 * #3040 — INDEPENDENT TESTER adversarial suite for useEventCoverVideoUpload.
 * Written by the tester, not the implementor. Different angles from the
 * implementor's T-A3/T-A6/T-A9/T-A14 suites:
 *
 *   J1 [A-3]  the WHOLE reopen story: a video applies, the host switches to a
 *             photo, the sheet closes, and an older server (one that ignores
 *             `activeOnly`) hands back that very applied video on reopen.
 *   J2 [A-6]  "Try again" after a remount: the job this device left behind
 *             failed while it was away; the next clip must be a NEW operation,
 *             not a "choose the same video" dead end.
 *   J3 [A-9]  the device goes offline BETWEEN automatic retries: retrying
 *             stops at once and the card says offline (H-10), not "interrupted".
 *   J4 [A-9]  the device is online and the server keeps failing: never offline
 *             copy, and exactly three automatic retries.
 *   J5 [A-14] Host Ads: the host replaces the ad video while the first one is
 *             still processing; when the FIRST job then finishes it is never
 *             applied, linked or emitted.
 *
 * MINGLA-INVARIANT: I-VIDEO-NO-RESURRECT | issue #3040 | a reopened sheet never re-emits a finished job this device did not start, even from a server that ignores activeOnly
 * MINGLA-INVARIANT: I-AD-VIDEO-REPLACE-WINS | issue #3040 | a replaced ad video finishing late is never applied or linked to the ad
 *
 * FAILS ON REVERT:
 *   J1 drop the client-side isActiveLaneStatus filter in resume()
 *   J2 drop cleanupPersisted for a terminal job in settleCanonical
 *   J3 drop `|| isOfflineFailure(failure)` from the retry loop
 *   J4 detachRecoverable ignoring the device (always "offline"), or retries removed
 *   J5 drop the generation guard after waitForEventCoverVideoReady in watch()
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

const V = "https://cdn.example/guid-v/play_1080p.mp4";
const file = { uri: "file:///clip.mp4", fileName: "clip.mp4", mimeType: "video/mp4", bytes: 289420, durationMs: 12000 };
const otherFile = { ...file, uri: "file:///different.mp4", fileName: "different.mp4" };
const ctx = { isNative: true, hasCover: true, videoOnly: false, finishesWithoutYou: false, phaseElapsedMs: 0 };

let offline = false;
const renderEvent = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {}, { isDeviceOffline: () => offline });
};
const renderAd = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload("", h.BRAND_ID, "published_manual", "ad_creative", { draftOwnerKey: "host-ad:draft-3040" });
};
const intentBodies = (): Array<Record<string, unknown>> =>
  h.service.createEventCoverVideoUploadIntent.mock.calls.map((call) => call[0] as unknown as Record<string, unknown>);

describe("#3040 tester adversarial — useEventCoverVideoUpload", () => {
  beforeEach(() => {
    h.resetAll();
    offline = false;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("J1 a video applies, the host switches to a photo, reopens — an older server's applied video never comes back", async () => {
    h.service.waitForEventCoverVideoReady.mockImplementation((async () =>
      h.status({ jobId: "job-1", status: "applied", isTerminal: true, processedUrl: V })) as never);
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () =>
      h.status({ jobId: "job-1", status: "applied", isTerminal: true, processedUrl: V })) as never);
    await renderEvent().start(file);
    const live = renderEvent();
    expect(live.stage.phase).toBe("applied");
    expect(live.processedUrl).toBe(V);
    // The host picks a photo: new media wins.
    live.resetAppliedPreview();
    expect(renderEvent().processedUrl).toBeNull();
    // The sheet closes. This device's record for the applied job is gone.
    h.unmountEffects();
    expect(h.persistedJobs.size).toBe(0);
    // Reopen against a server that IGNORES activeOnly and returns the applied V.
    h.resetReactHarness();
    h.service.fetchEventCoverVideoStatusByTarget.mockImplementation((async () =>
      h.status({ jobId: "job-1", status: "applied", isTerminal: true, processedUrl: V })) as never);
    h.service.applyEventCoverVideoJob.mockClear();
    renderEvent();
    await h.flushEffects();
    await h.settle();
    const reopened = renderEvent();
    expect(reopened.stage.phase).toBe("idle");
    expect(reopened.processedUrl).toBeNull();
    expect(reopened.ownsJob("job-1")).toBe(false);
    expect(h.service.applyEventCoverVideoJob).not.toHaveBeenCalled();
  });

  test("J2 after a remount onto a job that failed while away, Try again with any clip is a NEW operation", async () => {
    const key = `event:${h.EVENT_ID}`;
    const stale = h.persistedJob(key, { jobId: "job-away", sourceAcknowledged: true });
    h.persistedJobs.set(key, stale);
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () =>
      h.status({ jobId: "job-away", status: "failed", isTerminal: true, failureCode: "processing_stalled",
        failureMessage: "Video processing did not finish in time. Try uploading it again." })) as never);
    renderEvent();
    await h.flushEffects();
    await h.settle();
    const remounted = renderEvent();
    expect(remounted.stage).toMatchObject({ phase: "error", code: "processing_stalled", canRetry: true });
    // The dead job's record must not survive to hijack the retry.
    expect(h.persistedJobs.has(key)).toBe(false);
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () => h.status({ jobId: "job-1" })) as never);
    await renderEvent().start(otherFile);
    const ops = intentBodies().map((body) => body.clientOperationId);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops).not.toContain(stale.clientOperationId);
    expect(renderEvent().stage.phase).not.toBe("error");
  });

  test("J3 the device goes offline between automatic retries: retrying stops and the card says offline", async () => {
    jest.useFakeTimers();
    h.service.createEventCoverVideoUploadIntent.mockImplementation((async () => {
      throw new h.HarnessProcessingError("edge_error", "Could not prepare video upload.");
    }) as never);
    const run = renderEvent().start(file);
    // First failure happens online; the 1 s retry fires and fails online too;
    // then the network drops during the 3 s back-off.
    await jest.advanceTimersByTimeAsync(1_000);
    offline = true;
    for (let i = 0; i < 4; i += 1) await jest.advanceTimersByTimeAsync(10_000);
    await run;
    // At most the one attempt already scheduled before the drop; never the
    // full four (that would burn the 9 s back-off against a dead network).
    expect(h.service.createEventCoverVideoUploadIntent.mock.calls.length).toBeLessThanOrEqual(3);
    const stage = renderEvent().stage;
    expect(stage).toMatchObject({ phase: "detached", reason: "offline" });
    const card = videoUploadCardModel(stage, null, ctx);
    expect(card?.stateId).toBe("H-10");
  });

  test("J4 online with a failing server: three retries, then interrupted copy that never blames the network", async () => {
    jest.useFakeTimers();
    h.service.uploadEventCoverVideoSource.mockImplementation((async () => {
      throw new h.HarnessProcessingError("source_upload_failed", "The upload stopped.");
    }) as never);
    const run = renderEvent().start(file);
    for (let i = 0; i < 6; i += 1) await jest.advanceTimersByTimeAsync(10_000);
    await run;
    expect(h.service.uploadEventCoverVideoSource).toHaveBeenCalledTimes(4);
    const stage = renderEvent().stage;
    expect(stage).toMatchObject({ phase: "detached", reason: "interrupted" });
    const card = videoUploadCardModel(stage, null, ctx);
    expect(card?.stateId).toBe("H-11");
    expect(`${card?.title ?? ""} ${card?.body ?? ""}`).not.toMatch(/offline|connection|internet|network/i);
  });

  test("J5 Host Ads: a replaced ad video that finishes late is never applied, linked or emitted", async () => {
    let finishFirst: ((value: unknown) => void) | null = null;
    h.service.createEventCoverVideoUploadIntent.mockImplementation((async (input: { clientOperationId: string }) => ({
      jobId: intentBodies().length === 1 ? "ad-job-1" : "ad-job-2",
      upload: { url: `https://tus.example/${input.clientOperationId}`, fields: {}, protocol: "tus" },
    })) as never);
    h.service.acknowledgeEventCoverVideoSourceUploaded.mockImplementation((async (input: { jobId: string }) =>
      h.status({ jobId: input.jobId, status: "processing", targetKind: "ad_creative" })) as never);
    h.service.waitForEventCoverVideoReady.mockImplementation(((jobId: string) =>
      jobId === "ad-job-1"
        ? new Promise((resolve) => { finishFirst = resolve; })
        : new Promise(() => undefined)) as never);
    const first = renderAd().start(file);
    await h.settle(200);
    expect(finishFirst).not.toBeNull();
    // The host taps Replace video while the first clip is still processing.
    const second = renderAd().replace(otherFile);
    await h.settle(200);
    const bodies = intentBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ target: "ad_creative", draftOwnerKey: "host-ad:draft-3040", applyMode: "published_manual" });
    expect(bodies[1].clientOperationId).not.toBe(bodies[0].clientOperationId);
    // Now the FIRST job finishes.
    (finishFirst as unknown as (value: unknown) => void)(h.status({
      jobId: "ad-job-1", status: "ready", targetKind: "ad_creative", processedUrl: "https://cdn.example/ad-1/play_1080p.mp4",
      creativeId: "creative-of-replaced-video",
    }));
    await first.catch(() => undefined);
    await h.settle(200);
    const appliedJobs = h.service.applyEventCoverVideoJob.mock.calls.map((call) => call[0]);
    expect(appliedJobs).not.toContain("ad-job-1");
    const after = renderAd();
    expect(after.creativeId).not.toBe("creative-of-replaced-video");
    expect(after.processedUrl).not.toBe("https://cdn.example/ad-1/play_1080p.mp4");
    void second;
  });
});
