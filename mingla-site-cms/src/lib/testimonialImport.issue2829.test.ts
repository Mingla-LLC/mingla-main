/*
 * #2829 W5 (amendment A1.3) — the reviews half of a brand's history import.
 *  - each review is copied word for word, attached to its Mingla trip when
 *    the trips import mapping knows it, with its source note;
 *  - "confirmed as real" comes only from the records file; unconfirmed
 *    reviews are imported but never published until confirmed in Studio;
 *  - a review naming an unknown trip stops the import; a dry run writes
 *    nothing; re-running skips reviews already there (same reviewer, day, words).
 */
import { describe, expect, it } from "vitest";
import { importTestimonials, plannedTestimonials } from "./testimonialImport";

const mapping = { trips: { "fixture:coast-2024": { event_id: "11111111-1111-4111-8111-000000000001" } } };
const reviews = [
  { quote: "Best expierence, would go agian.", reviewer: "Fixture R ", review_date: "2024-07-02", trip_import_key: "fixture:coast-2024", source_note: " Invented ", confirmed_real: true },
  { quote: "Not yet confirmed praise.", reviewer: "Fixture T", review_date: "2025-02-01", trip_name: " Ski ", source_note: "Invented", confirmed_real: false },
];

describe("#2829 W5 reviews import", () => {
  it("plans each review word for word, attached to its trip", () => {
    expect(plannedTestimonials(reviews, mapping)).toEqual([
      { quote: "Best expierence, would go agian.", reviewer: "Fixture R", review_date: "2024-07-02T00:00:00.000Z", related_offering: "11111111-1111-4111-8111-000000000001", source_note: "Invented", confirmed_real: true, enabled: true },
      { quote: "Not yet confirmed praise.", reviewer: "Fixture T", review_date: "2025-02-01T00:00:00.000Z", trip_name: "Ski", source_note: "Invented", confirmed_real: false, enabled: true },
    ]);
    expect(() => plannedTestimonials([{ ...reviews[0]!, trip_import_key: "fixture:unknown" }], mapping)).toThrow("REVIEW_TRIP_UNKNOWN");
  });

  it("writes to the one tenant, skips what is already there, and writes nothing on a dry run", async () => {
    const created: Array<Record<string, unknown>> = [];
    const existing = [{ reviewer: "Fixture T", quote: "Not yet confirmed praise." }];
    const payload = {
      find: async () => ({ docs: existing }),
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; },
    } as never;
    const planned = plannedTestimonials(reviews, mapping);
    expect(await importTestimonials(payload, "tenant-1", planned, false)).toEqual([
      { reviewer: "Fixture R", review_date: "2024-07-02", status: "planned" },
      { reviewer: "Fixture T", review_date: "2025-02-01", status: "existing" },
    ]);
    expect(created).toEqual([]);
    await importTestimonials(payload, "tenant-1", planned, true);
    expect(created).toEqual([{ ...planned[0], tenant: "tenant-1" }]);
  });

  // #2829 W7c (A13.4) — a review imported before its trip was known is
  // attached on the next run; an existing attachment is never changed.
  it("attaches an existing unattached review to its trip on a re-run, and never re-points one", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const stored = [
      { id: 7, reviewer: "Fixture R", quote: "Best expierence, would go agian." },
    ];
    const payload = {
      find: async () => ({ docs: stored }),
      create: async () => { throw new Error("must not create"); },
      update: async (args: Record<string, unknown>) => { updates.push(args); return {}; },
    } as never;
    const planned = plannedTestimonials([reviews[0]!], mapping);
    expect(await importTestimonials(payload, "tenant-1", planned, false)).toEqual([
      { reviewer: "Fixture R", review_date: "2024-07-02", status: "planned" },
    ]);
    expect(updates).toEqual([]);
    expect(await importTestimonials(payload, "tenant-1", planned, true)).toEqual([
      { reviewer: "Fixture R", review_date: "2024-07-02", status: "attached" },
    ]);
    expect(updates).toEqual([expect.objectContaining({
      collection: "testimonials",
      id: 7,
      data: { related_offering: "11111111-1111-4111-8111-000000000001" },
      context: { minglaOperatorImportTenantId: "tenant-1" },
    })]);
    updates.length = 0;
    stored[0] = { ...stored[0]!, related_offering: "22222222-2222-4222-8222-000000000002" } as never;
    expect(await importTestimonials(payload, "tenant-1", planned, true)).toEqual([
      { reviewer: "Fixture R", review_date: "2024-07-02", status: "existing" },
    ]);
    expect(updates).toEqual([]);
  });
});
