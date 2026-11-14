/**
 * #3872 — changing the video-due date after hire.
 *
 * Seth's decision: the request carries a date AND a time, and the contract
 * shows the agreed (current terms) due date and time. The sheet prefills from
 * the agreed due, sends `changes.video_due_at` ("YYYY-MM-DDTHH:MM", read by
 * the server in the event's time zone) and shows server refusals next to the
 * fields.
 */
import {
  formatInZone,
  toIsoDay,
  videoDueWords,
  zoneDayAndTime,
  zoneLabel,
} from "../../utils/creatorProgramFormat";

/** A stored instant ("…Z" or "+01:00"), not a wall clock ("2026-12-15T12:00"). */
function hasOffset(value: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value);
}

/**
 * #4430 item 1: a due in the gig's zone with its label ("Tue Dec 15, 12:00 PM
 * Lagos time"). A change proposal is saved as the zone's wall clock, so it is
 * shown as written, with the zone label. No zone: today's phone-time words.
 */
export function zonedDueWords(
  videoDueAt: unknown,
  postBy: unknown,
  zone: string | null | undefined,
): string {
  if (zone && typeof videoDueAt === "string" && videoDueAt.length > 10) {
    if (hasOffset(videoDueAt)) {
      const words = formatInZone(videoDueAt, zone);
      if (words) return words;
    } else {
      const words = formatInZone(`${videoDueAt.slice(0, 16)}:00Z`, "UTC");
      if (words.endsWith(" UTC")) return `${words.slice(0, -4)} ${zoneLabel(zone)}`;
    }
  }
  return videoDueWords(videoDueAt, postBy);
}

type TermsLike = Record<string, unknown> & { version?: unknown };

/** The agreed due: the current terms version's, else the gig's. */
export function agreedVideoDue(input: {
  terms: TermsLike[] | null | undefined;
  currentVersion: unknown;
  gig: Record<string, unknown> | null | undefined;
}): { videoDueAt: string | null; postBy: string | null } {
  const terms = Array.isArray(input.terms) ? input.terms : [];
  const current =
    terms.find((row) => row.version === input.currentVersion) ??
    terms[terms.length - 1] ??
    null;
  const pick = (key: string): string | null => {
    const fromTerms = current?.[key];
    if (typeof fromTerms === "string" && fromTerms.length > 0) return fromTerms;
    const fromGig = input.gig?.[key];
    return typeof fromGig === "string" && fromGig.length > 0 ? fromGig : null;
  };
  return { videoDueAt: pick("video_due_at"), postBy: pick("post_by") };
}

/** The agreed due: "Tue Dec 15, 12:00 PM Lagos time" (zone known) or "Nov 22, 6:00 PM". */
export function agreedVideoDueWords(
  due: {
    videoDueAt: string | null;
    postBy: string | null;
  },
  zone: string | null = null,
): string {
  return zonedDueWords(due.videoDueAt, due.postBy, zone);
}

/**
 * Day ("YYYY-MM-DD") and time ("HH:MM") to prefill the sheet with. #4430 1c:
 * the server reads the sent wall clock in the gig's zone, so the prefill is
 * the gig zone's wall clock too, not the phone's.
 */
export function dueChangeInitial(
  due: {
    videoDueAt: string | null;
    postBy: string | null;
  },
  zone: string | null = null,
): { day: string; time: string } {
  const zoned = zone ? zoneDayAndTime(due.videoDueAt, zone) : null;
  if (zoned) return zoned;
  if (due.videoDueAt) {
    const date = new Date(due.videoDueAt);
    if (!Number.isNaN(date.getTime())) {
      return {
        day: toIsoDay(date),
        time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
      };
    }
  }
  return { day: due.postBy ?? "", time: due.postBy ? "23:59" : "" };
}

export type DueChangeErrors = { day?: string; time?: string; form?: string };

/** Checks before sending: both fields are required. */
export function dueChangeLocalErrors(day: string, time: string): DueChangeErrors {
  const errors: DueChangeErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) errors.day = "Choose the new date.";
  if (!/^\d{2}:\d{2}$/.test(time)) errors.time = "Choose the time.";
  return errors;
}

/** The change sent to gig_change_proposal_save. */
export function dueChangePayload(day: string, time: string): { video_due_at: string } {
  return { video_due_at: `${day}T${time}` };
}

/** A server refusal, placed next to the fields. */
export function dueChangeServerErrors(code: string): DueChangeErrors {
  if (code === "video_due_required") {
    return { day: "Pick a date and time that hasn't passed yet." };
  }
  if (code === "video_due_before_shoot") {
    return { day: "The video can't be due before the shoot. Pick a later date or time." };
  }
  if (code === "terms_change_already_open") {
    return { form: "There's already a change waiting for an answer." };
  }
  if (code === "terms_change_window_closed") {
    return { form: "The due date can only change before the script is locked." };
  }
  return { form: "That didn't go through. Try again." };
}

/**
 * Words for an open change: "Proposed: Nov 22, 6:00 PM" for a due change,
 * then any other changed terms.
 */
export function proposalChangeWords(
  changes: Record<string, unknown>,
  zone: string | null = null,
): string {
  const parts: string[] = [];
  const due = changes.video_due_at;
  const postBy = changes.post_by;
  if (typeof due === "string" || typeof postBy === "string") {
    parts.push(`Proposed: ${zonedDueWords(due, postBy, zone)}`);
  }
  for (const key of Object.keys(changes)) {
    if (key === "video_due_at" || key === "post_by") continue;
    if (key === "shoot_date") parts.push(`Shoot on ${videoDueWords(null, changes[key])}`);
    else if (key === "usage_days") parts.push(`Reuse for ${String(changes[key])} days`);
    else parts.push("Other terms");
  }
  return Array.from(new Set(parts)).join(" · ");
}
