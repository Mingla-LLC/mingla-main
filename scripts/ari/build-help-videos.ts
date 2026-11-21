// Issue #4420 (Host polish pass, part 2 §4.5) — Ari's help-video catalogue.
//
// Reads packages/help-content/index.ts (the one registry usemingla.com/help
// renders) and writes supabase/functions/_shared/generated/ariHelpVideos.json:
// every help video that exists (a Bamboo entry is set), sorted by episode, no
// timestamps. Edge bundles cannot reach packages/, so Ari reads only this
// JSON (supabase/functions/_shared/ariHelpVideos.ts), and Ari may show a
// video card only for a slug in it (I-4420-ARI-VIDEO-FROM-CATALOGUE).
//
// The parity test rebuilds the file with buildAriHelpVideoCatalogue() and
// fails on any difference:
//   supabase/functions/_shared/__tests__/issue_4420_ari_help_videos.implementor.test.ts
//
// Usage: deno run --allow-read --allow-write scripts/ari/build-help-videos.ts
//        deno run --allow-read scripts/ari/build-help-videos.ts --check
//          (exit 1 when stale)

import { HELP_VIDEOS } from "../../packages/help-content/index.ts";

export const OUTPUT_PATH =
  "supabase/functions/_shared/generated/ariHelpVideos.json";
export const HELP_VIDEO_BASE_URL = "https://usemingla.com/help/";

/** The fields of a help-content record the catalogue reads. */
export interface HelpVideoSource {
  readonly slug: string;
  readonly episode: number;
  readonly title: string;
  readonly blurb: string;
  readonly duration: string;
  readonly chapter: string;
  readonly intents: readonly string[];
  readonly bambooEntryId: string | null;
}

export interface AriHelpVideo {
  slug: string;
  episode: number;
  title: string;
  blurb: string;
  duration: string;
  chapter: string;
  intents: string[];
}

export interface AriHelpVideoCatalogue {
  schema_version: 1;
  base_url: string;
  videos: AriHelpVideo[];
}

/** Pure: the catalogue for a list of help-content records. */
export function buildAriHelpVideoCatalogue(
  records: readonly HelpVideoSource[],
): AriHelpVideoCatalogue {
  const videos = records
    .filter((record) =>
      typeof record.bambooEntryId === "string" &&
      record.bambooEntryId.length > 0
    )
    .map((record) => ({
      slug: record.slug,
      episode: record.episode,
      title: record.title,
      blurb: record.blurb,
      duration: record.duration,
      chapter: record.chapter,
      intents: [...record.intents],
    }))
    .sort((a, b) => a.episode - b.episode || a.slug.localeCompare(b.slug));
  return { schema_version: 1, base_url: HELP_VIDEO_BASE_URL, videos };
}

/** The exact file text the generator writes. */
export function renderAriHelpVideoCatalogue(
  records: readonly HelpVideoSource[] = HELP_VIDEOS,
): string {
  return `${JSON.stringify(buildAriHelpVideoCatalogue(records), null, 2)}\n`;
}

if (import.meta.main) {
  const target = new URL(`../../${OUTPUT_PATH}`, import.meta.url);
  const next = renderAriHelpVideoCatalogue();
  if (Deno.args.includes("--check")) {
    let current = "";
    try {
      current = Deno.readTextFileSync(target);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (current !== next) {
      console.error(
        `${OUTPUT_PATH} is stale. Run: deno run --allow-read --allow-write scripts/ari/build-help-videos.ts`,
      );
      Deno.exit(1);
    }
    console.log(`${OUTPUT_PATH} is current.`);
  } else {
    Deno.writeTextFileSync(target, next);
    console.log(`wrote ${OUTPUT_PATH}`);
  }
}
