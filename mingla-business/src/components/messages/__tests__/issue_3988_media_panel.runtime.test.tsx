import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: "ios" };
const mockMediaQuery: Record<string, unknown> = {};
const mockFileQuery: Record<string, unknown> = {};
const mockOpenItems = jest.fn();

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const base = jest.requireActual("react-native");
  Object.assign(mockPlatform, { select: base.Platform.select });
  const FlatList = (props: Record<string, unknown>) => {
    const data = (props.data as unknown[]) ?? [];
    const renderItem = props.renderItem as ((info: { item: unknown; index: number }) => React.ReactNode) | undefined;
    return ReactModule.createElement(
      "FlatListProbe",
      props,
      data.map((entry, index) => ReactModule.createElement("ListCell", { key: index }, renderItem?.({ item: entry, index }))),
    );
  };
  const SectionList = (props: Record<string, unknown>) => {
    const sections = (props.sections as { title: string; data: unknown[] }[]) ?? [];
    const renderHeader = props.renderSectionHeader as ((info: { section: { title: string; data: unknown[] } }) => React.ReactNode) | undefined;
    const renderItem = props.renderItem as ((info: { item: unknown; index: number }) => React.ReactNode) | undefined;
    return ReactModule.createElement(
      "SectionListProbe",
      props,
      sections.flatMap((section) => [
        ReactModule.createElement("SectionHeaderCell", { key: `${section.title}-header` }, renderHeader?.({ section })),
        ...section.data.map((entry, index) => ReactModule.createElement("SectionCell", { key: `${section.title}-${index}` }, renderItem?.({ item: entry, index }))),
      ]),
    );
  };
  return { ...base, FlatList, SectionList, Platform: mockPlatform };
});
jest.mock("../../../i18n", () => ({
  useBusinessMediaTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => values?.count === undefined ? key : `${key}:${values.count}`,
    language: "en",
  }),
}));
jest.mock("../../../hooks/useBrandGroupMedia", () => ({
  useBrandGroupMediaPages: (_conversationId: string, kind: string) => kind === "media" ? mockMediaQuery : mockFileQuery,
}));
jest.mock("../../media/MediaThumb", () => ({
  MediaThumb: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("MediaThumbProbe", props),
}));
jest.mock("../BrandGroupFilePreviewModal", () => ({
  BrandGroupFilePreviewModal: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("PreviewProbe", props),
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
const { BrandGroupMediaPanel } = require("../BrandGroupMediaPanel") as {
  BrandGroupMediaPanel: React.ComponentType<Record<string, unknown>>;
};

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  parent?: Node;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const row = {
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

function setQuery(target: Record<string, unknown>, overrides: Record<string, unknown> = {}): void {
  Object.assign(target, {
    data: { pages: [{ rows: [], totals: { media: 0, files: 0 }, nextCursor: null }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isRefetching: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  }, overrides);
}

async function mount(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <BrandGroupMediaPanel
        conversationId="conversation-a"
        groupName="Launch team"
        onOpenItems={mockOpenItems}
        renderThumbnail={(item: unknown) => React.createElement("MediaThumbProbe", { item })}
      />,
    );
  });
  return renderer;
}

describe("#3988 BrandGroupMediaPanel rendered states and paging", () => {
  beforeEach(() => {
    mockPlatform.OS = "ios";
    mockOpenItems.mockReset();
    setQuery(mockMediaQuery);
    setQuery(mockFileQuery);
  });

  it("renders retryable error and empty states from the real panel", async () => {
    const refetch = jest.fn();
    setQuery(mockMediaQuery, { isError: true, refetch });
    const errorRenderer = await mount();
    expect(errorRenderer.root.findAll((node) => node.type === "Text" && node.props.children === "media.load_error")).toHaveLength(1);
    const [retry] = errorRenderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityRole === "button");
    await TestRenderer.act(async () => (retry.props.onPress as () => void)());
    expect(refetch).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => errorRenderer.unmount());

    setQuery(mockMediaQuery);
    const emptyRenderer = await mount();
    expect(emptyRenderer.root.findAll((node) => node.type === "Text" && node.props.children === "Launch team · media.count_photos_videos:0 · media.count_files:0")).toHaveLength(1);
    expect(emptyRenderer.root.findAll((node) => node.type === "Text" && node.props.children === "media.empty_media_title")).toHaveLength(1);
    expect(emptyRenderer.root.findAll((node) => node.type === "Text" && node.props.children === "media.empty_body")).toHaveLength(1);
    await TestRenderer.act(async () => emptyRenderer.unmount());
  });

  it("renders media rows, requests the next keyset page, and opens the selected item", async () => {
    const fetchNextPage = jest.fn();
    setQuery(mockMediaQuery, {
      data: { pages: [{ rows: [row], totals: { media: 1, files: 0 }, nextCursor: { createdAt: row.createdAt, id: row.fileId } }] },
      hasNextPage: true,
      fetchNextPage,
    });
    const renderer = await mount();
    const [sectionList] = renderer.root.findAll((node) => node.type === "SectionListProbe");
    await TestRenderer.act(async () => (sectionList.props.onEndReached as () => void)());
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    const [tile] = renderer.root.findAll((node) => node.props.accessibilityLabel === row.name);
    await TestRenderer.act(async () => (tile.props.onPress as () => void)());
    expect(mockOpenItems).toHaveBeenCalledWith([row], row.fileId);
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("sorts two month sections newest first and does not fetch without a next cursor", async () => {
    const fetchNextPage = jest.fn();
    const september = { ...row, fileId: "file-september", createdAt: "2026-09-05T12:00:00.000Z" };
    const octoberVideo = { ...row, fileId: "file-october", name: "recap.mp4", mime: "video/mp4", kind: "video", durationMs: 65_000, createdAt: "2026-10-05T12:00:00.000Z" };
    setQuery(mockMediaQuery, {
      data: { pages: [{ rows: [september, octoberVideo], totals: { media: 2, files: 0 }, nextCursor: null }] },
      hasNextPage: false,
      fetchNextPage,
    });
    const renderer = await mount();
    const [sectionList] = renderer.root.findAll((node) => node.type === "SectionListProbe");
    const sectionTitles = (sectionList.props.sections as { title: string }[]).map((section) => section.title);
    expect(sectionTitles).toEqual(["October 2026", "September 2026"]);
    expect((sectionList.props.sections as { data: unknown[][] }[])[0].data[0]).toEqual([octoberVideo]);
    await TestRenderer.act(async () => (sectionList.props.onEndReached as () => void)());
    expect(fetchNextPage).not.toHaveBeenCalled();
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("renders a loading skeleton and switches to the files list at runtime", async () => {
    setQuery(mockMediaQuery, { isLoading: true });
    setQuery(mockFileQuery, {
      data: { pages: [{ rows: [{ ...row, fileId: "file-pdf", name: "brief.pdf", mime: "application/pdf", kind: "file", thumbState: "none" }], totals: { media: 0, files: 1 }, nextCursor: null }] },
    });
    const renderer = await mount();
    expect(renderer.root.findAll((node) => node.type === "ActivityIndicator")).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.type === "View" && Boolean(node.props.style) && JSON.stringify(node.props.style).includes("32.7%"))).toHaveLength(12);

    const tabs = renderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityRole === "tab");
    await TestRenderer.act(async () => (tabs[1].props.onPress as () => void)());
    expect(renderer.root.findAll((node) => node.type === "FlatListProbe")).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel === "brief.pdf")).toHaveLength(1);
    const [fileName] = renderer.root.findAll((node) => node.type === "Text" && node.props.children === "brief.pdf");
    expect(fileName.props.ellipsizeMode).toBe("middle");
    await TestRenderer.act(async () => renderer.unmount());
  });
});
