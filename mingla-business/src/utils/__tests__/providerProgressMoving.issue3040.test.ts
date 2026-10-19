// MINGLA-INVARIANT: I-VIDEO-NO-FROZEN-PERCENT | issue #3040 | while Mingla prepares a video the card shows the provider percent only when it is a real reading above 0 that is moving, otherwise an indeterminate bar with the elapsed timer from sourceUploadedAt, and never a static percent
/**
 * #3040 D2 — observed 2026-10-19: "Preparing at Mingla · 5%" for a whole
 * minute, because Bunny's encode progress is sampled only when a webhook lands
 * and the card trusted any reading above 0.
 */
import { describe, expect, test } from "@jest/globals";

import { videoUploadCardModel, type UploadCardContext } from "../../components/ui/coverUploadCardModel";
import type { EventCoverVideoStatus } from "../../services/eventCoverVideoProcessingService";
import {
  coverVideoProcessingTiming,
  PROVIDER_PROGRESS_STALE_MS,
  trackProviderProgress,
  type ProviderProgressTracker,
} from "../eventCoverVideoSlo";

const ctx: UploadCardContext = {
  videoOnly: false, hasCover: true, finishesWithoutYou: true, isNative: false,
  phaseElapsedMs: 0, newClipBytes: 7_100_000, newClipDurationMs: 60_000, bytesPerSecond: null,
};

describe("#3040 D2 — a provider percent is shown only while it moves", () => {
  test("a reading that never moves is never shown: the card stays indeterminate with the elapsed timer", () => {
    let tracker: ProviderProgressTracker | null = null;
    const shown: (number | null)[] = [];
    for (let t = 0; t <= 60_000; t += 2_000) {
      const step = trackProviderProgress(tracker, "job_1", 5, t);
      tracker = step.tracker;
      shown.push(step.percent);
    }
    expect(shown.every((percent) => percent === null)).toBe(true);

    const model = videoUploadCardModel(
      { phase: "processing", percent: shown[shown.length - 1], timing: "normal" },
      { sourceUploadedAt: new Date(0).toISOString() } as EventCoverVideoStatus,
      ctx,
    );
    expect(model?.stateId).toBe("H-08");
    expect(model?.progress.kind).toBe("indeterminate");
    expect(model?.elapsedFrom).toBe("sourceUploaded");
  });

  test("a rising reading is shown, then hidden again once it stalls", () => {
    let step = trackProviderProgress(null, "job_1", 5, 0);
    expect(step.percent).toBeNull();
    step = trackProviderProgress(step.tracker, "job_1", 40, 4_000);
    expect(step.percent).toBe(40);
    step = trackProviderProgress(step.tracker, "job_1", 40, 4_000 + PROVIDER_PROGRESS_STALE_MS - 1);
    expect(step.percent).toBe(40);
    step = trackProviderProgress(step.tracker, "job_1", 40, 4_000 + PROVIDER_PROGRESS_STALE_MS);
    expect(step.percent).toBeNull();
  });

  test("zero, null and another job's reading never count as movement", () => {
    expect(trackProviderProgress(null, "job_1", 0, 0).percent).toBeNull();
    expect(trackProviderProgress(null, "job_1", null, 0).percent).toBeNull();
    const first = trackProviderProgress(null, "job_1", 5, 0);
    expect(trackProviderProgress(first.tracker, "job_2", 30, 2_000).percent).toBeNull();
  });

  test("H-08 sub turns at 60 s and the H-09 warning at 120 s (design Appendix A)", () => {
    const uploaded = new Date(0).toISOString();
    expect(coverVideoProcessingTiming(uploaded, 59_999)).toBe("normal");
    expect(coverVideoProcessingTiming(uploaded, 60_000)).toBe("delayed");
    expect(coverVideoProcessingTiming(uploaded, 119_999)).toBe("delayed");
    expect(coverVideoProcessingTiming(uploaded, 120_000)).toBe("breached");
  });
});
