/**
 * #3040 D2 — the hook never hands the card a frozen provider percent.
 * Replays 2026-10-19: every status during processing said 5 % (determinate)
 * until the job finished; the card used to show "Preparing at Mingla · 5%".
 * Declared by I-VIDEO-NO-FROZEN-PERCENT (utils/__tests__/providerProgressMoving.issue3040.test.ts).
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
  // The harness drives the hook outside React on purpose (slot-array hooks).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useEventCoverVideoUpload(h.EVENT_ID, h.BRAND_ID, "draft_auto", "event", {});
};
const frozen = (): Record<string, unknown> => h.status({
  applyMode: "draft_auto", progressKind: "determinate", progressPercent: 5,
  sourceUploadedAt: new Date(Date.now() - 20_000).toISOString(),
});

describe("#3040 D2 — no frozen percent while Mingla prepares the video", () => {
  beforeEach(() => h.resetAll());

  test("a provider reading stuck at 5 % is projected as indeterminate, every poll", async () => {
    h.persistedJobs.set(KEY, h.persistedJob(KEY, { sourceAcknowledged: true }));
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () => frozen()) as never);
    const seen: unknown[] = [];
    h.service.waitForEventCoverVideoReady.mockImplementation(((_jobId: string, options: {
      signal: AbortSignal; onStatus: (status: unknown) => void;
    }) => new Promise((_, reject) => {
      for (let poll = 0; poll < 10; poll += 1) {
        options.onStatus(frozen());
        h.resetRenderCursor();
        seen.push(render().stage);
      }
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })) as never);
    render();
    await h.flushEffects();
    await h.settle();
    expect(seen.length).toBe(10);
    for (const stage of seen) {
      expect(stage).toMatchObject({ phase: "processing", percent: null });
    }
    expect(render().stage).toMatchObject({ phase: "processing", percent: null });
    h.unmountEffects();
  });

  test("a provider reading that rises is shown", async () => {
    h.persistedJobs.set(KEY, h.persistedJob(KEY, { sourceAcknowledged: true }));
    h.service.fetchEventCoverVideoStatus.mockImplementation((async () => frozen()) as never);
    h.service.waitForEventCoverVideoReady.mockImplementation(((_jobId: string, options: {
      signal: AbortSignal; onStatus: (status: unknown) => void;
    }) => new Promise((_, reject) => {
      options.onStatus(frozen());
      options.onStatus({ ...frozen(), progressPercent: 42 });
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })) as never);
    render();
    await h.flushEffects();
    await h.settle();
    expect(render().stage).toMatchObject({ phase: "processing", percent: 42 });
    h.unmountEffects();
  });
});
