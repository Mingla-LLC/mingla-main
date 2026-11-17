import type { CollectionBeforeChangeHook } from "payload";
import { usesBookingBlocksFeature } from "../contracts/generated/blocks.ts";
import { callCore } from "./gateway";

/*
 * #4453 milestone 5 — SITES_BOOKING_BLOCKS gates OFFERING the live booking
 * blocks (availability, ticket tiers, how it works), the hero booking bar
 * and the Mingla rating. A signed request from Mingla (the Website screen,
 * Ari) may ADD one only when Core signed the flag in as on
 * (`minglaBookingBlocks`). A block already on the page always keeps saving
 * and rendering: rendering a stored block is never flagged (spec §9), and
 * turning the flag off never breaks a page that has one.
 *
 * Studio editors signed in to Studio itself are gated too (the spec exempts
 * no one): Studio asks Core for the flag for the editor's own site (cached
 * 60 s; any failure reads as OFF, so a new block is refused, never let
 * through).
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

const FLAG_TTL_MS = 60_000;
const flagCache = new Map<string, { enabled: boolean; at: number }>();

/** Test hook. */
export function clearBookingFlagCache(): void {
  flagCache.clear();
}

export type FlagReader = (siteId: string) => Promise<boolean>;

/** Core's SITES_BOOKING_BLOCKS for one site (signed CMS → Core); fails closed. */
export const coreBookingFlag: FlagReader = async (siteId) => {
  const hit = flagCache.get(siteId);
  if (hit && Date.now() - hit.at < FLAG_TTL_MS) return hit.enabled;
  let enabled = false;
  try {
    const data = await callCore(`/internal/v1/sites/${siteId}/booking-blocks`, siteId, crypto.randomUUID(), {}) as { enabled?: unknown } | null;
    enabled = data?.enabled === true;
  } catch {
    enabled = false;
  }
  flagCache.set(siteId, { enabled, at: Date.now() });
  return enabled;
};

export function makeBookingBlocksGate(readFlag: FlagReader): CollectionBeforeChangeHook {
  return async ({ data, originalDoc, req }) => {
    if (req.context?.minglaBookingBlocks === true) return data;
    const next = Array.isArray(data?.blocks) ? (data.blocks as RawBlock[]) : [];
    const previous = Array.isArray(originalDoc?.blocks) ? (originalDoc.blocks as RawBlock[]) : [];
    if (!newBookingFeatureBlocks(next, previous).length) return data;
    // A signed Mingla request carries Core's answer already (absent = off).
    if (req.context?.minglaSignedCore === true) throw new Error("BOOKING_BLOCKS_OFF");
    const siteId = (req.user as { siteId?: unknown } | null | undefined)?.siteId;
    if (typeof siteId !== "string" || !(await readFlag(siteId))) throw new Error("BOOKING_BLOCKS_OFF");
    return data;
  };
}

export const gateBookingBlocks: CollectionBeforeChangeHook = makeBookingBlocksGate(coreBookingFlag);
