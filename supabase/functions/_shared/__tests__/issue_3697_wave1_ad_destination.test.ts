/**
 * toward #3697 Wave 1 — destination types, canonical URLs (A4-5), past-start reject (A4-4).
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AdDestinationError,
  canonicalAdDestinationUrl,
  resolveAdDestination,
} from "../adDestination.ts";

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
  in(column: string, values: readonly unknown[]): Query {
    this.filters.set(`in:${column}`, values);
    return this;
  }
  async maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: null;
  }> {
    const data = this.rows.find((row) => {
      if (row.__table !== this.table) return false;
      for (const [key, value] of this.filters) {
        if (key.startsWith("in:")) {
          const col = key.slice(3);
          if (!(value as unknown[]).includes(row[col])) return false;
        } else if (row[key] !== value) {
          return false;
        }
      }
      return true;
    }) ?? null;
    return { data, error: null };
  }
}

function db(rows: Record<string, unknown>[]) {
  return {
    from(table: string) {
      return { select: () => new Query(table, rows) };
    },
  };
}

Deno.test("A4-5: trip and experience canonical URLs never use /e/", () => {
  assertEquals(
    canonicalAdDestinationUrl("trip", "acme", "desert-run"),
    "https://host.usemingla.com/t/acme/desert-run",
  );
  assertEquals(
    canonicalAdDestinationUrl("experience", "acme", "pottery"),
    "https://host.usemingla.com/exp/acme/pottery",
  );
  assertEquals(
    canonicalAdDestinationUrl("event", "acme", "friday"),
    "https://host.usemingla.com/e/acme/friday",
  );
  assertEquals(
    canonicalAdDestinationUrl("rsvp", "acme", "house-party"),
    "https://host.usemingla.com/e/acme/house-party",
  );
  assertEquals(
    canonicalAdDestinationUrl("reservation", "acme", null, {
      brandId: "11111111-1111-1111-1111-111111111111",
    }),
    "https://host.usemingla.com/reserve/11111111-1111-1111-1111-111111111111",
  );
});

Deno.test("A4-5: resolveAdDestination maps trip → /t/ and experience → /exp/", async () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const trip = await resolveAdDestination(
    db([{
      __table: "business_public_events_view",
      id: "trip-1",
      brand_slug: "acme",
      slug: "desert-run",
      status: "scheduled",
      event_type: "trip",
      master_start_at: future,
    }]),
    { page_type: "trip", brand_slug: "acme", entity_slug: "desert-run" },
  );
  assertEquals(trip.canonical_url, "https://host.usemingla.com/t/acme/desert-run");

  const exp = await resolveAdDestination(
    db([{
      __table: "business_public_events_view",
      id: "exp-1",
      brand_slug: "acme",
      slug: "pottery",
      status: "scheduled",
      event_type: "experience",
      master_start_at: future,
    }]),
    {
      page_type: "experience",
      brand_slug: "acme",
      entity_slug: "pottery",
    },
  );
  assertEquals(exp.canonical_url, "https://host.usemingla.com/exp/acme/pottery");
});

Deno.test("A4-4: past master_start_at is rejected server-side", async () => {
  const past = new Date(Date.now() - 3600000).toISOString();
  await assertRejects(
    () =>
      resolveAdDestination(
        db([{
          __table: "business_public_events_view",
          id: "evt-1",
          brand_slug: "acme",
          slug: "yesterday",
          status: "scheduled",
          event_type: "event",
          master_start_at: past,
        }]),
        { page_type: "event", brand_slug: "acme", entity_slug: "yesterday" },
      ),
    AdDestinationError,
  );
});

Deno.test("Wave 1: rpc path prefers SQL resolve payload", async () => {
  const client = {
    from() {
      throw new Error("from() must not run when rpc is present");
    },
    rpc(_fn: string, _args: Record<string, unknown>) {
      return Promise.resolve({
        data: {
          ok: true,
          page_type: "trip",
          brand_slug: "acme",
          entity_slug: "desert-run",
          event_id: "trip-1",
          venue_id: null,
          canonical_url: "https://host.usemingla.com/t/acme/desert-run",
          availability: "available",
          availability_reason: null,
          result_kind: "tickets",
        },
        error: null,
      });
    },
  };
  const result = await resolveAdDestination(client, {
    page_type: "trip",
    brand_slug: "acme",
    entity_slug: "desert-run",
  });
  assertEquals(result.canonical_url, "https://host.usemingla.com/t/acme/desert-run");
  assertEquals(result.availability, "available");
});
