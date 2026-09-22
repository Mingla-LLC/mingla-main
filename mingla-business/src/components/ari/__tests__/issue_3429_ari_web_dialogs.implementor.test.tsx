/**
 * #3429 REWORK-1 D-9 — Ari's destructive actions must confirm with something a
 * BROWSER can show.
 *
 * `Alert.alert` is a silent no-op on react-native-web, so a drawer that
 * confirmed with it would present nothing at all and the tap would look dead —
 * or, worse, never reach the confirm handler. The drawer must open a real,
 * rendered dialog instead.
 *
 * WHY THIS FILE WAS REWRITTEN. It used to assert this with the TypeScript
 * compiler API over the drawer's SOURCE, and
 * I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN rejected it: source pins rot on every
 * refactor and caught none of the #1047 regressions. The property is fully
 * observable, so this suite now RENDERS the drawer, drives the real presses,
 * and reads what actually came out — the same chain the tester proved at
 * runtime (Delete -> a real in-DOM dialog -> its Delete fires the service call).
 *
 * fails-on-revert (real mutation of the product, never a comment-out):
 *   - confirm with `Alert.alert` instead of the dialog -> T-2/T-3/T-4 fail
 *     (nothing renders, the service is never called, and the Alert spy fires)
 */

import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const alertSpy = jest.fn();
jest.mock("react-native", () => {
  const base = jest.requireActual("react-native");
  return { ...base, Alert: { alert: alertSpy, prompt: jest.fn() } };
});

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  const icon = (name: string) => (p: Record<string, unknown>) => R.createElement(name, p);
  return { AlertTriangle: icon("AlertTriangle"), Ellipsis: icon("Ellipsis"), Sparkles: icon("Sparkles") };
});

// The sheet is a presentation shell; render its children when it is open so the
// drawer's own output is what this suite observes.
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? R.createElement("Sheet", null, children) : null,
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return { ScrollView: ({ children }: { children?: React.ReactNode }) => R.createElement("ScrollView", null, children) };
});

// A stand-in that renders the dialog's real props as output, so the test can see
// THAT a dialog was opened, with WHAT copy, and can invoke its confirm — without
// depending on the dialog's internals, which have their own suite.
jest.mock("../../ui/ConfirmDialog", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return { ConfirmDialog: (props: Record<string, unknown>) => R.createElement("ConfirmDialog", props) };
});

const deleteConversation = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../services/agentChatService", () => ({
  deleteConversation: (...a: unknown[]) => deleteConversation(...a),
  regenerateAgentConversationTitle: jest.fn().mockResolvedValue(null),
  renameAgentConversation: jest.fn().mockResolvedValue(undefined),
  conversationDisplayTitle: (c: { title?: string }) => c.title ?? "Conversation",
}));
jest.mock("../../../services/ariPolishAnalytics", () => ({ captureAriTitleAction: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: jest.fn(),
    setQueriesData: jest.fn(),
    invalidateQueries: jest.fn(),
    cancelQueries: jest.fn(),
    removeQueries: jest.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConversationDrawer } = require("../ConversationDrawer") as {
  ConversationDrawer: React.FC<Record<string, unknown>>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void | Promise<void>) => Promise<void> | void;
  create: (el: React.ReactElement) => TestRoot;
};

interface Instance {
  type: unknown;
  props: Record<string, unknown>;
}
interface TestRoot {
  root: { findAll: (p: (n: Instance) => boolean) => Instance[] };
  unmount: () => void;
}

const CONVERSATION = { id: "c1", title: "Friday rooftop launch", updated_at: "2026-09-20T10:00:00Z" };

function mount(): TestRoot {
  let tree: TestRoot | null = null;
  act(() => {
    tree = create(
      <ConversationDrawer
        visible
        onClose={jest.fn()}
        conversations={[CONVERSATION]}
        activeId={null}
        onSelect={jest.fn()}
        selectedBrandName="Harbor Supper Club"
        hasSelectedBrand
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
      />,
    ) as unknown as TestRoot;
  });
  return tree as unknown as TestRoot;
}

/** Every rendered element carrying this accessibility label. */
const byLabel = (tree: TestRoot, label: string): Instance[] =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === label);

const dialogs = (tree: TestRoot): Instance[] =>
  tree.root.findAll((n) => n.type === "ConfirmDialog");

/** A press event shaped like the one RN hands a Pressable. */
const press = (n: Instance): void => {
  (n.props.onPress as (e: { stopPropagation: () => void }) => void)({ stopPropagation: () => {} });
};

/** The menu row whose visible label is exactly `text` — the Delete action
 *  carries no accessibilityLabel, only the word a user reads. */
function rowLabelled(tree: TestRoot, text: string): Instance {
  const hit = tree.root.findAll((n) => {
    // Host elements only: the renderer surfaces both the component and the
    // host it renders, and counting both would double every row.
    if (typeof n.type !== "string") return false;
    if (typeof n.props?.onPress !== "function") return false;
    const child = n.props.children as { props?: { children?: unknown } } | undefined;
    return child?.props?.children === text;
  });
  if (hit.length !== 1) throw new Error(`expected exactly one "${text}" row, found ${hit.length}`);
  return hit[0];
}

describe("#3429 D-9 — Ari's destructive actions confirm with a dialog a browser can show", () => {
  beforeEach(() => {
    alertSpy.mockReset();
    deleteConversation.mockClear();
  });

  it("T-1 renders the drawer without reaching for Alert at all", () => {
    const tree = mount();
    expect(byLabel(tree, `More actions for ${CONVERSATION.title}`).length).toBeGreaterThan(0);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(dialogs(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("T-2 opening Delete renders a real confirmation, not a no-op Alert", async () => {
    const tree = mount();
    const more = byLabel(tree, `More actions for ${CONVERSATION.title}`)[0];
    await act(async () => { press(more); });
    await act(async () => { press(rowLabelled(tree, "Delete")); });

    const shown = dialogs(tree);
    expect(shown).toHaveLength(1);
    expect(shown[0].props.visible).toBe(true);
    expect(shown[0].props.description).toBe("Delete this conversation? This can't be undone.");
    expect(shown[0].props.confirmLabel).toBe("Delete");
    expect(shown[0].props.cancelLabel).toBe("Cancel");
    expect(shown[0].props.destructive).toBe(true);
    // The whole point: nothing went to Alert, which web would have swallowed.
    expect(alertSpy).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("T-3 confirming that dialog actually performs the delete", async () => {
    const tree = mount();
    const more = byLabel(tree, `More actions for ${CONVERSATION.title}`)[0];
    await act(async () => { press(more); });
    await act(async () => { press(rowLabelled(tree, "Delete")); });

    const dialog = dialogs(tree)[0];
    await act(async () => {
      await (dialog.props.onConfirm as () => Promise<void>)();
    });
    // A dead confirmation is the failure mode this guards; the service ran.
    expect(deleteConversation).toHaveBeenCalledWith(CONVERSATION.id);
    act(() => tree.unmount());
  });

  it("T-4 dismissing it performs nothing and leaves no dialog behind", async () => {
    const tree = mount();
    const more = byLabel(tree, `More actions for ${CONVERSATION.title}`)[0];
    await act(async () => { press(more); });
    await act(async () => { press(rowLabelled(tree, "Delete")); });

    const dialog = dialogs(tree)[0];
    await act(async () => { (dialog.props.onClose as () => void)(); });
    expect(dialogs(tree)).toHaveLength(0);
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
