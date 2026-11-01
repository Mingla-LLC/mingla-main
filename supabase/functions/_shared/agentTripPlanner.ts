import type { AgentLoopToolCall } from "./agentLoop.ts";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function explicitDates(text: string): string[] {
  const found: Array<{ index: number; date: string }> = [];
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const date = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date && match.index !== undefined) found.push({ index: match.index, date });
  }
  for (
    const match of text.matchAll(
      /\b(January|Jan\.?|February|Feb\.?|March|Mar\.?|April|Apr\.?|May|June|Jun\.?|July|Jul\.?|August|Aug\.?|September|Sept?\.?|October|Oct\.?|November|Nov\.?|December|Dec\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+)(20\d{2})\b/gi,
    )
  ) {
    const month = MONTHS[(match[1] ?? "").replaceAll(".", "").toLocaleLowerCase()];
    const date = isoDate(Number(match[3]), month, Number(match[2]));
    if (date && match.index !== undefined) found.push({ index: match.index, date });
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.date);
}

/**
 * Build a grounded create_trip call when the request supplies a title, an
 * explicit date range and an IANA timezone. Incomplete requests remain with
 * the normal planner so Ari can ask for the missing facts.
 */
export function buildAriTripCreationCall(
  text: string,
  brandId: string | null,
): AgentLoopToolCall | null {
  if (!brandId) return null;
  const createIntent =
    /\b(?:create|make|set\s+up|setup|schedule|host|plan|start|add|build)\b[\s\S]{0,100}\b(?:trip|retreat)\b/i
      .test(text) ||
    /\b(?:trip|retreat)\b[\s\S]{0,100}\b(?:create|make|set\s+up|setup|schedule|host|plan|start|add|build)\b/i
      .test(text);
  if (!createIntent) return null;

  const titleMatch =
    /\b(?:trip|retreat)\s+(?:called|named)\s+[“'‘]([^”'’]{2,100})[”'’]/i
      .exec(text) ??
    /\b(?:trip|retreat)\s+[“'‘]([^”'’]{2,100})[”'’]/i.exec(text);
  const title = titleMatch?.[1]?.trim();
  const dates = explicitDates(text);
  const timezone = /\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/.exec(text)?.[0];
  if (!title || dates.length !== 2 || !timezone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    return null;
  }
  if (dates[1] <= dates[0]) return null;

  const args: Record<string, unknown> = {
    brand_id: brandId,
    title,
    start_date: dates[0],
    end_date: dates[1],
    timezone,
  };
  const location = /\bLagos(?:\s*,\s*Nigeria)?\b/i.exec(text)?.[0];
  if (location) args.destination_text = location.replace(/\s+/g, " ").trim();
  const capacity =
    /\b(?:maximum|max(?:imum)?\s+of|capacity(?:\s+of)?)\s+(\d{1,6})\s+(?:guests?|travelers?|travellers?)\b/i
      .exec(text)?.[1];
  if (capacity) args.max_guests = Number(capacity);

  return { name: "create_trip", args };
}
