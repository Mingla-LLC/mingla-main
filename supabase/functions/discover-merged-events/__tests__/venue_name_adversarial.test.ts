// ORCH-0846 [Consumer event sheet venue/address parity] — TESTER-AUTHORED
// adversarial regression test.
//
// Mandatory companion to the implementor's happy-path suite at
// `venue_name_resolution.test.ts`, per CLOSE Step 0.5 (ORCH-0840
// [Regression-test enforcement + append-only CI]). Attacks DIFFERENT
// angles than the implementor's tests: edge cases, boundary conditions,
// malformed input, race conditions, contract drift between SQL JSONB and
// TS runtime types. A copy of the happy-path test with renamed `it()`
// blocks would NOT satisfy the gate — these tests probe failure modes
// the happy-path suite cannot reach.
//
// Five adversarial vectors:
//
//   (A1) Literal string "null" — when a client serializes a cleared
//        venueName field via `JSON.stringify({venueName: null})` and a
//        downstream layer mishandles the round-trip, the JSONB value
//        becomes the STRING "null" instead of the JSON null. The
//        helper must NOT treat this as null — it must pass the literal
//        string through as a venue name. Documents the chosen contract.
//
//   (A2) Theme as array, not object — JSONB has no array/object
//        discriminator at the type-level for `unknown`. A row where
//        `theme = '[{"business_event":...}]'` (legacy data shape, or a
//        client bug) must not crash and must return safe defaults.
//
//   (A3) Stress: pathologically long location_text — the SPEC §10.D
//        live probe found data with `"Venue · Street, City, State, Zip,
//        Country"` concatenated. Some rows could contain >2KB strings.
//        The helper must pass them through verbatim without truncation
//        or throw.
//
//   (A4) Unicode + emoji + RTL — venue names with mixed script direction
//        and high-codepoint emoji must round-trip unchanged. The shared
//        PublicEventPage relies on the string surviving JSON +
//        PostgREST + JS engine handoffs.
//
//   (A5) Format-hint case sensitivity + whitespace contamination — the
//        helper accepts ONLY the literal lowercase strings "in_person" /
//        "online" / "hybrid". An attacker (or migration bug) supplying
//        `"In_Person"`, `" online"`, or `"HYBRID"` must fall back to
//        `is_online`, not silently match. Locks in the canonical form.
//
//   (A6) Contract drift trip-wire — extractVenueName and
//        extractBusinessEventFormat must NEVER reach into nested objects
//        beyond `theme.business_event.{venueName,format}`. If anyone
//        ever adds a `theme.location.venueName` or
//        `theme.business_event.location.venueName` fallback in the
//        future, this test catches it. This is an explicit anti-test:
//        adding a fallback IS the breakage, because brand-side
//        publicEventsService also doesn't reach there.
//
// Run with:
//   deno test --allow-read supabase/functions/discover-merged-events/__tests__/venue_name_adversarial.test.ts

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  extractVenueName,
  extractBusinessEventFormat,
  deriveSharedFormat,
  resolveBusinessEventVenueFields,
} from "../_helpers.ts";

// ── A1 — literal "null" string is a valid venue name ────────────────────

Deno.test(
  "ORCH-0846 ADV-A1 — literal string 'null' is treated as a real venue name (not JSON null)",
  () => {
    const theme = { business_event: { venueName: "null" } };
    assertEquals(
      extractVenueName(theme),
      "null",
      "Literal string 'null' must NOT be coerced to JSON null. The helper checks `typeof === 'string'` + trim length, both satisfied. If a future refactor adds a `.toLowerCase() === 'null'` guard, it will silently drop legitimate venue names.",
    );
    const resolved = resolveBusinessEventVenueFields({
      theme,
      locationText: "fallback-should-not-be-used",
      isOnline: false,
    });
    assertEquals(resolved.venueName, "null");
  },
);

// ── A2 — pathological theme shapes ──────────────────────────────────────

Deno.test(
  "ORCH-0846 ADV-A2a — theme as array does not crash",
  () => {
    // Arrays are typeof 'object' in JS. The helper's `business_event` key
    // lookup on an array returns undefined (typed-ok). Must NOT throw.
    const theme = [{ business_event: { venueName: "Sneaky" } }];
    assertEquals(extractVenueName(theme), null);
    assertEquals(extractBusinessEventFormat(theme), null);
  },
);

Deno.test(
  "ORCH-0846 ADV-A2b — theme.business_event as array does not crash",
  () => {
    const theme = { business_event: [{ venueName: "Sneaky" }] };
    assertEquals(extractVenueName(theme), null);
    assertEquals(extractBusinessEventFormat(theme), null);
  },
);

Deno.test(
  "ORCH-0846 ADV-A2c — theme as primitive does not crash",
  () => {
    assertEquals(extractVenueName(42), null);
    assertEquals(extractVenueName("not an object"), null);
    assertEquals(extractVenueName(true), null);
    assertEquals(extractBusinessEventFormat(42), null);
  },
);

// ── A3 — stress: pathologically long strings ────────────────────────────

Deno.test(
  "ORCH-0846 ADV-A3 — 4KB venueName + 4KB location_text round-trip verbatim",
  () => {
    const longVenue = "V".repeat(4096);
    const longLocation = "L".repeat(4096);
    const theme = { business_event: { venueName: longVenue } };
    const resolved = resolveBusinessEventVenueFields({
      theme,
      locationText: longLocation,
      isOnline: false,
    });
    assertEquals(resolved.venueName?.length, 4096);
    assertEquals(resolved.address?.length, 4096);
    assertEquals(
      resolved.venueName,
      longVenue,
      "Helpers must not truncate, no matter the length — the shared component is responsible for any visual clipping.",
    );
  },
);

