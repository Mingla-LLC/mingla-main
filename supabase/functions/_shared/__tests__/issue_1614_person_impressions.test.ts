import { assertEquals } from "jsr:@std/assert@1";

import { type Card, recordPersonCardImpressions } from "../personHeroCards.ts";

function single(id: string): Card {
  return { id, cardType: "single" } as Card;
}

Deno.test("paired impressions write explicit null subject and await an idempotent upsert", async () => {
  let capturedRows: unknown = null;
  let capturedOptions: unknown = null;
  const adminClient = {
    from(table: string) {
      assertEquals(table, "person_card_impressions");
      return {
        async upsert(rows: unknown, options: unknown) {
          capturedRows = rows;
          capturedOptions = options;
          return { error: null };
        },
      };
    },
  };
  const result = await recordPersonCardImpressions({
    adminClient,
    viewerId: "viewer-secret",
    pairedUserId: "paired-secret",
    holidayKey: "holiday-secret",
    cards: [single("place-secret")],
    endpointContext: "get-person-hero-cards",
  });
  assertEquals(result, { attempted: 1, written: true, errorCode: null });
  assertEquals(capturedRows, [{
    user_id: "viewer-secret",
    person_id: null,
    paired_user_id: "paired-secret",
    place_pool_id: "place-secret",
    holiday_key: "holiday-secret",
  }]);
  assertEquals(capturedOptions, {
    onConflict: "user_id,paired_user_id,place_pool_id",
    ignoreDuplicates: true,
  });
});

Deno.test("write failure is fail-soft and emits one redacted structured event", async () => {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const result = await recordPersonCardImpressions({
      adminClient: {
        from() {
          return {
            upsert: async () => ({
              error: { code: "42P10", message: "payload leaked" },
            }),
          };
        },
      },
      viewerId: "viewer-secret",
      pairedUserId: "paired-secret",
      holidayKey: "holiday-secret",
      cards: [single("place-secret")],
      endpointContext: "get-paired-profile-cards",
    });
    assertEquals(result, { attempted: 1, written: false, errorCode: "42P10" });
    assertEquals(errors.length, 1);
    assertEquals(errors[0], [{
      event: "person_card_impression_write_failed",
      code: "42P10",
      endpoint: "get-paired-profile-cards",
      attemptedCount: 1,
    }]);
    const serialized = JSON.stringify(errors);
    for (
      const secret of [
        "viewer-secret",
        "paired-secret",
        "place-secret",
        "holiday-secret",
        "payload leaked",
      ]
    ) {
      assertEquals(serialized.includes(secret), false);
    }
  } finally {
    console.error = originalError;
  }
});

Deno.test("no single cards performs no query", async () => {
  let queried = false;
  const result = await recordPersonCardImpressions({
    adminClient: {
      from() {
        queried = true;
        throw new Error("must not query");
      },
    },
    viewerId: "viewer",
    pairedUserId: "paired",
    holidayKey: "holiday",
    cards: [],
    endpointContext: "get-person-hero-cards",
  });
  assertEquals(queried, false);
  assertEquals(result, { attempted: 0, written: true, errorCode: null });
});
