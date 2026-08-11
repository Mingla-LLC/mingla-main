// ===========================================================================
// Issue #1848 — "this venue isn't verified" and "ordering is switched off" are
// TWO different refusals, and the order pad prints the server's sentence
// verbatim.
//
// Before this, `resolveOrderContext` answered `venue_not_orderable` from BOTH
// gate 2 (claim_status is not 'verified') and gate 3 (`ordering_enabled` is
// false) — two returns fourteen lines apart — and that code's staff copy read
// "This venue isn't verified for ordering." So a venue that had just PASSED the
// verification gate, claim approved and badge on its public page, was told it
// was unverified: its manager went off to re-do a verification that was already
// correct while the actual switch sat one screen away, in Orders.
//
// `ordering_enabled` defaults OFF, so this is the FIRST refusal a venue meets
// on the ordering rail — not an edge case, the opening move of onboarding.
//
// Every gate below runs against a fake client that really holds the rows and
// really answers the filters, so the code under test walks the same gate order,
// in the same sequence, that it walks in production.
// ===========================================================================

import {
  assert,
  assertNotStrictEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolveOrderContext } from "../venueOrderCore.ts";
import {
  VENUE_ORDER_ERRORS,
  venueOrderErrorCopy,
  venueOrderErrorStatus,
} from "../venueOrderPricing.ts";

const VENUE_ID = "44444444-4444-4444-8444-444444444444";
const BRAND_ID = "55555555-5555-4555-8555-555555555555";

interface Fixture {
  /** `venue_listings` row for VENUE_ID, or null for "no such venue". */
  venue: Record<string, unknown> | null;
  /** `venue_ordering_settings` row for VENUE_ID, or null for "never set up". */
  settings: Record<string, unknown> | null;
}

/** Rows the shipped settings row carries; only the two flags vary per test. */
function settingsRow(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ordering_enabled: true,
    paused_at: null,
    service_charge_bps: 0,
    service_charge_label: "Service",
    tips_enabled: true,
    counter_pickup_enabled: false,
    staff_tabs_enabled: false,
    ...over,
  };
}

function verifiedVenue(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: VENUE_ID,
    brand_id: BRAND_ID,
    name: "The Brasserie",
    claim_status: "verified",
    ...over,
  };
}

/**
 * A client that answers the two reads gate 2 and gate 3 actually make, records
 * the order it was asked for them, and applies the `venue_id` / `id` filter for
 * real — so "gate 2 passed" is a fact about the query, not a stub's say-so.
 */
// deno-lint-ignore no-explicit-any
function orderRailClient(fixture: Fixture): { client: any; tables: string[] } {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const filters: Array<[string, unknown]> = [];
      const self = {
        select: () => self,
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return self;
        },
        maybeSingle() {
          const row = table === "venue_listings"
            ? fixture.venue
            : table === "venue_ordering_settings"
            ? fixture.settings
            : null;
          if (row === null) return Promise.resolve({ data: null, error: null });
          const key = table === "venue_listings" ? "id" : "venue_id";
          const wanted = filters.find(([c]) => c === key)?.[1];
          return Promise.resolve({
            data: wanted === VENUE_ID ? row : null,
            error: null,
          });
        },
      };
      return self;
    },
  };
  return { client, tables };
}

async function resolve(fixture: Fixture) {
  const { client, tables } = orderRailClient(fixture);
  const result = await resolveOrderContext(client, {
    spotCode: null,
    venueId: VENUE_ID,
  });
  return { result, tables };
}

// ---------------------------------------------------------------------------
// THE BUG. A verified venue whose only problem is the switch.
// ---------------------------------------------------------------------------
Deno.test("#1848: the toggle-off refusal is `ordering_disabled`, NOT the verification code", async () => {
  const { result, tables } = await resolve({
    venue: verifiedVenue(),
    settings: settingsRow({ ordering_enabled: false }),
  });

  assert(!result.ok, "ordering is off — the gate must refuse");
  assertStrictEquals(result.failure.code, "ordering_disabled");
  assertNotStrictEquals(
    result.failure.code as string,
    "venue_not_orderable",
    "the whole bug: a VERIFIED venue with an unflipped switch was handed the unverified code",
  );

  // Vacuity guard. If gate 2 had refused, gate 3 would never have been reached
  // and this test would prove nothing about the toggle at all — so assert the
  // settings read genuinely happened, AFTER the venue read.
  assertStrictEquals(tables[0], "venue_listings");
  assertStrictEquals(
    tables[1],
    "venue_ordering_settings",
    "gate 2 must have PASSED — the venue is verified — before gate 3 refused",
  );
});

Deno.test("#1848: the sentence the pad prints names the switch, and never calls a verified venue unverified", async () => {
  const { result } = await resolve({
    venue: verifiedVenue(),
    settings: settingsRow({ ordering_enabled: false }),
  });
  assert(!result.ok);

  // This is verbatim what `venue-order-staff`'s fail() puts on the wire, and
  // what `useVenueOrderPad`'s staffError() surfaces to the waiter unchanged.
  const staff = venueOrderErrorCopy(result.failure.code, "staff", {
    venue: result.failure.venue,
  })!;
  assertStrictEquals(
    staff,
    "Ordering is switched off for this venue. Turn it on from Orders.",
  );
  assert(
    !staff.toLowerCase().includes("verif"),
    "a verified venue must never be told anything about verification: that is the misdirection this issue is about",
  );
  assert(
    staff.includes("Orders"),
    "the sentence must point at the screen holding the switch",
  );
});

