/**
 * #2829 W9r (DESIGN_SPEC §7) — the Website section's words: dates as
 * "26 Oct, 18:54", the collection headers and empty states verbatim from the
 * approved prototype, and the business-type rule (no "restaurant", "menu" or
 * "table" unless the brand ticked food and drink).
 */
import type { CollectionSection } from "./websiteNav";

function locale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-GB";
  } catch {
    return "en-GB";
  }
}

/** "26 Oct, 18:54" (en-GB, 24 h) / "Oct 26, 6:54 PM" (en-US, 12 h). No seconds. */
export function formatWebsiteDateTime(value: string | null | undefined, withLocale: string = locale()): string {
  const time = Date.parse(String(value ?? ""));
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const day = new Intl.DateTimeFormat(withLocale, { day: "numeric", month: "short" }).format(date);
  const clock = new Intl.DateTimeFormat(withLocale, { hour: "numeric", minute: "2-digit" }).format(date);
  return `${day}, ${clock}`;
}

/** "26 Oct 2026" for a calendar day (never shifted by a timezone). */
export function formatWebsiteDay(day: string | null | undefined, withLocale: string = locale()): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return new Intl.DateTimeFormat(withLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
}

/** "20–27 Jun 2025" in the offering's own timezone (the locale's own range style). */
export function formatTripDates(start: string | null, end: string | null, timeZone: string | null, withLocale: string = locale()): string {
  const s = Date.parse(String(start ?? ""));
  if (!Number.isFinite(s)) return "";
  const e = Date.parse(String(end ?? ""));
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: timeZone ?? "UTC" };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(withLocale, options);
  } catch {
    format = new Intl.DateTimeFormat(withLocale, { ...options, timeZone: "UTC" });
  }
  if (!Number.isFinite(e) || e <= s) return format.format(new Date(s));
  const range = (format as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string }).formatRange;
  return typeof range === "function" ? range.call(format, new Date(s), new Date(e)) : `${format.format(new Date(s))} – ${format.format(new Date(e))}`;
}

export const COLLECTION_COPY: Readonly<Record<CollectionSection, {
  title: string;
  subtitle: (pageTitle: string | null) => string;
  add: string;
  one: string;
  emptyTitle: string;
  emptyBody: (pageTitle: string | null) => string;
  emptyAction: string;
  newTitle: string;
}>> = {
  destinations: {
    title: "Destinations",
    subtitle: (page) => `Shown on your ${page ?? "destinations"} page, each with its own page.`,
    add: "Add destination",
    one: "destination",
    emptyTitle: "No destinations yet",
    emptyBody: (page) => `Each destination gets its own page with your story, when to go, photos and the Mingla trips that go there. Your ${page ?? "destinations"} page stays hidden from search until the first one is shown.`,
    emptyAction: "Add your first destination",
    newTitle: "New destination",
  },
  stories: {
    title: "Stories",
    subtitle: (page) => `Shown on your ${page ?? "Stories"} page, newest first unless you reorder.`,
    add: "Write a story",
    one: "story",
    emptyTitle: "No stories yet",
    emptyBody: () => "Itineraries, packing lists, trip recaps. Stories help people find you on search.",
    emptyAction: "Write your first story",
    newTitle: "New story",
  },
  reviews: {
    title: "Reviews",
    subtitle: () => "Real words from real travellers. Each one needs your confirmation before it shows.",
    add: "Add a review",
    one: "review",
    emptyTitle: "No reviews yet",
    emptyBody: () => "Paste reviews word for word from where travellers left them. Mingla never writes reviews for you.",
    emptyAction: "Add your first review",
    newTitle: "Add a review",
  },
};

export const REVIEW_CONFIRM_TEXT = "I confirm this is a real review from a real traveller and I have permission to show it.";
export const REVIEW_CONFIRM_HELP = "Required before it can show on your website. Mingla records who confirmed it and when.";
export const REVIEW_CONFIRM_ADMIN_ONLY = "Only a brand admin or the owner can confirm a review.";

/**
 * What the brand offers, in words allowed on the Website section: only the
 * offerings it ticked; "menu" only for the food-and-drink venue offering.
 */
export function offeringNoun(offerings: readonly string[]): string {
  if (offerings.includes("trips")) return "trips";
  if (offerings.includes("events")) return "events";
  if (offerings.includes("experiences")) return "experiences";
  if (offerings.includes("venue_food_drink")) return "menu";
  return "offerings";
}

/** "Your trips changed in Mingla" — the generalised menu-changed card. */
export function offeringChangedLine(offerings: readonly string[]): string {
  return `Your ${offeringNoun(offerings)} changed in Mingla`;
}
