/**
 * #3355 Wave D (D1) — Ari settings > "What Ari remembers".
 *
 * The list shows every note the caller can read for the active brand (their
 * own, and the brand's shared notes), says who sees each, and deletes through
 * the caller-JWT ari_memory_forget RPC: the author can delete their note, a
 * brand admin a shared one, and a teammate's shared note shows no delete for
 * a member who may not remove it (the server refuses it too; see
 * supabase/migrations/__tests__/issue_3355_ari_memory_notes.implementor.pg17.test.sql).
 */
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
  create: (node: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
};

const mockAlert = jest.fn();
const mockForget = jest.fn((_id: string) => Promise.resolve());
const mockRpc = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ data: { forgotten: true }, error: null }),
);

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: unknown }) =>
      ReactModule.createElement(
        name,
        props,
        typeof children === "function" ? null : children,
      );
  return {
    StyleSheet: { create: (styles: unknown) => styles },
    ActivityIndicator: host("spinner"),
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
    Pressable: host("pressable"),
    Text: host("text"),
    TextInput: host("input"),
    View: host("view"),
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("scroll", null, children),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../constants/designSystem", () => {
  const token: object = new Proxy(
    {},
    { get: (_target, key) => (key === Symbol.toPrimitive ? () => 0 : token) },
  );
  return {
    ariPalette: token,
    ariThread: token,
    canvas: token,
    glass: token,
    radius: token,
    semantic: token,
    spacing: token,
    text: token,
    typography: token,
  };
});
jest.mock("../../../hooks/useAriPreferences", () => ({
  useAriPreferences: () => ({
    profile: null,
    update: jest.fn(),
    deleteAll: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ id: "brand-1", displayName: "Favy Lagos" }),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const NOTES = [
  {
    id: "mine-shared",
    brand_id: "brand-1",
    scope: "brand",
    kind: "correction",
    content: "FAVY10 ends on 19 December 2026.",
    confidence: 1,
    updated_at: "2026-11-10T10:00:00Z",
    mine: true,
    can_forget: true,
  },
  {
    id: "teammate-shared",
    brand_id: "brand-1",
    scope: "brand",
    kind: "preference",
    content: "Use naira prices in captions.",
    confidence: 1,
    updated_at: "2026-11-09T10:00:00Z",
    mine: false,
    can_forget: false,
  },
  {
    id: "mine-private",
    brand_id: null,
    scope: "user",
    kind: "preference",
    content: "Keep replies short.",
    confidence: 1,
    updated_at: "2026-11-08T10:00:00Z",
    mine: true,
    can_forget: true,
  },
];

jest.mock("../../../hooks/useAriKnowledge", () => ({
  useAriKnowledge: () => ({
    memory: NOTES,
    jobs: [],
    isLoading: false,
    refresh: jest.fn(),
    saveMemory: jest.fn(),
    updateMemory: jest.fn(),
    forgetMemory: (id: string) => mockForget(id),
    controlJob: jest.fn(),
    isSaving: false,
    isControllingJob: false,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AriSettingsScreen, memoryNoteAccess } = require("../AriSettingsScreen") as typeof import("../AriSettingsScreen");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { forgetAriMemory } = require("../../../services/ariKnowledgeService") as typeof import("../../../services/ariKnowledgeService");

function textOf(node: Node): string {
  return node.children
    .map((child) =>
      typeof child === "string" ? child : textOf(child as Node)
    )
    .join("");
}

function mount() {
  let r!: ReturnType<typeof TestRenderer.create>;
  void TestRenderer.act(() => {
    r = TestRenderer.create(<AriSettingsScreen />);
  });
  return r;
}

const labelled = (r: ReturnType<typeof mount>, label: string): Node[] =>
  r.root.findAll((n) => n.type === "pressable" && n.props.accessibilityLabel === label);

describe("#3355 Wave D — What Ari remembers", () => {
  beforeEach(() => {
    mockAlert.mockClear();
    mockForget.mockClear();
    mockRpc.mockClear();
  });

  it("lists the readable notes and says who sees each", () => {
    const r = mount();
    const texts = r.root.findAll((n) => n.type === "text").map(textOf);
    expect(texts).toContain("WHAT ARI REMEMBERS · FAVY LAGOS");
    expect(texts).toContain("FAVY10 ends on 19 December 2026.");
    expect(texts).toContain("Use naira prices in captions.");
    expect(texts).toContain("Keep replies short.");
    expect(texts).toContain("Shared with your team");
    expect(texts).toContain("Shared by a teammate");
    expect(texts).toContain("Only you · all brands");
    r.unmount();
  });

  it("offers delete only where the caller may delete", () => {
    expect(memoryNoteAccess(NOTES[1] as never)).toEqual({
      whoSees: "Shared by a teammate",
      canEdit: false,
      canForget: false,
    });
    const r = mount();
    expect(labelled(r, "Delete Correction memory")).toHaveLength(1);
    expect(labelled(r, "Delete Preference memory")).toHaveLength(1);
    expect(labelled(r, "Edit Preference memory")).toHaveLength(1);
    r.unmount();
  });

  it("delete confirms, then forgets the note", async () => {
    const r = mount();
    const [button] = labelled(r, "Delete Correction memory");
    await TestRenderer.act(() => {
      (button.props.onPress as () => void)();
    });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [title, body, actions] = mockAlert.mock.calls[0] as [
      string,
      string,
      { text: string; onPress?: () => Promise<void> }[],
    ];
    expect(title).toBe("Delete this note?");
    expect(body).toMatch(/everyone on the brand/);
    expect(mockForget).not.toHaveBeenCalled();
    await TestRenderer.act(async () => {
      await actions.find((a) => a.text === "Delete")?.onPress?.();
    });
    expect(mockForget).toHaveBeenCalledWith("mine-shared");
    r.unmount();
  });

  it("deletes through the caller's ari_memory_forget RPC", async () => {
    await forgetAriMemory("mine-shared");
    expect(mockRpc).toHaveBeenCalledWith("ari_memory_forget", {
      p_note_id: "mine-shared",
    });
  });
});
