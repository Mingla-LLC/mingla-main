/** Issue #3645 (payments audit item 7 follow-through) — the chip-in panel
 * words each server refusal from the error the surface throws.
 *
 * Drives the REAL shared `useRsvpOfferingState` (as PublicEventPage /
 * ConsumerEventDetailScreen mount it) for a restored Going guest with chip-in
 * on, and submits through the inline panel's own `onSubmit`. Only the
 * surface's `onChipIn` transport is stubbed: it rejects the way the fixed
 * callers do (`chipInRefusalFromBody`) or the way an older caller does
 * (`new Error(code)`).
 */
import React from "react";
import { View } from "react-native";
import {
  useRsvpOfferingState,
  type RsvpOfferingBodyProps,
  type RsvpOfferingState,
} from "@mingla/offering-rendering/RsvpOfferingBody";
import { chipInRefusalFromBody } from "@mingla/offering-rendering/chipInRefusal";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("react-native", () => {
  const base = jest.requireActual("../../../../__manual_mocks__/react-native.js");
  const curve = (x: number) => x;
  return {
    ...base,
    Easing: { inOut: () => curve, out: () => curve, in: () => curve, ease: curve, linear: curve },
    AccessibilityInfo: { announceForAccessibility: jest.fn(), setAccessibilityFocus: jest.fn() },
  };
});
jest.mock("react-native-svg", () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null, Rect: () => null, G: () => null }), { virtual: true });
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }), { virtual: true });

type Tree = { update: (node: React.ReactElement) => void; unmount: () => void };
const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement, options?: { createNodeMock?: () => unknown }) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);
const EVENT = "chip-night";

const restored = {
  version: 1, eventId: EVENT, rsvpId: "rsvp-chip", guestStatus: "going", guestApproval: "approved", savedAtMs: Date.now() - 1_000,
  details: {
    eventName: "Chip Night", dateLine: "Saturday", venueLine: "Test Venue", guestName: "Guest", status: "going", plusGuests: [], confirmationToken: null,
    credentials: [{ entityType: "primary", entityId: "rsvp-chip", displayName: "Guest", qrCode: "qr", pdfFetchRef: "rsvp-chip" }],
    anonymousRecovery: [],
  },
};

type PanelProps = {
  onSubmit: () => void;
  onAmountChange: (cents: number) => void;
  errorText: string | null;
  state: string;
  minCents: number | null;
};

let current: RsvpOfferingState;
function Harness({ onChipIn, currency, hostMinCents, eventId = EVENT }: {
  onChipIn: jest.Mock;
  currency: string;
  hostMinCents: number | null;
  eventId?: string;
}) {
  const config = {
    capacity: 80, goingCount: 1, allowPlusOnes: false, plusOnesMax: 0, waitlistEnabled: false, manualApproval: false,
    rsvp_contribution_enabled: true,
    rsvp_contribution_min_cents: hostMinCents,
    rsvp_contribution_suggested_cents: null,
    settlementCurrency: currency,
  };
  current = useRsvpOfferingState({
    event: { id: eventId, name: "Chip Night", dateLine: "Saturday", description: "", format: "in-person", venueName: "Test Venue", address: "Test Street", hideAddressUntilTicket: false, currency, tickets: [] } as unknown as RsvpOfferingBodyProps["event"],
    brand: null, palette, theme, config, isLoggedIn: false, replyIdentity: null,
    initialGuestName: "Guest", initialGuestEmail: "guest@example.test", initialGuestPhone: "+2348012345678",
    restoredRsvp: restored, onSubmit: jest.fn(), onChipIn,
  } as unknown as RsvpOfferingBodyProps);
  return <View />;
}

const trees: Tree[] = [];
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => { tree.unmount(); });
});

const mount = async (onChipIn: jest.Mock, currency = "NGN", hostMinCents: number | null = 5_000) => {
  await act(async () => {
    trees.push(create(<Harness onChipIn={onChipIn} currency={currency} hostMinCents={hostMinCents} />, { createNodeMock: () => ({ focus: jest.fn(), setAttribute: jest.fn() }) }));
  });
};
/** Re-render the SAME mounted hook (surfaces reuse it across events). */
const rerender = async (props: { onChipIn: jest.Mock; currency: string; hostMinCents: number | null; eventId?: string }) => {
  await act(async () => { trees[trees.length - 1].update(<Harness {...props} />); });
};
/** The inline panel's props: `<Suspense><RsvpChipInPanel …/></Suspense>`. */
const panel = (): PanelProps => {
  const node = current.chipInInlinePanel as React.ReactElement<{ children: React.ReactElement<PanelProps> }> | null;
  if (node === null) throw new Error("chip-in panel not mounted");
  return node.props.children.props;
};
const typeAmount = async (major: number) => { await act(async () => { panel().onAmountChange(major * 100); }); };
const submit = async () => { await act(async () => { panel().onSubmit(); await Promise.resolve(); }); };
const providerFloor = (minCents: unknown, reason: unknown = "provider_minimum") =>
  chipInRefusalFromBody("amount_below_min", { error: "amount_below_min", minCents, reason });

