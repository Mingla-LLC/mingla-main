// MINGLA-INVARIANT: I-ADDON-TIER-SHEET-HANDS-OFF | issue #3281 | With the Add-ons editor on, the ticket sheet of a published event never reads or sends a saved ticket's add-ons (the editor owns them); with it off, the sheet reads and sends them exactly as before.
/**
 * issue #3281 S3 — the REAL TicketTierEditSheet with the extras flag off and on.
 *
 * Flag off (the default): a saved ticket of a published event reads its
 * add-ons with business_event_ticket_extras and shows today's section.
 * Flag on: no read, a line pointing to the Add-ons editor, and Save sends no
 * `extras` key, so the server keeps what the editor saved (one write path).
 *
 * FAILS-ON-REVERT: drop the `!isFeatureEnabled("extras")` guard on the read,
 * or render TicketExtrasSection with the flag on -> red.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const flags = { extras: false };
jest.mock("../../../config/featureFlags", () => ({
  isFeatureEnabled: (key: string) => key === "extras" && flags.extras,
  featureFlags: {
    get extras(): boolean {
      return flags.extras;
    },
  },
}));
const rpc = jest.fn(async () => ({ data: {}, error: null }));
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => (rpc as (...a: unknown[]) => unknown)(...args) },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (): null => null,
}));
jest.mock("../../../hooks/useEventWaitlist", () => ({
  useEventWaitlist: () => ({ data: [] }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
// The real Sheet's scrim tap, Escape, Android back and drag all call its
// onClose (or onRequestClose when its dismissGuard says so); the mock keeps
// those props so the test can dismiss it the way a backdrop click does.
jest.mock("../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children?: React.ReactNode }) =>
    props.visible ? React.createElement("MockSheet", props, props.children) : null,
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
// The #4523 calendar fields are not under test here.
jest.mock("../../ui/HostCalendarFields", () => ({ HostDateTimeField: (): null => null }));
// Lazy children of a saved ticket on a published event; not under test.
jest.mock("../../guests/TicketLinksSheet", () => ({ TicketLinksSheet: (): null => null }));
jest.mock("../../discounts/ItemDiscountControls", () => ({ ItemDiscountControls: (): null => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: (): null => null }));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
// #4420 — the sheet's unsaved-changes dialog (reanimated is not loadable here).
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    props.visible === true ? React.createElement("MockConfirmDialog", props) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));

// eslint-disable-next-line import/first
import { TicketTierEditSheet } from "../TicketTierEditSheet";
// eslint-disable-next-line import/first
import type { TicketStub } from "../../../store/draftEventStore";

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<HostNode | string>;
};
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
    findAllByType: (type: string) => HostNode[];
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const EVENT_ID = "32813000-0000-4000-8300-0000000000e1";
const TICKET_ID = "32813000-0000-4000-8300-0000000000e2";

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-4420",
  name: "General Admission",
  priceGbp: 25,
  capacity: 100,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  currency: "USD",
  ...overrides,
});

const mount = async (onSave: (t: TicketStub) => void): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={ticket({ id: TICKET_ID })}
        nextOrder={0}
        onClose={() => undefined}
        onSave={onSave}
        eventCurrency="USD"
        eventId={EVENT_ID}
        liveEdit
      />,
    );
  });
  // Let the add-on read (a resolved promise) settle; no timers are flushed.
  for (let i = 0; i < 3; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
  return tree as Tree;
};
const byTestId = (tree: Tree, id: string): HostNode[] =>
  tree.root.findAll((n) => n.props.testID === id);
const hasText = (tree: Tree, text: string): boolean =>
  tree.root.findAll((n) => n.children.some((c) => typeof c === "string" && c.includes(text))).length > 0;
const saveButton = (tree: Tree): HostNode => {
  const match = tree.root.findAllByType("MockButton").find((n) => n.props.label === "Save changes");
  expect(match).toBeDefined();
  return match as HostNode;
};

beforeEach(() => {
  rpc.mockClear();
});

describe("#3281 S3 the ticket sheet and the Add-ons editor", () => {
  test("flag off: a saved live ticket reads its add-ons as today", async () => {
    flags.extras = false;
    const tree = await mount(() => undefined);
    expect(rpc).toHaveBeenCalledWith("business_event_ticket_extras", { p_event_id: EVENT_ID });
    expect(byTestId(tree, "ticket-sheet-add-ons-line")).toHaveLength(0);
  });

  test("flag on: no read, a pointer to the editor, and Save sends no add-ons", async () => {
    flags.extras = true;
    const onSave = jest.fn<(t: TicketStub) => void>();
    const tree = await mount(onSave);
    expect(rpc).not.toHaveBeenCalled();
    expect(byTestId(tree, "ticket-sheet-add-ons-line").length).toBeGreaterThan(0);
    expect(hasText(tree, "set in Add-ons")).toBe(true);
    expect(hasText(tree, "didn't load")).toBe(false);
    await TestRenderer.act(() => {
      (saveButton(tree).props.onPress as () => void)();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(Object.prototype.hasOwnProperty.call(onSave.mock.calls[0][0], "extras")).toBe(false);
  });
});
