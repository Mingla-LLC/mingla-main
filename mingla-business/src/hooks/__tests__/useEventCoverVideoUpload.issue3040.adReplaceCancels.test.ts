/**
 * #3040 rework 1 (P2, tester D-5) — Host Ads / Ari "Replace video".
 *
 * Ad videos never supersede each other on the server (each is its own
 * library item), so the client cancels the video it replaced the moment the
 * replacement is accepted. The server then refuses to put that job in the
 * library (cover_video_cancel_once + trg_ad_creatives_job_not_cancelled,
 * pg17 suite issue_3040_rework1 R4). Cover targets are untouched: the server
 * supersedes those itself.
 *
 * Invariant I-AD-VIDEO-CANCELLED-NEVER-MATERIALIZES (declared in supabase/migrations/__tests__/issue_3040_rework1.implementor.pg17.test.sql): replacing an ad video cancels the replaced job server-side at the start of the new one
 *
 * FAILS ON REVERT: remove the `cancelReplacedAdVideo(replacedJobId)` call in
 * uploadPrepared's replacing branch and the first case fails.
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

const file = { uri: "file:///clip.mp4", fileName: "clip.mp4", mimeType: "video/mp4", bytes: 289420, durationMs: 12000 };
const otherFile = { ...file, uri: "file:///different.mp4", fileName: "different.mp4" };

const renderAd = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload("", h.BRAND_ID, "published_manual", "ad_creative", { draftOwnerKey: "host-ad:draft-3040" });
};
const renderEvent = () => {
  h.resetRenderCursor();
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "published_manual", "event", {});
};
const intentCount = (): number => h.service.createEventCoverVideoUploadIntent.mock.calls.length;

const arm = (first: string, second: string, targetKind: string) => {
  h.service.createEventCoverVideoUploadIntent.mockImplementation((async (input: { clientOperationId: string }) => ({
    jobId: intentCount() === 1 ? first : second,
    upload: { url: `https://tus.example/${input.clientOperationId}`, fields: {}, protocol: "tus" },
  })) as never);
  h.service.acknowledgeEventCoverVideoSourceUploaded.mockImplementation((async (input: { jobId: string }) =>
    h.status({ jobId: input.jobId, status: "processing", targetKind })) as never);
  h.service.waitForEventCoverVideoReady.mockImplementation((() => new Promise(() => undefined)) as never);
};

describe("#3040 P2 replacing an ad video cancels the one it replaced", () => {
  beforeEach(() => h.resetAll());

  test("the replaced ad job is cancelled once the replacement is accepted", async () => {
    arm("ad-job-1", "ad-job-2", "ad_creative");
    void renderAd().start(file);
    await h.settle(200);
    void renderAd().replace(otherFile);
    await h.settle(200);
    expect(intentCount()).toBe(2);
    expect(h.service.cancelEventCoverVideoJob).toHaveBeenCalledWith("ad-job-1");
    expect(h.service.cancelEventCoverVideoJob).not.toHaveBeenCalledWith("ad-job-2");
  });

  test("a refused replacement leaves the first ad video alone", async () => {
    h.service.createEventCoverVideoUploadIntent
      .mockImplementationOnce((async (input: { clientOperationId: string }) => ({
        jobId: "ad-job-1",
        upload: { url: `https://tus.example/${input.clientOperationId}`, fields: {}, protocol: "tus" },
      })) as never)
      .mockImplementationOnce((async () => { throw new Error("intent refused"); }) as never);
    h.service.acknowledgeEventCoverVideoSourceUploaded.mockImplementation((async (input: { jobId: string }) =>
      h.status({ jobId: input.jobId, status: "processing", targetKind: "ad_creative" })) as never);
    h.service.waitForEventCoverVideoReady.mockImplementation((() => new Promise(() => undefined)) as never);
    void renderAd().start(file);
    await h.settle(200);
    await renderAd().replace(otherFile).catch(() => undefined);
    await h.settle(200);
    expect(h.service.cancelEventCoverVideoJob).not.toHaveBeenCalledWith("ad-job-1");
  });

  test("a cover replacement does not cancel from the client (the server supersedes covers)", async () => {
    arm("cover-job-1", "cover-job-2", "event");
    void renderEvent().start(file);
    await h.settle(200);
    void renderEvent().replace(otherFile);
    await h.settle(200);
    expect(intentCount()).toBe(2);
    expect(h.service.cancelEventCoverVideoJob).not.toHaveBeenCalledWith("cover-job-1");
  });
});
