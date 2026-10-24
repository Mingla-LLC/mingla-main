import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: "ios" };
const mockWindow = { width: 390, height: 844, fontScale: 2, scale: 3 };
let mockReduceMotion = true;
let mockGestureEnd: ((event: { translationY: number; velocityY: number }) => void) | null = null;
const mockUseVideoPlayer = jest.fn((_source?: unknown, _setup?: unknown) => ({ loop: false, pause: jest.fn() }));
const mockShare = jest.fn();
const mockDownload = jest.fn(async (_uri?: string, _destination?: string, _options?: unknown) => ({ uri: "file:///cache/launch.mp4" }));
const mockDelete = jest.fn(async (_uri?: string, _options?: unknown) => undefined);
const mockWithSpring = jest.fn((value: number) => value);

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const base = jest.requireActual("react-native");
  Object.assign(mockPlatform, { select: base.Platform.select });
  const FlatList = ReactModule.forwardRef((props: Record<string, unknown>, ref: { current: unknown } | null) => {
    if (ref && typeof ref === "object") {
      ref.current = { scrollToIndex: jest.fn() };
    }
    const data = (props.data as unknown[]) ?? [];
    const renderItem = props.renderItem as ((info: { item: unknown; index: number }) => React.ReactNode) | undefined;
    return ReactModule.createElement(
      "FlatListProbe",
      props,
      data.map((entry, index) => ReactModule.createElement("ListCell", { key: index }, renderItem?.({ item: entry, index }))),
    );
  });
  return {
    ...base,
    FlatList,
    Platform: mockPlatform,
    Share: { share: (...args: unknown[]) => mockShare(...args) },
    useWindowDimensions: () => mockWindow,
  };
});
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: () => {
      const gesture = {
        enabled: () => gesture,
        activeOffsetY: () => gesture,
        failOffsetX: () => gesture,
        onUpdate: () => gesture,
        onEnd: (handler: typeof mockGestureEnd) => {
          mockGestureEnd = handler;
          return gesture;
        },
      };
      return gesture;
    },
  },
}));
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    __esModule: true,
    default: { View: (props: Record<string, unknown>) => ReactModule.createElement("AnimatedView", props, props.children) },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withSpring: (value: number) => mockWithSpring(value),
  };
});
jest.mock("expo-video", () => ({
  useVideoPlayer: (source: unknown, setup: unknown) => mockUseVideoPlayer(source, setup),
  VideoView: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("VideoViewProbe", props),
}));
jest.mock("expo-image", () => ({
  Image: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ImageProbe", props),
}));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  downloadAsync: (uri: string, destination: string, options: unknown) => mockDownload(uri, destination, options),
  deleteAsync: (uri: string, options: unknown) => mockDelete(uri, options),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  EncodingType: { Base64: "base64" },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(async () => ({ granted: false })),
    createFileAsync: jest.fn(),
  },
}));
jest.mock("react-native-webview", () => ({
  WebView: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("WebViewProbe", props),
}));
jest.mock("@mingla/offering-rendering/videoPlayerReloadRelease", () => ({ registerVideoPlayerForReload: jest.fn(() => jest.fn()) }));
jest.mock("../../../hooks/useReducedMotionNative", () => ({ useReducedMotionNative: () => mockReduceMotion }));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("IconProbe", props),
}));
jest.mock("../../ui/WebSafeGestureDetector", () => ({
  WebSafeGestureDetector: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("GestureProbe", props, props.children),
}));
jest.mock("../MediaThumb", () => ({
  MediaThumb: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("MediaThumbProbe", props),
}));
jest.mock("../MediaViewerShell", () => ({
  MediaViewerShell: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react");
    const children = typeof props.children === "function"
      ? (props.children as (stage: Record<string, unknown>) => React.ReactNode)({ width: 300, height: 500, style: { width: 300, height: 500 } })
      : props.children;
    return R.createElement("ViewerShellProbe", props, props.topBar, children, props.bottomBar);
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MediaViewer } = require("../MediaViewer") as {
  MediaViewer: React.ComponentType<Record<string, unknown>>;
};

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  parent?: Node;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const flatten = (style: unknown): Record<string, unknown> =>
  (Array.isArray(style) ? style : [style]).filter(Boolean).reduce<Record<string, unknown>>(
    (value, entry) => Object.assign(value, entry),
    {},
  );

const video = (fileId: string, messageId = `message-${fileId}`) => ({
  fileId,
  messageId,
  name: `${fileId}.mp4`,
  mime: "video/mp4",
  sizeBytes: 12_000,
  createdAt: "2026-10-24T12:00:00.000Z",
  senderDisplayName: "Seth",
  senderRole: "brand",
  kind: "video",
  durationMs: 12_000,
  width: 1920,
  height: 1080,
  thumbState: "ready",
});

async function mountViewer(overrides: Record<string, unknown> = {}): Promise<{ renderer: Renderer; requestFor: jest.Mock; onClose: jest.Mock; onShowInChat: jest.Mock }> {
  const requestFor = jest.fn(async (fileId: string) => ({ uri: `https://edge.example/file/${fileId}`, headers: { Authorization: "Bearer secret" } }));
  const onClose = jest.fn();
  const onShowInChat = jest.fn();
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <MediaViewer
        visible
        items={[video("one"), video("two")]}
        initialIndex={0}
        requestFor={requestFor}
        onShowInChat={onShowInChat}
        onClose={onClose}
        {...overrides}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { renderer, requestFor, onClose, onShowInChat };
}

describe("#3988 MediaViewer rendered interaction matrix", () => {
  beforeEach(() => {
    mockPlatform.OS = "ios";
    mockWindow.fontScale = 2;
    mockReduceMotion = true;
    mockGestureEnd = null;
    mockUseVideoPlayer.mockClear();
    mockShare.mockReset().mockResolvedValue({});
    mockDownload.mockClear();
    mockDelete.mockClear();
    mockWithSpring.mockClear();
  });

  it("renders fullscreen with one active video player, 44pt actions, large-text bars, share and show-in-chat", async () => {
    const { renderer, onClose, onShowInChat } = await mountViewer();
    const [shell] = renderer.root.findAll((node) => node.type === "ViewerShellProbe");
    expect(shell.props.visible).toBe(true);
    expect(mockUseVideoPlayer).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll((node) => node.type === "VideoViewProbe")).toHaveLength(1);

    const actionNodes = renderer.root.findAll((node) => node.type === "Pressable");
    for (const node of actionNodes) {
      const style = flatten(node.props.style);
      if (style.width !== undefined) expect(Number(style.width)).toBeGreaterThanOrEqual(44);
      if (style.minHeight !== undefined) expect(Number(style.minHeight)).toBeGreaterThanOrEqual(44);
    }
    const largeRows = renderer.root.findAll((node) => flatten(node.props.style).minHeight === 84);
    expect(largeRows.length).toBeGreaterThanOrEqual(1);

    const [share] = renderer.root.findAll((node) => node.props.accessibilityLabel === "viewer.share");
    await TestRenderer.act(async () => {
      await (share.props.onPress as () => Promise<void>)();
    });
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith({ url: "file:///cache/launch.mp4" });
    expect(mockDelete).toHaveBeenCalledTimes(1);

    const [showText] = renderer.root.findAll((node) => node.props.children === "viewer.show_in_chat");
    await TestRenderer.act(async () => (showText.parent?.props.onPress as () => void)());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onShowInChat).toHaveBeenCalledWith("message-one");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("dismisses on a downward swipe and does not spring when Reduce Motion is enabled", async () => {
    const { renderer, onClose } = await mountViewer();
    await TestRenderer.act(async () => mockGestureEnd?.({ translationY: 130, velocityY: 0 }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => mockGestureEnd?.({ translationY: 20, velocityY: 0 }));
    expect(mockWithSpring).not.toHaveBeenCalled();
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("downloads through an authenticated request on web", async () => {
    mockPlatform.OS = "web";
    const originalDocument = globalThis.document;
    const click = jest.fn();
    const anchor = { href: "", download: "", click };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: jest.fn(() => anchor) },
    });
    try {
      const image = { ...video("image"), name: "image.jpg", mime: "image/jpeg", kind: "image" };
      const { renderer, requestFor } = await mountViewer({ items: [image], initialIndex: 0 });
      const [download] = renderer.root.findAll((node) => node.props.accessibilityLabel === "viewer.download");
      await TestRenderer.act(async () => {
        await (download.props.onPress as () => Promise<void>)();
      });
      expect(requestFor).toHaveBeenCalledWith("image", expect.any(Function));
      expect(anchor.href).toBe("https://edge.example/file/image");
      expect(anchor.download).toBe("image.jpg");
      expect(click).toHaveBeenCalledTimes(1);
      await TestRenderer.act(async () => renderer.unmount());
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    }
  });
});
