/**
 * #3355 — the in-chat upload card on Ari's logo / cover handoffs (Seth,
 * 2026-11-01). The owner picks the file through Brand details' own pickers;
 * only once the pipeline has saved it does the card ask Ari to check. A
 * removed cover (no file) never claims an upload.
 */
import React from "react";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
};

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    StyleSheet: { create: (styles: unknown) => styles },
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement("text", props, children),
    View: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement("view", props, children),
  };
});
jest.mock("../../../constants/designSystem", () => ({
  spacing: { sm: 8 },
  text: { secondary: "grey" },
  typography: { bodySm: { fontSize: 13 } },
}));
const brandState: { data: Record<string, unknown> | null; isLoading: boolean } = {
  data: {
    id: "b1",
    tagline: "Walks",
    bio: "Coastal walks.",
    photo: undefined,
    coverMediaUrl: undefined,
  },
  isLoading: false,
};
const invalidateQueries = jest.fn(() => Promise.resolve());
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => brandState,
}));
jest.mock("../../../services/brandMapping", () => ({
  joinBrandDescription: (t?: string, b?: string) =>
    [t, b].filter(Boolean).join("\n\n") || null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("button", props),
}));
jest.mock("../../brand/BrandAvatarPickerSheet", () => ({
  BrandAvatarPickerSheet: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("avatar-sheet", props),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({
  CoverPickerSheet: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("cover-sheet", props),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AriFlowUploadCard } = require("../AriFlowUploadCard") as typeof import("../AriFlowUploadCard");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ARI_FLOW_UPLOAD_COPY } = require("../ariFlowCards") as typeof import("../ariFlowCards");

function mount(kind: "logo" | "cover", onUploaded: () => void, disabled = false) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <AriFlowUploadCard
        kind={kind}
        copy={ARI_FLOW_UPLOAD_COPY[kind]}
        brandId="b1"
        accountId="u1"
        disabled={disabled}
        onUploaded={onUploaded}
      />,
    );
  });
  return renderer;
}

/**
 * The logo picker loads through its lazy owner when the owner opens it
 * (#3493), so press "Upload your logo" and let the lazy chunk resolve.
 */
async function openLogoSheet(renderer: ReturnType<typeof TestRenderer.create>): Promise<Node> {
  const button = renderer.root.findAll((n) => n.type === "button")[0];
  await TestRenderer.act(async () => {
    (button.props.onPress as () => void)();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer.root.findAll((n) => n.type === "avatar-sheet")[0];
}

const invalidatedKeys = (): string[] =>
  invalidateQueries.mock.calls.map((call) =>
    JSON.stringify((call as unknown as [{ queryKey: unknown }])[0].queryKey),
  );

describe("#3355 in-chat upload card", () => {
  beforeEach(() => invalidateQueries.mockClear());

  test("bug 15: a logo save refreshes the brand, its readiness and the Website setup pane", async () => {
    const uploaded = jest.fn();
    const renderer = mount("logo", uploaded);
    const sheet = await openLogoSheet(renderer);
    TestRenderer.act(() =>
      (sheet.props.onPicked as (r: { publicUrl: string }) => void)({
        publicUrl: "https://cdn.test/logo.png",
      }),
    );
    // Readiness keys are nested under the brand detail; the pane's key is
    // nested under the plan, so these two prefixes reach both.
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        JSON.stringify(["brands", "detail", "b1"]),
        JSON.stringify(["brand-sites", "b1", "plan"]),
      ]),
    );
    renderer.unmount();
  });

  test("bug 15: a cover save refreshes them too; a removal does not", () => {
    const renderer = mount("cover", jest.fn());
    const sheet = renderer.root.findAll((n) => n.type === "cover-sheet")[0];
    const change = sheet.props.onCoverChange as (patch: unknown) => void;
    TestRenderer.act(() => change({ coverMediaUrl: null }));
    expect(invalidateQueries).not.toHaveBeenCalled();
    TestRenderer.act(() =>
      change({ coverMediaUrl: "https://cdn.test/cover.png", coverMediaType: "image" }),
    );
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        JSON.stringify(["brands", "detail", "b1"]),
        JSON.stringify(["brand-sites", "b1", "plan"]),
      ]),
    );
    renderer.unmount();
  });

  test("bug 15: who is on setup refreshes with the plan; the key comes from the factory", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { brandSiteKeys } = require("../../../sites/brandSiteKeys") as typeof import("../../../sites/brandSiteKeys");
    expect(brandSiteKeys.flowState("b1").slice(0, 3)).toEqual([...brandSiteKeys.plan("b1")]);
  });

  test("logo: the owner opens the Brand details avatar picker; its save asks Ari to check", async () => {
    const uploaded = jest.fn();
    const renderer = mount("logo", uploaded);
    const button = renderer.root.findAll((n) => n.type === "button")[0];
    expect(button.props.label).toBe("Upload your logo");
    // Not loaded or mounted until the owner opens it.
    expect(renderer.root.findAll((n) => n.type === "avatar-sheet")).toHaveLength(0);
    const sheet = await openLogoSheet(renderer);
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.brandId).toBe("b1");
    expect(sheet.props.accountId).toBe("u1");
    expect(sheet.props.existingDescription).toBe("Walks\n\nCoastal walks.");
    expect(uploaded).not.toHaveBeenCalled();
    TestRenderer.act(() =>
      (sheet.props.onPicked as (r: { publicUrl: string }) => void)({
        publicUrl: "https://cdn.test/logo.png",
      }),
    );
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll((n) => n.type === "avatar-sheet")).toHaveLength(0);
    renderer.unmount();
  });

  test("cover: the brand cover picker (brand target); a removal never claims an upload", () => {
    const uploaded = jest.fn();
    const renderer = mount("cover", uploaded);
    const sheet = renderer.root.findAll((n) => n.type === "cover-sheet")[0];
    expect((sheet.props.target as { kind: string }).kind).toBe("brand");
    const change = sheet.props.onCoverChange as (patch: unknown) => void;
    TestRenderer.act(() => change({ coverMediaUrl: null }));
    expect(uploaded).not.toHaveBeenCalled();
    TestRenderer.act(() =>
      change({ coverMediaUrl: "https://cdn.test/cover.png", coverMediaType: "image" }),
    );
    expect(uploaded).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  test("offline or not current: the upload button is disabled", () => {
    const renderer = mount("logo", jest.fn(), true);
    const button = renderer.root.findAll((n) => n.type === "button")[0];
    expect(button.props.disabled).toBe(true);
    renderer.unmount();
  });
});
