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
    // ORCH-0989/ORCH-1062 [TEST-MOD-APPROVED ORCH-1062]: the inline picker (which
    // owned EVENT_COVER_UPLOAD_LIMIT_COPY) was replaced in CreatorStep4Cover by
    // the shared <CoverPickerSheet>/<CoverPicker> — the picker copy + behavior now
    // live there and are covered by the CoverPicker.* suites. The upload-limit copy
    // string itself still lives in the rules module, so keep that copy-existence
    // check and drop the stale CreatorStep4Cover source pin.
    const rulesSource = repoFile("src/utils/eventCoverMediaRules.ts");

    expect(rulesSource).toContain(
      "Upload a JPEG, PNG, WebP, or GIF up to 30 MB.",
    );
  });

  // ORCH-0989/ORCH-1062 [TEST-MOD-APPROVED ORCH-1062]: the two source pins that
  // asserted CreatorStep4Cover called the image picker inline
  // (`mediaTypes: ["images"]`, `allowsEditing: false`,
  // `UIImagePickerPreferredAssetRepresentationMode`, the GIF-safe / no-inline-video
  // guards) were removed — CreatorStep4Cover no longer calls the picker directly.
  // The unified <CoverPickerSheet> (ORCH-0989) delegates to the shared
  // coverPickerDeviceMedia picker, whose iOS-compatible / GIF-safe / image-only
  // behavior is covered by the passing CoverPicker.* suites. These were pure
  // source-shape pins on moved code, not behavioral coverage.

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
    // shared @mingla/offering-rendering package; assertions unchanged.
    const source = repoFile("../packages/offering-rendering/EventCoverMedia.tsx");

    expect(source).toContain("fullscreenOptions={{ enable: false }}");
    expect(source).toContain("playsInline");
    // ORCH-1167-R8/ORCH-1062 [TEST-MOD-APPROVED ORCH-1062]: the web cover video is
    // now created imperatively via `document.createElement('video')` (a
    // React-reconciled <video> is permanently denied inline-muted autoplay by
    // WebKit), and the inline web style constant was renamed away from
    // WEB_VIDEO_STYLE. Dropped these two stale source-shape pins; the browser-safe
    // playback behavior stays covered by the retained playsInline / fullscreen /
    // AppState / audio-pill assertions below and the ORCH-1124 audio-pill suite.
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
    // adapter (now a thin delegate) into the shared @mingla/offering-rendering
    // package's PublicEventPage. The old assertions below targeted
    // `publicPageSource` (the adapter) for `showAudioControl` /
    // `audioControlPosition="topLeft"` / `audioControlTopOffset={insets.top + 60}`
    // — strings that no longer exist there, so they were stale and failing.
    // Re-point them at the shared page (`sharedPublicPageSource`) and assert the
    // CURRENT reality: the cover audio control renders via the default
    // "bottomRight" position (no override), clearing the top-right floating
    // close+share chrome.
    const sharedPublicPageSource = repoFile(
      "../packages/offering-rendering/PublicEventPage.tsx",
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
    // ORCH-1062 [TEST-MOD-APPROVED ORCH-1062]: this suite's `publicPageSource`
    // half pinned the src/components/event/PublicEventPage.tsx pathname→
    // mediaPlaybackActive wiring (usePathname / eventPublicPath /
    // publicHeroPlaybackActive / the close→router.replace ordering). That whole
    // page moved into the shared @mingla/offering-rendering package (the
    // mingla-business file is now a thin delegate), so those pins were stale and
    // their behavior is covered by the shared package's own tests. Dropped the
    // moved publicPageSource half plus the two stale component strings
    // (`if (shouldPlay) callNativeVideoPlayer`, `autoPlay: shouldPlay`) that the
    // ORCH-1167-R8 imperative-DOM video refactor renamed away. Kept the
    // component-level playbackActive gating pins that still hold.
    const source = repoFile("../packages/offering-rendering/EventCoverMedia.tsx");

    expect(source).toContain("playbackActive?: boolean");
    expect(source).toContain("playbackActive = true");
    expect(source).toContain("const shouldPlay = autoplay && playbackActive");
    expect(source).toContain("isDisposedNativeVideoPlayerError");
    expect(source).toContain("callNativeVideoPlayer");
    expect(source).toContain("NativeSharedObjectNotFoundException");
    expect(source).toContain('payload.status === "readyToPlay" && shouldPlay');
    expect(source).toContain("if (shouldPlay) {");
    expect(source).toContain("callNativeVideoPlayer(() => player.pause())");
    expect(source).toContain('state === "active" && shouldPlay');
    expect(source).toContain('state === "inactive" || state === "background"');
    expect(source).toContain("if (!loop || !shouldPlay) return");
    expect(source).toContain("playbackActive={playbackActive}");
  });

  test("native event cover cleanup does not call pause on a potentially disposed player", () => {
    // ORCH-0964 [TEST-MOD-APPROVED ORCH-0964]: implementation moved to the
    // shared @mingla/offering-rendering package; assertions unchanged.
    const source = repoFile("../packages/offering-rendering/EventCoverMedia.tsx");
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
    // shared @mingla/offering-rendering package; assertions unchanged.
    const source = repoFile("../packages/offering-rendering/EventCoverMedia.tsx");

    expect(source).toContain("onMediaError");
    expect(source).toContain('handleMediaError("image"');
    expect(source).toContain('handleMediaError("video"');
    // ORCH-0989/ORCH-1062 [TEST-MOD-APPROVED ORCH-1062]: the CreatorStep4Cover
    // media-display-error UI (mediaDisplayError / accessibilityRole="alert") moved
    // into the shared <CoverPickerSheet>/<CoverPicker> when the inline picker was
    // replaced (ORCH-0989); dropped the two stale stepSource pins. The
    // error-surfacing behavior on the shared cover component stays asserted above.
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
    repoFile("../packages/offering-rendering/PublicEventPage.tsx");
  const coverMedia = (): string =>
    repoFile("../packages/offering-rendering/EventCoverMedia.tsx");

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
  // inside the cover container (bottom:40 / right:24) — not the page base — so
  // it does not collide with the host-mounted floating Buy bar (ORCH-1117) and
  // (ORCH-1133, round 3) clears the public-event blue details panel by +12px so
  // it stops bleeding into the details section that begins below the public hero.
  test("EventCoverMedia defaults the audio pill to bottomRight, styled within the cover", () => {
    const media = coverMedia();
    expect(media).toContain('audioControlPosition = "bottomRight"');
    expect(media).toContain("audioControlBottomRight:");
    // Parse the full `audioControlBottomRight: { ... }` block (the comment bloat
    // above `bottom:` blew past the old fixed 400-char window — DISC-1 hardening).
    const blockMatch = media
      .slice(media.indexOf("audioControlBottomRight:"))
      .match(/audioControlBottomRight:\s*\{([\s\S]*?)\n\s*\},/);
    const bottomRightStyle = blockMatch ? blockMatch[1] : "";
    // ORCH-1132 — right kept at 24 (visible right-edge breathing room).
    expect(bottomRightStyle).toContain("right: 24");
    // ORCH-1133 — raised 22 → 40 for clearance from the public-event details panel.
    expect(bottomRightStyle).toContain("bottom: 40");
  });
});
