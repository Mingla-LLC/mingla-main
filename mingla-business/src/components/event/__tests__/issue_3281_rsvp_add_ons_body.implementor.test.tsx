/* eslint-disable import/first */
// MINGLA-INVARIANT: I-ADDON-RSVP-REFUSAL-KEEPS-FORM | issue #3281 | An RSVP add-on refusal (sold out, too many, not going, switched off) shows the add-on copy in the Going step and leaves the guest's RSVP form, picks and reply untouched so they can retry; picks above the party's limit hold Going and Maybe back.
/**
 * issue #3281 S6 (checkpoint 16) — the shared RSVP body's add-on slot.
 *
 *   SLOT-*    the host's picker is drawn in the decision box, given the party
 *             size (the guest + plus-ones), and not at all when absent.
 *   READY-*   addOnsReady=false (picks above the party's limit) holds Going:
 *             no confirm step, nothing sent, "Pick fewer add-ons to continue."
 *   REFUSE-*  each add-on refusal public-submit-rsvp returns shows its copy in
 *             the Going step, nothing is cleared, and a retry sends again.
 *   DONE-*    an accepted Going reply carries its add-ons to the confirmation,
 *             and the confirmation draws "Add-ons · Tee × 2 · Seat × 1".
 *
 * Mounts the REAL useRsvpOfferingState + RsvpDecisionBox and the REAL
 * RsvpSuccessPopup.
 *
 * FAILS-ON-REVERT: drop `&& addOnsReady` from decisionReady (READY red), drop
 * the addOnErrorLine fallback (REFUSE red), drop `addOns: result.rsvpAddOns`
 * from the confirmation details or the "Add-ons" row (DONE red).
 */

import React from "react";
import { View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => {
  const base = jest.requireActual("../../../../__manual_mocks__/react-native.js");
  const curve = (t: number): number => t;
  return {
    ...base,
    Easing: { inOut: () => curve, out: () => curve, in: () => curve, ease: curve, linear: curve },
    AccessibilityInfo: { announceForAccessibility: () => undefined },
  };
});
jest.mock(
  "react-native-svg",
  () => ({
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Circle: () => null,
    Path: () => null,
    Rect: () => null,
    G: () => null,
  }),
  { virtual: true },
);

type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestNode | string)[];
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = {
  root: TestNode;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (
    node: React.ReactElement,
    options?: { createNodeMock?: (element: { type: unknown; props: Record<string, unknown> }) => unknown },
  ) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

import {
  RsvpDecisionBox,
  RsvpOfferingFloatingBar,
  useRsvpOfferingState,
  type RsvpOfferingBodyProps,
  type RsvpOfferingConfig,
  type RsvpOfferingState,
} from "@mingla/offering-rendering/RsvpOfferingBody";
import { RsvpSuccessPopup } from "@mingla/offering-rendering/RsvpSuccessPopup";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byTestID = (tree: Renderer, testID: string): TestNode[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const allText = (tree: Renderer): string =>
  tree.root.findAll((n) => n.type === "Text").map(textOf).join(" | ");

const event = {
  id: "event-3281-rsvp",
  name: "Supper Club",
  dateLine: "Sat 26 Sept · 7 PM – 10 PM",
  description: "",
  format: "in_person",
  venueName: "Lantern Room",
  address: "61 Wythe Avenue, Brooklyn, New York 11249, United States",
  hideAddressUntilTicket: false,
  currency: "USD",
  tickets: [],
} as unknown as RsvpOfferingBodyProps["event"];

const config: RsvpOfferingConfig = {
  capacity: 80,
  goingCount: 0,
  allowPlusOnes: false,
  plusOnesMax: 0,
  waitlistEnabled: true,
  manualApproval: false,
  visibility: "public",
  discoverable: true,
};

const captured: { state: RsvpOfferingState | null; partySizes: number[] } = { state: null, partySizes: [] };

const Harness: React.FC<Partial<RsvpOfferingBodyProps>> = (props) => {
  const state = useRsvpOfferingState({
    event,
    brand: null,
    palette,
    theme,
    config,
    isLoggedIn: true,
    replyIdentity: "user-a",
    initialGuestName: "Ada",
    initialGuestEmail: "ada@example.test",
    initialGuestPhone: "+15550000000",
    onSubmit: jest.fn(),
    accountPhoneOnFile: true,
    onRevealField: () => undefined,
    ...props,
  } as RsvpOfferingBodyProps);
  captured.state = state;
  return <RsvpDecisionBox palette={palette} theme={theme} config={config} state={state} />;
};

const mount = async (props: Partial<RsvpOfferingBodyProps> = {}): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Harness {...props} />, {
      createNodeMock: (element) => ({ testID: element.props.testID, focus: () => undefined }),
    });
  });
  return tree;
};

