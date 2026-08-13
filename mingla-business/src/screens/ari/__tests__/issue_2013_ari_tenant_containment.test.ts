// #2013 append-only shared Business iOS/Android/web behavior proof.
import React from "react";

const mockInvoke = jest.fn();
const mockUseQuery = jest.fn();
const mockQueryClient = {
  setQueriesData: jest.fn(),
  invalidateQueries: jest.fn(),
};

jest.mock("../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
  useQueryClient: () => mockQueryClient,
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

jest.mock("../../../components/ui/Sheet", () => {
  const ReactActual = require("react") as typeof React;
  return {
    Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? ReactActual.createElement("MockSheet", null, children) : null,
  };
});

jest.mock("lucide-react-native", () => {
  const ReactActual = require("react") as typeof React;
  return {
    AlertTriangle: (props: Record<string, unknown>) =>
      ReactActual.createElement("AlertTriangle", props),
  };
});

import {
  sendAgentMessage,
  type AgentConversation,
} from "../../../services/agentChatService";
import { ConversationDrawer } from "../../../components/ari/ConversationDrawer";
import { useConversationList } from "../../../hooks/useConversationList";

const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const conversations: AgentConversation[] = [
  {
    id: "scoped-a",
    title: "Mingla Nigeria plan",
    brand_id: "brand-a",
    created_at: "2026-08-13T10:00:00.000Z",
    updated_at: "2026-08-13T10:00:00.000Z",
  },
  {
    id: "foreign-b",
    title: "Foreign public brand",
    brand_id: "brand-b",
    created_at: "2026-08-13T09:00:00.000Z",
    updated_at: "2026-08-13T09:00:00.000Z",
  },
  {
    id: "legacy",
    title: "Older planning chat",
    brand_id: null,
    created_at: "2026-08-12T10:00:00.000Z",
    updated_at: "2026-08-12T10:00:00.000Z",
  },
];

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") {
    return textOf((value as { children?: unknown }).children ?? []);
  }
  return "";
}

describe("#2013 Ari tenant-containment UI behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: conversations,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  test("the edge request carries the selected brand and preserves typed recovery metadata", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        context: new Response(JSON.stringify({
          kind: "error",
          code: "CONVERSATION_BRAND_MISMATCH",
          message: "This conversation belongs to a different brand.",
          retry_after_seconds: 7,
          cooldown_until: "2026-08-13T10:00:07.000Z",
        }), { status: 409 }),
      },
    });

    const result = await sendAgentMessage({
      conversation_id: "conversation-a",
      message: "Continue planning",
      brand_id: "brand-a",
    });

    expect(mockInvoke).toHaveBeenCalledWith("agent-chat", {
      body: {
        conversation_id: "conversation-a",
        message: "Continue planning",
        brand_id: "brand-a",
      },
    });
    expect(result).toEqual({
      kind: "error",
      code: "CONVERSATION_BRAND_MISMATCH",
      message: "This conversation belongs to a different brand.",
      retry_after_seconds: 7,
      cooldown_until: "2026-08-13T10:00:07.000Z",
    });
  });

  test("the selected-brand conversation hook excludes a foreign bound thread but keeps legacy history", () => {
    let latest: ReturnType<typeof useConversationList> = {
      conversations: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    };
    const Probe = (): null => {
      latest = useConversationList("brand-a");
      return null;
    };

    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(React.createElement(Probe));
    });

    expect(latest.conversations.map((conversation) => conversation.id)).toEqual([
      "scoped-a",
      "legacy",
    ]);
    expect(mockUseQuery.mock.calls[0][0].queryKey).toEqual([
      "ari",
      "conversations",
      "brand-a",
    ]);
    TestRenderer.act(() => tree.unmount());
  });

  test("the drawer renders scoped and legacy sections, marks legacy read-only, and retries failures", () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const onRetry = jest.fn();
    const filtered = conversations.filter((conversation) =>
      conversation.brand_id === null || conversation.brand_id === "brand-a"
    );

    let tree: any;
    TestRenderer.act(() => {
      tree = TestRenderer.create(React.createElement(ConversationDrawer, {
        visible: true,
        onClose,
        conversations: filtered,
        activeId: "scoped-a",
        onSelect,
        selectedBrandName: "Mingla Nigeria",
        hasSelectedBrand: true,
        isLoading: false,
        isError: false,
        onRetry,
      }));
    });

    const rendered = textOf(tree.toJSON());
    expect(rendered).toMatch(/Mingla Nigeria\s+chats/);
    expect(rendered).toContain("Mingla Nigeria plan");
    expect(rendered).toContain("Older chats · Read-only");
    expect(rendered).toContain("Older planning chat");
    expect(rendered).not.toContain("Foreign public brand");
    expect(tree.root.findAllByType("AlertTriangle")).toHaveLength(1);
    expect(tree.root.findAll((node: any) =>
      node.props.accessibilityLabel?.includes("older read-only conversation")
    ).length).toBeGreaterThan(0);

    TestRenderer.act(() => {
      tree.update(React.createElement(ConversationDrawer, {
        visible: true,
        onClose,
        conversations: [],
        activeId: null,
        onSelect,
        selectedBrandName: "Mingla Nigeria",
        hasSelectedBrand: true,
        isLoading: false,
        isError: true,
        onRetry,
      }));
    });
    expect(textOf(tree.toJSON())).toContain("Could not load conversations.");
    const retry = tree.root.findAll((node: any) =>
      typeof node.props.onPress === "function" && textOf(node).includes("Try again")
    )[0];
    expect(retry).toBeDefined();
    TestRenderer.act(() => retry.props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => tree.unmount());
  });
});
