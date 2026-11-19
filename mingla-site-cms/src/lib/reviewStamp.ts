import type { CollectionBeforeChangeHook, Field } from "payload";
import {
  UNREVIEWED_SECTIONS,
  unreviewedPages,
  type BlockReviewStamp,
  type ReviewSource,
  type UnreviewedPage,
} from "../contracts/generated/publishChecks.ts";
import { editorCoreUserId } from "../collections/SiteContent";

/*
 * #4453 (spec v1 §4.3) — the Draft stamp on every block Ari or the composer
 * writes. Studio only: set by this hook alone (a caller's value is always
 * dropped, the way `drafted_by` is), never copied into an artifact, and a
 * publish is refused while an enabled page holds a Draft block.
 *
 *   - A signed Core write that raised `minglaReviewSource` ("ari" or
 *     "composer") stamps every NEW or CHANGED block Draft. Core raises it only
 *     while SITES_PROOF_PART is on, so nothing changes for owners until then.
 *   - `minglaMarkReviewed` (the "Looks right" action, after Core checked the
 *     member's rank) marks the named blocks, or every block, reviewed.
 *   - Any other signed Core write (Ari with the flag off): stamps are kept.
 *   - A person's own Studio write: a block they changed is reviewed by them
 *     (saving a section in Studio reviews it); an unchanged block keeps its stamp.
 */

type AnyDoc = Record<string, unknown>;

export const REVIEW_SOURCES: readonly ReviewSource[] = ["ari", "composer"];

/** The hidden, read-only field every Studio block carries. */
export function reviewField(): Field {
  return {
    name: "review",
    label: "Review",
    type: "json",
    admin: { hidden: true, readOnly: true },
  };
}

/** A block's content, without its id, stamp and Payload bookkeeping (key order ignored). */
function stableContent(block: AnyDoc): string {
  const { id: _id, review: _review, blockName: _name, ...rest } = block;
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value as AnyDoc).sort().map((key) => [key, sort((value as AnyDoc)[key])]));
    }
    return value;
  };
  return JSON.stringify(sort(rest));
}

export function isReviewStamp(value: unknown): value is BlockReviewStamp {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stamp = value as AnyDoc;
  return (stamp.state === "draft" || stamp.state === "reviewed") &&
    (stamp.source === "ari" || stamp.source === "composer" || stamp.source === "person") &&
    typeof stamp.at === "string" && (stamp.by === null || typeof stamp.by === "string");
}

export type ReviewContext = {
  /** Set only on a signed Core write by Ari's or the composer's path. */
  source: ReviewSource | null;
  /** "all", or the block ids to mark reviewed ("Looks right"). */
  markReviewed: "all" | ReadonlySet<string> | null;
  editor: string | null;
  now: string;
  /** A signed Core write (Ari's path, Build, "Looks right"): never reviews by saving. */
  signed?: boolean;
};

/** The blocks to store, each with the stamp it is owed (pure; the hook below calls it). */
export function stampBlocks(next: readonly AnyDoc[], previous: readonly AnyDoc[], ctx: ReviewContext): AnyDoc[] {
  const before = new Map<string, AnyDoc>();
  for (const block of previous) if (typeof block.id === "string") before.set(block.id, block);
  return next.map((raw) => {
    const { review: _ignored, ...block } = raw;
    const old = typeof block.id === "string" ? before.get(block.id) : undefined;
    const kept = old && isReviewStamp(old.review) ? old.review : null;
    const changed = !old || stableContent(old) !== stableContent(block);
    let stamp: BlockReviewStamp | null = kept;
    if (ctx.source && changed) {
      stamp = { state: "draft", source: ctx.source, at: ctx.now, by: null };
    } else if (!ctx.source && !ctx.signed && changed && kept?.state === "draft") {
      // A person saved this section in Studio: that reviews it.
      stamp = { state: "reviewed", source: kept.source, at: ctx.now, by: ctx.editor };
    }
    const id = typeof block.id === "string" ? block.id : null;
    const mark = ctx.markReviewed === "all" || (id !== null && ctx.markReviewed?.has(id) === true);
    if (mark && stamp?.state === "draft") stamp = { state: "reviewed", source: stamp.source, at: ctx.now, by: ctx.editor };
    return stamp ? { ...block, review: stamp } : { ...block, review: null };
  });
}

/** Pages hook: runs after enforcePage, so `data.blocks` are the blocks being stored. */
export const stampBlockReview: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (!data || !Array.isArray(data.blocks)) return data;
  const signed = req.context?.minglaSignedCore === true;
  const rawSource = req.context?.minglaReviewSource;
  const source = signed && (rawSource === "ari" || rawSource === "composer") ? rawSource : null;
  const rawMark = req.context?.minglaMarkReviewed;
  const markReviewed = signed
    ? rawMark === "all" ? "all" : Array.isArray(rawMark) ? new Set(rawMark.filter((id): id is string => typeof id === "string")) : null
    : null;
  const previous = Array.isArray(originalDoc?.blocks) ? originalDoc.blocks as AnyDoc[] : [];
  return {
    ...data,
    blocks: stampBlocks(data.blocks as AnyDoc[], previous, {
      source,
      markReviewed,
      editor: editorCoreUserId(req.user),
      now: new Date().toISOString(),
      // #4453 — with the flag off Ari's write carries no source: it keeps the stamp, never reviews.
      signed,
    }),
  };
};

/** A publish refused while Draft sections remain (UNREVIEWED_SECTIONS). */
export class UnreviewedSectionsError extends Error {
  constructor(readonly pages: readonly UnreviewedPage[]) {
    super(UNREVIEWED_SECTIONS);
    this.name = "UnreviewedSectionsError";
  }
}

export function assertNoUnreviewedSections(pages: Parameters<typeof unreviewedPages>[0]): void {
  const blocking = unreviewedPages(pages);
  if (blocking.length > 0) throw new UnreviewedSectionsError(blocking);
}

/** One page's review summary for the Business app ("3 sections to review"). */
export function pageReviewSummary(blocks: readonly AnyDoc[]): { count: number; blocks: { id: string; type: string; source: string }[] } {
  const drafts = blocks
    .filter((block) => isReviewStamp(block.review) && block.review.state === "draft" && typeof block.id === "string")
    .map((block) => ({ id: String(block.id), type: String(block.blockType ?? ""), source: (block.review as BlockReviewStamp).source }));
  return { count: drafts.length, blocks: drafts };
}
