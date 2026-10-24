import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPreviewRequest = jest.fn();

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native");
  return { ...base, Platform: { ...base.Platform, OS: "web" } };
});
jest.mock("../../../services/brandGroupFilesService", () => ({
  brandGroupFilePreviewRequest: (...args: unknown[]) => mockPreviewRequest(...args),
}));
jest.mock("../../media/MediaViewer", () => ({
  MediaViewer: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ViewerProbe", props),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandGroupFilePreviewModal } = require("../BrandGroupFilePreviewModal") as {
  BrandGroupFilePreviewModal: React.ComponentType<Record<string, unknown>>;
};

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const media = (fileId: string) => ({
  fileId,
  messageId: `message-${fileId}`,
  name: `${fileId}.jpg`,
  mime: "image/jpeg",
  sizeBytes: 120,
  createdAt: "2026-10-24T12:00:00.000Z",
  senderDisplayName: "Seth",
  senderRole: "brand",
  kind: "image",
  durationMs: null,
  width: 1200,
  height: 800,
  thumbState: "ready",
});

describe("#3988 BrandGroupFilePreviewModal rendered blob lifecycle", () => {
  it("opens, moves the active window, closes, and rejects a blob that finishes after close", async () => {
    const originalFetch = globalThis.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let finishLateBlob!: (blob: Blob) => void;
    const lateBlob = new Promise<Blob>((resolve) => { finishLateBlob = resolve; });
    const revokeObjectURL = jest.fn();
    URL.createObjectURL = jest.fn()
      .mockReturnValueOnce("blob:file-1")
      .mockReturnValueOnce("blob:file-3-late");
    URL.revokeObjectURL = revokeObjectURL;
    mockPreviewRequest.mockImplementation(async (fileId: string) => ({
      uri: `https://edge.example/file/${fileId}`,
      headers: { Authorization: "Bearer secret" },
    }));
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      body: null,
      headers: { get: () => null },
      blob: () => String(input).endsWith("file-3") ? lateBlob : Promise.resolve(new Blob(["one"])),
    })) as unknown as typeof fetch;
    const onClose = jest.fn();
    let renderer!: Renderer;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          <BrandGroupFilePreviewModal
            items={[media("file-0"), media("file-1"), media("file-2"), media("file-3")]}
            initialFileId="file-1"
            onClose={onClose}
          />,
        );
      });
      const [viewer] = renderer.root.findAll((node) => node.type === "ViewerProbe");
      await expect((viewer.props.requestFor as (fileId: string) => Promise<unknown>)("file-1")).resolves.toMatchObject({ uri: "blob:file-1" });

      await TestRenderer.act(async () => (viewer.props.onActiveIndexChange as (index: number) => void)(3));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-1");

      const finishingAfterClose = (viewer.props.requestFor as (fileId: string) => Promise<unknown>)("file-3");
      await TestRenderer.act(async () => (viewer.props.onClose as () => void)());
      expect(onClose).toHaveBeenCalledTimes(1);
      finishLateBlob(new Blob(["late"]));
      await expect(finishingAfterClose).rejects.toThrow("no longer active");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-3-late");
      await TestRenderer.act(async () => renderer.unmount());
    } finally {
      globalThis.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
