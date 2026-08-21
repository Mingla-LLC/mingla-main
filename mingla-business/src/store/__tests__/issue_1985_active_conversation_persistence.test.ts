/**
 * Issue #1985 — returning to Ari restores the last active conversation until
 * the user explicitly starts a new one.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AgentConversation } from "../../services/agentChatService";
import {
  ARI_CONVERSATION_SELECTION_STORAGE_KEY,
  ariConversationScopeKey,
  hasStoredAriConversationSelection,
  resolveRestoredAriConversation,
  useAriConversationSelectionStore,
} from "../ariConversationSelectionStore";

const mockMemory = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn((key: string) =>
    Promise.resolve(mockMemory.get(key) ?? null),
  ),
  setItem: jest.fn((key: string, value: string) => {
    mockMemory.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockMemory.delete(key);
    return Promise.resolve();
  }),
}));

const accountA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const brandA = "11111111-1111-4111-8111-111111111111";
const brandB = "22222222-2222-4222-8222-222222222222";
const conversationA = "33333333-3333-4333-8333-333333333333";
const conversationB = "44444444-4444-4444-8444-444444444444";

function conversation(
  id: string,
  brandId: string | null,
  updatedAt: string,
): AgentConversation {
  return {
    id,
    brand_id: brandId,
    title: "Ari plan",
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

describe("#1985 active Ari conversation persistence", () => {
  beforeEach(async () => {
    mockMemory.clear();
    jest.clearAllMocks();
    useAriConversationSelectionStore.setState({
      selections: {},
      hasHydrated: true,
    });
    await useAriConversationSelectionStore.persist.clearStorage();
  });

  it("persists one active pointer per account and brand across rehydration", async () => {
    const scopeA = ariConversationScopeKey(accountA, brandA)!;
    const scopeB = ariConversationScopeKey(accountA, brandB)!;
    const otherAccountScope = ariConversationScopeKey(accountB, brandA)!;

    useAriConversationSelectionStore
      .getState()
      .setSelection(scopeA, conversationA);
    useAriConversationSelectionStore
      .getState()
      .setSelection(scopeB, conversationB);
    useAriConversationSelectionStore
      .getState()
      .setSelection(otherAccountScope, null);

    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      ARI_CONVERSATION_SELECTION_STORAGE_KEY,
      expect.stringContaining(conversationA),
    );

    const raw = mockMemory.get(ARI_CONVERSATION_SELECTION_STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!).state.selections[scopeA]).toBe(conversationA);
    useAriConversationSelectionStore.setState({
      selections: {},
      hasHydrated: false,
    });
    // setState intentionally exercises the live persist middleware, so restore
    // the captured disk blob to simulate a fresh process reading the prior run.
    mockMemory.set(ARI_CONVERSATION_SELECTION_STORAGE_KEY, raw!);
    const hydrated = new Promise<void>((resolve) => {
      const unsubscribe =
        useAriConversationSelectionStore.persist.onFinishHydration(() => {
          unsubscribe();
          resolve();
        });
    });
    await useAriConversationSelectionStore.persist.rehydrate();
    await hydrated;

    const restored = useAriConversationSelectionStore.getState().selections;
    expect(restored[scopeA]).toBe(conversationA);
    expect(restored[scopeB]).toBe(conversationB);
    expect(restored[otherAccountScope]).toBeNull();
  });

  it("treats explicit New conversation as durable null, not as a missing preference", () => {
    const scope = ariConversationScopeKey(accountA, brandA)!;
    const selections = { [scope]: null };
    const visible = [
      conversation(conversationA, brandA, "2026-08-20T12:00:00Z"),
    ];

    expect(hasStoredAriConversationSelection(selections, scope)).toBe(true);
    expect(
      resolveRestoredAriConversation(selections[scope], visible, brandA),
    ).toBeNull();
  });

  it("adopts the newest brand-bound chat only when no preference exists", () => {
    const visible = [
      conversation(conversationA, brandA, "2026-08-20T12:00:00Z"),
      conversation(conversationB, null, "2026-08-20T13:00:00Z"),
    ];

    expect(resolveRestoredAriConversation(undefined, visible, brandA)).toBe(
      conversationA,
    );
  });

  it("fails closed when a stored chat was deleted, hidden by RLS, or belongs to another brand", () => {
    const visible = [
      conversation(conversationB, brandB, "2026-08-20T12:00:00Z"),
    ];
    expect(
      resolveRestoredAriConversation(conversationA, visible, brandA),
    ).toBeNull();
  });

  it("restores a deliberately selected legacy read-only chat without making it writable", () => {
    const legacy = conversation(conversationA, null, "2026-08-20T12:00:00Z");
    expect(
      resolveRestoredAriConversation(conversationA, [legacy], brandA),
    ).toBe(conversationA);
  });

  it("clears every account and brand pointer on sign-out reset", () => {
    const scopeA = ariConversationScopeKey(accountA, brandA)!;
    const scopeB = ariConversationScopeKey(accountB, brandB)!;
    useAriConversationSelectionStore.getState().setSelection(scopeA, conversationA);
    useAriConversationSelectionStore.getState().setSelection(scopeB, conversationB);

    useAriConversationSelectionStore.getState().reset();

    expect(useAriConversationSelectionStore.getState().selections).toEqual({});
  });
});
