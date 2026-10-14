/* eslint-disable import/first */
/**
 * #3380 polish — two follow-ups to PR #3862, pinned so they cannot come back.
 *
 *   ONE-*   With the phone empty, the Going confirm dialog shows ONE message.
 *           Before: the dialog's error line said "Add your phone number to
 *           confirm your RSVP." AND the phone field under it said "Add your
 *           phone number". The field's own empty error is now held back while
 *           the dialog line already says it, on both field paths (the injected
 *           country-picker field and the plain fallback field). The inline
 *           page card, and every other error, are unchanged.
 *   CLONE-* readRsvpErrorCode never throws when the response body was already
 *           read: `clone()` (which throws a TypeError on a used body) now sits
 *           inside the try, so it falls back to the synchronous parse.
 *
 *   CONFIG-* Jest maps every deep `@mingla/offering-rendering/<sub>` to THIS
 *           checkout, so a worktree whose node_modules links to the anchor
 *           still tests its own package code.
 *
 * FAILS-ON-REVERT: delete the `dialogAsksForPhone` guard in
 * packages/offering-rendering/RsvpOfferingBody.tsx and ONE-1 / ONE-2 / ONE-3
 * go red; move `clone()` back above the try in src/services/rsvpErrorCodes.ts
 * and CLONE-1 / CLONE-2 go red; drop the deep-subpath mapping from
 * jest.config.cjs and CONFIG-1 goes red.
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

const event = {
  id: "event-3380-polish",
  name: "Polish Night",
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

const phoneCalls: RsvpPhoneFieldRenderArgs[] = [];
const renderPhoneField = (args: RsvpPhoneFieldRenderArgs): React.ReactNode => {
  phoneCalls.push(args);
  return <View testID={args.testID} />;
};
const lastPhoneCall = (testID: string): RsvpPhoneFieldRenderArgs => {
  const call = [...phoneCalls].reverse().find((c) => c.testID === testID);
  if (call === undefined) throw new Error(`${testID} never rendered`);
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
    replyIdentity: "user-a",
    onSubmit: jest.fn(),
    renderPhoneField,
    defaultPhoneCountry: "US",
    onRevealField: () => undefined,
    accountPhoneOnFile: false,
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
  });
};
/** Every string the dialog's phone slot paints. */
const slotTexts = async (): Promise<string[]> => {
  const slot = dialog().contactSlot;
  if (slot === null || slot === undefined) throw new Error("no phone slot in the dialog");
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<View>{slot}</View>, { createNodeMock });
  });
  const shown = tree.root
    .findAll((n) => n.type === "Text")
    .map((n) => textOf(n));
  tree.unmount();
  return shown;
};

beforeEach(() => {
  phoneCalls.length = 0;
  captured.state = null;
});

describe("#3380 polish — an empty phone in the confirm dialog shows one message", () => {
  it("ONE-1: country-picker field: the dialog line asks, the field under it does not repeat it", async () => {
    const onSubmit = jest.fn();
    const tree = await mount({ onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);
    expect(lastPhoneCall("issue-3380-rsvp-confirm-phone").emptyRequired).toBe(false);
    // The page card (not the dialog) still marks its empty required field.
    expect(lastPhoneCall("issue-1857-rsvp-primary-phone").emptyRequired).toBe(true);
  });

  it("ONE-2: plain fallback field: no 'Add your phone number' under the dialog line", async () => {
    const onSubmit = jest.fn();
    const tree = await mount({ onSubmit, renderPhoneField: undefined });
    // Can't go is held without a phone and marks the empty fields, as a real
    // guest who tries it first would see; then Going opens the dialog.
    await press(byTestID(tree, "orch-1150-rsvp-not-going")[0]);
    expect(onSubmit).not.toHaveBeenCalled();
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(dialog().visible).toBe(true);
    await confirm();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);
    const shown = await slotTexts();
    expect(shown).not.toContain("Add your phone number");
    expect(shown.filter((line) => /add your phone number/i.test(line))).toHaveLength(0);
  });

  it("ONE-3: a server refusal with no phone sent shows the dialog line only", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_contact_required");
    });
    // Profile still loading: the dialog opens with no slot and sends.
    const tree = await mount({ onSubmit, accountPhoneOnFile: null });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await confirm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(dialog().errorText).toBe(RSVP_ADD_ACCOUNT_PHONE_COPY);
    expect(lastPhoneCall("issue-3380-rsvp-confirm-phone").emptyRequired).toBe(false);
  });

  it("ONE-4: other errors are unchanged — a bad number still marks the field", async () => {
    const onSubmit = jest.fn();
    const tree = await mount({ onSubmit });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await act(async () => {
      lastPhoneCall("issue-3380-rsvp-confirm-phone").onChangeRawValue("12", null);
    });
    await confirm();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog().errorText).toBe("Enter a valid phone number.");
    expect(lastPhoneCall("issue-3380-rsvp-confirm-phone").invalid).toBe(true);
  });
});

