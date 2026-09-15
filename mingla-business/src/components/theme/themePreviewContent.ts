import { deriveCoverPosterUrl } from "../../../../packages/offering-rendering/coverMediaPresentation";

import type { DraftEvent } from "../../store/draftEventStore";
import { formatSingleDateLine } from "../../utils/eventDateDisplay";

/**
 * issue #3349 — what the Theme sheet's preview band shows.
 *
 * The band used to hard-code a made-up event ("Rooftop Sessions",
 * "SAT 12 JUL · 8:00 PM"), so an organiser who had just named and dated their
 * own event opened Theme and saw somebody else's. Offering mounts now pass the
 * draft they are editing; only the brand and venue sheets, which have no single
 * event to show, keep the sample.
 *
 * PURE by contract (no React, no React Native) so the fallbacks are unit-tested
 * under the default node/ts-jest project, like `themeColorModel.ts`.
 */
export interface ThemePreviewContent {
  /** Eyebrow line — the first start, e.g. "Sat 17 Oct · 9 PM". Shown uppercase. */
  dateLine: string;
  title: string;
  /** Label on the accent button, e.g. "Get tickets". */
  ctaLabel: string;
  /**
   * The cover tile. `imageUrl` is a STILL (an image cover, or a video cover's
   * poster) so the sheet never mounts a second video player; null falls back to
   * the hue band. `null` for the whole field = no tile (the sample).
   */
  cover: { hue: number; imageUrl: string | null } | null;
}

/** Brand and venue sheets: no single event exists, so show a sample. */
export const SAMPLE_THEME_PREVIEW: ThemePreviewContent = {
  dateLine: "SAT 12 JUL · 8:00 PM",
  title: "Rooftop Sessions",
  ctaLabel: "Get tickets",
  cover: null,
};

/** The draft fields the preview reads — events, RSVPs and published edits. */
export type ThemePreviewDraft = Pick<
  DraftEvent,
  | "name"
  | "whenMode"
  | "date"
  | "doorsOpen"
  | "multiDates"
  | "coverHue"
  | "coverMediaUrl"
  | "coverMediaType"
> &
  Partial<Pick<DraftEvent, "isRsvp" | "coverMediaPosterUrl">> & {
    /**
     * issue #3373 — set by the experience creator, which has no DraftEvent of
     * its own and builds these fields from its wizard state. Omitted for events
     * and RSVPs (told apart by `isRsvp`), so their preview is unchanged.
     */
    kind?: "experience";
  };

const DEFAULT_COVER_HUE = 25;

const firstStart = (
  draft: ThemePreviewDraft,
): { date: string | null; time: string | null } => {
  if (draft.whenMode !== "multi_date") {
    return { date: draft.date, time: draft.doorsOpen };
  }
  let earliest: { date: string; startTime: string } | null = null;
  for (const entry of draft.multiDates ?? []) {
    if (
      earliest === null ||
      `${entry.date}T${entry.startTime}` <
        `${earliest.date}T${earliest.startTime}`
    ) {
      earliest = entry;
    }
  }
  return earliest === null
    ? { date: null, time: null }
    : { date: earliest.date, time: earliest.startTime };
};

const coverStill = (draft: ThemePreviewDraft): string | null => {
  const url = draft.coverMediaUrl;
  if (url === null || url.length === 0) return null;
  if (draft.coverMediaType === "video") {
    const poster = draft.coverMediaPosterUrl ?? null;
    return poster !== null && poster.length > 0
      ? poster
      : deriveCoverPosterUrl(url);
  }
  return draft.coverMediaType === "image" || draft.coverMediaType === "gif"
    ? url
    : null;
};

/**
 * The fallback name and the accent button's label for each kind of draft.
 * issue #3373 — an experience's public page books with "Reserve" (the one verb
 * every experience surface uses), so its preview button says the same.
 */
const draftWording = (
  draft: ThemePreviewDraft,
): { untitled: string; ctaLabel: string } => {
  if (draft.kind === "experience") {
    return { untitled: "Untitled experience", ctaLabel: "Reserve" };
  }
  return draft.isRsvp === true
    ? { untitled: "Untitled RSVP", ctaLabel: "Going" }
    : { untitled: "Untitled event", ctaLabel: "Get tickets" };
};

/**
 * The preview for the draft being created or edited, with fallbacks for every
 * field that can still be empty: "Untitled event" / "Untitled RSVP" (the same
 * words the Review step's mini card uses) / "Untitled experience", "Date TBD",
 * and the draft's cover colour when there is no media.
 */
export const buildDraftThemePreview = (
  draft: ThemePreviewDraft,
): ThemePreviewContent => {
  const wording = draftWording(draft);
  const name = draft.name.trim();
  const start = firstStart(draft);
  return {
    // "Date TBD" when there is no date; the date alone when there is no time.
    dateLine: formatSingleDateLine(start.date, start.time, null),
    title: name.length > 0 ? name : wording.untitled,
    ctaLabel: wording.ctaLabel,
    cover: {
      hue: Number.isFinite(draft.coverHue) ? draft.coverHue : DEFAULT_COVER_HUE,
      imageUrl: coverStill(draft),
    },
  };
};
