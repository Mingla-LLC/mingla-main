// issue #1561 — `expo-video` boundary stub for the WEB render-proof config.
//
// `EventCoverMedia` imports `expo-video`, which reaches `expo-modules-core`'s
// native EventEmitter at module load and throws under jest. The venue hero's
// WEB claims are about the CONTAINER — the pinned cover's `aspect-ratio` and
// its flow spacer's — not about video playback, and the venue page's own video
// handling is proven on the real tree in
// `venueFirstScreen.issue1561.happy.test.tsx` (a video cover keeps
// `coverMediaType: "video"`, keeps its mute control, and never enters the image
// pager). So this stub is a LOAD boundary, not a behaviour substitute: it
// renders nothing and asserts nothing.
//
// It is deliberately NOT registered in `jest.config.cjs` — only this one config
// maps it, so no existing suite's resolution changes.

const React = require("react");

const VideoView = () => React.createElement("ExpoVideoViewStub", null);

const useVideoPlayer = () => ({
  play: () => undefined,
  pause: () => undefined,
  replace: () => undefined,
  muted: true,
  loop: true,
  currentTime: 0,
  addListener: () => ({ remove: () => undefined }),
});

module.exports = {
  __esModule: true,
  VideoView,
  useVideoPlayer,
  createVideoPlayer: useVideoPlayer,
  isPictureInPictureSupported: () => false,
};
