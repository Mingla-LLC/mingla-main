/**
 * #4304 media speed (D) — the sender's own just-sent video gets a first-frame
 * poster made on the phone (expo-video thumbnail) and MediaThumb draws it while
 * the server thumbnail is pending; other people's pending videos keep the
 * existing "preparing" fallback. The poster never blocks the upload.
 *
 * fails-on-revert (true line deletion): delete the `generateBrandGroupVideoPoster`
 * call in useBrandGroupUploadQueue → the queue case has no poster; delete the
 * `localSource` layer in MediaThumb → the own-video case shows "preparing".
 */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockThumbnailRequest = jest.fn();
const mockPoster = { kind: "decoded-first-frame" };
const mockGeneratePoster = jest.fn(async (): Promise<object> => mockPoster);
const mockUpload = jest.fn(async () => undefined);
const mockFinalize = jest.fn(async () => "m-1");
let mockStatusListener: ((payload: { status: string }) => void) | null = null;
const mockPlayer = {
  status: "readyToPlay",
  addListener: jest.fn((_event: string, listener: (payload: { status: string }) => void) => {
    mockStatusListener = listener;
    return { remove: () => { mockStatusListener = null; } };
  }),
  generateThumbnailsAsync: jest.fn(async () => [mockPoster]),
  release: jest.fn(),
  pause: jest.fn(),
};

jest.mock("react-native", () => jest.requireActual("react-native"));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("../../../i18n", () => ({ useBusinessMediaTranslation: () => ({ t: (key: string) => key, language: "en" }) }));
jest.mock("../../../services/brandGroupFileRequests", () => ({
  brandGroupFileThumbnailRequest: (...args: unknown[]) => mockThumbnailRequest(...args),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../BrandGroupCachedImage", () => ({
  BrandGroupCachedImage: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("CachedImageProbe", props),
}));
jest.mock("../../messages/brandGroupVideoPoster", () => ({
  generateBrandGroupVideoPoster: (...args: unknown[]) => mockGeneratePoster(...(args as [])),
}));
jest.mock("../../../services/brandGroupFilesService", () => ({
  uploadPreparedBrandGroupFile: () => mockUpload(),
  finalizeBrandGroupFile: () => mockFinalize(),
}));
jest.mock("expo-video", () => ({ createVideoPlayer: jest.fn(() => mockPlayer) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
/* eslint-disable @typescript-eslint/no-require-imports */
const { MediaThumb } = require("../MediaThumb") as typeof import("../MediaThumb");
const previews = require("../../messages/brandGroupLocalPreviews") as typeof import("../../messages/brandGroupLocalPreviews");
const { useBrandGroupUploadQueue } = require("../../../hooks/useBrandGroupUploadQueue") as typeof import("../../../hooks/useBrandGroupUploadQueue");
const { generateBrandGroupVideoPoster: nativePoster } = require("../../messages/brandGroupVideoPoster.native") as typeof import("../../messages/brandGroupVideoPoster.native");
const { liveVideoPlayerCountForReload } = require("@mingla/offering-rendering/videoPlayerReloadRelease") as typeof import("@mingla/offering-rendering/videoPlayerReloadRelease");
/* eslint-enable @typescript-eslint/no-require-imports */

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const video = (fileId: string) => ({
  fileId,
  messageId: `m-${fileId}`,
  name: "clip.mp4",
  mime: "video/mp4",
  sizeBytes: 9_000_000,
  createdAt: "2026-11-07T12:00:00.000Z",
  senderDisplayName: "Seth",
  senderRole: "brand",
  kind: "video" as const,
  durationMs: 12_000,
  width: null,
  height: null,
  thumbState: "pending" as const,
});

describe("#4304 media speed — local video poster", () => {
  beforeEach(() => {
    previews.clearBrandGroupLocalPreviews();
    jest.clearAllMocks();
    // Drive has no poster yet: the thumb request never yields an image.
    mockThumbnailRequest.mockReturnValue(new Promise(() => undefined));
  });

  it("draws the sender's own local poster instead of the pending fallback", async () => {
    previews.setBrandGroupLocalPreview("own", { kind: "video", uri: "file:///clip.mp4", poster: mockPoster });
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<MediaThumb item={video("own")} bubble />);
    });
    const [probe] = renderer!.root.findAll((node) => node.type === "CachedImageProbe");
    expect(probe.props.source).toBe(mockPoster);
    expect(renderer!.root.findAll((node) => node.type === "Text" && node.props.children === "media.preparing")).toHaveLength(0);
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("keeps the pending fallback for someone else's video", async () => {
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<MediaThumb item={video("theirs")} bubble />);
    });
    expect(renderer!.root.findAll((node) => node.type === "CachedImageProbe")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.type === "Text" && node.props.children === "media.preparing")).toHaveLength(1);
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("the upload queue makes a poster for a sent video without waiting for it", async () => {
    let release: (value: object) => void = () => undefined;
    mockGeneratePoster.mockImplementationOnce(() => new Promise<object>((resolve) => { release = resolve; }));
    let queue: ReturnType<typeof useBrandGroupUploadQueue> | null = null;
    function Harness(): null {
      queue = useBrandGroupUploadQueue({ messages: [], onUploaded: () => undefined });
      return null;
    }
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<Harness />); });
    await TestRenderer.act(async () => {
      await queue!.enqueue([{
        fileId: "v-1", storagePath: "c/v-1", name: "clip.mp4", mimeType: "video/mp4", sizeBytes: 9_000_000,
        local: { uri: "file:///pick/clip.mp4", name: "clip.mp4", mimeType: "video/mp4", size: 9_000_000 },
      }]);
    });
    // Upload and save finished while the poster was still being made.
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(mockGeneratePoster).toHaveBeenCalledWith("file:///pick/clip.mp4");
    expect(previews.getBrandGroupLocalPreview("v-1")?.poster).toBeNull();
    await TestRenderer.act(async () => { release(mockPoster); await Promise.resolve(); });
    expect(previews.getBrandGroupLocalPreview("v-1")?.poster).toBe(mockPoster);
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("the native generator takes frame 0 and releases its short-lived player", async () => {
    await expect(nativePoster("file:///pick/clip.mp4")).resolves.toBe(mockPoster);
    expect(mockPlayer.generateThumbnailsAsync).toHaveBeenCalledWith([0], { maxWidth: 640, maxHeight: 640 });
    expect(mockPlayer.release).toHaveBeenCalledTimes(1);
    expect(liveVideoPlayerCountForReload()).toBe(0);
  });

  it("waits until the clip has loaded before asking for frame 0", async () => {
    // Simulator smoke test 2026-11-07: asking straight away returned an empty
    // list on iOS, so a just-sent video never got its still.
    mockPlayer.status = "loading";
    mockPlayer.generateThumbnailsAsync.mockClear();
    mockPlayer.addListener.mockClear();
    const pending = nativePoster("file:///pick/clip.mp4");
    for (let tick = 0; tick < 50 && !mockStatusListener; tick += 1) await Promise.resolve();
    expect(mockPlayer.addListener).toHaveBeenCalledWith("statusChange", expect.any(Function));
    expect(mockPlayer.generateThumbnailsAsync).not.toHaveBeenCalled();
    mockStatusListener!({ status: "readyToPlay" });
    await expect(pending).resolves.toBe(mockPoster);
    expect(mockPlayer.generateThumbnailsAsync).toHaveBeenCalledTimes(1);
    expect(mockStatusListener).toBeNull();
    mockPlayer.status = "readyToPlay";
  });
});
