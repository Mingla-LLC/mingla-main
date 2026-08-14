import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AdDestinationError, resolveAdDestination } from "./adDestination.ts";

class Query {
  private readonly filters = new Map<string, unknown>();
  constructor(
    private readonly table: string,
    private readonly rows: Record<string, unknown>[],
  ) {}
  select(): Query {
    return this;
  }
  eq(column: string, value: unknown): Query {
    this.filters.set(column, value);
    return this;
  }
  in(): Query {
    return this;
  }
  async maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: null;
  }> {
    return {
      data: this.rows.find((row) =>
        row.__table === this.table &&
        [...this.filters].every(([key, value]) => row[key] === value)
      ) ?? null,
      error: null,
    };
  }
}

function db(rows: Record<string, unknown>[]) {
  return {
    from(table: string) {
      return { select: () => new Query(table, rows) };
    },
  };
}

Deno.test("issue #1431 resolves one public Stay to the canonical venue route", async () => {
  const result = await resolveAdDestination(
    db([{
      __table: "ad_public_stay_destinations_view",
      id: "venue-1",
      brand_slug: "truthful-brand",
      slug: "ocean-stay",
    }]),
    {
      page_type: "venue",
      brand_slug: "truthful-brand",
      entity_slug: "ocean-stay",
    },
  );
  assertEquals(result, {
    page_type: "venue",
    brand_slug: "truthful-brand",
    entity_slug: "ocean-stay",
    event_id: null,
    venue_id: "venue-1",
    canonical_url:
      "https://host.usemingla.com/b/truthful-brand/v/ocean-stay",
  });
});

Deno.test("issue #1431 rejects dark, malformed, cross-brand, and widened Stay descriptors", async () => {
  for (
    const descriptor of [
      {
        page_type: "venue",
        brand_slug: "truthful-brand",
        entity_slug: "missing",
      },
      {
        page_type: "venue",
        brand_slug: "Truthful Brand",
        entity_slug: "ocean-stay",
      },
      { page_type: "venue", brand_slug: "truthful-brand" },
      {
        page_type: "venue",
        brand_slug: "truthful-brand",
        entity_slug: "ocean-stay",
        secret: true,
      },
    ]
  ) {
    await assertRejects(
      () => resolveAdDestination(db([]), descriptor),
      AdDestinationError,
    );
  }
});

Deno.test("issue #1431 keeps Event and Brand URL shapes unchanged", async () => {
  const database = db([
    {
      __table: "business_public_events_view",
      id: "event-1",
      brand_slug: "brand",
      slug: "event",
    },
    { __table: "business_public_brands_view", id: "brand-1", slug: "brand" },
  ]);
  assertEquals(
    (await resolveAdDestination(database, {
      page_type: "event",
      brand_slug: "brand",
      entity_slug: "event",
    })).canonical_url,
    "https://host.usemingla.com/e/brand/event",
  );
  assertEquals(
    (await resolveAdDestination(database, {
      page_type: "brand",
      brand_slug: "brand",
    })).canonical_url,
    "https://host.usemingla.com/b/brand",
  );
});
