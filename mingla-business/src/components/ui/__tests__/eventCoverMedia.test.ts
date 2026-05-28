import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import { resolveEventCoverMediaPresentation } from "../../../utils/eventCoverMediaRules";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("EventCoverMedia presentation", () => {
  test("falls back to hue cover when media is missing or errors", () => {
    expect(resolveEventCoverMediaPresentation({ mediaUrl: null })).toBe(
      "fallback",
    );
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.jpg",
        mediaType: "image",
        hasMediaError: true,
      }),
    ).toBe("fallback");
  });

  test("renders animated cover media types and respects reduced motion for video", () => {
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.gif",
        mediaType: "gif",
      }),
    ).toBe("gif");
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.mp4",
        mediaType: "video",
      }),
    ).toBe("video");
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.mp4",
        mediaType: "video",
        reduceMotion: true,
      }),
    ).toBe("video_still");
  });

  test("event creator shows upload limits before opening the picker", () => {
    const source = repoFile("src/components/event/CreatorStep4Cover.tsx");
    const rulesSource = repoFile("src/utils/eventCoverMediaRules.ts");

    expect(source).toContain("EVENT_COVER_UPLOAD_LIMIT_COPY");
    expect(rulesSource).toContain(
      "Upload a JPEG, PNG, WebP, or GIF up to 30 MB.",
    );
  });

  test("event creator requests iOS-compatible image output while preserving GIF-safe picking", () => {
    const source = repoFile("src/components/event/CreatorStep4Cover.tsx");

    expect(source).toContain('mediaTypes: ["images"]');
    expect(source).toContain("allowsEditing: false");
    expect(source).toContain("UIImagePickerPreferredAssetRepresentationMode");
    expect(source).toContain("Compatible");
    expect(source).toContain("quality: 1");
  });

  test("event creator separates image/GIF picking from native-trim-first video processing", () => {
    const source = repoFile("src/components/event/CreatorStep4Cover.tsx");

    expect(source).toContain('mediaTypes: ["images"]');
    expect(source).not.toContain('mediaTypes: ["videos"]');
    expect(source).not.toContain("validateNativeTrimmedEventCoverVideo");
    expect(source).toContain("allowsEditing: false");
    expect(source).not.toContain("allowsEditing: true");
    expect(source).not.toContain("videoMaxDuration: 15");
    expect(source).not.toContain("createEventCoverVideoUploadIntent");
    expect(source).toContain("if (!isAuthReady)");
    expect(source).toContain("Finishing sign-in before upload");
    expect(source).not.toContain("Use this clip");
    expect(source).not.toContain("Trim video cover");
    expect(source).toContain("searchGiphyEventCovers");
    expect(source).toContain("searchPexelsEventCovers");
    expect(source).toContain("coverMediaProvider");
    expect(source).not.toContain("VideoExportPreset.H264_1280x720");
    expect(source).not.toContain("UIImagePickerControllerQualityType.High");
    expect(source).not.toContain("EVENT_COVER_VIDEO_PROCESSING_COPY");
  });

  test("event creator no longer logs active video upload-intent diagnostics", () => {
    const source = repoFile("src/components/event/CreatorStep4Cover.tsx");

    expect(source).not.toContain("requestId: diagnostic?.requestId");
    expect(source).not.toContain("edgeStatus: diagnostic?.edgeStatus");
    expect(source).not.toContain("edgeError: diagnostic?.edgeError");
    expect(source).not.toContain("edgeDetail: diagnostic?.edgeDetail");
    expect(source).not.toContain("sourceDurationMs: diagnostic?.sourceDurationMs");
    expect(source).not.toContain("sourceBytes: diagnostic?.sourceBytes");
    expect(source).not.toContain("Object.assign(error, {");
  });

  test("event cover videos use inline browser-safe playback props", () => {
    // ORCH-0964 [TEST-MOD-APPROVED ORCH-0964]: implementation moved to the
    // shared @mingla/event-rendering package; assertions unchanged.
    const source = repoFile("../packages/event-rendering/EventCoverMedia.tsx");
    const publicPageSource = repoFile("src/components/event/PublicEventPage.tsx");

    expect(source).toContain("fullscreenOptions={{ enable: false }}");
    expect(source).toContain("playsInline");
    expect(source).toContain('React.createElement("video"');
    expect(source).toContain("WEB_VIDEO_STYLE");
    expect(source).toContain("AppState.addEventListener");
    expect(source).toContain('player.addListener("playToEnd"');
    expect(source).toContain('payload.status === "readyToPlay" && shouldPlay');
    expect(source).toContain('Platform.OS === "web" && autoplay ? true : muted');
    expect(source).toContain("showAudioControl");
    expect(source).toContain("audioControlPosition");
    expect(source).toContain("audioControlTopOffset");
    expect(source).toContain("audioControlTopLeft");
    expect(source).toContain("onMutedChange?.(next)");
    expect(publicPageSource).toContain("showAudioControl");
    expect(publicPageSource).toContain("audioControlLabel=\"event cover video\"");
    expect(publicPageSource).toContain("audioControlPosition=\"topLeft\"");
    expect(publicPageSource).toContain("audioControlTopOffset={insets.top + 60}");
    expect(publicPageSource).toContain("isLegacyUnsafeEventCoverVideoUrl");
    expect(source).not.toContain("allowsFullscreen={false}");
  });

  test("event cover video playback is gated by active surface intent", () => {
    // ORCH-0964 [TEST-MOD-APPROVED ORCH-0964]: implementation moved to the
    // shared @mingla/event-rendering package; assertions unchanged.
    const source = repoFile("../packages/event-rendering/EventCoverMedia.tsx");
    const publicPageSource = repoFile("src/components/event/PublicEventPage.tsx");

    expect(source).toContain("playbackActive?: boolean");
    expect(source).toContain("playbackActive = true");
    expect(source).toContain("const shouldPlay = autoplay && playbackActive");
    expect(source).toContain("isDisposedNativeVideoPlayerError");
    expect(source).toContain("callNativeVideoPlayer");
    expect(source).toContain("NativeSharedObjectNotFoundException");
    expect(source).toContain("if (shouldPlay) callNativeVideoPlayer");
    expect(source).toContain('payload.status === "readyToPlay" && shouldPlay');
    expect(source).toContain("if (shouldPlay) {");
    expect(source).toContain("callNativeVideoPlayer(() => player.pause())");
    expect(source).toContain('state === "active" && shouldPlay');
    expect(source).toContain('state === "inactive" || state === "background"');
    expect(source).toContain("autoPlay: shouldPlay");
    expect(source).toContain("if (!loop || !shouldPlay) return");
    expect(source).toContain("playbackActive={playbackActive}");

    expect(publicPageSource).toContain("usePathname");
    expect(publicPageSource).toContain("eventPublicPath");
    expect(publicPageSource).toContain("mediaPlaybackActive");
    expect(publicPageSource).toContain("publicHeroPlaybackActive");
    expect(publicPageSource).toContain("playbackActive={playbackActive}");
    expect(publicPageSource).toContain("setMediaPlaybackActive(false)");

    const closeIndex = publicPageSource.indexOf("setMediaPlaybackActive(false)");
    const replaceIndex = publicPageSource.indexOf('router.replace("/(tabs)/hub/events"');
    expect(closeIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeGreaterThan(closeIndex);
    expect(publicPageSource).toContain("muted={coverVideoMuted}");
    expect(publicPageSource).toContain('showAudioControl={safeCoverMediaType === "video"}');
  });

  test("native event cover cleanup does not call pause on a potentially disposed player", () => {
    // ORCH-0964 [TEST-MOD-APPROVED ORCH-0964]: implementation moved to the
    // shared @mingla/event-rendering package; assertions unchanged.
    const source = repoFile("../packages/event-rendering/EventCoverMedia.tsx");
    const cleanupBlockMatch = source.match(
      /return \(\) => \{\s*playToEndSub\.remove\(\);\s*appStateSub\.remove\(\);\s*\};/,
    );

    expect(cleanupBlockMatch).not.toBeNull();
    expect(cleanupBlockMatch?.[0]).not.toContain("player.pause");
    expect(cleanupBlockMatch?.[0]).not.toContain("callNativeVideoPlayer");
    expect(source).toContain("callNativeVideoPlayer(() => player.pause())");
    expect(source).toContain('state === "inactive" || state === "background"');
  });

  test("media render failures are surfaced to the caller before fallback", () => {
    // ORCH-0964 [TEST-MOD-APPROVED ORCH-0964]: implementation moved to the
    // shared @mingla/event-rendering package; assertions unchanged.
    const source = repoFile("../packages/event-rendering/EventCoverMedia.tsx");
    const stepSource = repoFile("src/components/event/CreatorStep4Cover.tsx");

    expect(source).toContain("onMediaError");
    expect(source).toContain('handleMediaError("image"');
    expect(source).toContain('handleMediaError("video"');
    expect(stepSource).toContain("mediaDisplayError");
    expect(stepSource).toContain('accessibilityRole="alert"');
  });
});
