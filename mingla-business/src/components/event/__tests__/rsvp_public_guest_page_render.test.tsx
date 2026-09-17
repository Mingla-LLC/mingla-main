/**
 * Public RSVP page — the shared decision components, rendered.
 *
 * Mounts the REAL shared state hook, inline decision box, floating bar and
 * momentum card from packages/offering-rendering (deep specifiers; the barrel
 * is mapped to a manual mock in this config) with react-test-renderer and the
 * lightweight react-native mock, then drives them the way a guest does.
 *
 * Why here: this business jest run is the one that runs on every PR, and its
 * roots stop at mingla-business/src.
 */

import React from "react";
import { View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The shared react-native stand-in has no Easing / AccessibilityInfo (its
// node-only suites never animate); add the two the decision card uses.
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
  RsvpDecisionBox,
  RsvpOfferingFloatingBar,
  useRsvpOfferingState,
  type RsvpOfferingBodyProps,
  type RsvpOfferingConfig,
  type RsvpOfferingState,
} from "@mingla/offering-rendering/RsvpOfferingBody";
import { RsvpMomentumDecision } from "@mingla/offering-rendering/RsvpMomentumDecision";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";
import type { RsvpGuestSnapshot } from "@mingla/offering-rendering/rsvpGuestSnapshot";

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byTestID = (tree: Renderer, testID: string): TestNode[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const hostTexts = (tree: Renderer): string[] =>
  tree.root.findAll((n) => n.type === "Text").map(textOf);
const componentsNamed = (node: TestNode, name: string): TestNode[] =>
  node.findAll((n) => typeof n.type === "function" && (n.type as { name?: string }).name === name);

const event = {
  id: "event-rsvp-guest",
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
  allowPlusOnes: true,
  plusOnesMax: 1,
  waitlistEnabled: true,
  manualApproval: false,
  visibility: "public",
  discoverable: true,
};

const captured: { state: RsvpOfferingState | null } = { state: null };

const Harness: React.FC<Partial<RsvpOfferingBodyProps>> = (props) => {
  const state = useRsvpOfferingState({
    event,
    brand: null,
    palette,
    theme,
    config,
    isLoggedIn: false,
    onSubmit: jest.fn(),
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

// Every host ref gets a focusable stand-in that remembers its testID.
const focusCalls: string[] = [];
const createNodeMock = (element: { type: unknown; props: Record<string, unknown> }) => ({
  testID: element.props.testID,
  focus: () => focusCalls.push(String(element.props.testID)),
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

const type = async (tree: Renderer, testID: string, value: string): Promise<void> => {
  const input = byTestID(tree, testID)[0];
  await act(async () => {
    (input.props.onChangeText as (v: string) => void)(value);
  });
};

beforeEach(() => {
  focusCalls.length = 0;
  captured.state = null;
});

describe("an unreplied guest", () => {
  it("sees capacity at zero going and the audience line for a public, listed event", async () => {
    const tree = await mount();
    const texts = hostTexts(tree);
    expect(texts).toContain("Be the first to RSVP · 80 spots");
    expect(texts).toContain("Listed on Mingla · anyone can RSVP.");
    expect(texts).not.toContain("Anyone with the link can RSVP.");
  });

  it("sees an enabled Going with an add-me glyph, never the check mark", async () => {
    const tree = await mount();
    const going = byTestID(tree, "orch-1150-rsvp-going");
    expect(going).toHaveLength(2); // inline + floating
    for (const button of going) {
      expect(componentsNamed(button, "UserPlusGlyph")).toHaveLength(1);
      expect(componentsNamed(button, "CheckGlyph")).toHaveLength(0);
      expect(button.props.accessibilityState).toEqual({ disabled: false, selected: false });
    }
    // The inline copy tells screen readers the details come first.
    expect(going[0].props.accessibilityHint).toBe("Add your details above first");
  });

  it("gets a solid card around the floating decision", async () => {
    const tree = await mount();
    const card = byTestID(tree, "rsvp-floating-decision-card")[0];
    const style = Object.assign({}, ...(card.props.style as object[]));
    expect(style).toMatchObject({ borderRadius: 22, borderWidth: 1 });
    expect(typeof (style as { backgroundColor?: unknown }).backgroundColor).toBe("string");
    expect((style as { backgroundColor: string }).backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(componentsNamed(card, "RsvpMomentumDecision")).toHaveLength(1);
  });
});

describe("a blocked decision tap", () => {
  it("reveals and focuses the first missing field and shows the hint beside both decision copies", async () => {
    const onRevealField = jest.fn();
    const onSubmit = jest.fn();
    const tree = await mount({ onRevealField, onSubmit });

    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(focusCalls).toEqual(["orch-1150-rsvp-name"]);
    expect(onRevealField).toHaveBeenCalledTimes(1);
    expect((onRevealField.mock.calls[0][0] as { testID: string }).testID).toBe("orch-1150-rsvp-name");

    const hints = byTestID(tree, "rsvp-decision-validation-hint");
    expect(hints.map(textOf)).toEqual([
      "Add your name, email and phone number above to RSVP.",
      "Add your name, email and phone number above to RSVP.",
    ]);
    expect(hints[0].props.accessibilityLiveRegion).toBe("polite");
    // Empty required fields are now marked, not only malformed ones.
    const texts = hostTexts(tree);
    expect(texts).toEqual(expect.arrayContaining(["Add your name", "Add your email", "Add your phone number"]));
    // The old off-screen error line is gone.
    expect(byTestID(tree, "orch-1150-rsvp-error")).toHaveLength(0);
  });

  it("from the floating bar reveals the field instead of opening the details modal", async () => {
    const onRevealField = jest.fn();
    const tree = await mount({ onRevealField });
    const floatingMaybe = byTestID(tree, "rsvp-floating-decision-card")[0].findAll(
      (n) => typeof n.type === "string" && n.props.testID === "orch-1150-rsvp-maybe",
    )[0];

    await press(floatingMaybe);

    expect(onRevealField).toHaveBeenCalledTimes(1);
    expect(captured.state?.decisionAttempted).toBe(true);
    const modal = captured.state?.detailsModal as React.ReactElement<{ children: React.ReactElement<{ visible: boolean }> }>;
    expect(modal.props.children.props.visible).toBe(false);
  });

  it("narrows the hint as the guest fills in details, then clears it", async () => {
    const onRevealField = jest.fn();
    const tree = await mount({ onRevealField });
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);

    await type(tree, "orch-1150-rsvp-name", "Ada Lovelace");
    expect(textOf(byTestID(tree, "rsvp-decision-validation-hint")[0])).toBe(
      "Add your email and phone number above to RSVP.",
    );
    await type(tree, "orch-1150-rsvp-email", "ada@");
    expect(textOf(byTestID(tree, "rsvp-decision-validation-hint")[0])).toBe(
      "Add a valid email and your phone number above to RSVP.",
    );
    await type(tree, "orch-1150-rsvp-email", "ada@example.com");
    await type(tree, "orch-1150-rsvp-phone", "+1 555 123 4567");
    expect(byTestID(tree, "rsvp-decision-validation-hint")).toHaveLength(0);

    // With details complete, Going opens the confirmation instead of revealing.
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    expect(onRevealField).toHaveBeenCalledTimes(1);
    const dialog = captured.state?.confirmDialog as React.ReactElement<{ children: React.ReactElement<{ visible: boolean }> }>;
    expect(dialog.props.children.props.visible).toBe(true);
  });
});

describe("a reply the page restored after the chip-in redirect", () => {
  const snapshot: RsvpGuestSnapshot = {
    version: 1,
    eventId: "event-rsvp-guest",
    rsvpId: "rsvp-1",
    guestStatus: "going",
    guestApproval: "approved",
    details: {
      eventName: "Neighbors Night on Wythe",
      dateLine: "Sat 26 Sept · 7 PM – 10 PM",
      venueLine: "Lantern Room",
      guestName: "Ada",
      status: "going",
      plusGuests: [],
      confirmationToken: null,
      credentials: [
        { entityType: "primary", entityId: "rsvp-1", displayName: "Ada", qrCode: "mingla:v1:rsvp:x", pdfFetchRef: "ref" },
      ],
      anonymousRecovery: [
        { entityType: "primary", entityId: "rsvp-1", recoveryToken: "tok", recoveryUrl: null },
      ],
    },
    savedAtMs: 1,
  };

  it("shows the guest as going, with the check mark and their pass, and no contact form", async () => {
    const onSubmit = jest.fn();
    const tree = await mount({ restoredRsvp: snapshot, onSubmit });
    const going = byTestID(tree, "orch-1150-rsvp-going");
    expect(going[0].props.accessibilityLabel).toBe("You're going");
    expect(going[0].props.accessibilityState).toEqual({ disabled: true, selected: true });
    expect(componentsNamed(going[0], "CheckGlyph")).toHaveLength(1);
    expect(byTestID(tree, "orch-1157-rsvp-contact")).toHaveLength(0);

    const viewPass = byTestID(tree, "rsvp-view-pass");
    expect(viewPass.length).toBeGreaterThan(0);
    await press(viewPass[0]);
    const popup = captured.state?.successPopup as React.ReactElement<{ children: React.ReactElement<{ visible: boolean; details: unknown }> }>;
    expect(popup.props.children.props.visible).toBe(true);
    expect(popup.props.children.props.details).toEqual(snapshot.details);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("goes back to the invite when the host withdraws an unverifiable reply", async () => {
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness restoredRsvp={snapshot} />, { createNodeMock });
    });
    expect(byTestID(tree, "orch-1150-rsvp-going")[0].props.accessibilityLabel).toBe("You're going");
    await act(async () => {
      tree.update(<Harness restoredRsvp={null} />);
    });
    expect(byTestID(tree, "orch-1150-rsvp-going")[0].props.accessibilityLabel).toBe("Going");
    expect(byTestID(tree, "rsvp-view-pass")).toHaveLength(0);
  });

  it("reports each accepted reply so the page can keep it for the tab", async () => {
    const onRsvpResolved = jest.fn();
    const onSubmit = jest.fn(async () => ({
      status: "maybe" as const,
      approvalStatus: "approved" as const,
      rsvpId: "rsvp-9",
      confirmationToken: null,
    }));
    const tree = await mount({ onRsvpResolved, onSubmit, onRevealField: jest.fn() });
    await type(tree, "orch-1150-rsvp-name", "Ada Lovelace");
    await type(tree, "orch-1150-rsvp-email", "ada@example.com");
    await type(tree, "orch-1150-rsvp-phone", "+1 555 123 4567");
    await press(byTestID(tree, "orch-1150-rsvp-maybe")[0]);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onRsvpResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        eventId: "event-rsvp-guest",
        rsvpId: "rsvp-9",
        guestStatus: "maybe",
        guestApproval: "approved",
        details: null,
      }),
    );
  });
});

describe("the momentum card", () => {
  const render = async (props: Partial<React.ComponentProps<typeof RsvpMomentumDecision>>): Promise<Renderer> => {
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <RsvpMomentumDecision
          palette={palette}
          theme={theme}
          goingCount={0}
          capacity={80}
          ctaState="open"
          guestStatus={null}
          guestApproval={null}
          partyTypes={[]}
          allowPlusOnes={false}
          plusOnesMax={0}
          plusCount={0}
          onPlusChange={() => undefined}
          waitlistEnabled
          submitting={false}
          contactReady
          onGoing={() => undefined}
          onMaybe={() => undefined}
          onNotGoing={() => undefined}
          variant="inline"
          showMomentum
          {...props}
        />,
      );
    });
    return tree;
  };

  it("keeps the spots hidden when the host hides the spots-left count", async () => {
    const shown = await render({});
    expect(textOf(byTestID(shown, "orch-1157-rsvp-momentum-sub")[0])).toBe("Be the first to RSVP · 80 spots");
    const hidden = await render({ hideRemainingCount: true });
    expect(textOf(byTestID(hidden, "orch-1157-rsvp-momentum-sub")[0])).toBe("Be the first to RSVP");
  });

  it("says 'Full' rather than promising a waitlist that is switched off", async () => {
    const tree = await render({ goingCount: 80, ctaState: "full", waitlistEnabled: false });
    expect(textOf(byTestID(tree, "orch-1157-rsvp-momentum-sub")[0])).toBe("Full");
  });
});

describe("#3416 plus-one field copy", () => {
  it("marks an empty plus-one's name, email and phone the way it marks the guest's own", async () => {
    const tree = await mount({});
    await press(byTestID(tree, "orch-1157-rsvp-plus-plus")[0]);
    await press(byTestID(tree, "orch-1150-rsvp-going")[0]);
    const texts = hostTexts(tree);
    expect(texts).toEqual(expect.arrayContaining(["Add their name", "Add their email", "Add their phone number"]));
    expect(texts).not.toContain("Required");
  });
});
