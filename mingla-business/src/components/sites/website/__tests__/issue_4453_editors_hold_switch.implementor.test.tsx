/**
 * #4453 (contract section I, rule 6) — the Website workspace's Story, Review
 * and Destination editors never compared what was typed with the saved copy,
 * so the brand switcher in the workspace bar could open the workspace for
 * another brand and drop the entry being written, with no message.
 *
 * WHAT RUNS: the three real editors and their shared Save / Cancel hook
 * (useEditorChrome), the real useUnsavedChangesGuard counter and the real
 * useWorkspaceBrandSwitch. Reading and saving an entry are played by the test.
 *
 * FAILS-ON-REVERT: remove the `useUnsavedChangesGuard` call from
 * useEditorChrome (or stop an editor passing `changed`) and that editor's
 * "holds the switch" case resolves without a hold or a toast.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/sites/website/__tests__/issue_4453_editors_hold_switch.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
const mockPick = jest.fn();
const mockDoc = { type: "doc", children: [{ type: "paragraph", children: [{ type: "text", text: "Ten strangers on day one." }] }] };
const mockEntries: Record<string, unknown> = {
  stories: { id: "s1", revision: "rev", enabled: false, title: "Lagos in a weekend", category: null, published_at: "2026-10-01", featured_image: null, excerpt: "Two days.", content: mockDoc, seo: { noindex: false } },
  testimonials: { id: "r3", revision: "rev", enabled: false, sort_order: null, thumb_url: null, quote: "Ten strangers on day one.", reviewer: "Alex R.", review_date: "2025-06-27", trip_name: null, related_offering: null, confirmed: false, confirmed_at: null, source_note: "Pasted" },
  destinations: {
    id: "d1", revision: "rev", enabled: false, title: "Zanzibar", slug: "zanzibar", country: "Tanzania", tagline: null, summary: null, featured_image: null,
    gallery: [], story_heading: null, body: null, facts: { language: null, currency: null, timezone: null, religion: null }, seasons: [], did_you_know: [], related_offerings: [], seo: { noindex: false },
  },
};

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("../PhotoField", () => ({ PhotoSlot: () => null, PhotoChooser: () => null }));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../../../../hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));
jest.mock("../../../../sites/contentApi", () => {
  const actual = jest.requireActual("../../../../sites/contentApi") as Record<string, unknown>;
  return {
    ...actual,
    useContentEntry: (_site: string, collection: string, id: string | null) => ({
      isLoading: false, isError: false, data: id === null ? undefined : mockEntries[collection], refetch: jest.fn(),
    }),
    useSaveContentEntry: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
    useContentRowActions: () => ({ remove: { mutate: jest.fn(), isPending: false } }),
    useStoryCategories: () => ({ data: { categories: [] } }),
    useSitePages: () => ({ data: { pages: [] } }),
    useMinglaOfferings: () => ({ isLoading: false, data: [] }),
  };
});

import { TextInput } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { StoryEditor } from "../sections/StoryEditor";
import { ReviewEditor } from "../sections/ReviewEditor";
import { DestinationEditor } from "../sections/DestinationEditor";
import { editorFormChanged } from "../sections/EditorKit";
import { WorkspaceRouteContext } from "../../../ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../../ui/toastStore";
import { unsavedWork } from "../../../../hooks/useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../../../../hooks/useWorkspaceBrandSwitch";
import type { Brand } from "../../../../types/brand";

interface Node { type: unknown; props: Record<string, unknown>; findAll(p: (n: Node) => boolean): Node[] }
type Renderer = { root: Node; unmount(): void };
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): Renderer;
  act(cb: () => void | Promise<void>): Promise<void>;
};

const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos", role: "owner" } as unknown as Brand;
let switchTo: ((brand: Brand) => Promise<WorkspaceBrandSwitchOutcome>) | null = null;
const Switcher = (): null => {
  switchTo = useWorkspaceBrandSwitch({ fromBrandId: "brand-lantern" });
  return null;
};
function context(heldByOther = false): WebsiteContextValue {
  const controller = { user: { id: "u1" }, siteId: "11111111-1111-4111-8111-111111111111", capabilities: { canPublish: true, canEdit: true, canCreate: true } } as unknown as WebsiteContextValue["controller"];
  return {
    brandId: "brand-lantern", brandName: "Lantern Room", controller, phone: false, section: "stories",
    go: jest.fn(), back: jest.fn(), toast: jest.fn(), askAdmin: jest.fn(), asking: false,
    lock: { heldByOther, holderName: null, canTakeOver: true, takeOver: jest.fn(), takingOver: false },
    plan: null,
    previewPreference: { device: "desktop", tablet: "portrait", phone: "portrait" },
    setPreviewPreference: jest.fn(), openFullScreenPreview: jest.fn(), openPreviewSheet: jest.fn(),
    designDirty: false, setDesignDirty: jest.fn(), tokenDeclarations: null, setTokenDeclarations: jest.fn(),
    headingRef: React.createRef(), offerings: ["trips"], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
  } as unknown as WebsiteContextValue;
}
async function mount(editor: React.ReactElement, heldByOther = false): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceRouteContext.Provider value={{ pathname: "/brand/brand-lantern/website/stories", params: { id: "brand-lantern" }, routeBrandId: "brand-lantern", pendingSwitch: { current: null } }}>
          <Switcher />
          <WebsiteProvider value={context(heldByOther)}>{editor}</WebsiteProvider>
        </WorkspaceRouteContext.Provider>
      </QueryClientProvider>,
    );
  });
  return renderer;
}
/** The text box behind a field's testID. */
const box = (r: Renderer, testID: string): Node => {
  const found = r.root.findAll((n) => n.type === TextInput && n.props.testID === testID);
  expect(found.length).toBeGreaterThan(0);
  return found[0]!;
};
const typeInto = async (r: Renderer, testID: string, text: string): Promise<void> =>
  TestRenderer.act(async () => {
    (box(r, testID).props.onChangeText as (v: string) => void)(text);
  });
