// INVARIANT sites-caption-not-booking: gallery captions never trip BOOKING_BLOCKS_OFF
/*
 * #4572 items 10/11 (D11) — an owner typing the first caption in a Photos
 * section was refused ("Your design doesn't have that kind of section") and
 * lost the whole edit. FAILS-ON-REVERT: with the gate reading the contract's
 * usesBookingBlocksFeature, the first caption is a "new booking feature".
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeBookingBlocksGate, newBookingFeatureBlocks, usesGatedBookingFeature } from "./bookingBlocksGate";

const gallery = (images: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ id: "g1", blockType: "gallery", images, ...extra });
const owner = { req: { context: {}, user: { siteId: "8a0b8c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d" } } };
const run = (gate: ReturnType<typeof makeBookingBlocksGate>, next: unknown[], previous: unknown[]) =>
  (gate as unknown as (args: unknown) => Promise<unknown>)({ data: { blocks: next }, originalDoc: { blocks: previous }, ...owner });

describe("#4572 D11 — captions are words, not booking", () => {
  it("the first caption on a gallery is not a gated feature", () => {
    expect(usesGatedBookingFeature(gallery([{ id: "i1", media: "m1", caption: "Opening night" }]))).toBe(false);
    expect(usesGatedBookingFeature(gallery([{ id: "i1", media: "m1" }], { captions: ["Opening night"] }))).toBe(false);
  });

  it("an owner saves the first caption with the booking flag off AND on", async () => {
    for (const flag of [false, true]) {
      const gate = makeBookingBlocksGate(async () => flag);
      await expect(run(gate, [gallery([{ id: "i1", media: "m1", caption: "Opening night" }])], [gallery([{ id: "i1", media: "m1" }])])).resolves.toBeTruthy();
    }
  });

  it("a real booking feature is still refused with the flag off, captions or not", async () => {
    const gate = makeBookingBlocksGate(async () => false);
    const rated = { id: "t1", blockType: "testimonials", show_rating: true, items: [] };
    await expect(run(gate, [gallery([{ id: "i1", media: "m1", caption: "x" }]), rated], [gallery([{ id: "i1", media: "m1" }]), { ...rated, show_rating: false }]))
      .rejects.toThrow("BOOKING_BLOCKS_OFF");
    expect(newBookingFeatureBlocks([rated], [])).toHaveLength(1);
  });

  it("the contract list is not edited (the exemption lives only in the CMS gate)", () => {
    const contract = fs.readFileSync(path.join(process.cwd(), "../packages/site-contracts/src/blocks.ts"), "utf8");
    expect(contract).toContain('"gallery.captions"];');
  });
});
