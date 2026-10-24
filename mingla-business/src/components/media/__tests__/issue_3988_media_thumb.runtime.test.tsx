import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: "ios" };
const mockInvalidateQueries = jest.fn();
const mockThumbnailRequest = jest.fn();

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native");
  Object.assign(mockPlatform, { select: base.Platform.select });
  return { ...base, Platform: mockPlatform };
});
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("expo-image", () => ({
  Image: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ImageProbe", props),
}));
jest.mock("../../../services/brandGroupMediaService", () => ({
  thumbnailRequest: (...args: unknown[]) => mockThumbnailRequest(...args),
}));
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
const { MediaThumb } = require("../MediaThumb") as { MediaThumb: React.ComponentType<{ item: MediaRow }> };

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}
interface Renderer { root: TestNode; update: (node: React.ReactElement) => void; unmount: () => void }
interface MediaRow {
  fileId: string;
  messageId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
  senderDisplayName: string;
  senderRole: string;
  kind: "image" | "video" | "file";
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbState: "pending" | "ready" | "none";
}

const item = (fileId: string, thumbState: MediaRow["thumbState"]): MediaRow => ({
  fileId,
  messageId: `message-${fileId}`,
  name: `${fileId}.jpg`,
  mime: "image/jpeg",
  sizeBytes: 123,
  createdAt: "2026-10-24T12:00:00.000Z",
  senderDisplayName: "Seth",
  senderRole: "brand",
  kind: "image",
  durationMs: null,
  width: 800,
  height: 600,
  thumbState,
});

describe("#3988 MediaThumb runtime cache and pending resolution", () => {
  beforeEach(() => {
    mockPlatform.OS = "ios";
    mockInvalidateQueries.mockReset();
    mockThumbnailRequest.mockReset().mockResolvedValue({
      uri: "https://edge.example/thumb?token=secret",
      headers: { Authorization: "Bearer secret" },
    });
  });

  it("uses an identity-safe native cache key and refetches metadata while a successful poster stays pending", async () => {
    jest.useFakeTimers();
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<MediaThumb item={item("file-a", "pending")} />);
      await Promise.resolve();
    });

    const [image] = renderer!.root.findAll((node) => node.type === "ImageProbe");
    expect(image.props.source).toMatchObject({ cacheKey: "bgthumb:file-a" });
    expect(mockThumbnailRequest).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["brandGroupMedia"] });
    expect(mockThumbnailRequest).toHaveBeenCalledTimes(2);
    await TestRenderer.act(async () => renderer!.unmount());
    jest.useRealTimers();
  });

  it("revokes a web object URL immediately when the thumb unmounts", async () => {
    mockPlatform.OS = "web";
    const originalFetch = globalThis.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const revokeObjectURL = jest.fn();
    URL.createObjectURL = jest.fn(() => "blob:file-a");
    URL.revokeObjectURL = revokeObjectURL;
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["thumb"]),
    })) as unknown as typeof fetch;
    let renderer: Renderer | null = null;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(<MediaThumb item={item("file-a", "ready")} />);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

      await TestRenderer.act(async () => renderer!.unmount());
      renderer = null;
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a");
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer!.unmount());
      globalThis.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it("expires a mounted web thumbnail after 24 hours before authorizing a replacement", async () => {
    mockPlatform.OS = "web";
    const originalFetch = globalThis.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const revokeObjectURL = jest.fn();
    URL.createObjectURL = jest.fn()
      .mockReturnValueOnce("blob:file-a:first")
      .mockReturnValueOnce("blob:file-a:replacement");
    URL.revokeObjectURL = revokeObjectURL;
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["thumb"]),
    })) as unknown as typeof fetch;
    let first: Renderer | null = null;
    let replacement: Renderer | null = null;
    try {
      await TestRenderer.act(async () => {
        first = TestRenderer.create(<MediaThumb item={item("file-a", "ready")} />);
        for (let attempt = 0; attempt < 3; attempt += 1) await new Promise<void>((resolve) => setImmediate(resolve));
      });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000 + 86_400_001);
      await TestRenderer.act(async () => {
        replacement = TestRenderer.create(<MediaThumb item={item("file-a", "ready")} />);
        for (let attempt = 0; attempt < 3; attempt += 1) await new Promise<void>((resolve) => setImmediate(resolve));
      });

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a:first");
      await TestRenderer.act(async () => replacement!.unmount());
      replacement = null;
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a:replacement");
    } finally {
      if (replacement) await TestRenderer.act(async () => replacement!.unmount());
      if (first) await TestRenderer.act(async () => first!.unmount());
      now.mockRestore();
      globalThis.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
