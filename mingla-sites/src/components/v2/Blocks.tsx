import type { ComponentType } from "react";
import type { BlockType } from "../../contracts/generated/blocks.ts";

/*
 * #2829 AD-4 — which component draws a block: its type, then its variant.
 *
 * A design supplies one component per (type, variant) it draws. The artifact
 * contract already refuses a variant its design does not draw, so the
 * fallback here (the type's first variant) only matters for an artifact
 * validated against an older registry; a type the design does not draw at all
 * renders nothing rather than something invented. Design-neutral fallback
 * variants for types a design lacks arrive with the second design (W7).
 */
export type BlockVariantMap<P> = Readonly<Record<BlockType, Readonly<Record<string, ComponentType<P>>>>>;

export function pickVariant<P>(map: BlockVariantMap<P>, block: { type: BlockType; variant?: unknown }): ComponentType<P> | null {
  const variants = map[block.type];
  if (!variants) return null;
  return (typeof block.variant === "string" ? variants[block.variant] : undefined) ?? Object.values(variants)[0] ?? null;
}
