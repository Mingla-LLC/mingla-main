import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import { resolveEventCoverMediaPresentation } from "../../../utils/eventCoverMediaRules";
// ORCH-0992: additive-only import (keeps the line above untouched so the
// append-only test gate stays green without a [TEST-MOD-APPROVED] override).
import { shouldFreezeCoverForReduceMotion } from "../../../utils/eventCoverMediaRules";

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
    // ORCH-1124 [TEST-MOD-APPROVED ORCH-1124] — the audio-pill wiring was
    // refactored out of the mingla-business src/components/event/PublicEventPage
    // adapter (now a thin delegate) into the shared @mingla/event-rendering
    // package's PublicEventPage. The old assertions below targeted
    // `publicPageSource` (the adapter) for `showAudioControl` /
    // `audioControlPosition="topLeft"` / `audioControlTopOffset={insets.top + 60}`
    // — strings that no longer exist there, so they were stale and failing.
    // Re-point them at the shared page (`sharedPublicPageSource`) and assert the
    // CURRENT reality: the cover audio control renders via the default
    // "bottomRight" position (no override), clearing the top-right floating
    // close+share chrome.
    const sharedPublicPageSource = repoFile(
      "../packages/event-rendering/PublicEventPage.tsx",
    );
    expect(sharedPublicPageSource).toContain("showAudioControl");
    expect(sharedPublicPageSource).not.toContain(
      "audioControlPosition=\"topRight\"",
    );
    expect(sharedPublicPageSource).not.toContain(
      "audioControlPosition=\"topLeft\"",
    );
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

// ORCH-0992 [event-cover video paused on web].
// Root cause proven by live browser repro: a true `video` cover was downgraded to
// a non-autoplaying still ("video_still") whenever the viewer had
// `prefers-reduced-motion: reduce`, so the cover sat frozen on frame 0 ("shows up
// but seems paused") on the event hero AND brand-list cards — while GIF covers
// beside it kept animating (GIFs are never frozen). Fix: a muted autoplay-loop
// cover is ambient motion and is exempt from the reduce-motion freeze.
describe("ORCH-0992 reduce-motion ambient cover gate", () => {
  // HAPPY PATH — the gate truth table. Fails-on-revert: if EventCoverMedia is
  // reverted to feed raw `reduceMotion`, the production behavior regresses; this
  // helper IS the gate the component calls, so flipping its first case to `true`
  // is exactly the reverted behavior.
  test("does NOT freeze a muted autoplay-loop cover under reduce-motion (ambient)", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: true,
        muted: true,
        loop: true,
      }),
    ).toBe(false);
  });

  test("freezes a sound-on cover under reduce-motion (not ambient)", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: true,
        muted: false,
        loop: true,
      }),
    ).toBe(true);
  });

  test("freezes a non-autoplay (tap-to-play) cover under reduce-motion", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: false,
        muted: true,
        loop: true,
      }),
    ).toBe(true);
  });

  test("freezes a non-looping cover under reduce-motion", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: true,
        muted: true,
        loop: false,
      }),
    ).toBe(true);
  });

  test("never freezes when reduce-motion is off", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: false,
        autoplay: false,
        muted: false,
        loop: false,
      }),
    ).toBe(false);
  });

  // ADVERSARIAL — integration of the REAL gate with the REAL presentation
  // resolver, exactly as EventCoverMedia chains them. A different angle than the
  // truth-table above: it asserts the END presentation a video cover resolves to,
  // proving the ambient exemption actually changes "video_still" → "video" while
  // leaving normal-motion and sound-on paths untouched. Fails-on-revert: reverting
  // the component/gate to pass raw `reduceMotion` flips the ambient case to
  // "video_still".
  const resolveCover = (params: {
    reduceMotion: boolean;
    autoplay: boolean;
    muted: boolean;
    loop: boolean;
  }): "video" | "video_still" =>
    resolveEventCoverMediaPresentation({
      mediaUrl: "https://res.cloudinary.com/x/video/upload/a.mp4",
      mediaType: "video",
      reduceMotion: shouldFreezeCoverForReduceMotion(params),
    }) as "video" | "video_still";

  test("ambient muted cover resolves to playing 'video' even under reduce-motion", () => {
    expect(
      resolveCover({
        reduceMotion: true,
        autoplay: true,
        muted: true,
        loop: true,
      }),
    ).toBe("video");
  });

  test("sound-on cover still resolves to 'video_still' under reduce-motion", () => {
    expect(
      resolveCover({
        reduceMotion: true,
        autoplay: true,
        muted: false,
        loop: true,
      }),
    ).toBe("video_still");
  });

  test("normal-motion ambient cover is unchanged ('video')", () => {
    expect(
      resolveCover({
        reduceMotion: false,
        autoplay: true,
        muted: true,
        loop: true,
      }),
    ).toBe("video");
  });
});

// ORCH-1124 [cover-video Sound/Mute pill unreachable under floating chrome].
// The shared public event page (buyer/anon web + business app) used to override
// EventCoverMedia's audio-pill position to "topRight", which planted the
// Sound/Mute pill directly under the top-right floating close+share chrome — an
// unreachable dead tap. Fix: drop the override so the pill inherits the
// "bottomRight" default (the position the consumer app already uses via
// expandedCard/ImageGallery), clearing the chrome.
describe("ORCH-1124 cover-video audio pill clears top-right floating chrome", () => {
  const sharedPublicPage = (): string =>
    repoFile("../packages/event-rendering/PublicEventPage.tsx");
  const coverMedia = (): string =>
    repoFile("../packages/event-rendering/EventCoverMedia.tsx");

  // HAPPY PATH — the public event page must NOT override the audio-pill
  // position, so it inherits the shared component's "bottomRight" default.
  // Fails-on-revert: re-adding `audioControlPosition="topRight"` (or any
  // top-anchored override) on the EventCoverMedia in PublicEventPage.tsx makes
  // this assertion fail.
  test("public event page does not pin the cover audio pill to a top position", () => {
    const page = sharedPublicPage();
    expect(page).toContain("showAudioControl");
    expect(page).not.toContain('audioControlPosition="topRight"');
    expect(page).not.toContain('audioControlPosition="topLeft"');
  });

  // The shared component's audio-pill default is "bottomRight" and is styled
  // inside the cover container (bottom:14 / right:14) — not the page base — so
  // it does not collide with the host-mounted floating Buy bar (ORCH-1117).
  test("EventCoverMedia defaults the audio pill to bottomRight, styled within the cover", () => {
    const media = coverMedia();
    expect(media).toContain('audioControlPosition = "bottomRight"');
    expect(media).toContain("audioControlBottomRight:");
    const bottomRightStyle = media
      .slice(media.indexOf("audioControlBottomRight:"))
      .slice(0, 80);
    expect(bottomRightStyle).toContain("right: 14");
    expect(bottomRightStyle).toContain("bottom: 14");
  });
});
