import { assertEquals } from "jsr:@std/assert@1";

import { type Card, recordPersonCardImpressions } from "../personHeroCards.ts";

function single(id: string): Card {
  return { id, cardType: "single" } as Card;
}

Deno.test("a thrown transport failure remains fail-soft and redacted", async () => {
  const events: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => events.push(args);
  try {
    const result = await recordPersonCardImpressions({
      adminClient: {
        from() {
          return {
            upsert: async () => {
              throw new Error("network failed for viewer-secret/place-secret");
            },
          };
        },
      },
      viewerId: "viewer-secret",
      pairedUserId: "paired-secret",
      holidayKey: "holiday-secret",
      cards: [single("place-secret")],
      endpointContext: "get-person-hero-cards",
    });

    assertEquals(result, { attempted: 1, written: false, errorCode: "unknown" });
    assertEquals(events.length, 1);
    assertEquals(events[0], [{
      event: "person_card_impression_write_failed",
      code: "unknown",
      endpoint: "get-person-hero-cards",
      attemptedCount: 1,
    }]);
    const serialized = JSON.stringify(events);
    for (const secret of ["viewer-secret", "paired-secret", "holiday-secret", "place-secret"]) {
      assertEquals(serialized.includes(secret), false);
    }
  } finally {
    console.error = originalError;
  }
});

Deno.test("the helper stays pending until the database write settles", async () => {
  let release: ((value: { error: null }) => void) | undefined;
  const deferred = new Promise<{ error: null }>((resolve) => {
    release = resolve;
  });
  let settled = false;
  const write = recordPersonCardImpressions({
    adminClient: {
      from() {
        return { upsert: () => deferred };
      },
    },
    viewerId: "viewer",
    pairedUserId: "paired",
    holidayKey: "holiday",
    cards: [single("place")],
    endpointContext: "get-paired-profile-cards",
  }).then((result) => {
    settled = true;
    return result;
  });

  await Promise.resolve();
  assertEquals(settled, false);
  release?.({ error: null });
  assertEquals(await write, { attempted: 1, written: true, errorCode: null });
  assertEquals(settled, true);
});

Deno.test("non-single cards never enter the telemetry payload", async () => {
  let rows: unknown = null;
  await recordPersonCardImpressions({
    adminClient: {
      from() {
        return {
          upsert: async (captured: unknown) => {
            rows = captured;
            return { error: null };
          },
        };
      },
    },
    viewerId: "viewer",
    pairedUserId: "paired",
    holidayKey: "holiday",
    cards: [
      single("single-place"),
      { id: "collaboration-place", cardType: "collaboration" } as unknown as Card,
    ],
    endpointContext: "get-person-hero-cards",
  });
  assertEquals(rows, [{
    user_id: "viewer",
    person_id: null,
    paired_user_id: "paired",
    place_pool_id: "single-place",
    holiday_key: "holiday",
  }]);
});
