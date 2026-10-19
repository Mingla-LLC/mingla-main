/**
 * #3040 T-A4 [A-4] / design T7 — the preview is the SAVED cover. A finished
 * video's `processedUrl` never outranks a photo picked after it, and the
 * "added" state hides once the cover is no longer that job's output.
 *
 * Invariant I-VIDEO-NO-RESURRECT (declared in supabase/functions/event-cover-video-status/__tests__/issue_3040_active_only.test.ts): opening a sheet never re-emits a finished, failed or cancelled job not started by this device
 */
import { describe, expect, test } from "@jest/globals";

import { resolveActiveMedia, resolveActiveMediaUrl } from "../coverPickerActiveMedia";

const V = "https://cdn.example/job-1/play_1080p.mp4";
const I = "https://storage.example/covers/photo.jpg";

describe("#3040 T-A4 — new media wins", () => {
  test("applied video V, then an image I is picked: the preview is I and the added card hides", () => {
    const media = resolveActiveMedia({
      localPreviewUri: null,
      processedUrl: V,
      stagePhase: "applied",
      coverUrl: I,
      coverType: "image",
    });
    expect(media.url).toBe(I);
    expect(media.type).toBe("image");
    expect(media.showAddedCard).toBe(false);
    expect(resolveActiveMediaUrl({ localPreviewUri: null, processedUrl: V, stagePhase: "applied", coverUrl: I, coverType: "image" })).toBe(I);
  });

  test("the added state shows only while the saved cover IS the job's output", () => {
    expect(resolveActiveMedia({ localPreviewUri: null, processedUrl: V, stagePhase: "applied", coverUrl: V, coverType: "video" }).showAddedCard).toBe(true);
  });

  test("while a replacement uploads, the CURRENT cover stays in the preview", () => {
    const media = resolveActiveMedia({
      localPreviewUri: "file:///new-clip.mp4",
      processedUrl: null,
      stagePhase: "uploading",
      coverUrl: I,
      coverType: "image",
    });
    expect(media.url).toBe(I);
    expect(media.isNewClip).toBe(false);
  });

  test("H-20: with no cover yet, the new clip is shown (dimmed, not live)", () => {
    const media = resolveActiveMedia({
      localPreviewUri: "file:///new-clip.mp4",
      processedUrl: null,
      stagePhase: "uploading",
      coverUrl: null,
      coverType: null,
    });
    expect(media.url).toBe("file:///new-clip.mp4");
    expect(media.isNewClip).toBe(true);
  });

  test("Remove cover after an applied video: the preview is empty, not the old video", () => {
    expect(resolveActiveMedia({ localPreviewUri: null, processedUrl: V, stagePhase: "applied", coverUrl: null, coverType: null }).url).toBeNull();
  });
});
