import type { CollectionBeforeChangeHook } from "payload";
import { usesBookingBlocksFeature } from "../contracts/generated/blocks.ts";

/*
 * #4453 milestone 5 — SITES_BOOKING_BLOCKS gates OFFERING the live booking
 * blocks (availability, ticket tiers, how it works), the hero booking bar
 * and the Mingla rating. A signed request from Mingla (the Website screen,
 * Ari) may ADD one only when Core signed the flag in as on
 * (`minglaBookingBlocks`). A block already on the page always keeps saving
 * and rendering: rendering a stored block is never flagged (spec §9), and
 * turning the flag off never breaks a page that has one.
 *
 * Studio staff (signed in to Studio itself, not a signed Mingla request) are
 * not gated: Studio is Mingla's internal tool, used to set up and check
 * fixtures before rollout.
 */
type RawBlock = Record<string, unknown> & { id?: unknown; blockType?: unknown };

function key(block: RawBlock): string {
  return `${String(block.blockType)}:${String(block.id ?? "")}`;
}

/** The booking-feature blocks in `next` that were not already in `previous` (matched by block id and type). */
export function newBookingFeatureBlocks(next: readonly RawBlock[], previous: readonly RawBlock[]): RawBlock[] {
  const before = new Set(previous.filter((block) => usesBookingBlocksFeature(block)).map(key));
  return next.filter((block) => usesBookingBlocksFeature(block) && (!block.id || !before.has(key(block))));
}

export const gateBookingBlocks: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (req.context?.minglaSignedCore !== true || req.context?.minglaBookingBlocks === true) return data;
  const next = Array.isArray(data?.blocks) ? (data.blocks as RawBlock[]) : [];
  const previous = Array.isArray(originalDoc?.blocks) ? (originalDoc.blocks as RawBlock[]) : [];
  if (newBookingFeatureBlocks(next, previous).length) throw new Error("BOOKING_BLOCKS_OFF");
  return data;
};
