/**
 * #4453 milestone 5 — SITES_BOOKING_BLOCKS gates OFFERING the booking blocks,
 * for signed Mingla requests AND Studio's own editors; stored blocks keep saving.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./gateway", () => ({ callCore: vi.fn() }));
import { makeBookingBlocksGate, newBookingFeatureBlocks } from "./bookingBlocksGate";

const run = (gate: ReturnType<typeof makeBookingBlocksGate>, blocks: unknown[], previous: unknown[], req: Record<string, unknown>) =>
  gate({ data: { blocks }, originalDoc: { blocks: previous }, req } as never);

describe("#4453 M5 booking blocks gate", () => {
  const added = [{ blockType: "availability", id: "b1", source: "venue_slots" }];
  it("refuses a NEW booking block for a Studio editor while Core says off; allows it when on", async () => {
    const off = makeBookingBlocksGate(async () => false);
    await expect(run(off, added, [], { context: {}, user: { siteId: "s1" } })).rejects.toThrow("BOOKING_BLOCKS_OFF");
    const on = makeBookingBlocksGate(async () => true);
    await expect(run(on, added, [], { context: {}, user: { siteId: "s1" } })).resolves.toBeTruthy();
  });
  it("an editor with no site, and a signed request without the flag, are refused (fail closed)", async () => {
    const reader = vi.fn(async () => true);
    const gate = makeBookingBlocksGate(reader);
    await expect(run(gate, added, [], { context: {}, user: null })).rejects.toThrow("BOOKING_BLOCKS_OFF");
    await expect(run(gate, added, [], { context: { minglaSignedCore: true }, user: null })).rejects.toThrow("BOOKING_BLOCKS_OFF");
    await expect(run(gate, added, [], { context: { minglaSignedCore: true, minglaBookingBlocks: true } })).resolves.toBeTruthy();
  });
  it("a block already on the page keeps saving with the flag off; other edits are never asked about", async () => {
    const reader = vi.fn(async () => false);
    const gate = makeBookingBlocksGate(reader);
    await expect(run(gate, added, added, { context: {}, user: { siteId: "s1" } })).resolves.toBeTruthy();
    await expect(run(gate, [{ blockType: "faq", id: "f" }], [], { context: {}, user: { siteId: "s1" } })).resolves.toBeTruthy();
    expect(reader).not.toHaveBeenCalled();
    expect(newBookingFeatureBlocks([{ blockType: "hero", id: "h", booking_bar: "venue_table" }], [{ blockType: "hero", id: "h" }])).toHaveLength(1);
  });
});