const pick = async (): Promise<WorkspaceBrandSwitchOutcome> => {
  let outcome!: WorkspaceBrandSwitchOutcome;
  await TestRenderer.act(async () => {
    outcome = await switchTo!(GAMELAND);
  });
  return outcome;
};
const toasts = (): string[] => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  mockReplace.mockClear();
  mockPick.mockClear();
  unsavedWork.screens = 0;
  resetToastStoreForTest();
});

describe.each([
  ["Story (existing)", () => <StoryEditor entryId="s1" />, "story-title", "Lagos in a weekend"],
  ["Story (new)", () => <StoryEditor entryId="new" />, "story-title", ""],
  ["Review (existing)", () => <ReviewEditor entryId="r3" />, "review-reviewer", "Alex R."],
  ["Review (new)", () => <ReviewEditor entryId="new" />, "review-quote", ""],
  ["Destination (existing)", () => <DestinationEditor entryId="d1" />, "destination-country", "Tanzania"],
  ["Destination (new)", () => <DestinationEditor entryId="new" />, "destination-country", ""],
])("#4453 the %s editor holds a brand switch while it differs from the saved copy", (_name, editor, field, saved) => {
  test("typed text holds the switch: the message shows, nothing moves, the text is still there", async () => {
    const r = await mount(editor());
    expect(box(r, field).props.value).toBe(saved);
    expect(unsavedWork.screens).toBe(0);
    await typeInto(r, field, `${saved} and more`);
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    expect(toasts()).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    expect(box(r, field).props.value).toBe(`${saved} and more`);
    await TestRenderer.act(async () => r.unmount());
    expect(unsavedWork.screens).toBe(0);
  });

  test("as opened, or typed back to the saved copy, the switch goes through", async () => {
    const r = await mount(editor());
    await expect(pick()).resolves.not.toBe("held");
    await typeInto(r, field, `${saved}!`);
    expect(unsavedWork.screens).toBe(1);
    await typeInto(r, field, saved);
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    expect(toasts()).toEqual([]);
    await TestRenderer.act(async () => r.unmount());
  });
});

describe("#4453 what counts as changed in a Website editor", () => {
  test("rich text is compared as the site shows it: a rebuilt document with the same words is not a change", () => {
    const rebuilt = JSON.parse(JSON.stringify(mockDoc)) as typeof mockDoc;
    expect(rebuilt).not.toBe(mockDoc);
    expect(editorFormChanged({ title: "A", content: rebuilt }, { title: "A", content: mockDoc })).toBe(false);
    // An emptied document is "no story", the same as none.
    expect(editorFormChanged({ content: { type: "doc", children: [] } }, { content: null })).toBe(false);
    const other = { type: "doc", children: [{ type: "paragraph", children: [{ type: "text", text: "Eleven strangers." }] }] };
    expect(editorFormChanged({ title: "A", content: other }, { title: "A", content: mockDoc })).toBe(true);
    expect(editorFormChanged({ title: "B", content: mockDoc }, { title: "A", content: mockDoc })).toBe(true);
    // Not read yet: nothing to have changed.
    expect(editorFormChanged(null, null)).toBe(false);
    expect(editorFormChanged({ title: "A" }, null)).toBe(false);
  });

  test("an editor someone else holds (read-only) never holds the switch", async () => {
    const r = await mount(<StoryEditor entryId="s1" />, true);
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    await TestRenderer.act(async () => r.unmount());
  });
});
