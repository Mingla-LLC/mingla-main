// MINGLA-INVARIANT: I-ADDON-EXPLORER-SLOT-OPT-IN | issue #3281 | Explorer detail screens list add-ons only while FEATURE_FLAG_ADD_ONS is on, with stored public object thumbnails, never an image transformation URL.
/**
 * issue #3281 S2 — Explorer's `addOns` slot for the shared offering bodies.
 * FAILS-ON-REVERT: drop the FEATURE_FLAG_ADD_ONS check (the off case reds) or
 * build the thumbnail from a transformation endpoint (the URL case reds).
 */
import React from "react";

// The shared block is pinned by its own suites; here only the slot's wiring.
jest.mock("@mingla/offering-rendering/OfferingAddOnsBlock", () => ({
  OfferingAddOnsBlock: (): null => null,
}));
const mockFlag = { on: false };
jest.mock("../../../config/featureFlags", () => ({
  get FEATURE_FLAG_ADD_ONS() {
    return mockFlag.on;
  },
}));

type Slot = ((id: string, addOns: unknown, currency: string | null, palette: unknown) => React.ReactNode) | null;
const load = (): { publicAddOnsSlot: () => Slot; addOnPhotoUrl: (p: string) => string } => {
  let mod!: { publicAddOnsSlot: () => Slot; addOnPhotoUrl: (p: string) => string };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../publicAddOnsSlot");
  });
  return mod;
};

describe("#3281 Explorer public add-ons slot", () => {
  test("off: no slot", () => {
    mockFlag.on = false;
    expect(load().publicAddOnsSlot()).toBeNull();
  });
  test("on: a slot that renders the shared block for that card", () => {
    mockFlag.on = true;
    const slot = load().publicAddOnsSlot();
    expect(typeof slot).toBe("function");
    const el = slot?.("t-1", [{ id: "a" }], "USD", {}) as React.ReactElement<Record<string, unknown>>;
    expect(el.props).toMatchObject({ enabled: true, id: "t-1", currency: "USD" });
  });
  test("thumbnails are the stored public objects, never a transformation URL", () => {
    const url = load().addOnPhotoUrl("add-ons/e1/x1_thumb.jpg");
    expect(url).toMatch(/\/storage\/v1\/object\/public\/event_covers\/add-ons\/e1\/x1_thumb\.jpg$/);
    expect(url).not.toContain("render/image");
  });
});