describe("#3380 polish — reading the error code never throws on a used body", () => {
  const usedBody = (): { clone: () => never; text: () => Promise<string> } => ({
    clone: () => {
      throw new TypeError("Response.clone: Body has already been consumed.");
    },
    text: async () => {
      throw new TypeError("Body is unusable");
    },
  });

  it("CLONE-1: a consumed response falls back to the error message", async () => {
    await expect(
      readRsvpErrorCode({
        message: "Edge Function returned a non-2xx status code",
        context: usedBody() as unknown as { body?: unknown },
      }),
    ).resolves.toBe("Edge Function returned a non-2xx status code");
  });

  it("CLONE-2: a consumed response still reads a code from context.body when present", async () => {
    const context = Object.assign(usedBody(), { body: JSON.stringify({ error: "rsvp_contact_required" }) });
    await expect(
      readRsvpErrorCode({ message: "Edge Function returned a non-2xx status code", context }),
    ).resolves.toBe("rsvp_contact_required");
  });

  it("CLONE-3: a readable clone is still preferred (unchanged)", async () => {
    const context = {
      clone: () => ({ text: async () => JSON.stringify({ error: "rsvp_full" }) }),
    };
    await expect(
      readRsvpErrorCode({ message: "x", context: context as unknown as { body?: unknown } }),
    ).resolves.toBe("rsvp_full");
  });
});

describe("#3380 polish — suites test THIS checkout's offering-rendering", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const businessRoot = path.resolve(__dirname, "../../../..");
  const ownPackage = path.resolve(businessRoot, "../packages/offering-rendering");

  it("CONFIG-1: jest.config.cjs maps every deep @mingla/offering-rendering/<sub> to this tree", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(path.join(businessRoot, "jest.config.cjs")) as {
      moduleNameMapper: Record<string, string>;
    };
    for (const sub of ["RsvpOfferingBody", "rsvpGuestSnapshot", "themeResolver"]) {
      const specifier = `@mingla/offering-rendering/${sub}`;
      const hit = Object.entries(cfg.moduleNameMapper).find(([pattern]) => new RegExp(pattern).test(specifier));
      expect(hit).toBeDefined();
      const [pattern, target] = hit as [string, string];
      const mapped = specifier.replace(new RegExp(pattern), target).replace("<rootDir>", businessRoot);
      expect(path.resolve(mapped)).toBe(path.join(ownPackage, sub));
    }
    // The bare barrel keeps its manual mock.
    expect(cfg.moduleNameMapper["^@mingla/offering-rendering$"]).toBe(
      "<rootDir>/__manual_mocks__/offering-rendering.js",
    );
  });

  it("CONFIG-2: the RSVP body this file mounts is this checkout's file", () => {
    expect(require.resolve("@mingla/offering-rendering/RsvpOfferingBody")).toBe(
      path.join(ownPackage, "RsvpOfferingBody.tsx"),
    );
  });
});
