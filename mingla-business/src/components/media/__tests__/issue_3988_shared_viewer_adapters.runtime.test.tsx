import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockInsets = { top: 32, bottom: 28, left: 0, right: 0 };
const mockPlayer = {
  loop: false,
  currentTime: 0,
  timeUpdateEventInterval: 0,
  pause: jest.fn(),
  play: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native");
  return {
    ...base,
    Platform: { ...base.Platform, OS: "ios" },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
  };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock("expo-video", () => ({
  useVideoPlayer: (_source: unknown, setup?: (player: typeof mockPlayer) => void) => {
    setup?.(mockPlayer);
    return mockPlayer;
  },
  VideoView: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("VideoViewProbe", props),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock("@mingla/help-content", () => ({ bambooHlsUrl: (id: string) => `https://video.example/${id}.m3u8` }));
jest.mock("@mingla/offering-rendering/videoPlayerReloadRelease", () => ({
  isVideoPlayerReleasedForReload: () => false,
  registerVideoPlayerForReload: () => jest.fn(),
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../hooks/useReducedMotionNative", () => ({ useReducedMotionNative: () => true }));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("IconProbe", props),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FullScreenVideoViewer } = require("../../ui/FullScreenVideoViewer") as {
  FullScreenVideoViewer: React.ComponentType<Record<string, unknown>>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GuidePlayerModal } = require("../../support/GuidePlayerModal") as {
  GuidePlayerModal: React.ComponentType<Record<string, unknown>>;
};

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const flatten = (style: unknown): Record<string, unknown> =>
  (Array.isArray(style) ? style : [style]).filter(Boolean).reduce<Record<string, unknown>>(
    (value, entry) => Object.assign(value, entry),
    {},
  );

describe("#3988 shared viewer shell adapters", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, text: async () => "" })) as unknown as typeof fetch;
    mockPlayer.addListener.mockClear();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders FullScreenVideoViewer through the safe-area shell", async () => {
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<FullScreenVideoViewer uri="https://video.example/clip.mp4" title="Launch clip" onClose={jest.fn()} />);
    });
    expect(renderer.root.findAll((node) => node.props.testID === "full-screen-video-viewer").length).toBeGreaterThanOrEqual(1);
    expect(renderer.root.findAll((node) => node.type === "VideoViewProbe" && node.props.accessibilityLabel === "Launch clip")).toHaveLength(1);
    const [safeTop] = renderer.root.findAll((node) => flatten(node.props.style).paddingTop === 32);
    expect(flatten(safeTop.props.style).paddingTop).toBe(32);
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("renders GuidePlayerModal content with top and bottom safe-area padding", async () => {
    const guide = {
      slug: "launch-guide",
      episode: 1,
      duration: "1:05",
      title: "Launch your event",
      blurb: "A quick guide.",
      bambooEntryId: "entry-1",
      steps: [{ title: "Open Mingla", body: "Start from the Host home.", links: [] }],
    };
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<GuidePlayerModal guide={guide} userId="user-a" onClose={jest.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAll((node) => node.props.testID === "guide-player-modal").length).toBeGreaterThanOrEqual(1);
    expect(renderer.root.findAll((node) => node.type === "VideoViewProbe" && node.props.accessibilityLabel === "Launch your event video")).toHaveLength(1);
    expect(renderer.root.findAll((node) => flatten(node.props.style).paddingTop === 32).length).toBeGreaterThanOrEqual(1);
    expect(renderer.root.findAll((node) => Number(flatten(node.props.contentContainerStyle).paddingBottom) >= 28).length).toBeGreaterThanOrEqual(1);
    await TestRenderer.act(async () => renderer.unmount());
  });
});
