/*
 * #4575 — the "Grid options" card in Website design (the section and the
 * workspace Design panel):
 *  - it shows on Grid only;
 *  - "Index sheet" and "As designed" store nothing; "Full-screen photo",
 *    "Full colour" and "Black and white" store their values;
 *  - both saves send `designOptions` with the colours unchanged, and only
 *    when the options changed.
 */
import React from "react";

const mockSaveLook = jest.fn();
const mockSetSiteLook = jest.fn();
let mockLook: Record<string, unknown> = { design: "grid", tokens: {}, fonts: {}, designOptions: {}, revision: "r1" };

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("../../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { id: "b", displayName: "Kola", theme: null, tagline: "", bio: "" } }),
  useUpdateBrand: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("../../../../hooks/useBrandSite", () => ({
  useBrandSiteLook: () => ({ isLoading: false, isError: false, data: mockLook, refetch: jest.fn() }),
  useSaveBrandSiteLook: () => ({ mutate: mockSaveLook, isPending: false }),
  // #4572 item 16 — the Logo row in Design.
  useSaveBrandSiteLogo: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../../sites/contentApi", () => {
  const actual = jest.requireActual("../../../../sites/contentApi");
  return {
    ...actual,
    setSiteLook: (...args: unknown[]) => mockSetSiteLook(...args),
    useSiteCover: () => ({ isLoading: false, data: { available: false, revision: null, photo: null, video: null } }),
    useSetSiteCover: () => ({ mutate: jest.fn(), isPending: false }),
    useFontSearch: () => ({ isLoading: false, isError: false, data: [] }),
    useFontPreviews: () => ({ data: [] }),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { DesignOptionsCard, DesignSection } from "../sections/DesignSection";
import { DesignPanel } from "../workspace/DesignPanel";
import { AUTOSAVE_IDLE_MS } from "../../../../sites/draftWriter";
import { DESIGNS, type DesignOptions } from "../../../../../../packages/site-contracts/src/designs.ts";
import type { Workspace } from "../workspace/useWorkspace";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };

const textOf = (root: Root): string => root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
  .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
const pressable = (root: Root, id: string) => root.findAll((node) => node.props.testID === id && typeof node.props.onPress === "function")[0];
const press = (root: Root, id: string) => {
  const target = pressable(root, id);
  if (!target) throw new Error(`no ${id}`);
  act(() => { (target.props.onPress as () => void)(); });
};

function context(): WebsiteContextValue {
  const controller = { user: { id: "u1" }, siteId: "s1", site: { data: null }, capabilities: { canPublish: true, canEdit: true, canCreate: true } } as unknown as WebsiteContextValue["controller"];
  return {
    brandId: "b", brandName: "Kola", controller, phone: false, section: "design",
    go: jest.fn(), back: jest.fn(), toast: jest.fn(), askAdmin: jest.fn(), asking: false,
    lock: { heldByOther: false, holderName: null, canTakeOver: true, takeOver: jest.fn(), takingOver: false },
    plan: null,
    previewPreference: { device: "desktop", tablet: "portrait", phone: "portrait" },
    setPreviewPreference: jest.fn(), openFullScreenPreview: jest.fn(), openPreviewSheet: jest.fn(),
    designDirty: false, setDesignDirty: jest.fn(), tokenDeclarations: null, setTokenDeclarations: jest.fn(),
    headingRef: React.createRef(), offerings: ["events"], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
  } as unknown as WebsiteContextValue;
}

function mount(node: React.ReactElement) {
  const value = context();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<QueryClientProvider client={new QueryClient()}><WebsiteProvider value={value}>{node}</WebsiteProvider></QueryClientProvider>);
  });
  return { root: tree.root, value, unmount: () => tree.unmount() };
}

beforeEach(() => {
  mockSaveLook.mockReset();
  mockSetSiteLook.mockReset();
  mockLook = { design: "grid", tokens: { colors: { canvas: "#fffaf0" } }, fonts: {}, designOptions: {}, revision: "r1" };
});

describe("#4575 DesignOptionsCard", () => {
  it("renders only on a design that offers options (Grid)", () => {
    const onOptions = jest.fn();
    const grid = mount(<DesignOptionsCard design={DESIGNS.grid} options={{}} onOptions={onOptions} disabled={false} />);
    expect(grid.root.findAll((node) => node.props.testID === "design-options").length).toBeGreaterThan(0);
    expect(textOf(grid.root)).toContain("Grid options");
    expect(textOf(grid.root)).toContain("Top of the page");
    for (const key of ["voyage", "atelier", "terra", "pop"] as const) {
      const other = mount(<DesignOptionsCard design={DESIGNS[key]} options={{}} onOptions={onOptions} disabled={false} />);
      expect([key, other.root.findAll((node) => node.props.testID === "design-options").length]).toEqual([key, 0]);
    }
  });

  it("maps each choice to the stored value; Index sheet and As designed store nothing", () => {
    const seen: DesignOptions[] = [];
    const card = (options: DesignOptions) => mount(<DesignOptionsCard design={DESIGNS.grid} options={options} onOptions={(next) => seen.push(next)} disabled={false} />).root;
    press(card({}), "option-cover-full");
    press(card({ cover: "full", photos: "mono" }), "option-cover-index");
    press(card({}), "option-photos-colour");
    press(card({}), "option-photos-mono");
    press(card({ cover: "full", photos: "colour" }), "option-photos-design");
    expect(seen).toEqual([{ cover: "full" }, { photos: "mono" }, { photos: "colour" }, { photos: "mono" }, { cover: "full" }]);
  });

  it("is read-only while someone else holds the lock", () => {
    const { root } = mount(<DesignOptionsCard design={DESIGNS.grid} options={{}} onOptions={jest.fn()} disabled />);
    expect(pressable(root, "option-cover-full")).toBeUndefined();
  });
});

describe("#4575 Website design section", () => {
  const saveAction = (value: WebsiteContextValue) => {
    const calls = (value.setStickyBar as jest.Mock).mock.calls.filter(([bar]) => bar);
    const bar = calls.at(-1)?.[0] as { actions: Array<{ testID: string; onPress: () => void }> } | undefined;
    return bar?.actions.find((action) => action.testID === "design-save");
  };

  it("shows the card on Grid and not on Voyage", () => {
    expect(mount(<DesignSection />).root.findAll((node) => node.props.testID === "design-options").length).toBeGreaterThan(0);
    mockLook = { ...mockLook, design: "voyage" };
    expect(mount(<DesignSection />).root.findAll((node) => node.props.testID === "design-options")).toHaveLength(0);
  });

  it("Full-screen photo saves design_options and keeps the colours exactly", () => {
    const { root, value } = mount(<DesignSection />);
    press(root, "option-cover-full");
    expect(value.setDesignDirty).toHaveBeenLastCalledWith(true);
    act(() => { saveAction(value)!.onPress(); });
    expect(mockSaveLook).toHaveBeenCalledTimes(1);
    const input = mockSaveLook.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.designOptions).toEqual({ cover: "full" });
    expect(input.tokens).toEqual({ colors: { canvas: "#fffaf0" } });
    expect(input).not.toHaveProperty("design");
  });

  it("a save that does not touch the options does not send them", () => {
    mockLook = { ...mockLook, designOptions: { cover: "full" } };
    const { root, value } = mount(<DesignSection />);
    // Back to the stored value: nothing to save.
    press(root, "option-cover-index");
    press(root, "option-cover-full");
    expect(value.setDesignDirty).toHaveBeenLastCalledWith(false);
    press(root, "shape-radius-soft");
    act(() => { saveAction(value)!.onPress(); });
    expect(mockSaveLook.mock.calls[0]![0]).not.toHaveProperty("designOptions");
  });
});