describe("#3645 chip-in refusal copy", () => {
  it("names the provider floor the server sent, not the lower host minimum (₦50 host, ₦100 floor)", async () => {
    const onChipIn = jest.fn().mockRejectedValue(providerFloor(10_000));
    await mount(onChipIn);
    expect(panel().minCents).toBe(5_000);
    await typeAmount(60);
    await submit();
    expect(onChipIn).toHaveBeenCalledWith({ amountCents: 6_000 });
    expect(panel().errorText).toMatch(/^Add at least .*100\.$/);
    expect(panel().errorText).not.toMatch(/50\./);
    expect(panel().state).toBe("error");
  });

  it("remembers the floor: the panel shows it and the next low tap is refused without a call", async () => {
    const onChipIn = jest.fn().mockRejectedValue(providerFloor(10_000));
    await mount(onChipIn);
    await typeAmount(60);
    await submit();
    expect(panel().minCents).toBe(10_000);
    await typeAmount(80);
    await submit();
    expect(onChipIn).toHaveBeenCalledTimes(1);
    expect(panel().errorText).toMatch(/^Add at least .*100\.$/);
  });

  it("rounds a fractional floor UP to a whole unit (GBP 30p → £1, never £0)", async () => {
    const onChipIn = jest.fn().mockRejectedValue(providerFloor(30));
    await mount(onChipIn, "GBP", null);
    await typeAmount(1);
    await submit();
    expect(panel().errorText).toMatch(/^Add at least .*1\.$/);
    expect(panel().errorText).not.toMatch(/0\.$/);
  });

  it("falls back to the host minimum when the error carries no usable floor (older caller / bad body)", async () => {
    for (const thrown of [new Error("amount_below_min"), providerFloor("10000"), providerFloor(-5), providerFloor(12.5), providerFloor(Number.NaN)]) {
      const onChipIn = jest.fn().mockRejectedValue(thrown);
      await mount(onChipIn);
      await typeAmount(60);
      await submit();
      expect(panel().errorText).toMatch(/^Add at least .*50\.$/);
    }
  });

  it("says 'Add a little more.' with no host minimum and no server floor", async () => {
    const onChipIn = jest.fn().mockRejectedValue(new Error("amount_below_min"));
    await mount(onChipIn, "NGN", null);
    await typeAmount(60);
    await submit();
    expect(panel().errorText).toBe("Add a little more.");
  });

  it("keeps the other refusals: brand_cannot_collect pauses, amount_invalid asks for an amount, anything else is generic", async () => {
    const paused = jest.fn().mockRejectedValue(chipInRefusalFromBody("brand_cannot_collect", { error: "brand_cannot_collect" }));
    await mount(paused);
    await typeAmount(200);
    await submit();
    expect(panel().state).toBe("paused");
    expect(panel().errorText).toBeNull();

    const invalid = jest.fn().mockRejectedValue(chipInRefusalFromBody("amount_invalid", null));
    await mount(invalid);
    await typeAmount(200);
    await submit();
    expect(panel().errorText).toBe("Enter an amount to chip in.");

    const other = jest.fn().mockRejectedValue(new Error("Edge Function returned a non-2xx status code"));
    await mount(other);
    await typeAmount(200);
    await submit();
    expect(panel().errorText).toBe("Couldn't process that. Try again.");
  });

  it("a floor learned on one event never carries to the next (same mounted hook, new event and currency)", async () => {
    const onChipIn = jest.fn().mockRejectedValueOnce(providerFloor(10_000)).mockResolvedValue({ kind: "redirecting" });
    await mount(onChipIn);
    await typeAmount(60);
    await submit();
    expect(panel().minCents).toBe(10_000);
    await rerender({ onChipIn, currency: "USD", hostMinCents: null, eventId: "other-event" });
    expect(panel().minCents).toBeNull();
    expect(panel().errorText).toBeNull();
    await typeAmount(5);
    await submit();
    expect(onChipIn).toHaveBeenCalledTimes(2);
    expect(onChipIn).toHaveBeenLastCalledWith({ amountCents: 500 });
    expect(panel().errorText).toBeNull();
  });

  it("after a fractional floor the panel minimum and the next tap's copy are whole units (DKK 2.30 -> 3, never 2)", async () => {
    // The field takes whole units, so a guest can type 2 under a 2.30 floor:
    // the remembered check refuses it here and must name 3 (nearest says 2).
    const onChipIn = jest.fn().mockRejectedValue(providerFloor(230));
    await mount(onChipIn, "DKK", null);
    await typeAmount(1);
    await submit();
    expect(panel().minCents).toBe(300);
    await typeAmount(2);
    await submit();
    expect(onChipIn).toHaveBeenCalledTimes(1);
    expect(panel().errorText).toMatch(/^Add at least .*3\.$/);
  });

  it("a host minimum raised above the remembered floor wins", async () => {
    const onChipIn = jest.fn().mockRejectedValue(providerFloor(10_000));
    await mount(onChipIn);
    await typeAmount(60);
    await submit();
    expect(panel().minCents).toBe(10_000);
    await rerender({ onChipIn, currency: "NGN", hostMinCents: 20_000 });
    expect(panel().minCents).toBe(20_000);
    await typeAmount(150);
    await submit();
    expect(onChipIn).toHaveBeenCalledTimes(1);
    expect(panel().errorText).toMatch(/^Add at least .*200\.$/);
  });
});
