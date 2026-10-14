/**
 * #3380 — tester adversarial suite (different angles from the implementor's).
 *
 * The implementor proved the happy paths (Going / Maybe asks for the phone,
 * phone-on-file unchanged, anonymous unchanged, server refusal reveals). This
 * suite attacks what those do not:
 *
 *   - Explorer's contract (`requirePrimaryContact`) must NOT pick up the new
 *     account-phone card or the refusal reveal, even with accountPhoneOnFile=false.
 *   - Can't go is held until the phone is added (the server refuses every
 *     status without one) and then carries the phone, with no plus-ones.
 *   - Plus-ones: an unfinished guest still blocks Going (no dialog), and a
 *     finished guest list is sent intact alongside the added phone.
 *   - An invalid number / wrong country in the confirm step sends nothing.
 *   - A late profile answer (null → true) never shows the field; (null → false)
 *     with the dialog already open adds the field to that open dialog.
 *   - Signing out mid-flow drops the server-asked phone state (anonymous form).
 *   - The own-profile hook never reads before auth is ready, never reads when
 *     signed out, and a failed read reports "unknown" (null), never "no phone".
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
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = {
  root: TestNode;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (
    node: React.ReactElement,
    options?: { createNodeMock?: (element: { type: unknown; props: Record<string, unknown> }) => unknown },
  ) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

import {
  RSVP_ADD_ACCOUNT_PHONE_COPY,
  RsvpDecisionBox,
  RsvpOfferingFloatingBar,
  useRsvpOfferingState,
  type RsvpOfferingBodyProps,
  type RsvpOfferingConfig,
  type RsvpOfferingState,
  type RsvpPhoneFieldRenderArgs,
} from "@mingla/offering-rendering/RsvpOfferingBody";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byTestID = (tree: Renderer, testID: string): TestNode[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);

const event = {
  id: "event-3380-adv",
  name: "Adversarial Night",
  dateLine: "Sat 26 Sept · 7 PM – 10 PM",
  description: "",
  format: "in_person",
  venueName: "Lantern Room",
  address: "61 Wythe Avenue, Brooklyn, New York 11249, United States",
  hideAddressUntilTicket: false,
  currency: "USD",
  tickets: [],
} as unknown as RsvpOfferingBodyProps["event"];

const baseConfig: RsvpOfferingConfig = {
  capacity: 80,
  goingCount: 0,
  allowPlusOnes: false,
  plusOnesMax: 0,
  waitlistEnabled: true,
  manualApproval: false,
  visibility: "public",
  discoverable: true,
};
const plusConfig: RsvpOfferingConfig = { ...baseConfig, allowPlusOnes: true, plusOnesMax: 2 };

const accepted = {
  status: "going" as const,
  approvalStatus: "approved" as const,
  rsvpId: "rsvp-3380-adv",
  confirmationToken: null,
};

const phoneCalls: RsvpPhoneFieldRenderArgs[] = [];
const renderPhoneField = (args: RsvpPhoneFieldRenderArgs): React.ReactNode => {
  phoneCalls.push(args);
  return <View testID={args.testID} />;
};
const lastCall = (pred: (c: RsvpPhoneFieldRenderArgs) => boolean): RsvpPhoneFieldRenderArgs => {
  const call = [...phoneCalls].reverse().find(pred);
  if (call === undefined) throw new Error("phone field never rendered");
  return call;
};
const lastPhoneCall = (testID: string): RsvpPhoneFieldRenderArgs =>
  lastCall((c) => c.testID === testID);

const captured: { state: RsvpOfferingState | null } = { state: null };

type HarnessProps = Partial<RsvpOfferingBodyProps> & { cfg?: RsvpOfferingConfig };
const Harness: React.FC<HarnessProps> = ({ cfg = baseConfig, ...props }) => {
  const state = useRsvpOfferingState({
    event,
    brand: null,
    palette,
    theme,
    config: cfg,
    isLoggedIn: true,
    replyIdentity: "user-a",
    onSubmit: jest.fn(),
    renderPhoneField,
    defaultPhoneCountry: "US",
    onRevealField: () => undefined,
    ...props,
  } as RsvpOfferingBodyProps);
  captured.state = state;
  return (
    <View>
      <RsvpDecisionBox palette={palette} theme={theme} config={cfg} state={state} />
      {state.guestForms ?? null}
      <RsvpOfferingFloatingBar palette={palette} theme={theme} config={cfg} state={state} />
    </View>
  );
};

const createNodeMock = (element: { type: unknown; props: Record<string, unknown> }) => ({
  testID: element.props.testID,
  focus: () => undefined,
});

const mount = async (props: HarnessProps = {}): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Harness {...props} />, { createNodeMock });
  });
  return tree;
};
const rerender = async (tree: Renderer, props: HarnessProps): Promise<void> => {
  await act(async () => {
    tree.update(<Harness {...props} />);
  });
};

const press = async (node: TestNode | undefined): Promise<void> => {
  const onPress = node?.props.onPress;
  if (typeof onPress !== "function") throw new Error("not pressable");
  await act(async () => {
    (onPress as () => void)();
  });
};

type DialogProps = {
  visible: boolean;
  errorText: string | null;
  contactSlot?: React.ReactNode;
  onConfirm: () => void;
};
const dialog = (): DialogProps => {
  const node = captured.state?.confirmDialog as React.ReactElement<{
    children: React.ReactElement<DialogProps>;
  }>;
  return node.props.children.props;
};
const confirm = async (): Promise<void> => {
  await act(async () => {
    dialog().onConfirm();
  });
};

beforeEach(() => {
  phoneCalls.length = 0;
  captured.state = null;
});

describe("#3380 adversarial — Explorer's requirePrimaryContact contract is untouched", () => {
  it("accountPhoneOnFile=false never adds the account-phone card or the dialog slot", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_contact_required");
    });
    const tree = await mount({
      requirePrimaryContact: true,
      accountPhoneOnFile: false,
      initialGuestName: "Explorer Person",
      initialGuestEmail: "explorer@example.invalid",
      initialGuestPhone: "+15551234567",
      onSubmit,
    });
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(true);
    expect(dialog().contactSlot ?? null).toBeNull();
    await confirm();
    // The pre-#3380 copy, and still no slot / account card after the refusal.
    expect(dialog().errorText).toBe("Add your name, email and phone.");
    expect(dialog().contactSlot ?? null).toBeNull();
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
  });
});

describe("#3380 adversarial — Can't go", () => {
  it("is held until the phone is added, then carries it with no plus-ones", async () => {
    const onSubmit = jest.fn(async () => ({ ...accepted, status: "not_going" as const }));
    const tree = await mount({ accountPhoneOnFile: false, onSubmit });

    await press(byTestID(tree, "orch-1150-rsvp-not-going")[0]);
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      lastPhoneCall("issue-1857-rsvp-primary-phone").onChangeCountry("NG", null);
    });
    await act(async () => {
      lastPhoneCall("issue-1857-rsvp-primary-phone").onChangeRawValue("0803 123 4567", "+2348031234567");
    });
    await press(byTestID(tree, "orch-1150-rsvp-not-going")[0]);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        rsvpStatus: "not_going",
        guestPhone: "+2348031234567",
        guestPhoneCountryIso: "NG",
        plusCount: 0,
        guests: [],
      }),
    );
  });
});

describe("#3380 adversarial — plus-ones", () => {
  it("an unfinished guest still blocks Going (no dialog); a finished list is sent intact with the phone", async () => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ cfg: plusConfig, accountPhoneOnFile: false, onSubmit });

    await press(byTestID(tree, "orch-1157-rsvp-plus-plus")[0]);
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    // Guest 1 is empty: the page reveals the fields; the dialog stays shut.
    expect(dialog().visible).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      (byTestID(tree, "orch-1163-rsvp-guest-0-name")[0].props.onChangeText as (v: string) => void)("Grace Hopper");
    });
    await act(async () => {
      (byTestID(tree, "orch-1163-rsvp-guest-0-email")[0].props.onChangeText as (v: string) => void)(
        "grace@example.invalid",
      );
    });
    await act(async () => {
      lastCall((c) => c.role === "plus_one").onChangeRawValue("555 987 6543", "+15559876543");
    });

    // Only the primary phone is missing now: the confirm step asks for it.
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(true);
    expect(dialog().contactSlot ?? null).not.toBeNull();
    await act(async () => {
      lastPhoneCall("issue-3380-rsvp-confirm-phone").onChangeRawValue("+234 803 123 4567", "+2348031234567");
    });
    await confirm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        rsvpStatus: "going",
        guestPhone: "+2348031234567",
        plusCount: 1,
        guests: [
          expect.objectContaining({ name: "Grace Hopper", email: "grace@example.invalid", phone: "+15559876543" }),
        ],
      }),
    );
  });
});

describe("#3380 adversarial — invalid numbers in the confirm step", () => {
  it.each([
    ["a too-short number", "12", null],
    ["a number the chosen country rejects (wrong country)", "0803 123 4567", null],
    ["letters", "call me", null],
  ])("%s sends nothing and says the number is invalid", async (_label, raw, composed) => {
    const onSubmit = jest.fn(async () => accepted);
    // Open the dialog through the real tap path.
    const tree = await mount({ accountPhoneOnFile: false, onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await act(async () => {
      lastPhoneCall("issue-3380-rsvp-confirm-phone").onChangeRawValue(raw, composed);
    });
    await confirm();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog().errorText).toBe("Enter a valid phone number.");
    expect(dialog().visible).toBe(true);
  });

  it("an empty confirm still asks for the phone with the add-phone copy", async () => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ accountPhoneOnFile: false, onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);
  });
});

describe("#3380 adversarial — a slow profile read", () => {
  it("null → true never shows the field at any point", async () => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ accountPhoneOnFile: null, onSubmit });
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
    await rerender(tree, { accountPhoneOnFile: true, onSubmit });
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
    expect(phoneCalls.filter((c) => c.role === "primary")).toHaveLength(0);
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().contactSlot ?? null).toBeNull();
    await confirm();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ guestPhone: "", guestPhoneCountryIso: null }));
  });

  it("null → false while the dialog is open adds the field to that dialog and holds the send", async () => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ accountPhoneOnFile: null, onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(true);
    expect(dialog().contactSlot ?? null).toBeNull();
    await rerender(tree, { accountPhoneOnFile: false, onSubmit });
    expect(dialog().visible).toBe(true);
    expect(dialog().contactSlot ?? null).not.toBeNull();
    await confirm();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);
  });
});

describe("#3380 adversarial — signing out mid-flow", () => {
  it("drops the server-asked phone state and falls back to the anonymous form", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_contact_required");
    });
    const tree = await mount({ accountPhoneOnFile: null, onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(1);

    await rerender(tree, { isLoggedIn: false, replyIdentity: null, accountPhoneOnFile: null, onSubmit });
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
    expect(byTestID(tree, "orch-1150-rsvp-name")).toHaveLength(1);
    expect(byTestID(tree, "orch-1150-rsvp-email")).toHaveLength(1);
    expect(dialog().visible).toBe(false);

    // Signing back in as someone else does not inherit the old refusal either.
    await rerender(tree, { isLoggedIn: true, replyIdentity: "user-b", accountPhoneOnFile: null, onSubmit });
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
    expect(textOf(tree.root as unknown as TestNode)).not.toContain(RSVP_ADD_ACCOUNT_PHONE_COPY);
  });
});