type DialogProps = { visible: boolean; errorText: string | null; onConfirm: () => void };
const dialog = (): DialogProps => {
  const node = captured.state?.confirmDialog as React.ReactElement<{
    children: React.ReactElement<DialogProps>;
  }>;
  return node.props.children.props;
};
const press = async (node: TestNode | undefined): Promise<void> => {
  const onPress = node?.props.onPress;
  if (typeof onPress !== "function") throw new Error("not pressable");
  await act(async () => {
    (onPress as () => void)();
  });
};
const confirm = async (): Promise<void> => {
  await act(async () => {
    dialog().onConfirm();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};
const picker = (partySize: number): React.ReactNode => {
  captured.partySizes.push(partySize);
  return <View testID="host-add-on-picker" />;
};
const accepted = {
  status: "going" as const,
  approvalStatus: "approved" as const,
  rsvpId: "rsvp-1",
  confirmationToken: null,
  credentials: [],
  anonymousRecovery: [],
  guests: [],
};

beforeEach(() => {
  captured.state = null;
  captured.partySizes.length = 0;
});

describe("#3281 S6 the RSVP body's add-on slot", () => {
  it("SLOT-1: the host's picker sits in the decision box and is given the party size", async () => {
    const tree = await mount({ addOnsNode: picker });
    expect(byTestID(tree, "host-add-on-picker")).toHaveLength(1);
    expect(captured.partySizes.every((n) => n === 1)).toBe(true);
  });

  it("SLOT-2: no slot, no picker (every surface without add-ons is unchanged)", async () => {
    const tree = await mount();
    expect(byTestID(tree, "host-add-on-picker")).toHaveLength(0);
    expect(captured.state?.addOnsNode).toBeNull();
  });

  it("READY-1: picks above the party's limit hold Going back and say why", async () => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ addOnsNode: picker, addOnsReady: false, onSubmit });
    expect(captured.state?.decisionReady).toBe(false);
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(allText(tree)).toContain("Pick fewer add-ons to continue.");
  });

  it("READY-2: picks that fit leave Going as it was", async () => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ addOnsNode: picker, addOnsReady: true, onSubmit });
    expect(captured.state?.decisionReady).toBe(true);
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(true);
  });

  it.each([
    ["extra_capacity_exceeded", "One of your add-ons just sold out. Pick fewer to continue."],
    ["extra_quantity_above_max", "You've picked more of an add-on than your party allows."],
    ["rsvp_add_ons_unavailable", "Add-ons open once your spot is confirmed."],
    ["extra_not_available", "One of your add-ons is no longer on sale. Remove it to continue."],
    ["rsvp_add_on_needs_payment", "One of your add-ons is no longer on sale. Remove it to continue."],
    ["rsvp_add_ons_invalid", "We couldn't read your add-ons. Change them and try again."],
  ])("REFUSE-1: %s shows its copy and keeps the form for a retry", async (code, copy) => {
    let calls = 0;
    const onSubmit = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error(code);
      return accepted;
    });
    const tree = await mount({ addOnsNode: picker, onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();
    expect(dialog().errorText).toBe(copy);
    expect(dialog().visible).toBe(true);
    expect(captured.state?.guestStatus ?? null).toBeNull();
    expect(byTestID(tree, "host-add-on-picker")).toHaveLength(1);
    // The guest changes their picks and confirms again: sent again, accepted.
    await confirm();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(captured.state?.guestStatus).toBe("going");
  });

  it("DONE-1: an accepted Going reply carries its add-ons to the confirmation", async () => {
    const onSubmit = jest.fn(async () => ({
      ...accepted,
      rsvpAddOns: [{ name: "Tee", quantity: 2 }, { name: "Seat", quantity: 1 }],
    }));
    const tree = await mount({ addOnsNode: picker, onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();
    const popup = captured.state?.successPopup as React.ReactElement<{
      children: React.ReactElement<{ details: { addOns?: unknown } | null }>;
    }>;
    expect(popup.props.children.props.details?.addOns).toEqual([
      { name: "Tee", quantity: 2 },
      { name: "Seat", quantity: 1 },
    ]);
    void tree;
  });

  it("DONE-2: the confirmation draws the Add-ons line (both pass presentations)", async () => {
    const details = {
      eventName: "Supper Club",
      dateLine: "Sat 26 Sept",
      venueLine: "Lantern Room",
      guestName: "Ada",
      status: "going" as const,
      plusGuests: [],
      confirmationToken: null,
      credentials: [],
      anonymousRecovery: [],
      addOns: [{ name: "Tee", quantity: 2 }, { name: "Seat", quantity: 1 }],
    };
    for (const passPresentation of ["qr", "claim"] as const) {
      let tree!: Renderer;
      await act(async () => {
        tree = TestRenderer.create(
          <RsvpSuccessPopup
            visible
            palette={palette}
            theme={theme}
            details={details}
            showCalendarNudge={false}
            onClose={() => undefined}
            passPresentation={passPresentation}
            claim={{ email: "ada@example.test", phoneLast4: "0000", shortUrl: null, onOpen: () => undefined }}
          />,
        );
      });
      expect(allText(tree)).toContain("Add-ons");
      expect(allText(tree)).toContain("Tee × 2 · Seat × 1");
      tree.unmount();
    }
  });

  it("DONE-3: a reply with no add-ons draws no Add-ons line", async () => {
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <RsvpSuccessPopup
          visible
          palette={palette}
          theme={theme}
          details={{
            eventName: "Supper Club",
            dateLine: "Sat 26 Sept",
            venueLine: "Lantern Room",
            guestName: "Ada",
            status: "going",
            plusGuests: [],
            confirmationToken: null,
            credentials: [],
            anonymousRecovery: [],
          }}
          showCalendarNudge={false}
          onClose={() => undefined}
        />,
      );
    });
    expect(allText(tree)).not.toContain("Add-ons");
  });
});
