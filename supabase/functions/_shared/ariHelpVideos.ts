// Issue #4420 (Host polish pass, part 2 §4.4-4.5) — the help-video catalogue
// at runtime, and the "help_support" turn gate.
//
// `generated/ariHelpVideos.json` is written by scripts/ari/build-help-videos.ts
// from packages/help-content (a parity test keeps it current). Ari shows a
// help-video card only for a slug in it, with the URL built here from the
// catalogue, never from model text (I-4420-ARI-VIDEO-FROM-CATALOGUE).
//
// The show_help_video tool exists only on a turn the Host app's Help &
// Support screen sends with workflow_context "help_support". Every other turn
// (every Host build before this screen) is offered, and may call, exactly the
// tools it was before.

import HELP_VIDEOS_FILE from "./generated/ariHelpVideos.json" with {
  type: "json",
};

export interface AriHelpVideo {
  slug: string;
  episode: number;
  title: string;
  blurb: string;
  duration: string;
  chapter: string;
  intents: string[];
}

interface AriHelpVideoFile {
  schema_version: number;
  base_url: string;
  videos: AriHelpVideo[];
}

const CATALOGUE = HELP_VIDEOS_FILE as AriHelpVideoFile;

export const HELP_VIDEO_BASE_URL = "https://usemingla.com/help/";

export const HELP_VIDEOS_FOR_ARI: readonly AriHelpVideo[] = Object.freeze(
  CATALOGUE.videos.map((video) =>
    Object.freeze({ ...video, intents: [...video.intents] })
  ),
);

const BY_SLUG: ReadonlyMap<string, AriHelpVideo> = new Map(
  HELP_VIDEOS_FOR_ARI.map((video) => [video.slug, video]),
);

/** The catalogue entry for exactly this slug, or null. */
export function helpVideoForAri(slug: unknown): AriHelpVideo | null {
  if (typeof slug !== "string") return null;
  return BY_SLUG.get(slug.trim()) ?? null;
}

/** The card contract the show_help_video tool returns. */
export interface AriHelpVideoCard {
  slug: string;
  title: string;
  blurb: string;
  duration: string;
  chapter: string;
  url: string;
}

export function helpVideoCard(video: AriHelpVideo): AriHelpVideoCard {
  return {
    slug: video.slug,
    title: video.title,
    blurb: video.blurb,
    duration: video.duration,
    chapter: video.chapter,
    url: `${HELP_VIDEO_BASE_URL}${video.slug}`,
  };
}

// ---------------------------------------------------------------------------
// The help_support turn gate.
// ---------------------------------------------------------------------------

export const ARI_HELP_SUPPORT_CONTEXT = "help_support";
export const SHOW_HELP_VIDEO_TOOL = "show_help_video";

/** Tools that exist only on a help_support turn. */
export const ARI_HELP_SUPPORT_ONLY_TOOLS: ReadonlySet<string> = new Set([
  SHOW_HELP_VIDEO_TOOL,
]);

/** May this turn offer or run `toolName`? False only for a help-only tool off the help_support context. */
export function ariHelpSupportToolAllowed(
  toolName: string,
  helpSupport: boolean,
): boolean {
  return helpSupport || !ARI_HELP_SUPPORT_ONLY_TOOLS.has(toolName);
}

/**
 * This turn's tools after the gate: off help_support, every help-only tool
 * is removed (whatever selected it); on it, show_help_video is always there.
 */
export function withAriHelpSupportTools<T extends { name: string }>(
  selected: readonly T[],
  all: readonly T[],
  helpSupport: boolean,
): T[] {
  const gated = selected.filter((tool) =>
    ariHelpSupportToolAllowed(tool.name, helpSupport)
  );
  if (!helpSupport) return gated;
  for (const name of ARI_HELP_SUPPORT_ONLY_TOOLS) {
    if (gated.some((tool) => tool.name === name)) continue;
    const tool = all.find((candidate) => candidate.name === name);
    if (tool) gated.push(tool);
  }
  return gated;
}

/** The catalogue as the help_support prompt lists it (slug — title — jobs). */
export function ariHelpVideoCatalogueLines(): string {
  return HELP_VIDEOS_FOR_ARI.map((video) =>
    `- ${video.slug} — ${video.title} (${video.duration}; ${
      video.intents.join(", ")
    })`
  ).join("\n");
}