describe("#4575 workspace Design panel", () => {
  const workspace = (): Workspace => ({
    siteId: "s1", readOnly: false, readOnlyReason: null, workspace: { look_revision: "r1" },
    afterChange: jest.fn(), notify: jest.fn(),
  } as unknown as Workspace);

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("a pick autosaves design_options with the colours unchanged", async () => {
    mockSetSiteLook.mockResolvedValue({ look_revision: "r2", warnings: [] });
    const { root } = mount(<DesignPanel ws={workspace()} onAskAri={jest.fn()} />);
    expect(root.findAll((node) => node.props.testID === "design-options").length).toBeGreaterThan(0);
    press(root, "option-photos-colour");
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_IDLE_MS + 10); });
    expect(mockSetSiteLook).toHaveBeenCalledTimes(1);
    const input = mockSetSiteLook.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.designOptions).toEqual({ photos: "colour" });
    expect(input.tokens).toEqual({ colors: { canvas: "#fffaf0" } });
    expect(input).not.toHaveProperty("design");
  });

  it("a colour change alone does not send the options", async () => {
    mockLook = { ...mockLook, designOptions: { cover: "full" } };
    mockSetSiteLook.mockResolvedValue({ look_revision: "r2", warnings: [] });
    const { root } = mount(<DesignPanel ws={workspace()} onAskAri={jest.fn()} />);
    press(root, "shape-radius-soft");
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_IDLE_MS + 10); });
    expect(mockSetSiteLook).toHaveBeenCalledTimes(1);
    expect(mockSetSiteLook.mock.calls[0]![1]).not.toHaveProperty("designOptions");
  });

  it("not on Voyage", () => {
    mockLook = { ...mockLook, design: "voyage" };
    const { root } = mount(<DesignPanel ws={workspace()} onAskAri={jest.fn()} />);
    expect(root.findAll((node) => node.props.testID === "design-options")).toHaveLength(0);
  });
});
