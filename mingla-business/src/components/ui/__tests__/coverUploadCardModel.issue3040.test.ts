/**
 * #3040 B-C15 — the approved design's truth rules on the upload card
 * (Appendix A §1.3): T1 no 100 while the phase is unchanged, T2 upload % held
 * below 100, T3 "Confirming upload" only for ack_pending, the truthful
 * stepper, limits per media, and the footer label per state.
 */
import { describe, expect, test } from "@jest/globals";

import {
  coverLimitsLines,
  coverSheetFooterLabel,
  coverStatusRowModel,
  formatEta,
  NATIVE_STEPS,
  videoUploadCardModel,
  WEB_STEPS,
} from "../coverUploadCardModel";

const ctx = { isNative: true, hasCover: true, videoOnly: false, finishesWithoutYou: false, phaseElapsedMs: 0 };

describe("#3040 upload card model", () => {
  test("T1/T2 — determinate bars never reach 100 inside a phase", () => {
    expect(videoUploadCardModel({ phase: "compressing", percent: 100 }, null, ctx)?.progress).toEqual({ kind: "determinate", percent: 99 });
    expect(videoUploadCardModel({ phase: "uploading", percent: 100, confirmedBytes: 10, totalBytes: 10 }, null, ctx)?.progress).toEqual({ kind: "determinate", percent: 99 });
    expect(videoUploadCardModel({ phase: "uploading", percent: null }, null, ctx)?.progress).toEqual({ kind: "indeterminate" });
  });

  test("Check is indeterminate (the frozen-100% fix) and says Big file after 20 s", () => {
    const card = videoUploadCardModel({ phase: "preparing", percent: 0 }, null, ctx);
    expect(card?.title).toBe("Checking file");
    expect(card?.progress.kind).toBe("indeterminate");
    expect(card?.currentStep).toBe("check");
    expect(videoUploadCardModel({ phase: "preparing", percent: 0 }, null, { ...ctx, phaseElapsedMs: 21_000 })?.body)
      .toBe("Big file — this can take a minute on some phones.");
  });

  test("T3 — Confirming upload exists only for ack_pending", () => {
    expect(videoUploadCardModel({ phase: "ack_pending", percent: 0 }, null, ctx)?.title).toBe("Confirming upload");
    expect(videoUploadCardModel({ phase: "detached", percent: 0, sourceAcknowledged: false, reason: "interrupted" }, null, ctx)?.title)
      .toBe("Upload interrupted");
  });

  test("stepper: native Optimize → Check → Upload → Finish; web has no Optimize", () => {
    expect(NATIVE_STEPS).toEqual(["optimize", "check", "upload", "finish"]);
    expect(WEB_STEPS).toEqual(["check", "upload", "finish"]);
    expect(videoUploadCardModel({ phase: "uploading", percent: 10 }, null, { ...ctx, isNative: false })?.steps).toEqual(WEB_STEPS);
  });

  test("the H-08 promise is true to the target", () => {
    const auto = videoUploadCardModel({ phase: "processing", percent: null, timing: "normal" }, null, { ...ctx, finishesWithoutYou: true });
    const manual = videoUploadCardModel({ phase: "processing", percent: null, timing: "normal" }, null, ctx);
    expect(auto?.body).toContain("swap it in automatically");
    expect(manual?.body).toContain("next time you open this");
  });

  test("Replace video stays available in every active ad phase", () => {
    for (const stage of [
      { phase: "compressing" as const, percent: 10 },
      { phase: "uploading" as const, percent: 10 },
      { phase: "processing" as const, percent: null, timing: "normal" as const },
    ]) {
      const card = videoUploadCardModel(stage, null, { ...ctx, videoOnly: true });
      expect(card?.actions.map((action) => action.label)).toContain("Replace video");
    }
  });

  test("ETA is rounded to 5 s and hidden without a rate or past 10 minutes", () => {
    expect(formatEta(20 * 1024 * 1024, 1024 * 1024)).toBe("About 20 s left");
    expect(formatEta(1000, null)).toBeNull();
    expect(formatEta(1_000_000_000, 1000)).toBeNull();
  });

  test("status row copy follows draft vs live, and limits follow the media", () => {
    expect(coverStatusRowModel({ coverKind: "video", isLive: false, videoOnly: false, justApplied: false }).body)
      .toContain("This is the cover saved to your draft.");
    expect(coverStatusRowModel({ coverKind: "photo", isLive: true, videoOnly: false, justApplied: false }).body)
      .toContain("This is the cover guests see now.");
    expect(coverStatusRowModel({ coverKind: "video", isLive: false, videoOnly: false, justApplied: true }).title)
      .toBe("New video cover is live");
    expect(coverLimitsLines("video", false)[0]).toBe("MP4, MOV, M4V or WebM · Up to 1 minute · Under 100 MB");
    expect(coverLimitsLines("photo", false)).toEqual(["JPEG, PNG, WebP or GIF · Under 30 MB"]);
    expect(coverLimitsLines("empty", false)).toEqual([
      "Video: MP4, MOV, M4V or WebM · Up to 1 minute · Under 100 MB",
      "Photo: JPEG, PNG, WebP or GIF · Under 30 MB",
    ]);
    expect(coverLimitsLines("empty", true)).toEqual(["MP4, MOV, M4V or WebM · 5 seconds to 1 minute · Under 100 MB"]);
  });

  test("footer label by state", () => {
    expect(coverSheetFooterLabel({ jobActive: true, needsAction: false, hasCover: true, videoOnly: false })).toBe("Close — keep working");
    expect(coverSheetFooterLabel({ jobActive: false, needsAction: true, hasCover: true, videoOnly: false })).toBe("Close");
    expect(coverSheetFooterLabel({ jobActive: false, needsAction: false, hasCover: true, videoOnly: true })).toBe("Use this ad video");
    expect(coverSheetFooterLabel({ jobActive: false, needsAction: false, hasCover: false, videoOnly: false })).toBe("Done");
  });
});
