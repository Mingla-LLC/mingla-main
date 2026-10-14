/**
 * #3380 — a signed-in guest whose account has no phone could never RSVP.
 *
 * public-submit-rsvp fills a signed-in guest's name, email and phone from the
 * account and answers 400 `rsvp_contact_required` when the phone is missing.
 * The signed-in confirm step never asked for a phone, so every "Confirm I'm
 * going" failed the same way. These tests mount the REAL shared state hook
 * (packages/offering-rendering, deep specifiers, same harness as
 * rsvp_public_guest_page_render.test.tsx) and drive each path:
 *
 *   - signed in, no phone on file  → the field is asked for and the phone is sent
 *   - signed in, phone on file     → unchanged: no field, empty contact sent
 *   - anonymous                    → unchanged: full contact form, no phone-only card
 *   - server refusal               → the field is revealed with clear copy
 *
 * Plus the transport fix: the edge function's `{ error }` code is read from the
 * response body, so the page sees `rsvp_contact_required` instead of the
 * generic "Edge Function returned a non-2xx status code".
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
  RSVP_ACCOUNT_EMAIL_MISSING_COPY,
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
import { readRsvpErrorCode } from "../../../services/rsvpErrorCodes";

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byTestID = (tree: Renderer, testID: string): TestNode[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const hostTexts = (tree: Renderer): string[] =>
  tree.root.findAll((n) => n.type === "Text").map(textOf);

const event = {
  id: "event-3380",
  name: "Neighbors Night on Wythe",
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

const accepted = {
  status: "going" as const,
  approvalStatus: "approved" as const,
  rsvpId: "rsvp-3380",
  confirmationToken: null,
};

// The web surface injects the country-picker phone field; this stand-in records
// every call so a test can see where it was asked for and type into it.
const phoneCalls: RsvpPhoneFieldRenderArgs[] = [];
const renderPhoneField = (args: RsvpPhoneFieldRenderArgs): React.ReactNode => {
  phoneCalls.push(args);
  return <View testID={args.testID} />;
};
const lastPhoneCall = (testID: string): RsvpPhoneFieldRenderArgs => {
  const call = [...phoneCalls].reverse().find((c) => c.testID === testID);
  if (call === undefined) throw new Error(`phone field ${testID} never rendered`);
  return call;
};

const captured: { state: RsvpOfferingState | null } = { state: null };

const Harness: React.FC<Partial<RsvpOfferingBodyProps>> = (props) => {
  const state = useRsvpOfferingState({
    event,
    brand: null,
    palette,
    theme,
    config,
    isLoggedIn: true,
    onSubmit: jest.fn(),
    renderPhoneField,
    defaultPhoneCountry: "US",
    onRevealField: () => undefined,
    ...props,
  } as RsvpOfferingBodyProps);
  captured.state = state;
  return (
    <View>
      <RsvpDecisionBox palette={palette} theme={theme} config={config} state={state} />
      <RsvpOfferingFloatingBar palette={palette} theme={theme} config={config} state={state} />
    </View>
  );
};

const createNodeMock = (element: { type: unknown; props: Record<string, unknown> }) => ({
  testID: element.props.testID,
  focus: () => undefined,
});

const mount = async (props: Partial<RsvpOfferingBodyProps> = {}): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Harness {...props} />, { createNodeMock });
  });
  return tree;
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
// Render whatever the dialog's contact slot holds, to see what the guest sees.
const renderSlot = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<View>{dialog().contactSlot ?? null}</View>, { createNodeMock });
  });
  return tree;
};

beforeEach(() => {
  phoneCalls.length = 0;
  captured.state = null;
});

describe("#3380 signed in, no phone on file", () => {
  it("asks for the phone in the confirm step and sends it with its country", async () => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ accountPhoneOnFile: false, onSubmit });

    // Name and email come from the account: only the phone card shows.
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(1);
    expect(byTestID(tree, "orch-1150-rsvp-name")).toHaveLength(0);
    expect(byTestID(tree, "orch-1150-rsvp-email")).toHaveLength(0);

    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(true);
    const slot = await renderSlot();
    expect(byTestID(slot, "issue-3380-rsvp-confirm-phone-slot")).toHaveLength(1);
    expect(byTestID(slot, "issue-3380-rsvp-confirm-phone")).toHaveLength(1);
    expect(lastPhoneCall("issue-3380-rsvp-confirm-phone").role).toBe("primary");

    // Confirming without a phone sends nothing and says what is needed.
    await confirm();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);

    await act(async () => {
      lastPhoneCall("issue-3380-rsvp-confirm-phone").onChangeCountry("NG", null);
    });
    await act(async () => {
      lastPhoneCall("issue-3380-rsvp-confirm-phone").onChangeRawValue("0803 123 4567", "+2348031234567");
    });
    await confirm();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        rsvpStatus: "going",
        guestName: "",
        guestEmail: "",
        guestPhone: "+2348031234567",
        guestPhoneCountryIso: "NG",
      }),
    );
    expect(dialog().visible).toBe(false);
  });

  it("holds Maybe until the phone is added, then sends it", async () => {
    const onSubmit = jest.fn(async () => ({ ...accepted, status: "maybe" as const }));
    const tree = await mount({ accountPhoneOnFile: false, onSubmit });

    await press(byTestID(tree, "orch-1150-rsvp-maybe")[0]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textOf(byTestID(tree, "rsvp-decision-validation-hint")[0])).toBe(
      "Add your phone number above to RSVP.",
    );

    await act(async () => {
      lastPhoneCall("issue-1857-rsvp-primary-phone").onChangeRawValue("555 123 4567", "+15551234567");
    });
    await press(byTestID(tree, "orch-1150-rsvp-maybe")[0]);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ rsvpStatus: "maybe", guestPhone: "+15551234567", guestPhoneCountryIso: "US" }),
    );
  });
});

describe("#3380 signed in, phone on file (unchanged)", () => {
  it.each([
    ["known to be on file", true],
    ["not known", null],
    ["not passed at all", undefined],
  ])("phone %s: no field, Going sends the account-filled empty contact", async (_label, onFile) => {
    const onSubmit = jest.fn(async () => accepted);
    const tree = await mount({ accountPhoneOnFile: onFile, onSubmit });

    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
    expect(byTestID(tree, "orch-1157-rsvp-contact")).toHaveLength(0);
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(true);
    expect(dialog().contactSlot ?? null).toBeNull();

    await confirm();
    expect(onSubmit).toHaveBeenCalledWith({
      rsvpStatus: "going",
      guestName: "",
      guestEmail: "",
      guestPhone: "",
      guestPhoneCountryIso: null,
      plusCount: 0,
      guests: [],
    });
    expect(phoneCalls.filter((c) => c.role === "primary")).toHaveLength(0);
  });
});

describe("#3380 anonymous guest (unchanged)", () => {
  it("still gets the full contact form, the account-phone flag is ignored, the dialog has no slot", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_contact_required");
    });
    const tree = await mount({ isLoggedIn: false, accountPhoneOnFile: false, onSubmit });

    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
    expect(byTestID(tree, "orch-1150-rsvp-name")).toHaveLength(1);
    expect(byTestID(tree, "orch-1150-rsvp-email")).toHaveLength(1);
    expect(byTestID(tree, "issue-1857-rsvp-primary-phone")).toHaveLength(1);

    // Going with nothing filled reveals the fields; no dialog.
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(false);
    expect(textOf(byTestID(tree, "rsvp-decision-validation-hint")[0])).toBe(
      "Add your name, email and phone number above to RSVP.",
    );

    // Filled in, then refused by the server: the old copy, still no slot.
    await act(async () => {
      (byTestID(tree, "orch-1150-rsvp-name")[0].props.onChangeText as (v: string) => void)("Ada Lovelace");
    });
    await act(async () => {
      (byTestID(tree, "orch-1150-rsvp-email")[0].props.onChangeText as (v: string) => void)("ada@example.com");
    });
    await act(async () => {
      lastPhoneCall("issue-1857-rsvp-primary-phone").onChangeRawValue("555 123 4567", "+15551234567");
    });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().contactSlot ?? null).toBeNull();
    await confirm();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        guestName: "Ada Lovelace",
        guestEmail: "ada@example.com",
        guestPhone: "+15551234567",
        guestPhoneCountryIso: "US",
      }),
    );
    expect(dialog().errorText).toBe("Add your name, email and phone.");
    expect(dialog().contactSlot ?? null).toBeNull();
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(0);
  });
});

describe("#3380 the server refuses a signed-in reply", () => {
  it("reveals the phone field with clear copy instead of a generic retry", async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new Error("rsvp_contact_required"))
      .mockResolvedValueOnce(accepted);
    const tree = await mount({ accountPhoneOnFile: null, onSubmit });

    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().contactSlot ?? null).toBeNull();
    await confirm();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(dialog().visible).toBe(true);
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);
    expect(dialog().errorText).not.toBe("Couldn't save your RSVP. Try again.");
    const slot = await renderSlot();
    expect(byTestID(slot, "issue-3380-rsvp-confirm-phone")).toHaveLength(1);
    expect(byTestID(tree, "issue-3380-rsvp-account-phone")).toHaveLength(1);
    expect(hostTexts(slot).join(" ")).toContain("can reach you about this event");

    await act(async () => {
      lastPhoneCall("issue-3380-rsvp-confirm-phone").onChangeRawValue("555 123 4567", "+15551234567");
    });
    await confirm();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ guestPhone: "+15551234567", guestPhoneCountryIso: "US" }),
    );
    expect(dialog().visible).toBe(false);
  });

  it("says the account email is missing when a phone was sent and it is still refused", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_contact_required");
    });
    const tree = await mount({ accountPhoneOnFile: false, onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await act(async () => {
      lastPhoneCall("issue-3380-rsvp-confirm-phone").onChangeRawValue("555 123 4567", "+15551234567");
    });
    await confirm();
    expect(dialog().errorText).toBe(RSVP_ACCOUNT_EMAIL_MISSING_COPY);
  });

  it("asks for a new phone when the account's phone is unusable", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_phone_invalid");
    });
    const tree = await mount({ onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);
    expect(dialog().contactSlot ?? null).not.toBeNull();
  });

  it("leaves other refusals alone", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_full");
    });
    const tree = await mount({ onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();
    expect(dialog().errorText).toBe("This event just filled up.");
    expect(dialog().contactSlot ?? null).toBeNull();
  });
});

describe("#3380 the refusal code reaches the page", () => {
  it("reads the { error } code from the edge function's response body", async () => {
    const response = new Response(JSON.stringify({ error: "rsvp_contact_required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: response,
    };
    await expect(readRsvpErrorCode(error)).resolves.toBe("rsvp_contact_required");
    // A clone was read: the body is still there for anyone else.
    await expect(response.json()).resolves.toEqual({ error: "rsvp_contact_required" });
  });

  it("falls back to the old parse when there is no readable body", async () => {
    await expect(
      readRsvpErrorCode({ message: "x", context: { body: JSON.stringify({ error: "rsvp_full" }) } }),
    ).resolves.toBe("rsvp_full");
    await expect(readRsvpErrorCode({ message: "rsvp_not_open" })).resolves.toBe("rsvp_not_open");
    await expect(readRsvpErrorCode(null)).resolves.toBe("rsvp_write_failed");
    const html = new Response("<html>bad gateway</html>", { status: 502 });
    await expect(readRsvpErrorCode({ message: "Edge Function returned a non-2xx status code", context: html })).resolves.toBe(
      "Edge Function returned a non-2xx status code",
    );
  });
});