// ── A4 — unicode + emoji + RTL ──────────────────────────────────────────

Deno.test(
  "ORCH-0846 ADV-A4 — unicode emoji + RTL + zero-width joiner survives",
  () => {
    // U+1F389 party popper + RTL "نادي" + zero-width joiner + script-shift
    const tricky = "Velvet 🎉 نادي‍الليل · 12 رحلة";
    const theme = { business_event: { venueName: tricky } };
    assertEquals(
      extractVenueName(theme),
      tricky,
      "Multi-script + emoji + ZWJ must round-trip identical bytes. Any unicode normalization would break venue names like the live row `'The Exhaustion · 700 Corporate Center Dr'` that uses U+00B7 MIDDLE DOT.",
    );
  },
);

Deno.test(
  "ORCH-0846 ADV-A4b — U+00B7 MIDDLE DOT (live-data canonical separator) survives",
  () => {
    // From SPEC §10.D live probe: locations look like
    //   "The Exhaustion · 700 Corporate Center Dr, Raleigh, NC 27607, USA"
    // The MIDDLE DOT (·) is U+00B7. If anything in the chain re-encodes
    // it as U+2027 HYPHENATION POINT or stripts it, the address display
    // breaks parity with the brand-side page.
    const live = "The Exhaustion · 700 Corporate Center Dr, Raleigh, NC 27607, USA";
    const resolved = resolveBusinessEventVenueFields({
      theme: { business_event: { venueName: null } },
      locationText: live,
      isOnline: false,
    });
    assertEquals(resolved.venueName, live);
    assertEquals(resolved.address, live);
    assert(
      resolved.venueName?.includes("·"),
      "MIDDLE DOT (U+00B7) must survive — it is the canonical venue/address separator in the live event data.",
    );
  },
);

// ── A5 — format-hint canonical-form gate ────────────────────────────────

Deno.test(
  "ORCH-0846 ADV-A5a — capitalized variants of format are REJECTED (fallback to is_online)",
  () => {
    for (const bad of ["In_Person", "ONLINE", "Hybrid", "IN_PERSON"]) {
      assertEquals(
        extractBusinessEventFormat({ business_event: { format: bad } }),
        null,
        `Format hint '${bad}' must be rejected — only the canonical lowercase forms are valid.`,
      );
    }
    // With null hint + is_online=true → falls back to 'online'.
    assertEquals(
      deriveSharedFormat(
        extractBusinessEventFormat({ business_event: { format: "ONLINE" } }),
        true,
      ),
      "online",
    );
  },
);

Deno.test(
  "ORCH-0846 ADV-A5b — whitespace-padded format strings are REJECTED",
  () => {
    for (const bad of [" online", "online ", " in_person ", "\tin_person"]) {
      assertEquals(
        extractBusinessEventFormat({ business_event: { format: bad } }),
        null,
        `Whitespace-padded format '${JSON.stringify(bad)}' must be rejected — the brand-side asFormat does strict equality.`,
      );
    }
  },
);

// ── A6 — anti-test: contract drift trip-wire ────────────────────────────

Deno.test(
  // ORCH-1157 Round-5 [TEST-MOD-APPROVED ORCH-1157] — the ORCH-0846 premise
  // that "ZERO live rows use .location.venueName" was DISPROVEN against live
  // data: 16/16 business events (RSVP + ticketed) carry the venue name at
  // theme.business_event.location.venueName and ZERO carry a top-level
  // theme.business_event.venueName. The old anti-test therefore enforced the
  // very privacy leak it was meant to prevent — extractVenueName returned null
  // and mapRpcRowToCard fell back to location_text (the full street) AS the
  // venueName, leaking the street through the consumer RSVP detail's venue-NAME
  // line. The corrected contract: top-level FIRST (forward-compat), then the
  // canonical nested location.venueName, never the full "name · street" string.
  "ORCH-0846/1157 ADV-A6a — venueName resolves nested location.venueName (NOT location_text)",
  () => {
    // Live shape: top-level venueName absent, real name nested under location.
    const liveShape = {
      business_event: {
        venueName: null,
        location: { venueName: "The Party Venue" },
      },
    };
    assertEquals(
      extractVenueName(liveShape),
      "The Party Venue",
      "Producer must resolve the nested location.venueName (the live shape) so the venue NAME is just the name, never the location_text street fallback.",
    );

    // Top-level still wins when a future writer sets it (forward-compat).
    const topLevelShape = {
      business_event: {
        venueName: "Top Level Name",
        location: { venueName: "Nested Name" },
      },
    };
    assertEquals(extractVenueName(topLevelShape), "Top Level Name");
  },
);

Deno.test(
  "ORCH-0846 ADV-A6b — format MUST NOT be read from theme.location.format or theme.format",
  () => {
    const theme = {
      format: "online", // top-level theme.format — INVALID source
      location: { format: "hybrid" }, // nested — INVALID source
      business_event: { format: null }, // canonical source — null
    };
    assertEquals(
      extractBusinessEventFormat(theme),
      null,
      "Producer must read format ONLY from theme.business_event.format. Top-level or nested fallbacks would silently activate dead/divergent code paths.",
    );
    assertEquals(deriveSharedFormat(null, false), "in-person");
  },
);

// ── A7 — boundary: empty-object theme.business_event ────────────────────

Deno.test(
  "ORCH-0846 ADV-A7 — empty business_event object yields safe defaults",
  () => {
    const theme = { business_event: {} };
    const resolved = resolveBusinessEventVenueFields({
      theme,
      locationText: "123 Main St",
      isOnline: false,
    });
    assertEquals(resolved.venueName, "123 Main St");
    assertEquals(resolved.address, "123 Main St");
    assertEquals(resolved.format, "in-person");
  },
);
