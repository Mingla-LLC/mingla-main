/**
 * issue #3827 going-box — the going box, rendered (amendment §6.1 A-R1..A-R10).
 *
 * Mounts the REAL shared RSVP state hook, inline decision box, floating bar,
 * RSVP momentum card and ticketed OfferingMomentum from packages/offering-
 * rendering (deep specifiers) with react-test-renderer and the lightweight
 * react-native mock — the same harness as rsvp_public_guest_page_render.test.tsx.
 *
 * FAILS-ON-REVERT: remove `unitVisible` from RsvpMomentumDecision -> A-R1 ("0 going"
 * back); fold extras into hasGoing -> A-R4 (cluster on extras only); drop showMeter
 * -> A-R4 / A-R8; remove the private/null guard in OfferingMomentum -> A-R6 / A-R7.
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
type Renderer = { root: TestNode };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

import {
  RsvpDecisionBox,
  RsvpOfferingFloatingBar,
  useRsvpOfferingState,
  type RsvpOfferingBodyProps,
  type RsvpOfferingConfig,
} from "@mingla/offering-rendering/RsvpOfferingBody";
import { RsvpMomentumDecision } from "@mingla/offering-rendering/RsvpMomentumDecision";
import { OfferingMomentum } from "@mingla/offering-rendering/OfferingMomentum";
import type { SocialProofSummary } from "@mingla/offering-rendering/socialProofTypes";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byTestID = (tree: Renderer | TestNode, testID: string): TestNode[] =>
  ("root" in tree ? tree.root : tree).findAll(
    (n) => typeof n.type === "string" && n.props.testID === testID,
  );
const allText = (tree: Renderer): string =>
  tree.root.findAll((n) => n.type === "Text").map(textOf).join(" | ");

const event = {
  id: "event-3827",
  name: "Going box night",
  dateLine: "Sat 26 Sept · 7 PM – 10 PM",
  description: "",
  format: "in_person",
  venueName: "Lantern Room",
  address: "61 Wythe Avenue",
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

const Page: React.FC<{ config: RsvpOfferingConfig }> = ({ config }) => {
  const state = useRsvpOfferingState({
    event,
    brand: null,
    palette,
    theme,
    config,
    isLoggedIn: false,
    onSubmit: jest.fn(),
  } as RsvpOfferingBodyProps);
  return (
    <View>
      <View testID="inline-host">
        <RsvpDecisionBox palette={palette} theme={theme} config={config} state={state} />
      </View>
      <View testID="dock-host">
        <RsvpOfferingFloatingBar palette={palette} theme={theme} config={config} state={state} />
      </View>
    </View>
  );
};

const mountPage = async (overrides: Partial<RsvpOfferingConfig>): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Page config={{ ...baseConfig, ...overrides }} />);
  });
  return tree;
};

const mountCard = async (
  props: Partial<React.ComponentProps<typeof RsvpMomentumDecision>>,
): Promise<Renderer> => {
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

const proof = (over: Partial<SocialProofSummary>): SocialProofSummary => ({
  eventId: "event-3827",
  entityType: "event",
  goingCount: 0,
  capacity: 50,
  privateGuestList: false,
  hideRemainingCount: false,
  sample: [],
  extraGuestCount: 0,
  capacityFull: false,
  ...over,
});

const mountOffering = async (socialProof: SocialProofSummary | null): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <OfferingMomentum
        palette={palette}
        theme={theme}
        socialProof={socialProof}
        onSeeWhosGoing={() => undefined}
      />,
    );
  });
  return tree;
};

describe("issue #3827 — RSVP page, nobody going (R-2 / R-4)", () => {
  it("A-R1: R=0, X=0, C=80 → no box, an '80 spots' chip, kicker and decision still there", async () => {
    const tree = await mountPage({});
    expect(byTestID(tree, "orch-1157-rsvp-momentum")).toHaveLength(0);
    expect(byTestID(tree, "orch-1157-rsvp-going-count")).toHaveLength(0);
    expect(byTestID(tree, "orch-1157-rsvp-meter")).toHaveLength(0);
    const chips = byTestID(tree, "issue-3827-rsvp-capacity-chip");
    expect(chips).toHaveLength(1);
    expect(textOf(chips[0])).toBe("80 spots");
    expect(byTestID(tree, "orch-1157-rsvp-kicker")).toHaveLength(1);
    expect(byTestID(tree, "orch-1150-rsvp-going")).toHaveLength(2);
    const text = allText(tree);
    expect(text).not.toMatch(/\b0 going\b/);
    expect(text).not.toContain("Be the first");
  });

  it("A-R1b: a withheld (null) count renders no box and is never read as 0", async () => {
    const tree = await mountPage({ goingCount: null });
    expect(byTestID(tree, "orch-1157-rsvp-momentum")).toHaveLength(0);
    expect(textOf(byTestID(tree, "issue-3827-rsvp-capacity-chip")[0])).toBe("80 spots");
  });

  it("A-R1c: 'Hide the spots-left count' → no box and no chip", async () => {
    const tree = await mountPage({ hideRemainingCount: true });
    expect(byTestID(tree, "orch-1157-rsvp-momentum")).toHaveLength(0);
    expect(byTestID(tree, "issue-3827-rsvp-capacity-chip")).toHaveLength(0);
  });
});

describe("issue #3827 — RSVP page, private list (R-1 / R-5)", () => {
  it("A-R2: private, count withheld, server full, waitlist on → chip 'Full · waitlist open', Going = Join waitlist", async () => {
    const tree = await mountPage({
      privateGuestList: true,
      goingCount: null,
      capacityFull: true,
      waitlistEnabled: true,
    });
    expect(byTestID(tree, "orch-1157-rsvp-momentum")).toHaveLength(0);
    expect(textOf(byTestID(tree, "issue-3827-rsvp-capacity-chip")[0])).toBe("Full · waitlist open");
    const going = byTestID(tree, "orch-1150-rsvp-going");
    expect(going.length).toBeGreaterThan(0);
    for (const button of going) expect(textOf(button)).toContain("Join waitlist");
  });

  it("A-R3: private, server full, waitlist off → chip 'Full', Going disabled", async () => {
    const tree = await mountPage({
      privateGuestList: true,
      goingCount: null,
      capacityFull: true,
      waitlistEnabled: false,
    });
    expect(textOf(byTestID(tree, "issue-3827-rsvp-capacity-chip")[0])).toBe("Full");
    for (const button of byTestID(tree, "orch-1150-rsvp-going")) {
      expect((button.props.accessibilityState as { disabled?: boolean }).disabled).toBe(true);
    }
  });

  it("A-R2b: private with a real count from an older server still renders no box", async () => {
    const tree = await mountCard({ goingCount: 12, privateGuestList: true });
    expect(byTestID(tree, "orch-1157-rsvp-momentum")).toHaveLength(0);
    expect(allText(tree)).not.toContain("12");
  });
});

describe("issue #3827 — RSVP card with guests on the host's own list", () => {
  it("A-R4: R=0, X=12, C=80 → '12 going', '80 spots left', no meter, no faces, no chip", async () => {
    const tree = await mountCard({ goingCount: 0, extraGuestCount: 12 });
    expect(byTestID(tree, "orch-1157-rsvp-momentum")).toHaveLength(1);
    expect(textOf(byTestID(tree, "orch-1157-rsvp-going-count")[0])).toBe("12");
    expect(textOf(byTestID(tree, "orch-1157-rsvp-momentum-sub")[0])).toBe("80 spots left");
    expect(byTestID(tree, "orch-1157-rsvp-meter")).toHaveLength(0);
    expect(byTestID(tree, "orch-1157-rsvp-cluster")).toHaveLength(0);
    expect(byTestID(tree, "issue-3827-rsvp-capacity-chip")).toHaveLength(0);
  });

  it("A-R5: R=3, X=12, capacity hidden → '15', 'Open invite', cluster with +12", async () => {
    const tree = await mountCard({ goingCount: 3, extraGuestCount: 12, hideRemainingCount: true });
    expect(textOf(byTestID(tree, "orch-1157-rsvp-going-count")[0])).toBe("15");
    expect(textOf(byTestID(tree, "orch-1157-rsvp-momentum-sub")[0])).toBe("Open invite");
    expect(byTestID(tree, "orch-1157-rsvp-cluster")).toHaveLength(1);
    expect(allText(tree)).toContain("+12");
  });

  it("A-R5b: the meter fill follows the REAL count only (R=8 of 80, X=60 → 10%)", async () => {
    const tree = await mountCard({ goingCount: 8, extraGuestCount: 60 });
    expect(textOf(byTestID(tree, "orch-1157-rsvp-going-count")[0])).toBe("68");
    expect(textOf(byTestID(tree, "orch-1157-rsvp-momentum-sub")[0])).toBe("72 spots left · filling up");
    expect(byTestID(tree, "orch-1157-rsvp-meter")).toHaveLength(1);
  });
});

describe("issue #3827 — ticketed / trip / experience box (OfferingMomentum)", () => {
  it("A-R6: private with a number from an older server → no box at all", async () => {
    const tree = await mountOffering(proof({ privateGuestList: true, goingCount: 7 }));
    expect(byTestID(tree, "orch-1339-momentum")).toHaveLength(0);
  });

  it("A-R7: withheld count (null), not private → no box", async () => {
    const tree = await mountOffering(proof({ goingCount: null }));
    expect(byTestID(tree, "orch-1339-momentum")).toHaveLength(0);
  });

  it("A-R8: R=0, X=40, C=50 → '40', '50 spots left', no meter, no faces", async () => {
    const tree = await mountOffering(proof({ goingCount: 0, extraGuestCount: 40 }));
    expect(byTestID(tree, "orch-1339-momentum")).toHaveLength(1);
    expect(allText(tree)).toContain("40");
    expect(textOf(byTestID(tree, "orch-1339-momentum-sub")[0])).toBe("50 spots left");
    expect(byTestID(tree, "orch-1339-momentum-meter")).toHaveLength(0);
    expect(byTestID(tree, "orch-1339-momentum-cluster")).toHaveLength(0);
  });

  it("A-R8b: R=10, X=42, C=50 → '52', '40 spots left · filling up', meter 20% (real)", async () => {
    const tree = await mountOffering(proof({ goingCount: 10, extraGuestCount: 42 }));
    expect(allText(tree)).toContain("52");
    expect(textOf(byTestID(tree, "orch-1339-momentum-sub")[0])).toBe("40 spots left · filling up");
    const meter = byTestID(tree, "orch-1339-momentum-meter")[0];
    const style = Object.assign({}, ...(meter.props.style as object[]));
    expect((style as { width: string }).width).toBe("20%");
    expect(byTestID(tree, "orch-1339-momentum-cluster")).toHaveLength(1);
  });

  it("A-R8c: nobody going and no extras → no box (unchanged)", async () => {
    const tree = await mountOffering(proof({ goingCount: 0, extraGuestCount: 0 }));
    expect(byTestID(tree, "orch-1339-momentum")).toHaveLength(0);
  });
});

describe("issue #3827 — the floating dock and the host preview", () => {
  it("A-R9: the floating dock never carries the box or the chip, in any state", async () => {
    const states: Array<Partial<RsvpOfferingConfig>> = [
      {},
      { goingCount: null },
      { goingCount: 5, extraGuestCount: 7 },
      { privateGuestList: true, goingCount: null, capacityFull: true },
      { goingCount: 0, extraGuestCount: 12 },
    ];
    for (const state of states) {
      const tree = await mountPage(state);
      const dock = byTestID(tree, "dock-host")[0];
      expect(byTestID(dock, "orch-1157-rsvp-momentum")).toHaveLength(0);
      expect(byTestID(dock, "issue-3827-rsvp-capacity-chip")).toHaveLength(0);
    }
  });

  it("A-R10: host RSVP preview — private or no extras shows no box; extras 7 shows '7'", async () => {
    // Exactly what app/rsvp/[id]/preview.tsx passes: goingCount 0, extras 0 when
    // the draft is private, capacityFull false.
    const privateDraft = await mountPage({ goingCount: 0, extraGuestCount: 0, privateGuestList: true, capacityFull: false });
    expect(byTestID(privateDraft, "orch-1157-rsvp-momentum")).toHaveLength(0);
    const empty = await mountPage({ goingCount: 0, extraGuestCount: 0, capacityFull: false });
    expect(byTestID(empty, "orch-1157-rsvp-momentum")).toHaveLength(0);
    expect(textOf(byTestID(empty, "issue-3827-rsvp-capacity-chip")[0])).toBe("80 spots");
    const extras = await mountPage({ goingCount: 0, extraGuestCount: 7, capacityFull: false });
    const inline = byTestID(extras, "inline-host")[0];
    expect(textOf(byTestID(inline, "orch-1157-rsvp-going-count")[0])).toBe("7");
  });
});

// ── A-R11: the unlisted private RSVP that is already full ──────────────────────
// No read carries a full flag for an unlisted private RSVP, so the page offers
// Going. The server refuses with `rsvp_full`. The guest must see the honest full
// message, and the page must switch into the full state (Going disabled, "Full"
// chip) — never a generic error, and never a tap that refuses again.
const PageWithDialog: React.FC<{
  config: RsvpOfferingConfig;
  onSubmit: RsvpOfferingBodyProps["onSubmit"];
}> = ({ config, onSubmit }) => {
  const state = useRsvpOfferingState({
    event,
    brand: null,
    palette,
    theme,
    config,
    isLoggedIn: false,
    onSubmit,
  } as RsvpOfferingBodyProps);
  return (
    <View>
      <RsvpDecisionBox palette={palette} theme={theme} config={config} state={state} />
      {state.confirmDialog}
    </View>
  );
};

const typeInto = async (tree: Renderer, testID: string, value: string): Promise<void> => {
  const input = byTestID(tree, testID)[0];
  await act(async () => {
    (input.props.onChangeText as (v: string) => void)(value);
  });
};
const tap = async (node: TestNode | undefined): Promise<void> => {
  const onPress = node?.props.onPress;
  if (typeof onPress !== "function") throw new Error("not pressable");
  await act(async () => {
    (onPress as () => void)();
  });
};

describe("issue #3827 — an unlisted private RSVP that filled up (A-R11)", () => {
  it("shows the full message, then the full state; Going does not refuse again", async () => {
    const onSubmit = jest.fn(async () => {
      throw new Error("rsvp_full");
    }) as unknown as RsvpOfferingBodyProps["onSubmit"];
    const config: RsvpOfferingConfig = {
      ...baseConfig,
      waitlistEnabled: false,
      privateGuestList: true,
      hideRemainingCount: true,
      goingCount: null,
      // the unlisted invite-link read has no full flag
      capacityFull: undefined,
    };
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(<PageWithDialog config={config} onSubmit={onSubmit} />);
    });
    await typeInto(tree, "orch-1150-rsvp-name", "Ada Lovelace");
    await typeInto(tree, "orch-1150-rsvp-email", "ada@example.com");
    await typeInto(tree, "orch-1150-rsvp-phone", "+1 555 123 4567");

    // Before: nothing says full, so Going is offered.
    const goingBefore = byTestID(tree, "orch-1150-rsvp-going")[0];
    expect((goingBefore.props.accessibilityState as { disabled?: boolean }).disabled).toBe(false);
    await tap(goingBefore);
    await tap(byTestID(tree, "orch-1163-rsvp-going-confirm-cta")[0]);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // The refusal reads honestly, never the generic fallback.
    const text = allText(tree);
    expect(text).toContain("This event just filled up.");
    expect(text).not.toContain("Couldn't save your RSVP");

    // After: the page is in the full state.
    expect(textOf(byTestID(tree, "issue-3827-rsvp-capacity-chip")[0])).toBe("Full");
    const goingAfter = byTestID(tree, "orch-1150-rsvp-going")[0];
    expect((goingAfter.props.accessibilityState as { disabled?: boolean }).disabled).toBe(true);
    await act(async () => {
      (goingAfter.props.onPress as (() => void) | undefined)?.();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("with the waitlist on, the same refusal-free path lands the guest on the waitlist", async () => {
    const onSubmit = jest.fn(async () => ({
      rsvpId: "rsvp-w1",
      status: "waitlisted",
      approvalStatus: "approved",
      confirmationToken: null,
    })) as unknown as RsvpOfferingBodyProps["onSubmit"];
    const config: RsvpOfferingConfig = {
      ...baseConfig,
      waitlistEnabled: true,
      privateGuestList: true,
      hideRemainingCount: true,
      goingCount: null,
      capacityFull: undefined,
    };
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(<PageWithDialog config={config} onSubmit={onSubmit} />);
    });
    await typeInto(tree, "orch-1150-rsvp-name", "Ada Lovelace");
    await typeInto(tree, "orch-1150-rsvp-email", "ada@example.com");
    await typeInto(tree, "orch-1150-rsvp-phone", "+1 555 123 4567");
    await tap(byTestID(tree, "orch-1150-rsvp-going")[0]);
    await tap(byTestID(tree, "orch-1163-rsvp-going-confirm-cta")[0]);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(allText(tree)).toContain("On the waitlist");
    expect(allText(tree)).not.toContain("Couldn't save your RSVP");
  });
});
