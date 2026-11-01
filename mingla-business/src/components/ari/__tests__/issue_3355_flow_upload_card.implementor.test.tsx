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
  act: (callback: () => void) => void;
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

function mount(kind: "logo" | "cover", onUploaded: () => void, disabled = false) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <AriFlowUploadCard
        kind={kind}
        brandId="b1"
        accountId="u1"
        disabled={disabled}
        onUploaded={onUploaded}
      />,
    );
  });
  return renderer;
}

describe("#3355 in-chat upload card", () => {
  test("logo: the owner opens the Brand details avatar picker; its save asks Ari to check", () => {
    const uploaded = jest.fn();
    const renderer = mount("logo", uploaded);
    const button = renderer.root.findAll((n) => n.type === "button")[0];
    expect(button.props.label).toBe("Upload your logo");
    let sheet = renderer.root.findAll((n) => n.type === "avatar-sheet")[0];
    expect(sheet.props.visible).toBe(false);
    expect(sheet.props.brandId).toBe("b1");
    expect(sheet.props.accountId).toBe("u1");
    expect(sheet.props.existingDescription).toBe("Walks\n\nCoastal walks.");
    TestRenderer.act(() => (button.props.onPress as () => void)());
    sheet = renderer.root.findAll((n) => n.type === "avatar-sheet")[0];
    expect(sheet.props.visible).toBe(true);
    expect(uploaded).not.toHaveBeenCalled();
    TestRenderer.act(() =>
      (sheet.props.onPicked as (r: { publicUrl: string }) => void)({
        publicUrl: "https://cdn.test/logo.png",
      }),
    );
    expect(uploaded).toHaveBeenCalledTimes(1);
    sheet = renderer.root.findAll((n) => n.type === "avatar-sheet")[0];
    expect(sheet.props.visible).toBe(false);
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
