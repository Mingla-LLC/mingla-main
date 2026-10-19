/**
 * #3040 T-ADMIN5S (Host half) [answer 4] — an ad video under 5 s is refused
 * at PICK time in Host Ads and Ari (AD-06): no prepare, no intent, no byte.
 * Covers have no minimum.
 *
 * Invariant I-AD-VIDEO-MIN-5S (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_ad_min_duration.test.ts): an ad_creative source shorter than 5 s never leaves the device (pick check), and the edge and DB refuse it; covers have no minimum
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { pickRefusalCardModel } from "../coverUploadCardModel";
import { isAdVideoTooShort, VIDEO_LIMITS } from "@mingla/video-upload";

const picker = readFileSync(join(__dirname, "..", "CoverPicker.tsx"), "utf8");
const ctx = { isNative: true, hasCover: false, videoOnly: true, finishesWithoutYou: false, phaseElapsedMs: 0 };

describe("#3040 AD-06 — ad video minimum at pick", () => {
  test("4.2 s is refused with the AD-06 card; 5 s is fine", () => {
    expect(isAdVideoTooShort(4200)).toBe(true);
    expect(isAdVideoTooShort(5000)).toBe(false);
    expect(VIDEO_LIMITS.AD_MIN_DURATION_MS).toBe(5000);
    const card = pickRefusalCardModel({ kind: "too_short", durationMs: 4200 }, ctx);
    expect(card.stateId).toBe("AD-06");
    expect(card.title).toBe("This video is 4 seconds long");
    expect(card.sub).toBe("Ad videos need at least 5 seconds");
    expect(card.actions.map((action) => action.label)).toEqual(["Choose another video"]);
  });

  test("the picker refuses BEFORE handing the clip to the upload hook, for ad videos only", () => {
    const start = picker.indexOf("const pickVideoCover = useCallback(");
    const body = picker.slice(start, picker.indexOf("const continueVideoUploadAfterNativeEditor", start));
    const refusal = body.indexOf("if (isAdCreative && rawClipDurationMs > 0 && rawClipDurationMs < AD_MIN_DURATION_MS)");
    expect(refusal).toBeGreaterThan(-1);
    expect(body.indexOf('setPickRefusal({ kind: "too_short", durationMs: rawClipDurationMs });')).toBeGreaterThan(refusal);
    expect(body.indexOf("await videoUpload.start(uploadFile)")).toBeGreaterThan(refusal);
    expect(body.indexOf("await videoUpload.replace(uploadFile)")).toBeGreaterThan(refusal);
  });
});
