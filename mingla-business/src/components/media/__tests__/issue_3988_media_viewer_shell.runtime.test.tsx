import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: "web" };
const mockWindow = { width: 1280, height: 800, fontScale: 2, scale: 2 };
const mockInsets = { top: 31, bottom: 27, left: 0, right: 0 };
let mockReduceMotion = true;
let mockKeyHandler: ((event: { key: string; preventDefault: () => void }) => void) | null = null;

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native");
  return {
    ...base,
    Platform: mockPlatform,
    useWindowDimensions: () => mockWindow,
  };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: true }) }));
jest.mock("../../../hooks/useReducedMotionNative", () => ({ useReducedMotionNative: () => mockReduceMotion }));
jest.mock("../../ui/escapeLayerStack", () => ({ useEscapeLayer: () => () => true }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MediaViewerShell } = require("../MediaViewerShell") as {
  MediaViewerShell: React.ComponentType<Record<string, unknown>>;
};

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; update: (node: React.ReactElement) => void; unmount: () => void }

const flatten = (style: unknown): Record<string, unknown> =>
  (Array.isArray(style) ? style : [style]).filter(Boolean).reduce<Record<string, unknown>>(
    (value, entry) => Object.assign(value, entry),
    {},
  );

describe("#3988 MediaViewerShell rendered geometry and close behavior", () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    mockPlatform.OS = "web";
    mockReduceMotion = true;
    mockKeyHandler = null;
    const opener = { focus: jest.fn() };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        activeElement: opener,
        addEventListener: (name: string, handler: typeof mockKeyHandler) => {
          if (name === "keydown") mockKeyHandler = handler;
        },
        removeEventListener: (name: string, handler: typeof mockKeyHandler) => {
          if (name === "keydown" && mockKeyHandler === handler) mockKeyHandler = null;
        },
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  });

  it("renders safe-area and largest-text geometry, disables animation for Reduce Motion, and handles Escape", async () => {
    const onClose = jest.fn();
    let observedStage: Record<string, unknown> | null = null;
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <MediaViewerShell
          visible
          onClose={onClose}
          topBar={<React.Fragment>top</React.Fragment>}
          bottomBar={<React.Fragment>bottom</React.Fragment>}
        >
          {(stage: Record<string, unknown>) => {
            observedStage = stage;
            return <React.Fragment>stage</React.Fragment>;
          }}
        </MediaViewerShell>,
      );
    });

    const [modal] = renderer.root.findAll((node) => node.type === "Modal");
    expect(modal.props.animationType).toBe("none");
    expect((observedStage as unknown as { width: number }).width).toBeGreaterThan(0);
    expect((observedStage as unknown as { height: number }).height).toBeGreaterThan(0);
    const [topBar] = renderer.root.findAll((node) => flatten(node.props.style).paddingTop === 31);
    const [bottomBar] = renderer.root.findAll((node) => flatten(node.props.style).paddingBottom === 27);
    expect(flatten(topBar.props.style)).toMatchObject({ paddingTop: 31 });
    expect(Number(flatten(topBar.props.style).minHeight)).toBeGreaterThanOrEqual(56);
    expect(flatten(bottomBar.props.style)).toMatchObject({ paddingBottom: 27 });

    const preventDefault = jest.fn();
    mockKeyHandler?.({ key: "Escape", preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("uses native back only for the top layer and restores fade when motion is allowed", async () => {
    mockPlatform.OS = "ios";
    mockReduceMotion = false;
    const onClose = jest.fn();
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <MediaViewerShell visible onClose={onClose}>stage</MediaViewerShell>,
      );
    });
    const [modal] = renderer.root.findAll((node) => node.type === "Modal");
    expect(modal.props.animationType).toBe("fade");
    await TestRenderer.act(async () => (modal.props.onRequestClose as () => void)());
    expect(onClose).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => renderer.unmount());
  });
});
