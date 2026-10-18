import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, relativePath), "utf8");

describe("#3040 trip-day videos use the canonical Bunny transport", () => {
  const service = read("mingla-business/src/services/tripDayMediaService.ts");
  const sheet = read("mingla-business/src/components/trip/TripDayMediaSheet.tsx");
  const uploadIntent = read(
    "supabase/functions/event-cover-video-upload-intent/index.ts",
  );
  const shared = read("supabase/functions/_shared/eventCoverVideo.ts");

  test("keeps image uploads in Storage but sends video through Bunny/TUS", () => {
    expect(service).toContain('target: "trip_day_media"');
    expect(service).toContain("createEventCoverVideoUploadIntent");
    expect(service).toContain("uploadEventCoverVideoSource");
    expect(service).toContain("acknowledgeEventCoverVideoSourceUploaded");
    expect(service).toContain("waitForEventCoverVideoReady");
    expect(service).toContain('TRIP_DAY_MEDIA_BUCKET = "event_covers"');
    expect(service.indexOf("if (isVideoMime(contentType))")).toBeLessThan(
      service.indexOf("const storagePath"),
    );
  });

  test("shows transport progress and applies the shared one-minute contract", () => {
    expect(sheet).toContain("videoProgress.percent");
    expect(sheet).toContain("Uploading video");
    expect(sheet).toContain("Processing video");
    expect(sheet).toContain("videos up to one minute");
    expect(service).toContain("EVENT_COVER_MAX_VIDEO_DURATION_MS");
    expect(service).toContain("Choose a video that is one minute or shorter.");
  });

  test("edge authorization treats trip media as event-manager media", () => {
    expect(uploadIntent).toContain('targetKind === "trip_day_media"');
    expect(shared).toContain('selector.targetKind === "trip_day_media"');
    expect(shared).toContain("requireEventManager(");
  });
});
