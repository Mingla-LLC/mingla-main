import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../i18n", () => ({
  useBusinessMediaTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => key === "format.kb" ? `${values?.n} KB` : key,
    language: "en",
  }),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandGroupMediaBubble } = require("../BrandGroupMediaBubble") as {
  BrandGroupMediaBubble: React.ComponentType<Record<string, unknown>>;
};

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

describe("#3988 rendered brand-group media chat bubble", () => {
  it("renders the authorized thumbnail body and localized file footer used by the live thread", async () => {
    const item = {
      fileId: "file-a",
      messageId: "message-a",
      name: "launch.jpg",
      mime: "image/jpeg",
      sizeBytes: 2048,
      createdAt: "2026-10-24T12:00:00.000Z",
      senderDisplayName: "Seth",
      senderRole: "brand",
      kind: "image",
      durationMs: null,
      width: 1200,
      height: 800,
      thumbState: "ready",
    };
    let renderer!: Renderer;
    const renderThumbnail = (mediaItem: Record<string, unknown>, style: unknown, bubble?: boolean): React.ReactNode =>
      React.createElement("MediaThumbProbe", { item: mediaItem, style, bubble });
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <BrandGroupMediaBubble item={item} name="launch.jpg" sizeBytes={2048} mine renderThumbnail={renderThumbnail} />,
      );
    });

    const [thumb] = renderer.root.findAll((node) => node.type === "MediaThumbProbe");
    expect(thumb.props.item).toBe(item);
    expect(thumb.props.bubble).toBe(true);
    const text = renderer.root.findAll((node) => node.type === "Text")
      .flatMap((node) => node.children.filter((child): child is string => typeof child === "string"))
      .join("");
    expect(text).toContain("launch.jpg");
    expect(text).toContain("2 KB");
    await TestRenderer.act(async () => renderer.unmount());
  });
});