Deno.test("#1848: a venue that never set ordering up gets the same honest refusal", async () => {
  // The literal default state at onboarding: gate 2 passes, and there is no
  // `venue_ordering_settings` row at all.
  const { result, tables } = await resolve({
    venue: verifiedVenue(),
    settings: null,
  });
  assert(!result.ok);
  assertStrictEquals(result.failure.code, "ordering_disabled");
  assertStrictEquals(tables[1], "venue_ordering_settings");
});

// ---------------------------------------------------------------------------
// The OTHER cause still answers the verification code — the split has to cut
// both ways or it has only moved the lie.
// ---------------------------------------------------------------------------
Deno.test("#1848: an unverified venue still answers `venue_not_orderable`, with the verification sentence", async () => {
  for (
    const claim of ["pending_review", "rejected", "suspended", "revoked", null]
  ) {
    const { result, tables } = await resolve({
      venue: verifiedVenue({ claim_status: claim }),
      // Switched ON — so the ONLY thing wrong is the claim. If gate 3 were
      // still the one answering, this would come back `ordering_disabled`.
      settings: settingsRow({ ordering_enabled: true }),
    });
    assert(!result.ok, `claim_status ${claim} must refuse`);
    assertStrictEquals(
      result.failure.code,
      "venue_not_orderable",
      `claim_status ${claim}`,
    );
    assertStrictEquals(
      tables.length,
      1,
      "gate 2 refuses before the settings row is ever read",
    );
  }

  const staff = venueOrderErrorCopy("venue_not_orderable", "staff")!;
  assertStrictEquals(
    staff,
    "This venue isn't verified yet. Ordering opens once its claim is approved.",
  );
  assert(
    !staff.includes("switched off"),
    "the verification refusal must not point at the ordering switch",
  );
});

Deno.test("#1848: an unknown venue is unverified, not switched off", async () => {
  const { result } = await resolve({ venue: null, settings: settingsRow() });
  assert(!result.ok);
  assertStrictEquals(result.failure.code, "venue_not_orderable");
  assertStrictEquals(result.failure.venue, "This venue");
});

// ---------------------------------------------------------------------------
// The neighbours. Splitting gate 3 must not move `ordering_paused` or the
// happy path, or the split has traded one wrong answer for another.
// ---------------------------------------------------------------------------
Deno.test("#1848: a switched-ON venue that is PAUSED still answers `ordering_paused`", async () => {
  const { result } = await resolve({
    venue: verifiedVenue(),
    settings: settingsRow({ paused_at: "2026-08-11T19:00:00Z" }),
  });
  assert(!result.ok);
  assertStrictEquals(result.failure.code, "ordering_paused");
  assertStrictEquals(
    venueOrderErrorCopy("ordering_paused", "staff"),
    "Ordering is paused. Turn it back on from Orders.",
  );
});

Deno.test("#1848: a verified venue with the switch ON still resolves — the gates are not just refusing", async () => {
  const { result } = await resolve({
    venue: verifiedVenue(),
    settings: settingsRow(),
  });
  assert(
    result.ok,
    "the happy path must survive the split, or every assertion above is vacuous",
  );
  assertStrictEquals(result.context.servingVenueId, VENUE_ID);
  assertStrictEquals(result.context.brandId, BRAND_ID);
  assertStrictEquals(result.context.venueName, "The Brasserie");
  assertStrictEquals(result.context.settings.ordering_enabled, true);
});

// ---------------------------------------------------------------------------
// The copy contract for the pair.
// ---------------------------------------------------------------------------
Deno.test("#1848: the two codes are distinct, both 409, and the guest learns nothing about the venue's internals", () => {
  assertStrictEquals(venueOrderErrorStatus("venue_not_orderable"), 409);
  assertStrictEquals(venueOrderErrorStatus("ordering_disabled"), 409);

  const unverified = venueOrderErrorCopy("venue_not_orderable", "staff")!;
  const disabled = venueOrderErrorCopy("ordering_disabled", "staff")!;
  assertNotStrictEquals(
    unverified,
    disabled,
    "two causes, two sentences — sharing one is exactly what sent the operator to the wrong screen",
  );

  // The guest side is DELIBERATELY one sentence for both. Which of the two a
  // venue is in is the venue's business, not the scanner's, and both are
  // truthfully "not yet".
  const guestUnverified = venueOrderErrorCopy("venue_not_orderable", "guest", {
    venue: "The Brasserie",
  });
  const guestDisabled = venueOrderErrorCopy("ordering_disabled", "guest", {
    venue: "The Brasserie",
  });
  assertStrictEquals(
    guestUnverified,
    "The Brasserie isn't taking orders through Mingla yet.",
  );
  assertStrictEquals(
    guestDisabled,
    "The Brasserie isn't taking orders through Mingla yet.",
  );
  for (const copy of [guestDisabled!, guestUnverified!]) {
    for (
      const leak of [
        "verif",
        "switch",
        "claim",
        "approv",
        "enabled",
        "settings",
      ]
    ) {
      assert(
        !copy.toLowerCase().includes(leak),
        `guest copy must not expose venue internals ("${leak}")`,
      );
    }
    assert(!copy.includes("{"), "a template token must never reach a guest");
  }
});

Deno.test("#1848: the error table only GREW — `ordering_disabled` is an addition, not a rename", () => {
  // Append-only. Every code the order rail shipped with still resolves.
  for (
    const code of [
      "venue_not_orderable",
      "ordering_paused",
      "spot_unknown",
      "item_not_orderable",
      "counter_pickup_unavailable",
    ] as const
  ) {
    assert(code in VENUE_ORDER_ERRORS, `${code} must still exist`);
  }
  assert("ordering_disabled" in VENUE_ORDER_ERRORS);
  assert(Object.keys(VENUE_ORDER_ERRORS).length >= 25);
});
