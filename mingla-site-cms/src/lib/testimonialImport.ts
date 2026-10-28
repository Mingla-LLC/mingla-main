import type { Payload } from "payload";

/*
 * #2829 W5 (amendment A1.3) — the reviews half of a brand's history import:
 * each review copied into the site's Testimonials exactly as the brand has
 * it (typos included), attached to its Mingla trip when the trip is known
 * (from the trips import mapping), with the operator's source note.
 *
 * "Confirmed as real" is carried only when the records file says so (the
 * operator attests it); an unconfirmed review is imported but never
 * published until someone confirms it in Studio. Re-running skips a review
 * already present (same reviewer, day and words) — except that a review
 * imported before its trip was known is attached to that trip now (#2829
 * W7c, A13.4); an existing attachment is never changed. Nothing here can
 * publish: the brand still reviews and publishes the site.
 */
export type ReviewRecord = {
  quote: string;
  reviewer: string;
  review_date: string;
  trip_name?: string;
  trip_import_key?: string;
  source_note: string;
  confirmed_real: boolean;
};

export type TripMapping = { trips: Record<string, { event_id: string }> };

export type PlannedTestimonial = {
  quote: string;
  reviewer: string;
  review_date: string;
  trip_name?: string;
  related_offering?: string;
  source_note: string;
  confirmed_real: boolean;
  enabled: true;
};

/** YYYY-MM-DD → the instant Studio's day picker stores for that day (UTC midnight). */
function dayInstant(day: string): string {
  return `${day}T00:00:00.000Z`;
}

export function plannedTestimonials(reviews: readonly ReviewRecord[], mapping: TripMapping | null): PlannedTestimonial[] {
  return reviews.map((review) => {
    const key = review.trip_import_key?.trim().toLowerCase();
    const eventId = key ? mapping?.trips[key]?.event_id : undefined;
    if (key && !eventId) throw new Error(`REVIEW_TRIP_UNKNOWN:${key}`);
    return {
      quote: review.quote,
      reviewer: review.reviewer.trim(),
      review_date: dayInstant(review.review_date),
      ...(review.trip_name?.trim() ? { trip_name: review.trip_name.trim() } : {}),
      ...(eventId ? { related_offering: eventId } : {}),
      source_note: review.source_note.trim(),
      confirmed_real: review.confirmed_real === true,
      enabled: true,
    };
  });
}

export type ImportOutcome = { reviewer: string; review_date: string; status: "created" | "existing" | "attached" | "planned" };

/** Writes the planned reviews to one tenant (server-side Local API, no Studio user). */
export async function importTestimonials(
  payload: Pick<Payload, "find" | "create" | "update">,
  tenantId: string,
  planned: readonly PlannedTestimonial[],
  apply: boolean,
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];
  for (const review of planned) {
    const existing = await payload.find({
      collection: "testimonials",
      overrideAccess: true,
      draft: true,
      depth: 0,
      pagination: false,
      where: {
        and: [
          { tenant: { equals: tenantId } },
          { reviewer: { equals: review.reviewer } },
          { review_date: { equals: review.review_date } },
        ],
      },
    });
    const day = review.review_date.slice(0, 10);
    const same = existing.docs.find((doc) => (doc as { quote?: unknown }).quote === review.quote) as
      | { id?: string | number; related_offering?: unknown }
      | undefined;
    if (same) {
      const unattached = typeof same.related_offering !== "string" || same.related_offering === "";
      if (review.related_offering && unattached && same.id !== undefined) {
        if (apply) {
          await payload.update({
            collection: "testimonials",
            id: same.id,
            overrideAccess: true,
            draft: true,
            depth: 0,
            context: { minglaOperatorImportTenantId: tenantId },
            data: { related_offering: review.related_offering } as never,
          });
        }
        outcomes.push({ reviewer: review.reviewer, review_date: day, status: apply ? "attached" : "planned" });
        continue;
      }
      outcomes.push({ reviewer: review.reviewer, review_date: day, status: "existing" });
      continue;
    }
    if (!apply) {
      outcomes.push({ reviewer: review.reviewer, review_date: day, status: "planned" });
      continue;
    }
    await payload.create({
      collection: "testimonials",
      overrideAccess: true,
      draft: true,
      depth: 0,
      context: { minglaOperatorImportTenantId: tenantId },
      data: { ...review, tenant: tenantId } as never,
    });
    outcomes.push({ reviewer: review.reviewer, review_date: day, status: "created" });
  }
  return outcomes;
}
