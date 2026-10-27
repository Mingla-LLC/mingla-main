import { ValidationError, type PayloadRequest } from "payload";
import { studioMediaGrantRequest } from "./studioRequestAuth";
import { requestTenant } from "./tenantIntegrity";
import { HERO_VIDEO_TOO_LONG_MESSAGE, MAX_HERO_VIDEO_MS } from "../contracts/generated/video.ts";

/*
 * #2829 W6 (AD-9) — a hero's background video is a short loop: at most 15
 * seconds. A longer one is refused when the page is saved, with the plain
 * reason, on the hero's video field — never discovered later as a publish
 * failure. A video whose length could not be read is refused too (a length
 * is always recorded when a video is approved).
 */
export const HERO_VIDEO_LENGTH_UNKNOWN_MESSAGE = "We couldn't read this video's length. Upload it again.";

function relationId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "id" in value) return String((value as { id: unknown }).id);
  return null;
}

/** The hero-video problem for a length in ms (null when it may be a hero). */
export function heroVideoProblem(durationMs: unknown): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return HERO_VIDEO_LENGTH_UNKNOWN_MESSAGE;
  return durationMs > MAX_HERO_VIDEO_MS ? HERO_VIDEO_TOO_LONG_MESSAGE : null;
}

export async function assertHeroVideoLengths(req: PayloadRequest, blocks: unknown[]): Promise<void> {
  const heroes: Array<{ index: number; mediaId: string }> = [];
  blocks.forEach((raw, index) => {
    const block = raw as Record<string, unknown> | null;
    const mediaId = block?.blockType === "hero" ? relationId(block.video) : null;
    if (mediaId) heroes.push({ index, mediaId });
  });
  if (!heroes.length) return;
  const signedCore = req.context?.minglaSignedCore === true;
  const result = await req.payload.find({
    collection: "media",
    overrideAccess: signedCore,
    req: signedCore ? req : studioMediaGrantRequest(req),
    depth: 0,
    pagination: false,
    showHiddenFields: true,
    where: {
      and: [
        { tenant: { equals: requestTenant(req) } },
        { id: { in: [...new Set(heroes.map((hero) => hero.mediaId))] } },
      ],
    },
  });
  const durations = new Map(result.docs.map((doc) => [String(doc.id), (doc as { duration_ms?: unknown }).duration_ms]));
  const errors = heroes
    .map((hero) => ({ hero, message: heroVideoProblem(durations.get(hero.mediaId)) }))
    .filter((entry): entry is { hero: (typeof heroes)[number]; message: string } => entry.message !== null)
    .map(({ hero, message }) => ({ path: `blocks.${hero.index}.video`, message }));
  if (errors.length) throw new ValidationError({ collection: "pages", errors, req });
}
